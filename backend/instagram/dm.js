// DMs do Instagram → conversas do painel (canal 'instagram', phone = IGSID do cliente)
// Espelha o fluxo de mensagens do WhatsApp do server.js: upsert de conversa, mensagem
// gravada com mídia em media_files e broadcast 'new_message' pros atendentes.
const { queryOne, queryRun } = require('../database');
const { getUserProfile } = require('./api');
const leIg = require('./le-ig');

const IG_USER_ID = process.env.META_IG_USER_ID;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // media_files guarda base64 no banco — vídeo gigante não entra

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Notificador injetado pelo server.js (broadcast WebSocket)
let notify = () => {};
function init({ broadcast } = {}) {
  if (broadcast) notify = broadcast;
}

// Cache de perfil (IGSID → nome/@username) — evita chamada à API a cada mensagem
const profileCache = new Map();
const PROFILE_TTL = 24 * 3600 * 1000;

async function fetchProfile(igsid) {
  const hit = profileCache.get(igsid);
  if (hit && Date.now() < hit.expires) return hit.data;
  let data = { name: '', username: '' };
  try {
    const p = await getUserProfile(igsid);
    data = { name: p.name || '', username: p.username || '' };
  } catch (e) {
    console.warn('[ig-dm] perfil indisponível para', igsid, e.details?.message || e.message);
  }
  profileCache.set(igsid, { data, expires: Date.now() + PROFILE_TTL });
  if (profileCache.size > 2000) profileCache.clear();
  return data;
}

// Baixa mídia da CDN da Meta (URL expira rápido) e guarda em media_files
async function storeMedia(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar mídia`);
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > MAX_MEDIA_BYTES) throw new Error(`mídia muito grande (${len} bytes)`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error(`mídia muito grande (${buffer.length} bytes)`);
  const mime = (res.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  const id = `ig_${genId()}`;
  await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3)", [id, mime, buffer.toString('base64')]);
  return { mediaUrl: `/media/${id}`, mime };
}

// Interpreta o conteúdo da DM: texto, resposta de story, publicação compartilhada, mídia
async function extractContent(message) {
  const text = (message.text || '').trim();
  let label = '';
  let mediaType = null;
  let mediaSourceUrl = null;
  let storyId = null;

  if (message.reply_to?.story) {
    label = '↩️ Respondeu ao seu story';
    mediaType = 'image';
    mediaSourceUrl = message.reply_to.story.url || null;
    storyId = message.reply_to.story.id || null;
  }

  const att = (message.attachments || [])[0];
  if (att) {
    const url = att.payload?.url || null;
    switch (att.type) {
      case 'image': mediaType = 'image'; mediaSourceUrl = url; break;
      case 'video': mediaType = 'video'; mediaSourceUrl = url; break;
      case 'audio': mediaType = 'audio'; mediaSourceUrl = url; break;
      case 'file': mediaType = 'document'; mediaSourceUrl = url; label = label || '📎 Enviou um arquivo'; break;
      case 'share': label = label || '📎 Compartilhou uma publicação'; mediaType = 'image'; mediaSourceUrl = url; break;
      case 'ig_reel': label = label || `🎬 Compartilhou um reel${att.payload?.title ? ': ' + att.payload.title : ''}`; mediaType = 'video'; mediaSourceUrl = url; break;
      case 'story_mention': label = label || '📣 Te mencionou no story'; mediaType = 'image'; mediaSourceUrl = url; break;
      default: label = label || `📎 Anexo (${att.type})`; mediaSourceUrl = url;
    }
  }

  let mediaUrl = null;
  if (mediaSourceUrl) {
    try {
      const stored = await storeMedia(mediaSourceUrl);
      mediaUrl = stored.mediaUrl;
      // Vídeo de story/reel pode vir como imagem de capa — ajusta o tipo pelo mime real
      if (stored.mime.startsWith('image/') && mediaType === 'video') mediaType = 'image';
      if (stored.mime.startsWith('video/') && mediaType === 'image') mediaType = 'video';
    } catch (e) {
      console.warn('[ig-dm] falha ao baixar mídia:', e.message);
      mediaType = null; // sem mídia salva, mostra só o rótulo
    }
  }

  const content = [label, text].filter(Boolean).join('\n') || (mediaType ? `[${mediaType}]` : '[mensagem]');
  return { content, mediaType: mediaUrl ? mediaType : null, mediaUrl, storyId };
}

// Evento messaging[] do webhook do Instagram
async function handleDmEvent(evt) {
  // Recibo de leitura do cliente → ✓✓ azul nas mensagens enviadas
  if (evt.read) {
    const conv = await queryOne(
      "SELECT id FROM conversations WHERE phone = $1 AND channel = 'instagram' ORDER BY started_at DESC LIMIT 1",
      [evt.sender?.id]);
    if (conv) {
      await queryRun("UPDATE messages SET ack = 3 WHERE conversation_id = $1 AND from_me = true AND ack >= 0 AND ack < 3", [conv.id]);
      notify('conversation_read', { conversation_id: conv.id });
    }
    return;
  }

  const message = evt.message;
  if (!message) return;

  // Echo = mensagem enviada pela loja (API ou app do Instagram no celular).
  // As enviadas pelo painel/bot já são gravadas com o mesmo mid no momento do envio
  // (ON CONFLICT ignora); echo sem registro = alguém respondeu pelo app → entra no histórico.
  if (message.is_echo) {
    const customerId = evt.recipient?.id;
    if (!customerId) return;
    const conv = await queryOne(
      "SELECT * FROM conversations WHERE phone = $1 AND channel = 'instagram' ORDER BY started_at DESC LIMIT 1",
      [customerId]);
    if (!conv) return; // não cria conversa a partir de echo (ex.: DM avulsa do bot de reservas)
    const text = message.text || '[mídia]';
    const r = await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, 'Instagram', $3, 1, NOW()) ON CONFLICT (id) DO NOTHING",
      [message.mid || genId(), conv.id, text]);
    if (r.rowCount > 0) {
      await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [text, conv.id]);
      notify('new_message', {
        conversation: { ...conv, last_message: text, last_message_from_me: true },
        message: { id: message.mid, conversation_id: conv.id, from_me: true, sender: 'Instagram', content: text, ack: 1, timestamp: new Date().toISOString() },
      });
    }
    return;
  }

  // Mensagem do cliente
  const igsid = evt.sender?.id;
  if (!igsid || igsid === IG_USER_ID) return;

  const profile = await fetchProfile(igsid);
  const displayName = profile.name || (profile.username ? '@' + profile.username : `Instagram ${igsid.slice(-4)}`);
  const pushName = profile.username ? '@' + profile.username : displayName;

  const { content, mediaType, mediaUrl, storyId } = await extractContent(message);

  let conv = await queryOne(
    "SELECT * FROM conversations WHERE phone = $1 AND channel = 'instagram' AND status != 'finalizado' ORDER BY started_at DESC LIMIT 1",
    [igsid]);

  if (!conv) {
    const convId = genId();
    await queryRun(
      `INSERT INTO conversations (id, phone, customer_name, customer_push_name, status, unread_count, last_message, last_message_at, last_message_from_me, channel)
       VALUES ($1, $2, $3, $4, 'aguardando', 1, $5, NOW(), false, 'instagram')`,
      [convId, igsid, displayName, pushName, content]);
    conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [convId]);
    console.log(`💬 [ig-dm] nova conversa de ${pushName}`);
  } else {
    await queryRun(
      `UPDATE conversations SET unread_count = unread_count + 1, last_message = $1, last_message_at = NOW(), last_message_from_me = false,
        customer_name = COALESCE(NULLIF($2, ''), customer_name), customer_push_name = COALESCE(NULLIF($3, ''), customer_push_name) WHERE id = $4`,
      [content, displayName, pushName, conv.id]);
    conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
  }

  const msgId = message.mid || genId();
  await queryRun(
    "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ig_story_id, timestamp) VALUES ($1, $2, false, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (id) DO NOTHING",
    [msgId, conv.id, pushName, content, mediaType, mediaUrl, storyId || null]);

  notify('new_message', {
    conversation: conv,
    message: { id: msgId, conversation_id: conv.id, from_me: false, sender: pushName, content, media_type: mediaType, media_url: mediaUrl, timestamp: new Date().toISOString() },
  });

  // Lê (IA) — responde em background se estiver habilitada pro canal Instagram
  setImmediate(() => leIg.maybeReply(conv, { id: msgId, content, media_type: mediaType, ig_story_id: storyId }).catch(() => {}));
}

module.exports = { init, handleDmEvent };
