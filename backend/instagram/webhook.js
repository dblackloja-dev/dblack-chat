// Webhook do Instagram (live commerce) — comentário "QUERO A1 M" numa live vira
// reserva + DM automática com link do checkout. Chega pelo mesmo POST /api/webhook/meta
// do WhatsApp, com body.object === 'instagram'.
const { sendPrivateReply, sendDirectMessage } = require('./api');
const reservations = require('../live/reservations');

const IG_USER_ID = process.env.META_IG_USER_ID;
const CHECKOUT_BASE = process.env.LIVE_CHECKOUT_URL || 'https://dblack.com.br/live';

// "QUERO A1 M", "quero a12 gg", "QUERO A3" (sem tamanho)
// Tamanhos do maior pro menor: regex casa a primeira alternativa, senão "GG" viraria "G"
const QUERO_RE = /\bquero\b[\s:,-]*([a-z]\d{1,3})(?:\s*(xgg|xg|gg|pp|p|m|g|\d{2}))?/i;

// Dedupe simples em memória (a Meta pode reenviar o mesmo evento).
// O banco também protege: live_reservations.comment_id é UNIQUE.
const seen = new Set();
const SEEN_MAX = 5000;

async function handleInstagramWebhook(body) {
  // Log do payload cru nos primeiros dias — pra confirmar o formato real de live_comments
  console.log('[ig-webhook] raw', JSON.stringify(body));

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'live_comments' || change.field === 'comments') {
        await handleComment(change.value, change.field === 'live_comments');
      }
    }
    for (const evt of entry.messaging || []) {
      if (evt.message?.text) await handleDirectMessage(evt);
    }
  }
}

async function handleComment(value, isLive) {
  if (!value?.id || !value?.text) return;
  if (value.from?.id === IG_USER_ID) return;          // ignora os próprios comentários
  if (seen.has(value.id)) return;
  if (seen.size >= SEEN_MAX) seen.clear();
  seen.add(value.id);

  const m = value.text.match(QUERO_RE);
  if (!m) return;                                     // comentário comum, ignora

  const code = m[1].toUpperCase();
  const size = m[2] ? m[2].toUpperCase() : null;

  const result = await reservations.reserve({
    code, size,
    igUserId: value.from?.id,
    igUsername: value.from?.username,
    commentId: value.id,
    mediaId: value.media?.id,
    source: isLive ? 'live' : 'post',
  });

  let text;
  switch (result.status) {
    case 'reserved':
      text = `Reservei a ${code}${size ? ' ' + size : ''} pra você por ${result.minutes} min 🖤\n` +
             `Paga no Pix aqui: ${CHECKOUT_BASE}/${result.token}`;
      break;
    case 'needs_size':
      text = `Qual tamanho da ${code}? Comenta de novo: QUERO ${code} + tamanho (ex: QUERO ${code} M)`;
      break;
    case 'sold_out':
      text = `A ${code}${size ? ' ' + size : ''} acabou 😢 Te coloquei na fila — se liberar, te aviso aqui.`;
      break;
    case 'unknown_code':
      text = `Não achei a peça ${code}. Confere o código que está na tela e comenta de novo.`;
      break;
    default:
      return;
  }

  // Private reply: DM ligada ao comentário. Se falhar (ex.: janela de 7 dias), tenta DM direta.
  try {
    await sendPrivateReply(value.id, text);
  } catch (err) {
    console.warn('[ig-webhook] private reply falhou, tentando DM:', err.details || err.message);
    if (value.from?.id) {
      try {
        await sendDirectMessage(value.from.id, text);
      } catch (err2) {
        console.error('[ig-webhook] DM direta também falhou:', err2.details || err2.message);
      }
    }
  }
}

async function handleDirectMessage(evt) {
  // Por enquanto só loga. Depois: integrar ao painel do Chat como canal "instagram".
  console.log('[ig-dm]', evt.sender?.id, evt.message?.text);
}

module.exports = { handleInstagramWebhook };
