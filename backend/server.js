const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { queryAll, queryOne, queryRun, initDB } = require('./database');
const WhatsAppClient = require('./whatsapp');
// Cupom gerado como texto formatado (sem dependências nativas)
const bcrypt = require('bcryptjs');
const erp = require('./erp');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'dblack_chat_secret_2026';

app.use(cors());
app.use(express.json());

// ─── Helpers ───
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().split('T')[0];

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

// Envia evento para todos os atendentes conectados
function broadcast(event, data) {
  const msg = JSON.stringify({ event, data });
  clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(msg);
  });
}

// ═══════════════════════════════════
// ═══  WHATSAPP                   ═══
// ═══════════════════════════════════
const wa = new WhatsAppClient();
let currentQR = null;
let currentPairingCode = null;

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

// Quando recebe mensagem do WhatsApp
wa.on('message', async (msg) => {
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
    } else {
      // Atualiza conversa existente
      await queryRun(
        "UPDATE conversations SET unread_count = unread_count + 1, last_message = $1, last_message_at = NOW(), customer_push_name = COALESCE(NULLIF($2, ''), customer_push_name) WHERE id = $3",
        [msg.content, msg.pushName || '', conv.id]
      );
      conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
    }

    // Salva mensagem
    const msgId = msg.id || genId();
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, timestamp) VALUES ($1, $2, false, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
      [msgId, conv.id, msg.pushName || msg.phone, msg.content, msg.mediaType || null, msg.timestamp]
    );

    // Notifica todos os atendentes em tempo real
    broadcast('new_message', {
      conversation: conv,
      message: { id: msgId, conversation_id: conv.id, from_me: false, sender: msg.pushName || msg.phone, content: msg.content, media_type: msg.mediaType, timestamp: msg.timestamp },
    });

  } catch (e) {
    console.error('Erro ao processar mensagem:', e);
  }
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
    await wa.startPairing(phone);
    // Aguarda o código ser gerado (até 15s)
    let attempts = 0;
    const waitForCode = () => new Promise((resolve) => {
      const check = setInterval(() => {
        attempts++;
        if (wa.pairingCode || attempts > 30) {
          clearInterval(check);
          resolve(wa.pairingCode);
        }
      }, 500);
    });
    const code = await waitForCode();
    if (code) {
      res.json({ success: true, pairingCode: code });
    } else {
      res.json({ success: true, message: 'Aguardando código... verifique o status.' });
    }
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
    const { store_id, customer_id, customer_phone, customer_name, items, payment_method, discount, discount_type } = req.body;
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
    });

    // Gera cupom como texto formatado
    const receiptText = generateReceiptText(sale, req.user.name, customerDisplayName);

    // Busca a conversa ativa deste telefone
    const conv = customer_phone ? await queryOne(
      "SELECT * FROM conversations WHERE phone = $1 AND status != 'finalizado' ORDER BY last_message_at DESC LIMIT 1",
      [customer_phone]
    ) : null;

    // Envia cupom via WhatsApp e registra no chat
    if (customer_phone && wa.connected) {
      try {
        await wa.sendMessage(customer_phone, receiptText);

        // Registra a mensagem do cupom no chat
        if (conv) {
          const msgId = genId();
          await queryRun(
            "INSERT INTO messages (id, conversation_id, from_me, sender, content, timestamp) VALUES ($1, $2, true, $3, $4, NOW())",
            [msgId, conv.id, req.user.name, receiptText]
          );
          await queryRun(
            "UPDATE conversations SET last_message = $1, last_message_at = NOW() WHERE id = $2",
            [`🧾 Cupom enviado — R$ ${sale.total.toFixed(2)}`, conv.id]
          );
          broadcast('new_message', {
            conversation: { ...conv, last_message: `🧾 Cupom enviado — R$ ${sale.total.toFixed(2)}` },
            message: { id: msgId, conversation_id: conv.id, from_me: true, sender: req.user.name, content: receiptText, timestamp: new Date().toISOString() },
          });
        }
      } catch (waErr) {
        console.error('Erro ao enviar cupom via WhatsApp:', waErr.message);
      }
    }

    res.json({ success: true, sale });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

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
  // Verifica se tem credenciais salvas no banco
  const authRow = await queryOne("SELECT key FROM wa_auth WHERE key = 'creds' LIMIT 1");
  if (authRow) {
    console.log('🔑 Credenciais encontradas no banco, conectando ao WhatsApp...');
    await wa.connect();
  } else {
    console.log('📱 WhatsApp não configurado. Use o painel admin para parear.');
  }
  server.listen(PORT, () => {
    console.log(`🚀 D'Black Chat rodando na porta ${PORT}`);
  });
}
const path = require('path');

start().catch(console.error);
