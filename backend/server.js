// Carrega variáveis de ambiente ANTES de qualquer outro módulo
require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { queryAll, queryOne, queryRun, initDB } = require('./database');
// const WhatsAppClient = require('./whatsapp'); // Baileys (desativado)
const WhatsAppEvolution = require('./whatsapp-evolution');
const { createCanvas } = require('@napi-rs/canvas');
const multer = require('multer');
const sharp = require('sharp');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
const uploadVideo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 * 1024 * 1024 } });
// ffmpeg removido — PTT não funciona no Baileys v7
const bcrypt = require('bcryptjs');
const erp = require('./erp');
const aiAgent = require('./ai-agent');
const { generateReceiptImage, generateReceiptText } = require('./receipt');

// Valida que JWT_SECRET foi definido no .env (nunca usar fallback hardcoded)
if (!process.env.JWT_SECRET) {
  console.error('❌ ERRO FATAL: JWT_SECRET não definido no .env! O servidor não vai iniciar sem isso.');
  process.exit(1);
}

const compression = require('compression');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET;

// Confia no proxy reverso do Railway/Vercel (necessário para rate limit funcionar corretamente)
app.set('trust proxy', 1);

// Compressão gzip — reduz tamanho das respostas JSON em ~70%
app.use(compression());

// Headers de segurança (CSP, X-Frame-Options, etc.)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS restrito — só aceita do frontend e do Railway
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3002').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Permite requests sem origin (mobile, curl, servidor-a-servidor)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.log('⛔ CORS bloqueou origem:', origin);
    cb(new Error('Origem não permitida'));
  },
  credentials: true,
}));

// Rate limit global — máximo 100 requests por minuto por IP
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 100, message: { error: 'Muitas requisições. Aguarde um momento.' } });
app.use(globalLimiter);

// Rate limit específico para login — máximo 5 tentativas por minuto por IP
const loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Muitas tentativas de login. Aguarde 1 minuto.' } });

app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve mídia salva no banco — protegido por IDs longos e aleatórios (ex: evo_AC71BC721C...)
// Não exige token JWT para evitar problemas de expiração em <img src> e <audio src>
// Cache de mídia em memória (evita query no banco pra cada imagem que aparece no chat)
const mediaCache = new Map();
const MEDIA_CACHE_MAX = 100; // máx 100 itens
const MEDIA_CACHE_TTL = 600000; // 10 min

app.get('/media/:id', async (req, res) => {
  try {
    const id = req.params.id;

    // Verifica cache em memória
    const cached = mediaCache.get(id);
    if (cached && Date.now() < cached.expires) {
      res.set('Content-Type', cached.mime);
      res.set('Content-Length', cached.buffer.length);
      res.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 dias (mídia não muda)
      return res.send(cached.buffer);
    }

    const file = await queryOne("SELECT mime_type, data FROM media_files WHERE id = $1", [id]);
    if (!file) return res.status(404).send('Not found');
    const buffer = Buffer.from(file.data, 'base64');

    // Salva no cache (limpa se muito grande)
    if (mediaCache.size >= MEDIA_CACHE_MAX) {
      const oldest = mediaCache.keys().next().value;
      mediaCache.delete(oldest);
    }
    mediaCache.set(id, { buffer, mime: file.mime_type, expires: Date.now() + MEDIA_CACHE_TTL });

    res.set('Content-Type', file.mime_type);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(buffer);
  } catch (e) { res.status(500).send('Error'); }
});

// ─── Helpers ───
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().split('T')[0];

// ─── Saudação automática (carregada do banco) ───
async function getGreeting() {
  try {
    const enabled = await queryOne("SELECT value FROM chat_settings WHERE key = 'greeting_enabled'");
    if (!enabled || enabled.value !== 'true') return null;
    const text = await queryOne("SELECT value FROM chat_settings WHERE key = 'greeting_text'");
    return text?.value || null;
  } catch { return null; }
}

// ─── Fila de mensagens (processa uma por vez, sem perder nenhuma) ───
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }
  add(handler) {
    this.queue.push(handler);
    this.process();
  }
  async process() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const handler = this.queue.shift();
      try {
        await handler();
      } catch (e) {
        console.error('❌ Erro na fila de mensagens:', e.message);
      }
    }
    this.processing = false;
  }
  get size() { return this.queue.length; }
}
const msgQueue = new MessageQueue();

// ─── Auth Middleware ───
const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token necessário' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// ─── WebSocket ───
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Map(); // userId -> ws

wss.on('connection', (ws, req) => {
  // Autentica via query string: /ws?token=xxx
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  let user = null;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    ws.close(1008, 'Token inválido');
    return;
  }

  clients.set(user.id, ws);
  console.log(`🔌 WS conectado: ${user.name} (${user.id})`);

  ws.on('close', () => {
    clients.delete(user.id);
    console.log(`🔌 WS desconectado: ${user.name}`);
  });

  ws.on('error', () => clients.delete(user.id));
});

// Envia evento para todos os atendentes conectados (resiliente a erros)
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach((ws, userId) => {
    try {
      if (ws.readyState === 1) ws.send(msg);
      else clients.delete(userId);
    } catch (e) {
      console.error(`⚠️ Erro ao enviar WS para ${userId}:`, e.message);
      clients.delete(userId);
    }
  });
}

// ═══════════════════════════════════
// ═══  WHATSAPP                   ═══
// ═══════════════════════════════════
// Provedor de WhatsApp: 'evolution' (não-oficial) ou 'meta' (API oficial Cloud)
const WA_PROVIDER = (process.env.WA_PROVIDER || 'evolution').toLowerCase();
const WhatsAppMeta = require('./whatsapp-meta');
const wa = WA_PROVIDER === 'meta' ? new WhatsAppMeta() : new WhatsAppEvolution();
console.log(`📡 Provedor WhatsApp: ${WA_PROVIDER}`);
let currentQR = null;
let currentPairingCode = null;

// Inicializa agente IA com dependências
aiAgent.init({ wa, broadcast: (...args) => broadcast(...args), genId });

// ─── Webhook do Asaas — confirma pagamento, registra no ERP, envia cupom ───
const asaas = require('./asaas');

app.post('/api/webhook/asaas', async (req, res) => {
  // Valida token de autenticação do Asaas
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (webhookToken) {
    const received = req.headers['asaas-access-token'] || req.query.token;
    if (received !== webhookToken) {
      console.log('⛔ Webhook Asaas rejeitado — token inválido');
      return res.status(403).json({ error: 'Não autorizado' });
    }
  }
  res.json({ ok: true }); // responde rápido
  try {
    const { event, payment } = req.body;
    if (!payment?.id) return;

    // Só processa confirmações de pagamento
    const confirmed = ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'];
    if (!confirmed.includes(event)) {
      if (event === 'PAYMENT_OVERDUE' || event === 'PAYMENT_DELETED' || event === 'PAYMENT_REFUNDED') {
        await queryRun("UPDATE pending_payments SET status = $1 WHERE asaas_charge_id = $2", [event.replace('PAYMENT_', ''), payment.id]);
      }
      return;
    }

    console.log(`💰 Asaas: pagamento ${payment.id} confirmado!`);

    // Busca pagamento pendente
    const pending = await queryOne("SELECT * FROM pending_payments WHERE asaas_charge_id = $1 AND status = 'PENDING'", [payment.id]);
    if (!pending) { console.log('⚠️ Pagamento não encontrado ou já processado:', payment.id); return; }

    // Marca como confirmado
    await queryRun("UPDATE pending_payments SET status = 'CONFIRMED', confirmed_at = NOW() WHERE id = $1", [pending.id]);

    const cartItems = typeof pending.cart_data === 'string' ? JSON.parse(pending.cart_data) : pending.cart_data;

    // Incrementa stock_sold nas combinações cor+tamanho vendidas (grid e photo)
    for (const item of cartItems) {
      if (item.ref) {
        // Tenta grid (cor+tamanho)
        const gridResult = await queryRun(
          `UPDATE promo_stock SET stock_sold = stock_sold + $1
           WHERE promo_item_id IN (SELECT id FROM promo_items WHERE LOWER(ref) = LOWER($2))
             AND LOWER(color) = LOWER($3) AND LOWER(size) = LOWER($4) AND stock_limit > 0`,
          [item.quantity || 1, item.ref, item.color || '', item.size || '']
        );
        // Se não atualizou grid, tenta photo (só cor)
        if (gridResult.rowCount === 0 && item.color) {
          await queryRun(
            `UPDATE promo_photos SET stock_sold = stock_sold + $1
             WHERE promo_item_id IN (SELECT id FROM promo_items WHERE LOWER(ref) = LOWER($2))
               AND LOWER(color) = LOWER($3) AND stock_limit > 0`,
            [item.quantity || 1, item.ref, item.color || '']
          );
        }
      }
    }

    // Busca cliente no ERP
    let customerId = null;
    if (pending.customer_phone) {
      const customer = await erp.findCustomerByPhone(pending.customer_phone);
      if (customer) customerId = customer.id;
    }

    // Cria venda no ERP
    const taxaEntrega = parseFloat(pending.taxa_entrega) || 0;
    const sale = await erp.createSale({
      store_id: 'loja4',
      customer_id: customerId,
      customer_name: pending.customer_name || 'Cliente WhatsApp',
      customer_phone: pending.customer_phone || '',
      seller_name: 'Lê (IA)',
      seller_id: '',
      items: cartItems,
      payment_method: pending.payment_method,
      discount: 0,
      discount_type: 'fixed',
      discount_label: '',
    });
    // Adiciona info de entrega no objeto sale pra o cupom
    sale.taxa_entrega = taxaEntrega;
    sale.tipo_entrega = pending.tipo_entrega || 'retirada';
    if (taxaEntrega > 0) sale.total = sale.total + taxaEntrega;

    console.log(`✅ Venda ${sale.cupom} criada no ERP — R$ ${sale.total.toFixed(2)}`);

    // Envia cupom e confirmação via WhatsApp
    if (wa.connected && pending.customer_phone) {
      try {
        // Mensagem de confirmação
        const confirmMsg = pending.payment_method === 'pix'
          ? `Pagamento via PIX confirmado! R$ ${sale.total.toFixed(2)}`
          : `Pagamento via cartão confirmado! R$ ${sale.total.toFixed(2)}`;
        await wa.sendMessage(pending.customer_phone, confirmMsg, { isBot: true });

        const confirmMsgId = genId();
        await queryRun(
          "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
          [confirmMsgId, pending.conversation_id, 'Lê (IA)', confirmMsg]
        );

        // Envia cupom
        const receiptBuffer = generateReceiptImage(sale, 'Lê (IA)', pending.customer_name || 'Cliente');
        const caption = `🧾 Cupom D'Black Store\n💰 Total: R$ ${sale.total.toFixed(2)}\nObrigado pela compra! 🖤`;
        const cupomResult = await wa.sendImage(pending.customer_phone, receiptBuffer, caption, { isBot: true });

        const msgId = cupomResult?._waId || genId();
        const mediaId = 'img_' + msgId;
        await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
          [mediaId, 'image/png', receiptBuffer.toString('base64')]);
        await queryRun(
          "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1,$2,true,$3,$4,'image',$5,1,NOW())",
          [msgId, pending.conversation_id, 'Lê (IA)', `/media/${mediaId}|${caption}`, `/media/${mediaId}`]
        );

        const displayText = `🧾 Pagamento confirmado — R$ ${sale.total.toFixed(2)}`;
        await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
          [displayText, pending.conversation_id]);

        if (broadcast) {
          broadcast('new_message', {
            conversation: { id: pending.conversation_id, last_message: displayText, last_message_from_me: true },
            message: { id: msgId, conversation_id: pending.conversation_id, from_me: true, sender: 'Lê (IA)', content: `/media/${mediaId}|${caption}`, media_type: 'image', media_url: `/media/${mediaId}`, timestamp: new Date().toISOString() },
          });
        }

        // Envia link do formulário (entrega ou retirada)
        const tipoEntrega = pending.tipo_entrega || 'retirada';
        let formMsg;
        if (tipoEntrega === 'entrega') {
          formMsg = `📋 Para finalizarmos a entrega, preencha o formulário com seu endereço:\n\nhttps://dblack-entregas.vercel.app/formulario\n\nAssim que preenchermos, enviaremos sua encomenda! 🚚`;
        } else {
          formMsg = `📋 Para agilizar sua retirada, preencha o formulário abaixo:\n\nhttps://dblack-entregas.vercel.app/retirada\n\nAssim que estiver pronto, avisaremos você! 🏪`;
        }
        await wa.sendMessage(pending.customer_phone, formMsg, { isBot: true });
        const formMsgId = genId();
        await queryRun(
          "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
          [formMsgId, pending.conversation_id, 'Lê (IA)', formMsg]
        );
        await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
          [formMsg, pending.conversation_id]);
        if (broadcast) {
          broadcast('new_message', {
            conversation: { id: pending.conversation_id, last_message: formMsg, last_message_from_me: true },
            message: { id: formMsgId, conversation_id: pending.conversation_id, from_me: true, sender: 'Lê (IA)', content: formMsg, timestamp: new Date().toISOString() },
          });
        }
      } catch (e) {
        console.error('⚠️ Erro ao enviar confirmação/cupom:', e.message);
      }
    }
  } catch (e) { console.error('❌ Erro webhook Asaas:', e.message); }
});

// Webhook da Evolution API — protegido com chave secreta (opcional)
// Configure WEBHOOK_SECRET no .env para ativar. Na URL do webhook da Evolution, adicione ?secret=SUA_CHAVE
app.post('/api/webhook/evolution', async (req, res) => {
  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (webhookSecret) {
    const received = req.headers['x-webhook-secret'] || req.query.secret;
    if (received !== webhookSecret) {
      console.log('⛔ Webhook rejeitado — chave inválida. IP:', req.ip);
      return res.status(403).json({ error: 'Não autorizado' });
    }
  }
  res.json({ ok: true }); // responde rápido pra Evolution não dar timeout
  try {
    await wa.processWebhook(req.body);
  } catch (e) { console.error('Webhook erro:', e.message); }
});

// Webhook da API oficial do Meta (Cloud API)
// GET = verificação do endpoint (handshake exigido pelo Meta ao cadastrar o webhook)
app.get('/api/webhook/meta', (req, res) => {
  const verifyToken = process.env.META_WA_VERIFY_TOKEN;
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken) {
    console.log('✅ Webhook do Meta verificado!');
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/api/webhook/meta', async (req, res) => {
  res.sendStatus(200); // responde rápido — Meta reenvia se demorar
  try {
    await wa.processWebhook(req.body);
  } catch (e) { console.error('Webhook Meta erro:', e.message); }
});

wa.on('qr', async (qr) => {
  currentQR = await QRCode.toDataURL(qr);
  broadcast('qr', { qr: currentQR });
});

wa.on('pairing_code', (code) => {
  currentPairingCode = code;
  broadcast('pairing_code', { code });
  console.log('🔢 Código de pareamento enviado aos clientes:', code);
});

// ─── Alertas de queda do WhatsApp (via ntfy — fora do WhatsApp) ───
// Espera 2 min antes do primeiro alerta (evita falso alarme em queda transitória),
// depois re-alerta a cada 15 min enquanto estiver fora do ar.
const { sendAlert } = require('./alert');
let waDownSince = null;
let waDownAlerted = false;
let waAlertTimer = null;

function scheduleDownAlert(delay = 120000) {
  if (waAlertTimer) return;
  waAlertTimer = setTimeout(async () => {
    waAlertTimer = null;
    if (wa.connected) { waDownSince = null; waDownAlerted = false; return; }
    waDownAlerted = true;
    const mins = Math.max(1, Math.round((Date.now() - (waDownSince || Date.now())) / 60000));
    await sendAlert(
      '🚨 WhatsApp do D\'Black Chat CAIU',
      `Desconectado há ${mins} min. Clientes sem resposta!\n\nAbra o painel → Configurações → Parear, e digite o código no celular em Aparelhos conectados → Conectar com número de telefone.`
    );
    scheduleDownAlert(900000); // re-alerta em 15 min se continuar fora
  }, delay);
}

wa.on('connected', () => {
  currentQR = null;
  currentPairingCode = null;
  broadcast('wa_status', { connected: true });
  if (waAlertTimer) { clearTimeout(waAlertTimer); waAlertTimer = null; }
  if (waDownAlerted) {
    const mins = Math.max(1, Math.round((Date.now() - (waDownSince || Date.now())) / 60000));
    sendAlert('✅ WhatsApp reconectado', `O WhatsApp do D'Black Chat voltou após ${mins} min fora do ar.`, { tags: ['white_check_mark'], priority: 3 });
  }
  waDownSince = null;
  waDownAlerted = false;
});

wa.on('disconnected', () => {
  currentQR = null;
  currentPairingCode = null;
  broadcast('wa_status', { connected: false, message: 'WhatsApp desconectou. Tentando reconectar...' });
  console.log('⚠️ WhatsApp desconectou — tentando reconexão automática...');
  if (!waDownSince) waDownSince = Date.now();
  scheduleDownAlert();
});

// Reconexão automática esgotada — só o pairing code resolve (ação manual no celular)
wa.on('recovery_needed', () => {
  sendAlert(
    '🚨 WhatsApp precisa de reconexão MANUAL',
    'A reconexão automática falhou (provável device_removed). NÃO insista no QR code.\n\n1. Abra o painel → Configurações → Parear\n2. No celular: Aparelhos conectados → Conectar com número de telefone\n3. Digite o código IMEDIATAMENTE (expira rápido)'
  );
});

// Atualiza status de entrega das mensagens (enviado/entregue/lido)
wa.on('message_ack', async ({ id, ack }) => {
  try {
    await queryRun("UPDATE messages SET ack = $1 WHERE id = $2 AND ack < $1", [ack, id]);
    broadcast('message_ack', { id, ack });
  } catch (e) { console.error('Erro ao atualizar ack:', e.message); }
});

// Quando recebe mensagem do WhatsApp — entra na fila pra processar sequencialmente
wa.on('message', (msg) => {
  msgQueue.add(async () => {
    try {
      // Marca como lido (simula comportamento humano)
      if (msg.id) await wa.markAsRead(msg.id, msg.phone);

      // Busca ou cria conversa para este telefone
      let conv = await queryOne("SELECT * FROM conversations WHERE phone = $1 AND status != 'finalizado' ORDER BY started_at DESC LIMIT 1", [msg.phone]);

      if (!conv) {
        // Nova conversa — vai pra fila "aguardando"
        const convId = genId();
        await queryRun(
          `INSERT INTO conversations (id, phone, customer_name, customer_push_name, status, unread_count, last_message, last_message_at, last_message_from_me, real_phone)
           VALUES ($1, $2, $3, $4, 'aguardando', 1, $5, NOW(), false, $6)`,
          [convId, msg.phone, msg.pushName || msg.phone, msg.pushName || '', msg.content, msg.realPhone || null]
        );
        conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [convId]);

        // Envia saudação automática para cliente novo (só se IA estiver desativada)
        const aiEnabled = await aiAgent.isAgentEnabled();
        const greetingText = !aiEnabled ? await getGreeting() : null;
        if (wa.connected && greetingText) {
          try {
            const greeting = greetingText.replace('{nome}', msg.pushName || 'cliente');
            const greetResult = await wa.sendMessage(msg.phone, greeting, { isBot: true });
            // Salva a saudação no histórico
            const greetId = greetResult?._waId || genId();
            await queryRun(
              "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, $3, $4, 1, NOW())",
              [greetId, convId, 'D\'Black Bot', greeting]
            );
            console.log(`👋 Saudação enviada para ${msg.pushName || msg.phone}`);
          } catch (e) { console.error('Erro ao enviar saudação:', e.message); }
        }
      } else {
        // Atualiza conversa existente — se finalizada, reabre como aguardando
        const reopen = conv.status === 'finalizado' ? ", status = 'aguardando', assigned_to = NULL" : '';
        await queryRun(
          `UPDATE conversations SET unread_count = unread_count + 1, last_message = $1, last_message_at = NOW(), last_message_from_me = false, customer_push_name = COALESCE(NULLIF($2, ''), customer_push_name), real_phone = COALESCE(NULLIF($4, ''), real_phone)${reopen} WHERE id = $3`,
          [msg.content, msg.pushName || '', conv.id, msg.realPhone || '']
        );
        if (conv.status === 'finalizado') console.log(`🔄 Conversa ${conv.phone} reaberta (era finalizada)`);
        conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
      }

      // Salva mensagem (com media_url se tiver)
      const msgId = msg.id || genId();
      await queryRun(
        "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, timestamp) VALUES ($1, $2, false, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING",
        [msgId, conv.id, msg.pushName || msg.phone, msg.content, msg.mediaType || null, msg.mediaUrl || null, msg.timestamp]
      );

      // Notifica todos os atendentes em tempo real
      broadcast('new_message', {
        conversation: conv,
        message: { id: msgId, conversation_id: conv.id, from_me: false, sender: msg.pushName || msg.phone, content: msg.content, media_type: msg.mediaType, media_url: msg.mediaUrl, timestamp: msg.timestamp },
      });

      // ─── AGENTE DE IA "Lê" ───
      // Responde automaticamente se: IA ativa + conversa aguardando (sem atendente humano)
      // IMPORTANTE: roda FORA da fila para não bloquear mensagens de outros clientes
      if (conv.status === 'aguardando') {
        const aiEnabled = await aiAgent.isAgentEnabled();

        // Modo teste: se ai_test_phones estiver configurado, só responde esses números
        let aiAllowed = aiEnabled;
        if (aiEnabled) {
          try {
            const testRow = await queryOne("SELECT value FROM chat_settings WHERE key = 'ai_test_phones'");
            if (testRow && testRow.value && testRow.value.trim()) {
              const testPhones = testRow.value.split(',').map(p => p.trim().replace(/\D/g, ''));
              const cleanPhone = (msg.phone || '').replace(/\D/g, '');
              aiAllowed = testPhones.some(tp => cleanPhone.includes(tp) || tp.includes(cleanPhone.slice(-11)));
              if (!aiAllowed) console.log(`🧪 Lê em modo teste — ignorando ${msg.phone} (não está na lista)`);
            }
          } catch (e) { /* sem config de teste = responde todos */ }
        }

        if (aiAllowed) {
          const aiConvId = conv.id;
          const aiPhone = msg.phone;
          const aiPushName = msg.pushName;
          const aiContent = msg.content;
          const aiMediaType = msg.mediaType;

          // Processa IA em background (não bloqueia a fila)
          setImmediate(async () => {
            try {
              const aiResponse = await aiAgent.generateResponse(aiConvId, aiContent, aiPushName, aiMediaType, aiPhone);
              if (aiResponse.text) {
                let aiWaResult = await wa.sendMessage(aiPhone, aiResponse.text, { isBot: true });
                // Retry se falhou (timeout, erro 500, etc)
                if (!aiWaResult?.key?.id && (aiWaResult?.status >= 400 || aiWaResult?.error)) {
                  console.log('⚠️ Retry envio da Lê para', aiPhone);
                  await new Promise(r => setTimeout(r, 2000));
                  aiWaResult = await wa.sendMessage(aiPhone, aiResponse.text, { isBot: false });
                }
                if (!aiWaResult?.key?.id && (aiWaResult?.status >= 400 || aiWaResult?.error)) {
                  console.error('❌ Erro ao enviar resposta da Lê:', JSON.stringify(aiWaResult).slice(0, 300));
                }
                const aiMsgId = aiWaResult?._waId || genId();
                await queryRun(
                  "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, $3, $4, 1, NOW())",
                  [aiMsgId, aiConvId, 'Lê (IA)', aiResponse.text]
                );
                await queryRun(
                  "UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
                  [aiResponse.text, aiConvId]
                );
                const freshConv = await queryOne("SELECT * FROM conversations WHERE id = $1", [aiConvId]);
                broadcast('new_message', {
                  conversation: freshConv || { id: aiConvId, last_message: aiResponse.text, last_message_from_me: true },
                  message: { id: aiMsgId, conversation_id: aiConvId, from_me: true, sender: 'Lê (IA)', content: aiResponse.text, timestamp: new Date().toISOString() },
                });
                console.log(`🤖 Lê respondeu para ${aiPushName || aiPhone}`);

                if (aiResponse.shouldTransfer) {
                  console.log(`🔀 Lê transferindo ${aiPushName || aiPhone} para atendente humano`);
                  await queryRun(
                    "UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
                    ['🔀 IA transferiu para atendente', aiConvId]
                  );
                  broadcast('conversation_updated', { ...freshConv, last_message: '🔀 IA transferiu para atendente' });
                }
              }
            } catch (e) {
              console.error('❌ Erro IA ao responder:', e.message);
            }
          });
        }
      }

      if (msgQueue.size > 0) console.log(`📬 Fila: ${msgQueue.size} mensagens pendentes`);
    } catch (e) {
      console.error('❌ Erro ao processar mensagem:', e.message);
    }
  });
});

// ═══════════════════════════════════
// ═══  AUTH ROUTES                ═══
// ═══════════════════════════════════
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    // Autentica no banco do ERP
    const user = await erp.findUser(email);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });

    const validPass = await bcrypt.compare(password, user.password);
    if (!validPass) return res.status(401).json({ error: 'Senha inválida' });

    const avatar = user.avatar || user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    // No chat: admin do ERP = admin, demais = atendente
    const chatRole = user.role === 'admin' ? 'admin' : 'atendente';
    const token = jwt.sign({ id: user.id, name: user.name, role: chatRole, erpRole: user.role, avatar }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, id: user.id, name: user.name, role: chatRole, avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  // Busca no ERP pra garantir que ainda está ativo
  const user = await erp.findUser(req.user.name);
  if (!user || !user.active) return res.status(401).json({ error: 'Usuário não encontrado' });
  const avatar = user.avatar || user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const chatRole = user.role === 'admin' ? 'admin' : 'atendente';
  res.json({ id: user.id, name: user.name, email: user.email, role: chatRole, avatar, active: user.active });
});

// ═══════════════════════════════════
// ═══  USERS (admin only)         ═══
// ═══════════════════════════════════
// Lista usuários do ERP (somente leitura — gerenciar pelo ERP)
app.get('/api/users', auth, async (req, res) => {
  try {
    const users = await erp.listUsers();
    // Mapeia role do ERP para o chat
    res.json(users.map(u => ({
      ...u,
      role: u.role === 'admin' ? 'admin' : 'atendente',
      avatar: u.avatar || u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  CONVERSATIONS              ═══
// ═══════════════════════════════════
app.get('/api/conversations', auth, async (req, res) => {
  try {
    // Todas as ativas (aguardando + atendendo) + finalizadas dos últimos 2 dias
    const convs = await queryAll(
      `SELECT * FROM conversations
       WHERE status IN ('aguardando', 'atendendo')
       UNION ALL
       SELECT * FROM conversations
       WHERE status = 'finalizado' AND finished_at > NOW() - INTERVAL '2 days'
       ORDER BY last_message_at DESC`
    );
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Busca conversas por nome ou telefone — INCLUI finalizadas antigas (que não aparecem na lista padrão).
// Resolve o "sumiço" das conversas: os dados continuam no banco, aqui a equipe reencontra qualquer cliente.
app.get('/api/conversations/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json([]);
    const like = '%' + q + '%';
    const digits = q.replace(/\D/g, '');
    const params = [like];
    let phoneClause = '';
    if (digits.length >= 3) {
      params.push('%' + digits + '%');
      phoneClause = ` OR phone ILIKE $${params.length} OR real_phone ILIKE $${params.length}`;
    }
    const convs = await queryAll(
      `SELECT * FROM conversations
       WHERE customer_name ILIKE $1 OR customer_push_name ILIKE $1 OR phone ILIKE $1${phoneClause}
       ORDER BY last_message_at DESC LIMIT 50`,
      params
    );
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aceitar conversa (mover de aguardando → atendendo)
app.post('/api/conversations/:id/accept', auth, async (req, res) => {
  try {
    await queryRun(
      "UPDATE conversations SET status = 'atendendo', agent_id = $1, agent_name = $2, accepted_at = NOW() WHERE id = $3",
      [req.user.id, req.user.name, req.params.id]
    );
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
    broadcast('conversation_updated', conv);
    res.json(conv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Finalizar conversa
app.post('/api/conversations/:id/finish', auth, async (req, res) => {
  try {
    await queryRun(
      "UPDATE conversations SET status = 'finalizado', finished_at = NOW(), finished_by = $1 WHERE id = $2",
      [req.user.name, req.params.id]
    );
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
    broadcast('conversation_updated', conv);
    res.json(conv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Transferir conversa (devolve pra fila)
app.post('/api/conversations/:id/transfer', auth, async (req, res) => {
  try {
    await queryRun(
      "UPDATE conversations SET status = 'aguardando', agent_id = NULL, agent_name = NULL WHERE id = $1",
      [req.params.id]
    );
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
    broadcast('conversation_updated', conv);
    res.json(conv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Atualizar telefone real de conversa LID
app.put('/api/conversations/:id/real-phone', auth, async (req, res) => {
  try {
    const { real_phone } = req.body;
    await queryRun("UPDATE conversations SET real_phone = $1 WHERE id = $2", [real_phone || null, req.params.id]);
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
    broadcast('conversation_updated', conv);
    res.json(conv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  MESSAGES                   ═══
// ═══════════════════════════════════
app.get('/api/messages/:conversationId', auth, async (req, res) => {
  try {
    // Carrega últimas 100 mensagens (conversas longas não precisam carregar tudo)
    const msgs = await queryAll(
      `SELECT * FROM (
        SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 100
      ) sub ORDER BY timestamp ASC`,
      [req.params.conversationId]
    );
    // Marca como lido — mas NÃO se for admin (admin só monitora)
    if (req.user.role !== 'admin') {
      await queryRun("UPDATE conversations SET unread_count = 0 WHERE id = $1", [req.params.conversationId]);
    }
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Marcar conversa como não lida
app.post('/api/conversations/:conversationId/mark-unread', auth, async (req, res) => {
  try {
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.conversationId]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    const count = conv.unread_count > 0 ? conv.unread_count : 1;
    await queryRun("UPDATE conversations SET unread_count = $1 WHERE id = $2", [count, conv.id]);
    const updated = { ...conv, unread_count: count };
    broadcast('conversation_updated', updated);
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar mensagem (atendente → cliente via WhatsApp)
app.post('/api/messages/send', auth, async (req, res) => {
  try {
    const { conversation_id, content } = req.body;
    if (!conversation_id || !content || !content.trim()) return res.status(400).json({ error: 'Conversa e conteúdo são obrigatórios' });
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Envia via WhatsApp com nome do atendente
    const waText = `*${req.user.name}:*\n${content}`;
    const waResult = await wa.sendMessage(conv.phone, waText);

    // Usa o ID do WhatsApp para rastrear entrega/leitura (se disponível)
    const msgId = waResult?._waId || genId();
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, $3, $4, 1, NOW()) ON CONFLICT (id) DO NOTHING",
      [msgId, conversation_id, req.user.name, content]
    );

    // Atualiza última mensagem
    await queryRun(
      "UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
      [content, conversation_id]
    );

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content, ack: 1, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: content, last_message_from_me: true }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar imagem (atendente → cliente via WhatsApp) — com compressão automática
app.post('/api/messages/send-image', auth, upload.single('image'), async (req, res) => {
  try {
    const { conversation_id, caption } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Imagem não enviada' });

    // Comprime a imagem: reduz para max 1280px e qualidade 80% (JPEG)
    let imageBuffer = req.file.buffer;
    try {
      imageBuffer = await sharp(req.file.buffer)
        .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      console.log(`📷 Imagem comprimida: ${Math.round(req.file.buffer.length/1024)}KB → ${Math.round(imageBuffer.length/1024)}KB`);
    } catch (e) {
      console.log('⚠️ Compressão falhou, usando original:', e.message);
    }

    // Envia via WhatsApp (usa o buffer já comprimido)
    const waResult = await wa.sendImage(conv.phone, imageBuffer, caption || '');

    // Salva no banco (usa o buffer comprimido — menor e mais rápido)
    const msgId = waResult?._waId || genId();
    const mediaId = 'img_' + msgId;
    const base64 = imageBuffer.toString('base64');
    await queryRun(
      "INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [mediaId, 'image/jpeg', base64]
    );

    const mediaUrl = `/media/${mediaId}`;
    const displayText = caption ? `📷 ${caption}` : '📷 Imagem';
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1, $2, true, $3, $4, 'image', $5, 1, NOW())",
      [msgId, conversation_id, req.user.name, mediaUrl + (caption ? `|${caption}` : ''), mediaUrl]
    );
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [displayText, conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: mediaUrl + (caption ? `|${caption}` : ''), media_type: 'image', media_url: mediaUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: displayText, last_message_from_me: true }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar arquivo (atendente → cliente via WhatsApp)
app.post('/api/messages/send-file', auth, upload.single('file'), async (req, res) => {
  try {
    const { conversation_id } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });

    const jid = conv.phone.includes('@') ? conv.phone : conv.phone + '@s.whatsapp.net';
    const fileName = req.file.originalname || 'arquivo';
    const mime = req.file.mimetype || 'application/octet-stream';

    // Salva no banco
    const mediaId = 'file_' + genId();
    await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3)", [mediaId, mime, req.file.buffer.toString('base64')]);

    // Envia via WhatsApp (Evolution API)
    const waResultDoc = await wa.sendDocument(conv.phone, req.file.buffer, fileName, mime);

    const msgId = waResultDoc?._waId || genId();
    const displayText = `📎 ${fileName}`;
    const fileUrl = `/media/${mediaId}`;
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1, $2, true, $3, $4, 'document', $5, 1, NOW())",
      [msgId, conversation_id, req.user.name, displayText, fileUrl]
    );
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [displayText, conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: displayText, media_type: 'document', media_url: fileUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: displayText, last_message_from_me: true }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar vídeo (atendente → cliente via WhatsApp)
app.post('/api/messages/send-video', auth, uploadVideo.single('video'), async (req, res) => {
  try {
    const { conversation_id, caption } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Vídeo não enviado' });

    console.log(`🎥 Enviando vídeo: ${Math.round(req.file.buffer.length/1024/1024)}MB | ${req.file.mimetype}`);

    // Envia via WhatsApp
    const waResult = await wa.sendVideo(conv.phone, req.file.buffer, caption || '');

    // Salva no banco
    const msgId = waResult?._waId || genId();
    const mediaId = 'vid_' + msgId;
    const mime = req.file.mimetype || 'video/mp4';
    await queryRun(
      "INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
      [mediaId, mime, req.file.buffer.toString('base64')]
    );

    const mediaUrl = `/media/${mediaId}`;
    const displayText = caption ? `🎥 ${caption}` : '🎥 Vídeo';
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1, $2, true, $3, $4, 'video', $5, 1, NOW())",
      [msgId, conversation_id, req.user.name, mediaUrl + (caption ? `|${caption}` : ''), mediaUrl]
    );
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [displayText, conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: mediaUrl + (caption ? `|${caption}` : ''), media_type: 'video', media_url: mediaUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: displayText, last_message_from_me: true }, message });
    res.json(message);
  } catch (e) {
    console.error('❌ Erro ao enviar vídeo:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Enviar áudio PTT (via Evolution API — converte automaticamente)
app.post('/api/messages/send-audio', auth, upload.single('audio'), async (req, res) => {
  try {
    const { conversation_id } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Áudio não enviado' });

    // Salva no banco
    const mediaId = 'aud_' + genId();
    const audioMime = req.file.mimetype || 'audio/ogg';
    await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3)", [mediaId, audioMime, req.file.buffer.toString('base64')]);

    // Envia via Evolution (sendWhatsAppAudio converte pra OGG Opus automaticamente)
    const waResultAud = await wa.sendAudio(conv.phone, req.file.buffer);

    const msgId = waResultAud?._waId || genId();
    const audioUrl = `/media/${mediaId}`;
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1, $2, true, $3, $4, 'audio', $5, 1, NOW())",
      [msgId, conversation_id, req.user.name, audioUrl, audioUrl]
    );
    await queryRun("UPDATE conversations SET last_message = '🎵 Áudio', last_message_at = NOW(), last_message_from_me = true WHERE id = $1", [conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: audioUrl, media_type: 'audio', media_url: audioUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: '🎵 Áudio', last_message_from_me: true }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Foto de perfil do WhatsApp
app.get('/api/profile-pic/:phone', auth, async (req, res) => {
  try {
    const url = await wa.getProfilePic(req.params.phone);
    res.json({ url });
  } catch { res.json({ url: null }); }
});

// Apagar mensagem enviada (para todos)
app.delete('/api/messages/:id', auth, async (req, res) => {
  try {
    const msg = await queryOne("SELECT * FROM messages WHERE id = $1", [req.params.id]);
    if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada' });
    // Admin pode apagar qualquer mensagem, demais só as enviadas
    if (!msg.from_me && req.user.role !== 'admin') return res.status(403).json({ error: 'Só pode apagar mensagens enviadas' });

    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [msg.conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Apaga no WhatsApp — só a Evolution suporta (API oficial do Meta não permite apagar pra todos)
    if (typeof wa.api === 'function') {
      try {
        await wa.api('DELETE', 'chat/deleteMessageForEveryone', {
          id: req.params.id,
          fromMe: true,
          remoteJid: conv.phone.includes('@') ? conv.phone : conv.phone + '@s.whatsapp.net',
        });
      } catch (e) { console.log('Erro ao apagar no WhatsApp:', e.message); }
    }

    // Marca como apagada no banco
    await queryRun("UPDATE messages SET content = '🚫 Mensagem apagada', media_type = NULL, media_url = NULL WHERE id = $1", [req.params.id]);

    broadcast('message_deleted', { id: req.params.id, conversation_id: msg.conversation_id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buscar dados do cliente no ERP pelo telefone
app.get('/api/erp/customer-details/:phone', auth, async (req, res) => {
  try {
    const customer = await erp.findCustomerByPhone(req.params.phone);
    if (!customer) return res.json({ not_found: true });

    // Busca últimas compras do cliente
    const sales = await erp.erpQuery(
      "SELECT id, total, payment, status, date, items FROM sales WHERE customer_id = $1 OR customer_whatsapp LIKE $2 ORDER BY created_at DESC LIMIT 10",
      [customer.id, `%${req.params.phone.slice(-9)}%`]
    );

    res.json({ ...customer, recent_sales: sales });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  WHATSAPP STATUS            ═══
// ═══════════════════════════════════
app.get('/api/whatsapp/status', auth, async (req, res) => {
  // Se acha que está offline, consulta o provedor pra confirmar
  if (!wa.connected) {
    try {
      if (await wa.checkHealth()) {
        wa.connected = true;
        console.log('✅ WhatsApp reconectado (verificação de status)');
      }
    } catch {}
  }
  res.json({ ...wa.getStatus(), qr: currentQR, pairingCode: currentPairingCode, number: process.env.WHATSAPP_NUMBER || '' });
});

app.post('/api/whatsapp/reconnect', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await wa.connect();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/whatsapp/pair', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Informe o número do WhatsApp' });

    // Evolution API — solicita conexão
    await wa.startPairing(phone);
    // Retorna QR code ou pairing code
    if (wa.pairingCode) {
      res.json({ success: true, pairingCode: wa.pairingCode });
    } else if (wa.qrCode) {
      currentQR = wa.qrCode;
      res.json({ success: true, qr: wa.qrCode, message: 'Escaneie o QR Code no WhatsApp' });
    } else {
      res.json({ success: true, message: 'Aguardando... verifique o status.' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  TAGS DE CONVERSAS          ═══
// ═══════════════════════════════════
app.post('/api/conversations/:id/tags', auth, async (req, res) => {
  try {
    const { tag, color } = req.body;
    const id = genId();
    await queryRun("INSERT INTO conversation_tags (id, conversation_id, tag, color) VALUES ($1,$2,$3,$4)", [id, req.params.id, tag, color || '#00a884']);
    // Atualiza campo tags na conversa
    const tags = await queryAll("SELECT tag, color FROM conversation_tags WHERE conversation_id = $1", [req.params.id]);
    await queryRun("UPDATE conversations SET tags = $1 WHERE id = $2", [tags.map(t => t.tag).join(','), req.params.id]);
    res.json({ id, tag, color });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/conversations/:id/tags/:tagId', auth, async (req, res) => {
  try {
    await queryRun("DELETE FROM conversation_tags WHERE id = $1", [req.params.tagId]);
    const tags = await queryAll("SELECT tag FROM conversation_tags WHERE conversation_id = $1", [req.params.id]);
    await queryRun("UPDATE conversations SET tags = $1 WHERE id = $2", [tags.map(t => t.tag).join(','), req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/conversations/:id/tags', auth, async (req, res) => {
  try { res.json(await queryAll("SELECT * FROM conversation_tags WHERE conversation_id = $1", [req.params.id])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  HISTÓRICO POR CLIENTE      ═══
// ═══════════════════════════════════
app.get('/api/conversations/history/:phone', auth, async (req, res) => {
  try {
    const convs = await queryAll(
      "SELECT * FROM conversations WHERE phone = $1 ORDER BY started_at DESC LIMIT 50",
      [req.params.phone]
    );
    res.json(convs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  BUSCA DE MENSAGENS         ═══
// ═══════════════════════════════════
app.get('/api/messages/search', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 3) return res.json([]); // Mínimo 3 chars (reduz queries pesadas)
    const msgs = await queryAll(
      `SELECT m.*, c.customer_push_name, c.phone FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.content ILIKE $1
       ORDER BY m.timestamp DESC LIMIT 30`,
      [`%${q}%`]
    );
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  FILA INTELIGENTE           ═══
// ═══════════════════════════════════
app.post('/api/conversations/:id/auto-assign', auth, async (req, res) => {
  try {
    // Fila inteligente desativada por enquanto (estrutura pronta)
    return res.json({ disabled: true, message: 'Fila inteligente desativada. Ative nas configurações.' });
    // Pega o atendente com menos conversas ativas
    const agents = await queryAll(
      "SELECT agent_id, agent_name, COUNT(*) as active_count FROM conversations WHERE status = 'atendendo' AND agent_id IS NOT NULL GROUP BY agent_id, agent_name ORDER BY active_count ASC"
    );
    const allUsers = await erp.listUsers();
    const atendentes = allUsers.filter(u => u.role !== 'admin' && u.active);

    let assigned = null;
    if (agents.length > 0) {
      // Atendente com menos carga
      assigned = agents[0];
    } else if (atendentes.length > 0) {
      // Nenhum tem conversa, pega o primeiro
      assigned = { agent_id: atendentes[0].id, agent_name: atendentes[0].name };
    }

    if (assigned) {
      await queryRun(
        "UPDATE conversations SET status = 'atendendo', agent_id = $1, agent_name = $2, accepted_at = NOW() WHERE id = $3",
        [assigned.agent_id, assigned.agent_name, req.params.id]
      );
      const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [req.params.id]);
      broadcast('conversation_updated', conv);
      res.json(conv);
    } else {
      res.json({ error: 'Nenhum atendente disponível' });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  MÉTRICAS DA IA             ═══
// ═══════════════════════════════════
app.get('/api/ai-metrics', auth, async (req, res) => {
  try {
    const total = await queryOne("SELECT COUNT(*) as c FROM ai_metrics");
    const resolved = await queryOne("SELECT COUNT(*) as c FROM ai_metrics WHERE resolved_by_ai = true");
    const transferred = await queryOne("SELECT COUNT(*) as c FROM ai_metrics WHERE transferred = true");
    const avgTime = await queryOne("SELECT AVG(response_time_ms) as avg FROM ai_metrics WHERE response_time_ms > 0");
    const daily = await queryAll(
      "SELECT created_at::date as day, COUNT(*) as total, SUM(CASE WHEN resolved_by_ai THEN 1 ELSE 0 END) as resolved, SUM(CASE WHEN transferred THEN 1 ELSE 0 END) as transferred FROM ai_metrics GROUP BY day ORDER BY day DESC LIMIT 30"
    );
    res.json({
      total: parseInt(total.c),
      resolved: parseInt(resolved.c),
      transferred: parseInt(transferred.c),
      avg_response_ms: Math.round(parseFloat(avgTime.avg) || 0),
      resolution_rate: parseInt(total.c) > 0 ? Math.round(parseInt(resolved.c) / parseInt(total.c) * 100) : 0,
      daily,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  RESPOSTAS RÁPIDAS          ═══
// ═══════════════════════════════════
app.get('/api/quick-replies', auth, async (req, res) => {
  try {
    const replies = await queryAll("SELECT id, label, text, category, sort_order, active, image_mime, CASE WHEN image_data IS NOT NULL THEN true ELSE false END as has_image FROM quick_replies WHERE active = true ORDER BY sort_order ASC");
    res.json(replies);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Imagem da resposta rápida
app.get('/api/quick-replies/:id/image', auth, async (req, res) => {
  try {
    const qr = await queryOne("SELECT image_data, image_mime FROM quick_replies WHERE id = $1", [req.params.id]);
    if (!qr?.image_data) return res.status(404).send('Sem imagem');
    const buffer = Buffer.from(qr.image_data, 'base64');
    res.set('Content-Type', qr.image_mime || 'image/jpeg');
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) { res.status(500).send('Erro'); }
});
app.post('/api/quick-replies', auth, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { label, text, category } = req.body;
    const id = genId();
    const imageData = req.file ? req.file.buffer.toString('base64') : null;
    const imageMime = req.file ? req.file.mimetype : null;
    await queryRun("INSERT INTO quick_replies (id, label, text, category, image_data, image_mime) VALUES ($1,$2,$3,$4,$5,$6)", [id, label, text, category || 'geral', imageData, imageMime]);
    res.json({ id, label, text, category: category || 'geral', has_image: !!imageData, active: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/quick-replies/:id', auth, upload.single('image'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { label, text, category, remove_image } = req.body;
    if (req.file) {
      await queryRun("UPDATE quick_replies SET label=$1, text=$2, category=$3, image_data=$4, image_mime=$5 WHERE id=$6", [label, text, category, req.file.buffer.toString('base64'), req.file.mimetype, req.params.id]);
    } else if (remove_image === 'true') {
      await queryRun("UPDATE quick_replies SET label=$1, text=$2, category=$3, image_data=NULL, image_mime=NULL WHERE id=$4", [label, text, category, req.params.id]);
    } else {
      await queryRun("UPDATE quick_replies SET label=$1, text=$2, category=$3 WHERE id=$4", [label, text, category, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/quick-replies/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM quick_replies WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  CONFIGURAÇÕES              ═══
// ═══════════════════════════════════
app.get('/api/settings', auth, async (req, res) => {
  try {
    const rows = await queryAll("SELECT * FROM chat_settings");
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/settings', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    for (const [key, value] of Object.entries(req.body)) {
      await queryRun("INSERT INTO chat_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2", [key, String(value)]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  AGENTES DE IA              ═══
// ═══════════════════════════════════
app.get('/api/ai-agents', auth, async (req, res) => {
  try { res.json(await queryAll("SELECT * FROM ai_agents ORDER BY created_at")); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/ai-agents', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { name, personality, instructions, knowledge_base, auto_reply, max_wait_seconds } = req.body;
    const id = genId();
    await queryRun(
      "INSERT INTO ai_agents (id, name, personality, instructions, knowledge_base, auto_reply, max_wait_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, name, personality || '', instructions || '', knowledge_base || '', auto_reply || false, max_wait_seconds || 60]
    );
    res.json({ id, name, enabled: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/ai-agents/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { name, enabled, personality, instructions, knowledge_base, auto_reply, max_wait_seconds } = req.body;
    await queryRun(
      "UPDATE ai_agents SET name=$1, enabled=$2, personality=$3, instructions=$4, knowledge_base=$5, auto_reply=$6, max_wait_seconds=$7 WHERE id=$8",
      [name, enabled, personality, instructions, knowledge_base, auto_reply, max_wait_seconds || 60, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/ai-agents/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM ai_agents WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  PROMOÇÃO (Semana de Oportunidade) ═══
// ═══════════════════════════════════
app.get('/api/promo-items', auth, async (req, res) => {
  try { res.json(await queryAll("SELECT * FROM promo_items ORDER BY category, display_name")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promo-items', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { ref, category, display_name, promo_price } = req.body;
    if (!ref || !category || !display_name) return res.status(400).json({ error: 'ref, category e display_name são obrigatórios' });
    const id = genId();
    const price = promo_price ? parseFloat(promo_price) : null;
    await queryRun("INSERT INTO promo_items (id, ref, category, display_name, promo_price) VALUES ($1,$2,$3,$4,$5)", [id, ref, category, display_name, price]);
    res.json({ id, ref, category, display_name, promo_price: price, active: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/promo-items/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { category, display_name, active, promo_price } = req.body;
    await queryRun("UPDATE promo_items SET category = COALESCE($1, category), display_name = COALESCE($2, display_name), active = COALESCE($3, active), promo_price = COALESCE($4, promo_price) WHERE id = $5",
      [category, display_name, active, promo_price !== undefined ? (promo_price ? parseFloat(promo_price) : null) : undefined, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/promo-items/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM promo_items WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Fotos da promoção (múltiplas por produto/cor)
app.get('/api/promo-items/:id/photos', auth, async (req, res) => {
  try {
    const photos = await queryAll("SELECT id, promo_item_id, color, mime_type, stock_limit, stock_sold, created_at FROM promo_photos WHERE promo_item_id = $1 ORDER BY color", [req.params.id]);
    res.json(photos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promo-items/:id/photos', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { color, image } = req.body; // image = base64 string
    if (!image) return res.status(400).json({ error: 'image (base64) é obrigatório' });
    const id = genId();
    const mime = image.startsWith('/9j/') ? 'image/jpeg' : image.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
    await queryRun("INSERT INTO promo_photos (id, promo_item_id, color, mime_type, data) VALUES ($1,$2,$3,$4,$5)",
      [id, req.params.id, color || '', mime, image]);
    res.json({ id, promo_item_id: req.params.id, color: color || '', mime_type: mime, stock_limit: 0, stock_sold: 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/promo-photos/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { stock_limit } = req.body;
    if (stock_limit !== undefined) {
      await queryRun("UPDATE promo_photos SET stock_limit = $1 WHERE id = $2", [parseInt(stock_limit) || 0, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/promo-photos/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM promo_photos WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Estoque promo por cor+tamanho
app.get('/api/promo-items/:id/stock', auth, async (req, res) => {
  try {
    const rows = await queryAll("SELECT * FROM promo_stock WHERE promo_item_id = $1 ORDER BY color, size", [req.params.id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/promo-items/:id/stock', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { color, size, stock_limit } = req.body;
    if (!color && !size) return res.status(400).json({ error: 'cor ou tamanho obrigatório' });
    const id = genId();
    await queryRun(
      "INSERT INTO promo_stock (id, promo_item_id, color, size, stock_limit) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (promo_item_id, color, size) DO UPDATE SET stock_limit = $5",
      [id, req.params.id, color || '', size || '', parseInt(stock_limit) || 0]
    );
    const row = await queryOne("SELECT * FROM promo_stock WHERE promo_item_id = $1 AND color = $2 AND size = $3", [req.params.id, color || '', size || '']);
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/promo-stock/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { stock_limit } = req.body;
    await queryRun("UPDATE promo_stock SET stock_limit = $1 WHERE id = $2", [parseInt(stock_limit) || 0, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/promo-stock/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM promo_stock WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve foto da promo (público, pra IA enviar)
app.get('/api/promo-photos/:id/image', async (req, res) => {
  try {
    const photo = await queryOne("SELECT mime_type, data FROM promo_photos WHERE id = $1", [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });
    const buffer = Buffer.from(photo.data, 'base64');
    res.set('Content-Type', photo.mime_type);
    res.set('Content-Length', buffer.length);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  DASHBOARD / RELATÓRIOS     ═══
// ═══════════════════════════════════
// Cache simples do dashboard (evita 5+ queries pesadas a cada request)
let dashboardCache = { data: null, expires: 0 };

app.get('/api/dashboard', auth, async (req, res) => {
  try {
    // Cache de 10 segundos — evita múltiplos atendentes disparando a mesma query
    if (dashboardCache.data && Date.now() < dashboardCache.expires) {
      return res.json(dashboardCache.data);
    }

    const todayStr = today();
    const [totalConvs, todayConvs, waitingConvs, activeConvs, totalMsgsToday] = await Promise.all([
      queryOne("SELECT COUNT(*) as c FROM conversations"),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE started_at::date = $1", [todayStr]),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE status = 'aguardando'"),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE status = 'atendendo'"),
      queryOne("SELECT COUNT(*) as c FROM messages WHERE timestamp >= $1::date", [todayStr]),
    ]);
    // Vendas do dia no ERP
    let todaySales = { count: 0, total: 0 };
    try {
      const sales = await erp.erpQuery("SELECT COUNT(*) as c, COALESCE(SUM(total),0) as t FROM sales WHERE date = $1 AND store_id = 'loja4' AND status = 'Concluída'", [todayStr]);
      if (sales[0]) todaySales = { count: parseInt(sales[0].c), total: parseFloat(sales[0].t) };
    } catch {}
    // Top atendentes
    const topAgents = await queryAll(
      "SELECT agent_name, COUNT(*) as total FROM conversations WHERE status = 'finalizado' AND finished_at::date = $1 AND agent_name IS NOT NULL GROUP BY agent_name ORDER BY total DESC LIMIT 5",
      [todayStr]
    );
    const result = {
      total_conversations: parseInt(totalConvs.c),
      today_conversations: parseInt(todayConvs.c),
      waiting: parseInt(waitingConvs.c),
      active: parseInt(activeConvs.c),
      today_messages: parseInt(totalMsgsToday.c),
      today_sales: todaySales,
      top_agents: topAgents,
    };
    dashboardCache = { data: result, expires: Date.now() + 10000 };
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reports', auth, async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const toDate = to || today();
    const [convsByDay, salesByDay, agentStats] = await Promise.all([
      queryAll("SELECT started_at::date as day, COUNT(*) as total FROM conversations WHERE started_at::date BETWEEN $1 AND $2 GROUP BY day ORDER BY day", [fromDate, toDate]),
      erp.erpQuery("SELECT date as day, COUNT(*) as count, SUM(total) as total FROM sales WHERE date BETWEEN $1 AND $2 AND store_id = 'loja4' AND status = 'Concluída' GROUP BY date ORDER BY date", [fromDate, toDate]).catch(() => []),
      queryAll("SELECT agent_name, COUNT(*) as total, AVG(EXTRACT(EPOCH FROM (finished_at - accepted_at))) as avg_time FROM conversations WHERE status = 'finalizado' AND finished_at::date BETWEEN $1 AND $2 AND agent_name IS NOT NULL GROUP BY agent_name ORDER BY total DESC", [fromDate, toDate]),
    ]);
    res.json({ conversations_by_day: convsByDay, sales_by_day: salesByDay, agent_stats: agentStats, from: fromDate, to: toDate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Contatos do Chat (clientes que mandaram mensagem)
app.get('/api/contacts', auth, async (req, res) => {
  try {
    // Removida subquery correlacionada (N+1) — agora usa só agregação simples
    const contacts = await queryAll(`
      SELECT phone, MAX(customer_push_name) as customer_push_name,
             COUNT(DISTINCT id) as total_conversations,
             MIN(started_at) as first_contact,
             MAX(last_message_at) as last_contact
      FROM conversations
      GROUP BY phone
      ORDER BY MAX(last_message_at) DESC
      LIMIT 500
    `);
    res.json(contacts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lista de contatos do ERP
app.get('/api/erp/customers', auth, async (req, res) => {
  try {
    const { q } = req.query;
    let customers;
    if (q && q.length >= 2) {
      const like = `%${q}%`;
      customers = await erp.erpQuery("SELECT * FROM customers WHERE name ILIKE $1 OR whatsapp ILIKE $1 OR cpf ILIKE $1 OR email ILIKE $1 ORDER BY name LIMIT 50", [like]);
    } else {
      customers = await erp.erpQuery("SELECT * FROM customers ORDER BY name LIMIT 100");
    }
    res.json(customers);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  ERP — VENDAS               ═══
// ═══════════════════════════════════

// Buscar produtos por SKU ou descrição
app.get('/api/erp/products', auth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json([]);
    const products = await erp.searchProducts(q);
    // Monta URL da foto — se já for URL completa, usa direto; senão, adiciona prefixo
    const uploadsUrl = process.env.ERP_UPLOADS_URL || '';
    products.forEach(p => {
      if (p.photo) {
        p.photo_url = p.photo.startsWith('http') ? p.photo : `${uploadsUrl}/${p.photo}`;
      }
    });
    res.json(products);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Estoque de um produto por loja
app.get('/api/erp/products/:id/stock', auth, async (req, res) => {
  try {
    const stock = await erp.getProductStock(req.params.id);
    res.json(stock);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Lojas do ERP
app.get('/api/erp/stores', auth, async (req, res) => {
  try {
    const stores = await erp.getStores();
    res.json(stores);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Buscar cliente por telefone
app.get('/api/erp/customer/:phone', auth, async (req, res) => {
  try {
    const customer = await erp.findCustomerByPhone(req.params.phone);
    res.json(customer || { not_found: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Finalizar venda e enviar cupom via WhatsApp
app.post('/api/erp/sales', auth, async (req, res) => {
  try {
    const { store_id, customer_id, customer_phone, customer_name, items, payment_method, discount, discount_type, discount_label } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'Carrinho vazio' });

    // Usa o nome que veio do frontend (pushName do WhatsApp) ou busca no ERP
    let customerDisplayName = customer_name || 'Cliente WhatsApp';
    if (!customer_name && customer_phone) {
      const cust = await erp.findCustomerByPhone(customer_phone);
      if (cust) customerDisplayName = cust.name;
    }

    // Cria venda no ERP
    const sale = await erp.createSale({
      store_id: store_id || 'loja4',
      customer_id,
      customer_name: customerDisplayName,
      customer_phone,
      seller_name: req.user.name,
      seller_id: req.user.id,
      items,
      payment_method: payment_method || 'pix',
      discount: discount || 0,
      discount_type: discount_type || 'fixed',
      discount_label: discount_label || '',
    });

    // Gera cupom como imagem e texto
    const receiptBuffer = generateReceiptImage(sale, req.user.name, customerDisplayName);
    const receiptText = generateReceiptText(sale, req.user.name, customerDisplayName);

    // Busca a conversa ativa deste telefone
    const conv = customer_phone ? await queryOne(
      "SELECT * FROM conversations WHERE phone = $1 AND status != 'finalizado' ORDER BY last_message_at DESC LIMIT 1",
      [customer_phone]
    ) : null;

    // Envia cupom via WhatsApp e registra no chat
    if (customer_phone && wa.connected) {
      try {
        const caption = `🧾 Cupom D'Black Store\n💰 Total: R$ ${sale.total.toFixed(2)}\nObrigado pela compra! 🖤`;
        const cupomResult = await wa.sendImage(customer_phone, receiptBuffer, caption);

        // Registra no chat (salva imagem no banco para exibição no painel)
        if (conv) {
          const msgId = cupomResult?._waId || genId();
          const mediaId = 'img_' + msgId;
          const base64 = receiptBuffer.toString('base64');
          await queryRun(
            "INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
            [mediaId, 'image/png', base64]
          );
          const mediaUrl = `/media/${mediaId}`;
          const displayText = `🧾 Cupom enviado — R$ ${sale.total.toFixed(2)}`;
          await queryRun(
            "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1, $2, true, $3, $4, 'image', $5, 1, NOW())",
            [msgId, conv.id, req.user.name, mediaUrl, mediaUrl]
          );
          await queryRun(
            "UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
            [displayText, conv.id]
          );
          broadcast('new_message', {
            conversation: { ...conv, last_message: displayText, last_message_from_me: true },
            message: { id: msgId, conversation_id: conv.id, from_me: true, sender: req.user.name, content: mediaUrl, media_type: 'image', media_url: mediaUrl, timestamp: new Date().toISOString() },
          });
        }
      } catch (waErr) {
        console.error('Erro ao enviar cupom via WhatsApp:', waErr.message);
      }
    }

    res.json({ success: true, sale });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Receipt functions moved to receipt.js (shared with ai-agent.js)

// ═══════════════════════════════════
// ═══  START                      ═══
// ═══════════════════════════════════
async function start() {
  await initDB();
  // Verifica conexão da Evolution API
  await wa.connect();
  server.listen(PORT, () => {
    console.log(`🚀 D'Black Chat rodando na porta ${PORT}`);
  });
}

// ═══════════════════════════════════
// ═══  PROTEÇÕES DE ESTABILIDADE  ═══
// ═══════════════════════════════════

// Evita que o servidor caia por erros não tratados
process.on('uncaughtException', (err) => {
  console.error('🔴 Erro não tratado:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('🔴 Promise rejeitada:', reason?.message || reason);
});

// WebSocket heartbeat — detecta conexões mortas
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log('🔌 WS morto, removendo...');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// Marca conexão como viva quando recebe pong
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Health check da Evolution a cada 60s (detecção rápida de queda) + log de status a cada 5 min
let healthTick = 0;
setInterval(async () => {
  healthTick++;
  if (healthTick % 5 === 0) {
    const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const wsCount = clients.size;
    console.log(`📊 Status: ${memMB}MB RAM | ${wsCount} WS conectados | Fila: ${msgQueue.size} | WhatsApp: ${wa.connected ? '✅' : '❌'}`);
  }

  // Verifica se o provedor está respondendo corretamente
  try {
    const healthy = await wa.checkHealth();
    if (!healthy && wa.connected) {
      console.log('⚠️ WhatsApp desconectou (health check) — reconectando...');
      wa.connected = false;
      broadcast('wa_status', { connected: false, message: 'WhatsApp desconectou. Tentando reconectar...' });
      if (!waDownSince) waDownSince = Date.now();
      scheduleDownAlert();
      await wa.connect();
    }
  } catch (e) {
    console.log('⚠️ Health check falhou:', e.message, '— tentando reconectar...');
    try { await wa.connect(); } catch {}
  }
}, 60000);

start().catch(console.error);
