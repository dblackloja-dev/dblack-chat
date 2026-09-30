// Lê nos COMENTÁRIOS dos posts do feed — resposta pública curta + convite pro
// Direct quando há intenção de compra. Comentários de live NÃO passam por aqui
// (o live commerce "QUERO A1 M" tem fluxo próprio no webhook.js).
const { queryOne } = require('../database');
const { replyToComment, sendPrivateReply } = require('./api');
const content = require('./content');

const MODEL = 'claude-sonnet-4-6';

async function setting(key, fallback = '') {
  try {
    const row = await queryOne("SELECT value FROM chat_settings WHERE key = $1", [key]);
    return row ? row.value : fallback;
  } catch { return fallback; }
}

async function getApiKey() {
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'").catch(() => null);
    if (row) apiKey = row.value;
  }
  return apiKey ? apiKey.trim() : null;
}

const extractMsg = (raw) => {
  const m = raw.match(/<msg>([\s\S]*?)<\/msg>/i);
  return m ? m[1].trim() : null;
};

// Convite enviado como private reply (abre a conversa no Direct → fluxo completo da Lê)
const DM_INVITE = 'Oi! Vi seu comentário no post 😉 Me conta aqui o tamanho e a sua cidade que eu te ajudo a garantir a sua!';

function buildSystem() {
  return `Você é a Lê, vendedora online da D'Black Store (@d_blackloja), respondendo COMENTÁRIOS PÚBLICOS nos posts do feed do Instagram.

FORMATO (OBRIGATÓRIO): pense dentro de <analise>...</analise> e escreva a resposta pública SOMENTE dentro de <msg>...</msg>. Se não valer a pena responder, escreva <msg>[SKIP]</msg>.

REGRAS DO COMENTÁRIO PÚBLICO:
- Resposta CURTA: no máximo 200 caracteres, 1 ou 2 frases, tom leve e mineiro da Lê
- No máximo 1 emoji, sempre leve (✨ 😍 🥰 😉 💕). NUNCA o coração preto 🖤, nunca emojis tristes
- ESCREVA POR EXTENSO, sem abreviação ("vc", "pq" proibidos), sem listas, sem asteriscos
- Elogio ou emoji de desejo → agradeça em uma frase simpática, variando as palavras. NÃO ofereça produto nem pergunte tamanho em público
- Pergunta de PREÇO ou TAMANHO → responda SÓ com o que está no POST abaixo (copie o preço exatamente). Se a informação não estiver lá, diga que responde no Direct e inclua o marcador [DM]
- Intenção de COMPRA ("quero", "como compro", "me separa") → responda que já chamou no Direct pra garantir a peça e inclua [DM]
- Pedido já feito, entrega, troca ou reclamação → diga que vai resolver no Direct e inclua [DM]
- Comentário marcando amiga (@fulana), spam, corrente ou assunto fora da loja → <msg>[SKIP]</msg>
- NUNCA invente preço, promoção, prazo ou estoque; NUNCA peça dados pessoais em público; NUNCA prometa reserva
- Você não conversa em público: perguntas que pedem conversa (mais de uma troca) vão pro Direct com [DM]

O marcador [DM] faz o sistema mandar uma mensagem no Direct da pessoa convidando ela a continuar por lá — use sempre que a resposta completa não couber no comentário público.`;
}

async function maybeReplyComment(value) {
  try {
    if ((await setting('ig_ai_enabled', 'false')) !== 'true') return;
    if ((await setting('ig_comments_ai', 'true')) !== 'true') return;

    // Modo teste compartilhado com a Lê dos Directs
    const testUsers = (await setting('ig_ai_test_users', '')).trim();
    if (testUsers && testUsers !== '*') {
      const allowed = testUsers.split(',').map(u => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
      if (!allowed.includes((value.from?.username || '').toLowerCase())) return;
    }

    const apiKey = await getApiKey();
    if (!apiKey) return;

    const post = await content.getById(value.media?.id);
    const postContext = post
      ? `POST COMENTADO (fonte de verdade de preço e tamanhos):\n${post.analysis || 'sem análise'}${post.caption ? `\nLegenda: ${[...post.caption].slice(0, 300).join('')}` : ''}`
      : `POST NÃO IDENTIFICADO — use o CONTEXTO GERAL DA PÁGINA abaixo com cautela; se não tiver certeza da peça, responda no Direct com [DM]:\n${await content.getPageContext()}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: content.jsonSafe({
        model: MODEL, max_tokens: 400, temperature: 0.3,
        // Persona fixa num bloco cacheado; o contexto do post (variável) fica fora
        system: [
          { type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral' } },
          { type: 'text', text: postContext },
        ],
        messages: [{ role: 'user', content: `Comentário de @${value.from?.username || 'cliente'} no post: "${value.text}"` }],
      }),
      signal: AbortSignal.timeout(45000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);

    const raw = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    let text = extractMsg(raw);
    if (text === null) { console.error('[ig-comments] resposta sem <msg>, ignorada:', raw.slice(0, 150)); return; }
    if (text.includes('[SKIP]')) return;

    const wantsDm = text.includes('[DM]');
    text = text.replace(/\[DM\]/g, '').trim();
    if (text.length > 400) text = [...text].slice(0, 400).join('');

    if (text) {
      await replyToComment(value.id, text);
      console.log(`💬 [ig-comments] respondeu @${value.from?.username || '?'}: ${text.slice(0, 80)}`);
    }
    if (wantsDm) {
      try {
        await sendPrivateReply(value.id, DM_INVITE);
        console.log(`💬 [ig-comments] convite pro Direct enviado a @${value.from?.username || '?'}`);
      } catch (e) {
        console.warn('[ig-comments] private reply falhou:', e.details?.message || e.message);
      }
    }
  } catch (e) {
    console.error('[ig-comments] erro:', e.message);
  }
}

module.exports = { maybeReplyComment, _test: { extractMsg, buildSystem } };
