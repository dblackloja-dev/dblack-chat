// Cliente da Instagram API (Instagram API com login do Instagram) — conta @d_blackloja
// Mesmo estilo do whatsapp-meta.js: fetch nativo, sem axios.
// Docs: https://developers.facebook.com/docs/instagram-platform
require('dotenv').config();

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';
const IG_USER_ID = process.env.META_IG_USER_ID;

// Token: banco (chat_settings.meta_ig_token, gravado pelo /api/ig/oauth/callback) com
// fallback pro env META_IG_TOKEN. Cache de 60s pra não bater no banco a cada chamada.
let tokenCache = { value: null, at: 0 };
async function getToken() {
  if (tokenCache.value && Date.now() - tokenCache.at < 60000) return tokenCache.value;
  let tok = null;
  try {
    const { queryOne } = require('../database');
    const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'meta_ig_token'");
    tok = row?.value || null;
  } catch { /* banco indisponível → cai pro env */ }
  tok = tok || process.env.META_IG_TOKEN;
  tokenCache = { value: tok, at: Date.now() };
  return tok;
}
function invalidateTokenCache() { tokenCache = { value: null, at: 0 }; }

// Token IGAA* (login do Instagram) fala com graph.instagram.com; EAA* (login unificado/SUAT,
// nunca expira) fala com graph.facebook.com — mesmos endpoints de mensagens/perfil/mídia.
function baseFor(token) {
  const host = token && token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com';
  return `https://${host}/${GRAPH_VERSION}`;
}

async function igGraph(method, pathPart, body) {
  const TOKEN = await getToken();
  if (!TOKEN || !IG_USER_ID) throw new Error('META_IG_TOKEN/META_IG_USER_ID não configurados');
  const res = await fetch(`${baseFor(TOKEN)}/${pathPart}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) {
    const err = new Error(json?.error?.message || `Instagram API HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.details = json?.error;
    throw err;
  }
  return json;
}

// DM em resposta a um comentário (private reply). Funciona para comments e live_comments.
async function sendPrivateReply(commentId, text) {
  return igGraph('POST', `${IG_USER_ID}/messages`, {
    recipient: { comment_id: commentId },
    message: { text },
  });
}

// DM direta para um usuário (IGSID). Só dentro da janela de 24h desde a última msg dele.
async function sendDirectMessage(igsid, text) {
  return igGraph('POST', `${IG_USER_ID}/messages`, {
    recipient: { id: igsid },
    message: { text },
  });
}

// Resposta pública ao comentário (opcional, para confirmar "A1 reservada" na live).
async function replyToComment(commentId, message) {
  return igGraph('POST', `${commentId}/replies`, { message });
}

// DM com mídia (imagem/vídeo/áudio) — a URL precisa ser pública para a Meta baixar
async function sendMediaMessage(igsid, type, url) {
  return igGraph('POST', `${IG_USER_ID}/messages`, {
    recipient: { id: igsid },
    message: { attachment: { type, payload: { url } } },
  });
}

// DM com botões (button template): texto + até 3 botões; web_url esconde o link atrás do botão
async function sendButtonMessage(igsid, text, buttons) {
  return igGraph('POST', `${IG_USER_ID}/messages`, {
    recipient: { id: igsid },
    message: { attachment: { type: 'template', payload: { template_type: 'button', text, buttons } } },
  });
}

// Perfil de quem mandou DM (nome, @username, foto) a partir do IGSID
async function getUserProfile(igsid) {
  return igGraph('GET', `${igsid}?fields=name,username,profile_pic`);
}

// GET genérico na Instagram API (usado pelo job de contexto de stories/feed)
async function igGet(pathPart) {
  return igGraph('GET', pathPart);
}

module.exports = { sendPrivateReply, sendDirectMessage, sendMediaMessage, sendButtonMessage, replyToComment, getUserProfile, igGet, invalidateTokenCache };
