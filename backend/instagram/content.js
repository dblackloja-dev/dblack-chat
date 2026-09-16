// Contexto da página @d_blackloja — job que lê stories e feed a cada 5 min,
// baixa as imagens e extrai por visão o que a Srª D'Black escreve na arte
// (peça, PREÇO e TAMANHOS). É a fonte de verdade da Lê no Instagram — não o ERP,
// porque preço/tamanho ficam na arte do story/post, não no sistema.
const { queryAll, queryOne, queryRun } = require('../database');
const { igGet } = require('./api');

const IG_USER_ID = process.env.META_IG_USER_ID;
const MODEL = 'claude-sonnet-4-6';

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
let timer = null;

async function initTables() {
  await queryRun(`
    CREATE TABLE IF NOT EXISTS ig_content (
      id TEXT PRIMARY KEY,              -- media id do story/post
      kind TEXT NOT NULL,               -- story | feed
      media_type TEXT,
      caption TEXT DEFAULT '',
      permalink TEXT,
      media_url TEXT,                   -- nossa cópia em /media/ (sobrevive à CDN)
      analysis TEXT DEFAULT '',         -- extração da IA: peça + preço + tamanhos
      posted_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,           -- stories: posted_at + 24h
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await queryRun("CREATE INDEX IF NOT EXISTS idx_ig_content_kind_posted ON ig_content (kind, posted_at DESC)");
}

function start() {
  if (timer) return;
  syncNow().catch(e => console.error('[ig-content] sync inicial:', e.message));
  timer = setInterval(() => syncNow().catch(e => console.error('[ig-content] sync:', e.message)), 5 * 60 * 1000);
  console.log('📖 Job de contexto do Instagram ativo (stories + feed a cada 5 min)');
}

async function getApiKey() {
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    try {
      const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'");
      if (row) apiKey = row.value;
    } catch {}
  }
  return apiKey ? apiKey.trim() : null;
}

async function storeImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new Error('imagem muito grande');
  const mime = (res.headers.get('content-type') || 'image/jpeg').split(';')[0];
  const id = `igc_${genId()}`;
  await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1, $2, $3)", [id, mime, buffer.toString('base64')]);
  return { mediaId: id, mime, base64: buffer.toString('base64') };
}

// Visão: extrai da arte o que a cliente perguntaria (peça, preço, tamanhos, condição)
async function analyzeImage(base64, mime, caption, kind) {
  const apiKey = await getApiKey();
  if (!apiKey) return '';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text:
            `Esta imagem é um ${kind === 'story' ? 'story' : 'post do feed'} da loja de roupas D'Black Store.` +
            (caption ? ` Legenda: "${caption}".` : '') +
            `\nExtraia em UMA linha, neste formato exato:` +
            `\nPEÇA: <descrição curta da(s) peça(s): tipo, cor, estampa> | PREÇO: <valor(es) escritos na arte ou legenda, ex: R$79,90 ou 12x7,40; se não aparecer, "não informado"> | TAMANHOS: <tamanhos/cores escritos; se não aparecer, "não informado"> | OBS: <campanha, condição ou frase da arte, se houver>` +
            `\nSe a imagem não mostrar produto (bastidores, aviso, pessoas conversando), responda: SEM PRODUTO: <resumo em poucas palavras>.` },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
}

async function ingestItem(item, kind) {
  const exists = await queryOne("SELECT id FROM ig_content WHERE id = $1", [item.id]);
  if (exists) return false;

  // Vídeo: analisa pela thumbnail; imagem: pela própria
  const imgUrl = item.media_type === 'VIDEO' ? (item.thumbnail_url || null) : (item.media_url || item.thumbnail_url || null);
  let mediaUrl = null, analysis = '';
  if (imgUrl) {
    try {
      const stored = await storeImage(imgUrl);
      mediaUrl = `/media/${stored.mediaId}`;
      if (stored.mime.startsWith('image/')) {
        analysis = await analyzeImage(stored.base64, stored.mime, item.caption || '', kind);
      }
    } catch (e) {
      console.warn(`[ig-content] ${kind} ${item.id}: mídia/análise falhou —`, e.message);
    }
  }

  const postedAt = item.timestamp || new Date().toISOString();
  const expiresAt = kind === 'story' ? new Date(new Date(postedAt).getTime() + 24 * 3600 * 1000).toISOString() : null;
  await queryRun(
    `INSERT INTO ig_content (id, kind, media_type, caption, permalink, media_url, analysis, posted_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
    [item.id, kind, item.media_type || null, item.caption || '', item.permalink || null, mediaUrl, analysis, postedAt, expiresAt]);
  console.log(`[ig-content] ${kind} ${item.id} indexado: ${(analysis || item.caption || '').slice(0, 90)}`);
  return true;
}

async function syncNow() {
  // limit alto: a loja posta dezenas de stories/dia e o PREÇO vem em stories separados da sequência
  const stories = await igGet(`${IG_USER_ID}/stories?fields=id,media_type,media_url,thumbnail_url,caption,timestamp&limit=100`).catch(e => {
    console.warn('[ig-content] stories indisponíveis:', e.details?.message || e.message);
    return { data: [] };
  });
  for (const s of stories.data || []) await ingestItem(s, 'story');

  const feed = await igGet(`${IG_USER_ID}/media?fields=id,media_type,media_url,thumbnail_url,caption,permalink,timestamp&limit=12`).catch(e => {
    console.warn('[ig-content] feed indisponível:', e.details?.message || e.message);
    return { data: [] };
  });
  for (const p of feed.data || []) await ingestItem(p, 'feed');
}

const fmtHora = (d) => new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Contexto textual injetado no prompt da Lê
async function getPageContext() {
  const stories = await queryAll(
    "SELECT * FROM ig_content WHERE kind = 'story' AND posted_at > NOW() - INTERVAL '48 hours' ORDER BY posted_at ASC LIMIT 100");
  const feed = await queryAll(
    "SELECT * FROM ig_content WHERE kind = 'feed' ORDER BY posted_at DESC LIMIT 10");

  let out = '';
  if (stories.length) {
    out += 'STORIES RECENTES em ordem cronológica (últimas 48h). PADRÃO DA LOJA: os stories saem em SEQUÊNCIA — primeiro o look completo no provador, logo depois um story de cada peça com o PREÇO e tamanhos na arte. O preço de uma peça vista num look costuma estar nos stories dos MINUTOS SEGUINTES (mesma faixa de horário):\n';
    for (const s of stories) {
      const dead = s.expires_at && new Date(s.expires_at) < new Date() ? ' [EXPIRADO]' : '';
      out += `- [${fmtHora(s.posted_at)}${dead}] ${s.analysis || s.caption || 'sem descrição'}\n`;
    }
  }
  if (feed.length) {
    out += '\nPOSTS RECENTES DO FEED:\n';
    for (const p of feed) {
      out += `- [${fmtHora(p.posted_at)}] ${p.analysis || ''}${p.caption ? ` | legenda: ${p.caption.slice(0, 150)}` : ''}\n`;
    }
  }
  return out || '(nenhum conteúdo indexado ainda)';
}

// Lookup exato: cliente respondeu a um story/post específico
async function getById(mediaId) {
  if (!mediaId) return null;
  return queryOne("SELECT * FROM ig_content WHERE id = $1", [mediaId]);
}

// O ID de story do webhook (reply_to.story.id) NÃO é o mesmo ID que /me/stories lista.
// Se não estiver indexado, busca a mídia por esse ID na API e indexa na hora (com análise).
async function ensureStory(storyId) {
  if (!storyId) return null;
  const existing = await getById(storyId);
  if (existing) return existing;
  try {
    const item = await igGet(`${storyId}?fields=id,media_type,media_url,thumbnail_url,caption,timestamp`);
    if (item?.id) {
      await ingestItem(item, 'story');
      return getById(storyId);
    }
  } catch (e) {
    console.warn('[ig-content] ensureStory falhou para', storyId, '—', e.details?.message || e.message);
  }
  return null;
}

// Sequência do provador: o story respondido + vizinhos de ±45 min (onde costuma estar o preço)
async function getSequence(storyId) {
  const row = await getById(storyId);
  if (!row || !row.posted_at) return null;
  const neighbors = await queryAll(
    `SELECT * FROM ig_content WHERE kind = 'story'
       AND posted_at BETWEEN $1::timestamptz - INTERVAL '45 minutes' AND $1::timestamptz + INTERVAL '45 minutes'
     ORDER BY posted_at ASC LIMIT 15`, [row.posted_at]);
  let out = '';
  for (const s of neighbors) {
    const marker = s.id === storyId ? '  << ESTE é o story que a cliente respondeu' : '';
    out += `- [${fmtHora(s.posted_at)}] ${s.analysis || s.caption || 'sem descrição'}${marker}\n`;
  }
  return { row, sequence: out };
}

module.exports = { initTables, start, syncNow, getPageContext, getById, ensureStory, getSequence };
