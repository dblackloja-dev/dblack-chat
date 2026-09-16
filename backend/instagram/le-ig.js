// Lê no Instagram — responde DMs da @d_blackloja usando o CONTEXTO DA PÁGINA
// (stories/feed indexados pelo content.js) como fonte de verdade de preço e tamanho.
// NÃO consulta o ERP: preço/tamanho estão na arte que a Srª D'Black posta.
const { queryAll, queryOne, queryRun } = require('../database');
const { sendDirectMessage } = require('./api');
const content = require('./content');

const MODEL = 'claude-sonnet-4-6';
const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let notify = () => {};
function init({ broadcast } = {}) {
  if (broadcast) notify = broadcast;
}

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

function buildSystemPrompt(pageContext) {
  return `Você é a Lê, vendedora online da D'Black Store, respondendo os Directs do Instagram @d_blackloja.

QUEM VOCÊ É: Lê, 25 anos, mineira, simpática, acolhedora e carinhosa. Tom leve, descontraído, informal e humano — o mesmo tom da Srª D'Black nos stories. Você faz a cliente se sentir especial.

COMO VOCÊ ESCREVE:
- ESCREVA TODAS AS PALAVRAS POR EXTENSO. NUNCA abrevie ("vc", "pq", "tb" são proibidos)
- Mensagens curtas, máximo 300 caracteres, objetivas
- Emojis com moderação (1 por mensagem no máximo; 🖤 é a cara da marca)
- NUNCA use listas, bullet points, negrito ou asteriscos
- NUNCA use apelidos (flor, querida, amor, miga). Use o nome se souber
- NUNCA repita saudação nem informação já dita na conversa
- Responda SOMENTE o que foi perguntado

O CANAL: a cliente chega respondendo um story, compartilhando um post ou mandando print. A imagem vem anexada na conversa — identifique a peça e cruze com o CONTEXTO DA PÁGINA abaixo.

REGRA DE OURO — PREÇOS E TAMANHOS:
- A ÚNICA fonte de preço, tamanho e cor é o CONTEXTO DA PÁGINA (o que a Srª D'Black escreveu nas artes dos stories e posts)
- Cite o preço EXATAMENTE como está na arte (ex: "R$79,90 ou 12x de 7,40 no cartão")
- Se o contexto NÃO tiver o preço ou tamanho da peça, NUNCA invente e NUNCA chute: diga que vai confirmar rapidinho com a equipe e coloque [TRANSFERIR] no final

FECHAMENTO DA VENDA:
- Pergunte o tamanho desejado e a cidade da cliente
- Entrega: retirada grátis nas lojas (São Domingos, Divino e São João do Manhuaçu); motoboy R$7 (Santa Margarida, Matipó, Abre Campo, Sericita, Padre Fialho, São Francisco do Glória, Fervedouro, Carangola, Pedra Bonita, Orizânia, Santo Amaro e Realeza); Correios R$25 para todo o Brasil (6 a 10 dias)
- Pagamento: Pix ou cartão de crédito parcelado (cite as condições da arte quando houver)
- Quando a cliente decidir a peça e o tamanho, diga que vai passar para a equipe finalizar o pedido e coloque [TRANSFERIR]

QUANDO TRANSFERIR (texto curto + [TRANSFERIR] no final):
- Cliente decidiu comprar (fechar pedido/pagamento)
- Informação que não está no contexto
- Reclamação, troca ou problema com pedido
- Cliente pede para falar com uma pessoa
- Se perguntarem se é robô: confirme que é assistente virtual da loja e ofereça passar para a equipe

NUNCA: prometa reserva de peça, dê desconto por conta própria, invente promoção, fale de assunto fora da loja.

ÁUDIOS: peça com carinho para escrever, que você responde rapidinho.

A D'BLACK: lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Srª D'Black (Letícia). 3 lojas físicas + online. Horários: segunda a sexta 09:00-19:00; sábado: Divino e São João até 14:00, São Domingos até 12:00.

CONTEXTO DA PÁGINA (atualizado automaticamente a cada 5 minutos — é isto que está no ar):
${pageContext}`;
}

// Monta o histórico da conversa no formato da API (com as imagens que a cliente mandou)
async function buildMessages(convId) {
  const rows = await queryAll(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20", [convId]);
  rows.reverse();

  // Só as 2 imagens mais recentes da cliente entram como imagem (custo/latência)
  const imageIds = rows.filter(m => !m.from_me && m.media_type === 'image' && m.media_url?.startsWith('/media/'))
    .slice(-2).map(m => m.id);

  const messages = [];
  for (const m of rows) {
    const role = m.from_me ? 'assistant' : 'user';
    let contentBlocks = m.content || '[mensagem]';
    if (!m.from_me && imageIds.includes(m.id)) {
      const media = await queryOne("SELECT mime_type, data FROM media_files WHERE id = $1", [m.media_url.replace('/media/', '')]);
      if (media && media.mime_type.startsWith('image/')) {
        contentBlocks = [
          { type: 'image', source: { type: 'base64', media_type: media.mime_type, data: media.data } },
          { type: 'text', text: m.content || '(imagem)' },
        ];
      }
    }
    // Mescla mensagens consecutivas do mesmo papel (API exige alternância user/assistant)
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === 'string' && typeof contentBlocks === 'string') {
      last.content += '\n' + contentBlocks;
    } else {
      messages.push({ role, content: contentBlocks });
    }
  }
  if (messages.length === 0 || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(início da conversa)' });
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: '(aguardando sua resposta)' });
  return messages;
}

// Chamada após cada DM recebida — decide se a Lê responde
async function maybeReply(conv, msg) {
  try {
    if (!conv || conv.status !== 'aguardando' || conv.ai_muted) return;
    if ((await setting('ig_ai_enabled', 'false')) !== 'true') return;

    // Modo teste: só responde os usuários da lista (ig_ai_test_users = '*' libera todos)
    const testUsers = (await setting('ig_ai_test_users', '')).trim();
    if (testUsers && testUsers !== '*') {
      const allowed = testUsers.split(',').map(u => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
      const uname = (conv.customer_push_name || '').replace(/^@/, '').toLowerCase();
      if (!allowed.includes(uname) && !allowed.includes(String(conv.phone))) {
        return;
      }
    }

    const apiKey = await getApiKey();
    if (!apiKey) return;

    const pageContext = await content.getPageContext();
    let system = buildSystemPrompt(pageContext);

    // Resposta de story: injeta o lookup exato do story respondido
    if (msg?.ig_story_id) {
      const item = await content.getById(msg.ig_story_id);
      if (item) system += `\n\nATENÇÃO: a última mensagem da cliente é RESPOSTA a este story específico: ${item.analysis || item.caption || 'sem descrição'}`;
    }

    const messages = await buildMessages(conv.id);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, temperature: 0.7, system, messages }),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);

    let text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return;

    const shouldTransfer = text.includes('[TRANSFERIR]');
    text = text.replace(/\[TRANSFERIR\]/g, '').trim();
    if (!text) return;

    const igResult = await sendDirectMessage(conv.phone, text);
    const msgId = igResult?.message_id || genId();
    await queryRun(
      "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, 'Lê (IA)', $3, 1, NOW()) ON CONFLICT (id) DO NOTHING",
      [msgId, conv.id, text]);
    await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [text, conv.id]);

    notify('new_message', {
      conversation: { ...conv, last_message: text, last_message_from_me: true },
      message: { id: msgId, conversation_id: conv.id, from_me: true, sender: 'Lê (IA)', content: text, ack: 1, timestamp: new Date().toISOString() },
    });
    console.log(`🤖 [le-ig] Lê respondeu ${conv.customer_push_name || conv.phone}${shouldTransfer ? ' (transferindo)' : ''}`);

    if (shouldTransfer) {
      await queryRun("UPDATE conversations SET ai_muted = true WHERE id = $1", [conv.id]);
      const fresh = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
      notify('conversation_updated', fresh);
    }
  } catch (e) {
    console.error('[le-ig] erro ao responder:', e.message);
  }
}

module.exports = { init, maybeReply };
