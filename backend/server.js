const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { queryAll, queryOne, queryRun, initDB } = require('./database');
const WhatsAppClient = require('./whatsapp');
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

wa.on('qr', async (qr) => {
  currentQR = await QRCode.toDataURL(qr);
  broadcast('qr', { qr: currentQR });
});

wa.on('connected', () => {
  currentQR = null;
  broadcast('wa_status', { connected: true });
});

wa.on('disconnected', () => {
  currentQR = null;
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
    const user = await queryOne("SELECT * FROM chat_users WHERE email = $1 AND active = true", [email]);
    if (!user || user.password !== password) return res.status(401).json({ error: 'Credenciais inválidas' });
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role, avatar: user.avatar }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, id: user.id, name: user.name, role: user.role, avatar: user.avatar });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const user = await queryOne("SELECT id, name, email, role, avatar, active FROM chat_users WHERE id = $1", [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

// ═══════════════════════════════════
// ═══  USERS (admin only)         ═══
// ═══════════════════════════════════
app.get('/api/users', auth, async (req, res) => {
  try {
    const users = await queryAll("SELECT id, name, email, role, active, avatar, created_at FROM chat_users ORDER BY name");
    res.json(users);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin pode criar usuários' });
    const { name, email, password, role } = req.body;
    const id = genId();
    const avatar = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    await queryRun(
      "INSERT INTO chat_users (id, name, email, password, role, avatar) VALUES ($1, $2, $3, $4, $5, $6)",
      [id, name, email, password, role || 'atendente', avatar]
    );
    res.json({ id, name, email, role: role || 'atendente', avatar, active: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    const { name, email, password, role, active } = req.body;
    const avatar = name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : undefined;
    if (password) {
      await queryRun("UPDATE chat_users SET name=$1, email=$2, password=$3, role=$4, active=$5, avatar=$6 WHERE id=$7",
        [name, email, password, role, active !== false, avatar, req.params.id]);
    } else {
      await queryRun("UPDATE chat_users SET name=$1, email=$2, role=$3, active=$4, avatar=$5 WHERE id=$6",
        [name, email, role, active !== false, avatar, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await queryRun("DELETE FROM chat_users WHERE id = $1", [req.params.id]);
    res.json({ success: true });
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

    // Envia via WhatsApp
    await wa.sendMessage(conv.phone, content);

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
  res.json({ ...wa.getStatus(), qr: currentQR });
});

app.post('/api/whatsapp/reconnect', auth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
    await wa.connect();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════
// ═══  START                      ═══
// ═══════════════════════════════════
async function start() {
  await initDB();
  await wa.connect();
  server.listen(PORT, () => {
    console.log(`🚀 D'Black Chat rodando na porta ${PORT}`);
  });
}

start().catch(console.error);
