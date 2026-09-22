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

function buildSystemPrompt(pageContext, waNumber) {
  // Com o número da loja disponível, o fechamento manda a cliente pro WhatsApp (onde a equipe
  // fecha as vendas de verdade) via marcador [ZAP: ...] que o código troca por link wa.me.
  const fechamento = waNumber
    ? `- Quando a cliente decidir a peça e o tamanho (e você já souber a cidade), convide-a a finalizar no WhatsApp da loja, onde a equipe fecha o pedido rapidinho, e termine a mensagem com o marcador [ZAP: peça | tamanho | cidade]. O sistema troca o marcador por um link do WhatsApp que já chega com o pedido escrito — NUNCA escreva o link você mesma, use somente o marcador. Exemplo: "Perfeito! Vou te mandar o link do nosso WhatsApp, é só clicar que seu pedido já chega prontinho e a equipe finaliza com você ✨ [ZAP: vestido midi preto | 40 | Divino]"
- Se a cliente disser que prefere finalizar por aqui mesmo, ou voltar a falar depois do link, use [TRANSFERIR] para a equipe atender no Direct`
    : `- Quando a cliente decidir a peça e o tamanho, diga que vai passar para a equipe finalizar o pedido e coloque [TRANSFERIR]`;
  const transferirCompra = waNumber
    ? '- Cliente quer comprar mas prefere finalizar pelo Direct (senão, use o [ZAP: ...])'
    : '- Cliente decidiu comprar (fechar pedido/pagamento)';
  return `Você é a Lê, vendedora online da D'Black Store, respondendo os Directs do Instagram @d_blackloja.

QUEM VOCÊ É: Lê, 25 anos, mineira, simpática, acolhedora e carinhosa. Tom leve, descontraído, informal e humano — o mesmo tom da Srª D'Black nos stories. Você faz a cliente se sentir especial.

COMO VOCÊ ESCREVE:
- ESCREVA TODAS AS PALAVRAS POR EXTENSO. NUNCA abrevie ("vc", "pq", "tb" são proibidos)
- Mensagens curtas, máximo 300 caracteres, objetivas
- Emojis com moderação (1 por mensagem no máximo). NUNCA use o coração preto 🖤 — é pesado demais. Varie o emoji conforme o assunto da resposta: use só emojis leves, alegres e positivos (✨ 😍 🥰 😉 💕 🎉 👏, por exemplo). NUNCA use emojis que transmitam tristeza, raiva ou peso (😢 💔 😡 😔 ☠️ e parecidos são proibidos)
- NUNCA use listas, bullet points, negrito ou asteriscos
- NUNCA use apelidos (flor, querida, amor, miga). Use o nome se souber
- NUNCA repita saudação nem informação já dita na conversa
- Responda SOMENTE o que foi perguntado
- Se a última mensagem da cliente JÁ estiver coberta pela sua resposta anterior (nada novo a dizer), responda exatamente [SKIP] e nada mais — assim nenhuma mensagem é enviada

O CANAL: a cliente chega respondendo um story, compartilhando um post ou mandando print. A imagem vem anexada na conversa — identifique a peça e cruze com o CONTEXTO DA PÁGINA abaixo.

MENSAGEM DE CARINHO (elogio, agradecimento, "amei", "que linda", emoji de coração, parabéns): retribua o carinho com naturalidade e PARE por aí. NUNCA emende pergunta de venda ("quer garantir a sua?", "posso separar?", "vai querer?") nem ofereça produto — isso soa robótico e entrega que é atendimento automático. Vendedora de verdade recebe carinho e agradece, só isso. A venda só entra na conversa quando a cliente pergunta de peça, preço ou tamanho.

REGRA DE OURO — PREÇOS E TAMANHOS:
- A ÚNICA fonte de preço, tamanho e cor é o CONTEXTO DA PÁGINA (o que a Srª D'Black escreveu nas artes dos stories e posts)
- Cite o preço EXATAMENTE como está na arte (ex: "R$79,90 ou 12x de 7,40 no cartão")
- Os stories saem em SEQUÊNCIA: o look no provador e, nos minutos seguintes, um story de cada peça com o preço na arte — procure o preço nos stories de horário vizinho ao do look
- Se o contexto NÃO tiver o preço ou tamanho da peça, NUNCA invente e NUNCA chute: diga que vai confirmar rapidinho com a equipe e coloque [TRANSFERIR] no final

PROMOÇÕES: TODA promoção divulgada nos stories/feed (ex: "Compre 3 Leve 4") vale TAMBÉM nas compras online — aqui pelo Direct/WhatsApp, com entrega ou retirada — além das lojas físicas. NUNCA diga que uma promoção é só nas lojas físicas. Restrição só existe se estiver escrita na arte.

FECHAMENTO DA VENDA:
- Pergunte o tamanho desejado e a cidade da cliente
- Entrega: retirada grátis nas lojas (São Domingos, Divino e São João do Manhuaçu); motoboy R$7 (Santa Margarida, Matipó, Abre Campo, Sericita, Padre Fialho, São Francisco do Glória, Fervedouro, Carangola, Pedra Bonita, Orizânia, Santo Amaro e Realeza); Correios R$25 para todo o Brasil (6 a 10 dias)
- Pagamento: Pix ou cartão de crédito parcelado (cite as condições da arte quando houver)
${fechamento}

QUANDO TRANSFERIR (texto curto + [TRANSFERIR] no final):
${transferirCompra}
- Informação que não está no contexto
- Reclamação, troca ou problema com pedido
- Cliente pede para falar com uma pessoa
- Se perguntarem se é robô: confirme que é assistente virtual da loja e ofereça passar para a equipe
- SEMPRE avise a cliente de forma leve e educada que uma pessoa da equipe vai continuar o atendimento ali mesmo. Exemplos de tom: "Vou te passar para uma das meninas da nossa equipe, elas continuam com você por aqui rapidinho, tá bom? 😉" ou "Deixa comigo! Já chamei uma das meninas para te ajudar com isso, ela te responde aqui mesmo ✨". NUNCA transfira em silêncio nem deixe a cliente sem saber o que vai acontecer

NUNCA: prometa reserva de peça, dê desconto por conta própria, invente promoção, fale de assunto fora da loja.

ÁUDIOS: peça com carinho para escrever, que você responde rapidinho.

A D'BLACK: lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Srª D'Black (Letícia). 3 lojas físicas + online. Horários: segunda a sexta 09:00-19:00; sábado: todas as lojas das 08:00 às 14:00.

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

// Trava por conversa: mensagens em rajada geram UMA resposta só (a geração em
// andamento termina, e se chegou coisa nova nesse meio tempo, gera mais uma vez)
const inFlight = new Map(); // convId → { dirty: bool, lastMsg }

async function maybeReply(conv, msg) {
  const lock = inFlight.get(conv.id);
  if (lock) { lock.dirty = true; lock.lastMsg = msg; return; }
  inFlight.set(conv.id, { dirty: false, lastMsg: msg });
  try {
    let rounds = 0;
    do {
      await new Promise(r => setTimeout(r, 3000)); // agrupa mensagens em rajada
      const state = inFlight.get(conv.id);
      state.dirty = false;
      await generateAndSend(conv, state.lastMsg);
      rounds++;
    } while (inFlight.get(conv.id)?.dirty && rounds < 3);
  } finally {
    inFlight.delete(conv.id);
  }
}

async function generateAndSend(convStale, msg) {
  try {
    // Estado fresco: a conversa pode ter sido aceita/transferida durante a espera
    const conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [convStale.id]);
    if (!conv || conv.status !== 'aguardando' || conv.ai_muted || conv.channel !== 'instagram') return;
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
    const waNumber = (await setting('wa_number', '')).replace(/\D/g, '');
    let system = buildSystemPrompt(pageContext, waNumber);

    // Resposta de story: busca (e indexa se preciso) o story exato + a sequência vizinha
    // (o padrão da loja é look → detalhe → arte com preço nos minutos seguintes)
    if (msg?.ig_story_id) {
      await content.ensureStory(msg.ig_story_id);
      const seq = await content.getSequence(msg.ig_story_id);
      if (seq) {
        system += `\n\nATENÇÃO: a última mensagem da cliente é RESPOSTA a um story específico. Abaixo, a sequência de stories daquele horário — o PREÇO das peças do look costuma estar nos stories vizinhos desta lista:\n${seq.sequence}`;
      } else {
        system += `\n\nATENÇÃO: a última mensagem da cliente é resposta a um story — a imagem anexada É o story respondido. Identifique a peça pela imagem (pode ser um conjunto de mais de uma peça) e procure o item correspondente no CONTEXTO DA PÁGINA pelo visual e pelo horário. Se não tiver certeza do preço, transfira.`;
      }
    }

    const messages = await buildMessages(conv.id);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: content.jsonSafe({ model: MODEL, max_tokens: 500, temperature: 0.7, system, messages }),
      signal: AbortSignal.timeout(60000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);

    let text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if (!text) return;

    if (text.includes('[SKIP]')) return; // nada novo a dizer — não envia

    let shouldTransfer = text.includes('[TRANSFERIR]');
    text = text.replace(/\[TRANSFERIR\]/g, '').trim();

    // [ZAP: peça | tamanho | cidade] → link wa.me com o pedido pré-escrito.
    // A frase "Vim do Instagram" é o marcador que o server.js usa pra etiquetar a
    // origem quando a cliente chega no WhatsApp — não mudar sem mudar lá também.
    const zapMatch = text.match(/\[ZAP:?\s*([^\]]*)\]/i);
    if (zapMatch) {
      text = text.replace(zapMatch[0], '').trim();
      const detalhes = zapMatch[1].split('|').map(s => s.trim()).filter(Boolean).join(', ');
      if (waNumber && detalhes) {
        const prefill = `Oi! Vim do Instagram e quero finalizar minha compra: ${detalhes}`;
        text += `\n\nhttps://wa.me/${waNumber}?text=${encodeURIComponent(prefill)}`;
      }
      // Com ou sem link, a equipe assume a partir daqui (no WhatsApp ou no Direct)
      shouldTransfer = true;
    }
    // Garantia: transferência NUNCA acontece em silêncio — se veio sem texto, avisa com a frase padrão
    if (shouldTransfer && !text) {
      text = 'Vou te passar para uma das meninas da nossa equipe, elas continuam com você por aqui rapidinho, tá bom? 😉';
    }
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
