// Exporta todas as conversas do dblack-chat para um backup navegável offline.
// Gera: <destino>/index.html (lista de conversas) + <destino>/conversa/<id>.html + <destino>/media/*
// Uso: node export-conversas.js [pasta_destino]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEST = process.argv[2] || path.join(require('os').homedir(), 'Desktop', 'backup-conversas-dblack');
const SINCE = process.argv[3] || null; // data de corte opcional, ex: 2026-06-01
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const extFromMime = m => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'application/pdf': 'pdf' }[m] || 'bin');
const fmtDate = d => d ? new Date(d).toLocaleString('pt-BR') : '';

const CSS = `
body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#e5ddd5;color:#111b21}
header{background:#00a884;color:#fff;padding:14px 20px;position:sticky;top:0;z-index:10}
header a{color:#fff;text-decoration:none;font-weight:600}
.wrap{max-width:820px;margin:0 auto;padding:16px}
.conv-list{background:#fff;border-radius:8px;overflow:hidden}
.conv-item{display:block;padding:14px 18px;border-bottom:1px solid #eee;text-decoration:none;color:#111b21}
.conv-item:hover{background:#f5f5f5}
.conv-item .nome{font-weight:600}
.conv-item .meta{font-size:13px;color:#667781;margin-top:3px}
.msgs{display:flex;flex-direction:column;gap:6px;padding:16px}
.msg{max-width:75%;padding:8px 12px;border-radius:8px;background:#fff;box-shadow:0 1px 1px rgba(0,0,0,.1);word-wrap:break-word}
.msg.me{align-self:flex-end;background:#d9fdd3}
.msg .sender{font-size:12px;font-weight:600;color:#00a884;margin-bottom:2px}
.msg .time{font-size:11px;color:#667781;text-align:right;margin-top:4px}
.msg img,.msg video{max-width:100%;border-radius:6px;display:block}
.msg audio{width:250px}
.day{align-self:center;background:#e1f2fa;color:#54656f;font-size:12px;padding:4px 10px;border-radius:6px;margin:8px 0}
`;

async function main() {
  fs.mkdirSync(DEST, { recursive: true });
  fs.mkdirSync(path.join(DEST, 'conversa'), { recursive: true });
  fs.mkdirSync(path.join(DEST, 'media'), { recursive: true });

  const convs = (await pool.query(
    "SELECT id, phone, customer_name, customer_push_name, status, agent_name, started_at, last_message_at, last_message FROM conversations"
    + (SINCE ? " WHERE last_message_at >= $1" : "")
    + " ORDER BY last_message_at DESC NULLS LAST",
    SINCE ? [SINCE] : []
  )).rows;
  if (SINCE) console.log(`Filtro: conversas com atividade desde ${SINCE}`);

  // Cache id -> nome de arquivo salvo em disco (evita reescrever a mesma mídia)
  const mediaNames = new Map();
  let mediaCount = 0;
  async function mediaTag(mediaUrl, mediaType) {
    if (!mediaUrl) return '';
    const id = mediaUrl.replace('/media/', '');
    let fname = mediaNames.get(id);
    if (!fname) {
      try {
        const r = await pool.query("SELECT mime_type, data FROM media_files WHERE id = $1", [id]);
        if (!r.rows[0]) return `<i>[mídia não encontrada]</i>`;
        fname = id + '.' + extFromMime(r.rows[0].mime_type);
        fs.writeFileSync(path.join(DEST, 'media', fname), Buffer.from(r.rows[0].data, 'base64'));
        mediaNames.set(id, fname);
        mediaCount++;
      } catch { return `<i>[erro ao carregar mídia]</i>`; }
    }
    const rel = '../media/' + fname;
    if (mediaType === 'image') return `<img src="${rel}" loading="lazy">`;
    if (mediaType === 'video') return `<video src="${rel}" controls></video>`;
    if (mediaType === 'audio') return `<audio src="${rel}" controls></audio>`;
    return `<a href="${rel}">📎 Baixar anexo</a>`;
  }

  let done = 0;
  for (const c of convs) {
    const nome = c.customer_name || c.customer_push_name || c.phone;
    const msgs = (await pool.query(
      "SELECT from_me, sender, content, media_type, media_url, timestamp FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC", [c.id]
    )).rows;

    let body = '', lastDay = '';
    for (const m of msgs) {
      const day = m.timestamp ? new Date(m.timestamp).toLocaleDateString('pt-BR') : '';
      if (day && day !== lastDay) { body += `<div class="day">${day}</div>`; lastDay = day; }
      const media = m.media_url ? await mediaTag(m.media_url, m.media_type) : '';
      const senderLabel = m.from_me ? esc(m.sender || 'D\'Black') : esc(nome);
      const text = (m.content && !(m.media_url && ['📷 Imagem', '🎥 Vídeo', '🎵 Áudio'].includes(m.content))) ? esc(m.content) : '';
      body += `<div class="msg ${m.from_me ? 'me' : ''}"><div class="sender">${senderLabel}</div>${media}${text ? '<div>' + text + '</div>' : ''}<div class="time">${fmtDate(m.timestamp)}</div></div>`;
    }

    const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(nome)}</title><style>${CSS}</style></head><body><header><a href="../index.html">← Todas as conversas</a> &nbsp;|&nbsp; <b>${esc(nome)}</b> (${esc(c.phone)})</header><div class="msgs">${body || '<p style="text-align:center;color:#667781">Sem mensagens</p>'}</div></body></html>`;
    fs.writeFileSync(path.join(DEST, 'conversa', c.id + '.html'), html);
    done++;
    if (done % 25 === 0) console.log(`  ${done}/${convs.length} conversas...`);
  }

  // Índice
  const items = convs.map(c => {
    const nome = c.customer_name || c.customer_push_name || c.phone;
    return `<a class="conv-item" href="conversa/${c.id}.html"><div class="nome">${esc(nome)}</div><div class="meta">${esc(c.phone)} · ${esc(c.status || '')} · última: ${fmtDate(c.last_message_at)}</div><div class="meta">${esc((c.last_message || '').slice(0, 80))}</div></a>`;
  }).join('');
  const index = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backup de conversas — D'Black</title><style>${CSS}</style></head><body><header><b>Backup de conversas — D'Black Store</b> · ${convs.length} conversas · gerado em ${new Date().toLocaleString('pt-BR')}</header><div class="wrap"><div class="conv-list">${items}</div></div></body></html>`;
  fs.writeFileSync(path.join(DEST, 'index.html'), index);

  console.log(`\n✅ Backup gerado: ${DEST}`);
  console.log(`   ${convs.length} conversas · ${mediaCount} mídias`);
  console.log(`   Abra o arquivo index.html no navegador.`);
  await pool.end();
}

main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
