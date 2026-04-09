const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { queryAll, queryOne, queryRun, initDB } = require('./database');
// const WhatsAppClient = require('./whatsapp'); // Baileys (desativado)
const WhatsAppEvolution = require('./whatsapp-evolution');
const { createCanvas } = require('@napi-rs/canvas');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
// ffmpeg removido — PTT não funciona no Baileys v7
const bcrypt = require('bcryptjs');
const erp = require('./erp');
const aiAgent = require('./ai-agent');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'dblack_chat_secret_2026';

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve mídia salva no banco (pra funcionar no Railway sem disco persistente)
app.get('/media/:id', async (req, res) => {
  try {
    const file = await queryOne("SELECT mime_type, data FROM media_files WHERE id = $1", [req.params.id]);
    if (!file) return res.status(404).send('Not found');
    const buffer = Buffer.from(file.data, 'base64');
    res.set('Content-Type', file.mime_type);
    res.set('Content-Length', buffer.length);
    res.set('Cache-Control', 'public, max-age=86400');
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
const wa = new WhatsAppEvolution();
let currentQR = null;
let currentPairingCode = null;

// Webhook da Evolution API
app.post('/api/webhook/evolution', async (req, res) => {
  res.json({ ok: true }); // responde rápido pra Evolution não dar timeout
  try {
    await wa.processWebhook(req.body);
  } catch (e) { console.error('Webhook erro:', e.message); }
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

wa.on('connected', () => {
  currentQR = null;
  currentPairingCode = null;
  broadcast('wa_status', { connected: true });
});

wa.on('disconnected', () => {
  currentQR = null;
  currentPairingCode = null;
  broadcast('wa_status', { connected: false });
});

// Quando recebe mensagem do WhatsApp — entra na fila pra processar sequencialmente
wa.on('message', (msg) => {
  msgQueue.add(async () => {
    try {
      // Busca ou cria conversa para este telefone
      let conv = await queryOne("SELECT * FROM conversations WHERE phone = $1 AND status != 'finalizado' ORDER BY started_at DESC LIMIT 1", [msg.phone]);

      if (!conv) {
        // Nova conversa — vai pra fila "aguardando"
        const convId = genId();
        await queryRun(
          `INSERT INTO conversations (id, phone, customer_name, customer_push_name, status, unread_count, last_message, last_message_at)
           VALUES ($1, $2, $3, $4, 'aguardando', 1, $5, NOW())`,
          [convId, msg.phone, msg.pushName || msg.phone, msg.pushName || '', msg.content]
        );
        conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [convId]);

        // Envia saudação automática para cliente novo (só se IA estiver desativada)
        const aiEnabled = await aiAgent.isAgentEnabled();
        const greetingText = !aiEnabled ? await getGreeting() : null;
        if (wa.connected && greetingText) {
          try {
            const greeting = greetingText.replace('{nome}', msg.pushName || 'cliente');
            await wa.sendMessage(msg.phone, greeting);
            // Salva a saudação no histórico
            const greetId = genId();
            await queryRun(
              "INSERT INTO messages (id, conversation_id, from_me, sender, content, timestamp) VALUES ($1, $2, true, $3, $4, NOW())",
              [greetId, convId, 'D\'Black Bot', greeting]
            );
            console.log(`👋 Saudação enviada para ${msg.pushName || msg.phone}`);
          } catch (e) { console.error('Erro ao enviar saudação:', e.message); }
        }
      } else {
        // Atualiza conversa existente
        await queryRun(
          "UPDATE conversations SET unread_count = unread_count + 1, last_message = $1, last_message_at = NOW(), customer_push_name = COALESCE(NULLIF($2, ''), customer_push_name) WHERE id = $3",
          [msg.content, msg.pushName || '', conv.id]
        );
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
      if (conv.status === 'aguardando') {
        const aiEnabled = await aiAgent.isAgentEnabled();
        if (aiEnabled) {
          try {
            const aiResponse = await aiAgent.generateResponse(conv.id, msg.content, msg.pushName, msg.mediaType);
            if (aiResponse.text) {
              // Envia resposta via WhatsApp
              await wa.sendMessage(msg.phone, aiResponse.text);

              // Salva no banco
              const aiMsgId = genId();
              await queryRun(
                "INSERT INTO messages (id, conversation_id, from_me, sender, content, timestamp) VALUES ($1, $2, true, $3, $4, NOW())",
                [aiMsgId, conv.id, 'Lê (IA)', aiResponse.text]
              );
              await queryRun(
                "UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2",
                [aiResponse.text, conv.id]
              );

              // Notifica atendentes
              broadcast('new_message', {
                conversation: { ...conv, last_message: aiResponse.text },
                message: { id: aiMsgId, conversation_id: conv.id, from_me: true, sender: 'Lê (IA)', content: aiResponse.text, timestamp: new Date().toISOString() },
              });

              console.log(`🤖 Lê respondeu para ${msg.pushName || msg.phone}`);

              // Se precisa transferir, marca a conversa
              if (aiResponse.shouldTransfer) {
                console.log(`🔀 Lê transferindo ${msg.pushName || msg.phone} para atendente humano`);
                // Mantém como aguardando mas adiciona flag
                await queryRun(
                  "UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2",
                  ['🔀 IA transferiu para atendente', conv.id]
                );
                broadcast('conversation_updated', { ...conv, last_message: '🔀 IA transferiu para atendente' });
              }
            }
          } catch (e) {
            console.error('❌ Erro IA ao responder:', e.message);
          }
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
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
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
    const convs = await queryAll("SELECT * FROM conversations ORDER BY last_message_at DESC");
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

// ═══════════════════════════════════
// ═══  MESSAGES                   ═══
// ═══════════════════════════════════
app.get('/api/messages/:conversationId', auth, async (req, res) => {
  try {
    const msgs = await queryAll(
      "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC",
      [req.params.conversationId]
    );
    // Marca como lido
    await queryRun("UPDATE conversations SET unread_count = 0 WHERE id = $1", [req.params.conversationId]);
    res.json(msgs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar mensagem (atendente → cliente via WhatsApp)
app.post('/api/messages/send', auth, async (req, res) => {
  try {
    const { conversation_id, content } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Envia via WhatsApp com nome do atendente
    const waText = `*${req.user.name}:*\n${content}`;
    await wa.sendMessage(conv.phone, waText);

    // Salva no banco
    const msgId = genId();
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, timestamp) VALUES ($1, $2, true, $3, $4, NOW())",
      [msgId, conversation_id, req.user.name, content]
    );

    // Atualiza última mensagem
    await queryRun(
      "UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2",
      [content, conversation_id]
    );

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: content }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Enviar imagem (atendente → cliente via WhatsApp)
app.post('/api/messages/send-image', auth, upload.single('image'), async (req, res) => {
  try {
    const { conversation_id, caption } = req.body;
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
    if (!req.file) return res.status(400).json({ error: 'Imagem não enviada' });

    // Envia via WhatsApp
    await wa.sendImage(conv.phone, req.file.buffer, caption || '');

    // Salva no banco
    const msgId = genId();
    const displayText = caption ? `📷 ${caption}` : '📷 Imagem';
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, timestamp) VALUES ($1, $2, true, $3, $4, 'image', NOW())",
      [msgId, conversation_id, req.user.name, displayText]
    );
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2", [displayText, conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: displayText, media_type: 'image', timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: displayText }, message });
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
    await wa.sendDocument(conv.phone, req.file.buffer, fileName, mime);

    const msgId = genId();
    const displayText = `📎 ${fileName}`;
    const fileUrl = `/media/${mediaId}`;
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, timestamp) VALUES ($1, $2, true, $3, $4, 'document', $5, NOW())",
      [msgId, conversation_id, req.user.name, displayText, fileUrl]
    );
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2", [displayText, conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: displayText, media_type: 'document', media_url: fileUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: displayText }, message });
    res.json(message);
  } catch (e) { res.status(500).json({ error: e.message }); }
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
    await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3)", [mediaId, 'audio/ogg', req.file.buffer.toString('base64')]);

    // Envia via Evolution (sendWhatsAppAudio converte pra OGG Opus automaticamente)
    await wa.sendAudio(conv.phone, req.file.buffer);

    const msgId = genId();
    const audioUrl = `/media/${mediaId}`;
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, timestamp) VALUES ($1, $2, true, $3, $4, 'audio', $5, NOW())",
      [msgId, conversation_id, req.user.name, audioUrl, audioUrl]
    );
    await queryRun("UPDATE conversations SET last_message = '🎵 Áudio', last_message_at = NOW() WHERE id = $1", [conversation_id]);

    const message = { id: msgId, conversation_id, from_me: true, sender: req.user.name, content: audioUrl, media_type: 'audio', media_url: audioUrl, timestamp: new Date().toISOString() };
    broadcast('new_message', { conversation: { ...conv, last_message: '🎵 Áudio' }, message });
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
    if (!msg.from_me) return res.status(403).json({ error: 'Só pode apagar mensagens enviadas' });

    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [msg.conversation_id]);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });

    // Apaga no WhatsApp via Evolution
    try {
      await wa.api('DELETE', 'chat/deleteMessageForEveryone', {
        id: req.params.id,
        fromMe: true,
        remoteJid: conv.phone + '@s.whatsapp.net',
      });
    } catch (e) { console.log('Erro ao apagar no WhatsApp:', e.message); }

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
  res.json({ ...wa.getStatus(), qr: currentQR, pairingCode: currentPairingCode });
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
    if (!q || q.length < 2) return res.json([]);
    const msgs = await queryAll(
      `SELECT m.*, c.customer_push_name, c.phone FROM messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.content ILIKE $1
       ORDER BY m.timestamp DESC LIMIT 50`,
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
// ═══  DASHBOARD / RELATÓRIOS     ═══
// ═══════════════════════════════════
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const todayStr = today();
    const [totalConvs, todayConvs, waitingConvs, activeConvs, totalMsgsToday] = await Promise.all([
      queryOne("SELECT COUNT(*) as c FROM conversations"),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE started_at::date = $1", [todayStr]),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE status = 'aguardando'"),
      queryOne("SELECT COUNT(*) as c FROM conversations WHERE status = 'atendendo'"),
      queryOne("SELECT COUNT(*) as c FROM messages WHERE timestamp::date = $1", [todayStr]),
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
    res.json({
      total_conversations: parseInt(totalConvs.c),
      today_conversations: parseInt(todayConvs.c),
      waiting: parseInt(waitingConvs.c),
      active: parseInt(activeConvs.c),
      today_messages: parseInt(totalMsgsToday.c),
      today_sales: todaySales,
      top_agents: topAgents,
    });
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
    const contacts = await queryAll(`
      SELECT phone, MAX(customer_push_name) as customer_push_name,
             COUNT(DISTINCT id) as total_conversations,
             (SELECT COUNT(*) FROM messages m JOIN conversations c2 ON m.conversation_id = c2.id WHERE c2.phone = conversations.phone AND m.from_me = false) as total_messages,
             MIN(started_at) as first_contact,
             MAX(last_message_at) as last_contact
      FROM conversations
      GROUP BY phone
      ORDER BY MAX(last_message_at) DESC
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
        await wa.sendImage(customer_phone, receiptBuffer, caption);

        // Registra no chat
        if (conv) {
          const msgId = genId();
          await queryRun(
            "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, timestamp) VALUES ($1, $2, true, $3, $4, 'image', NOW())",
            [msgId, conv.id, req.user.name, `🧾 Cupom de venda — R$ ${sale.total.toFixed(2)}\n${receiptText}`]
          );
          await queryRun(
            "UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2",
            [`🧾 Cupom enviado — R$ ${sale.total.toFixed(2)}`, conv.id]
          );
          broadcast('new_message', {
            conversation: { ...conv, last_message: `🧾 Cupom enviado — R$ ${sale.total.toFixed(2)}` },
            message: { id: msgId, conversation_id: conv.id, from_me: true, sender: req.user.name, content: `🧾 Cupom de venda — R$ ${sale.total.toFixed(2)}`, media_type: 'image', timestamp: new Date().toISOString() },
          });
        }
      } catch (waErr) {
        console.error('Erro ao enviar cupom via WhatsApp:', waErr.message);
      }
    }

    res.json({ success: true, sale });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Gera cupom não fiscal como imagem
function generateReceiptImage(sale, sellerName, customerName) {
  const W = 420;
  const pad = 24;
  const lh = 24;

  // Calcula altura
  const itemCount = sale.items.length;
  const H = 280 + (itemCount * 52) + (sale.discount > 0 ? 28 : 0);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fundo
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  let y = pad;
  const cx = W / 2;
  const r = W - pad;

  const line = () => {
    ctx.strokeStyle = '#CCCCCC';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(r, y); ctx.stroke();
    ctx.setLineDash([]);
    y += 12;
  };

  // Cabeçalho
  ctx.fillStyle = '#000';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText("D'BLACK STORE", cx, y); y += lh;
  ctx.font = '11px Arial';
  ctx.fillStyle = '#666';
  ctx.fillText('CUPOM NÃO FISCAL', cx, y); y += 8;
  line();

  // Info
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  ctx.font = '12px Arial';
  const now = new Date();
  const dataStr = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  ctx.fillText(`Data: ${dataStr}`, pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`Vendedor: ${sellerName}`, r, y); y += 18;
  if (customerName) {
    ctx.textAlign = 'left';
    ctx.fillText(`Cliente: ${customerName}`, pad, y); y += 18;
  }
  if (sale.cupom) {
    ctx.textAlign = 'left';
    ctx.fillText(`Cupom: ${sale.cupom}`, pad, y); y += 18;
  }
  line();

  // Itens
  for (const item of sale.items) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#000';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`${item.quantity}x ${item.name}`, pad, y);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`R$ ${(item.price * item.quantity).toFixed(2)}`, r, y); y += 18;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#888';
    ctx.font = '10px Arial';
    ctx.fillText(`SKU: ${item.sku || '-'}  |  R$ ${item.price.toFixed(2)} cada`, pad + 8, y); y += 22;
  }
  line();

  // Subtotal
  ctx.fillStyle = '#333';
  ctx.font = '13px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('Subtotal:', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`R$ ${sale.subtotal.toFixed(2)}`, r, y); y += lh;

  // Desconto
  if (sale.discount > 0) {
    ctx.fillStyle = '#CC0000';
    ctx.font = '13px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Desconto:', pad, y);
    ctx.textAlign = 'right';
    ctx.fillText(`- R$ ${sale.discount.toFixed(2)}`, r, y); y += lh;
  }

  // Total
  ctx.fillStyle = '#000';
  ctx.font = 'bold 18px Arial';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL:', pad, y);
  ctx.textAlign = 'right';
  ctx.fillText(`R$ ${sale.total.toFixed(2)}`, r, y); y += lh + 4;

  // Pagamento
  const payLabels = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Cartão Crédito', debito: 'Cartão Débito', crediario: 'Crediário' };
  ctx.font = '12px Arial';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'left';
  ctx.fillText(`Pagamento: ${payLabels[sale.payment_method] || sale.payment_method}`, pad, y); y += 8;
  line();

  // Rodapé
  y += 4;
  ctx.fillStyle = '#000';
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Obrigado pela preferência!', cx, y); y += 18;
  ctx.font = '10px Arial';
  ctx.fillStyle = '#666';
  ctx.fillText("D'Black Store — @d_blackloja", cx, y);

  return canvas.toBuffer('image/png');
}

// Gera cupom não fiscal como texto formatado para WhatsApp
function generateReceiptText(sale, sellerName, customerName) {
  const payLabels = { pix: 'PIX', dinheiro: 'Dinheiro', credito: 'Cartão Crédito', debito: 'Cartão Débito', crediario: 'Crediário' };
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  let text = `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `    🖤 *D'BLACK STORE*\n`;
  text += `     CUPOM NÃO FISCAL\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📅 ${data}\n`;
  text += `👤 Vendedor: ${sellerName}\n`;
  if (customerName) text += `🙋 Cliente: ${customerName}\n`;
  if (sale.cupom) text += `🧾 Cupom: ${sale.cupom}\n`;
  text += `────────────────────\n`;
  text += `*ITENS:*\n\n`;

  for (const item of sale.items) {
    text += `▸ ${item.quantity}x ${item.name}\n`;
    text += `   SKU: ${item.sku || '-'} | R$ ${item.price.toFixed(2)} cada\n`;
    text += `   *Subtotal: R$ ${(item.price * item.quantity).toFixed(2)}*\n\n`;
  }

  text += `────────────────────\n`;
  text += `Subtotal: R$ ${sale.subtotal.toFixed(2)}\n`;
  if (sale.discount > 0) {
    text += `Desconto: - R$ ${sale.discount.toFixed(2)}\n`;
  }
  text += `\n💰 *TOTAL: R$ ${sale.total.toFixed(2)}*\n`;
  text += `💳 Pagamento: ${payLabels[sale.payment_method] || sale.payment_method}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━\n`;
  text += `  Obrigado pela preferência! 🛍️\n`;
  text += `  *D'Black Store* — @d_blackloja`;

  return text;
}

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

// Monitoramento a cada 5 min
setInterval(() => {
  const memMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const wsCount = clients.size;
  console.log(`📊 Status: ${memMB}MB RAM | ${wsCount} WS conectados | Fila: ${msgQueue.size} | WhatsApp: ${wa.connected ? '✅' : '❌'}`);
}, 300000);

start().catch(console.error);
