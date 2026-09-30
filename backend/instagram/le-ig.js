// Lê no Instagram — responde DMs da @d_blackloja usando o CONTEXTO DA PÁGINA
// (stories/feed indexados pelo content.js) como fonte de verdade de preço e tamanho.
// NÃO consulta o ERP: preço/tamanho estão na arte que a Srª D'Black posta.
//
// v2 (22/09/2026) — correções a partir da auditoria dos Directs:
//  1. Saída em <analise>/<msg>: só o <msg> é enviado (fim do vazamento de raciocínio)
//  2. Travas de código: texto que fala da cliente em 3ª pessoa,
//     promessa ("vou confirmar", "já chamo") sem [TRANSFERIR] → vira transferência
//  3. Reação repetida não gera nova oferta (máx. 1 oferta sem resposta por 24h)
//  4. Menção em story → agradecimento fixo, sem IA
//  5. Pedido/entrega/reclamação pendente no histórico → transfere ANTES de vender
//  6. Histórico lido de todas as conversas da cliente (não só a aberta)
//  7. Horário da loja no prompt: fora do expediente não promete "rapidinho"
//  8. Alerta de transferência pro painel (evento 'handoff_needed')
//  9. Temperatura 0.3 e debounce de 8s
// 10. Chegada nas lojas pela etiqueta do content.js (terça → amanhã; qua-seg → já nas lojas)
// 11. Regra de preço: arte = à vista com 10%; cartão = preço cheio em 12x sem juros
const { queryAll, queryOne, queryRun } = require('../database');
const { sendDirectMessage, sendButtonMessage } = require('./api');
const content = require('./content');

const MODEL = 'claude-sonnet-4-6';
const DEBOUNCE_MS = 8000;
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

// ---------- helpers de regra (código, não prompt) ----------

// Horário das lojas: seg-sex 09-19, sáb 08-14 (America/Sao_Paulo)
function lojaAberta(date = new Date()) {
  const sp = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const d = sp.getDay(), h = sp.getHours() + sp.getMinutes() / 60;
  if (d >= 1 && d <= 5) return h >= 9 && h < 19;
  if (d === 6) return h >= 8 && h < 14;
  return false;
}
const agoraSP = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Rótulos que o dm.js coloca na primeira linha do content
const LABEL_RE = /^(↩️|📣|📎|🎬)[^\n]*\n?/u;
const stripLabel = (c) => String(c || '').replace(LABEL_RE, '').trim();
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+$/u;
const isReactionOnly = (c) => { const t = stripLabel(c); return !!t && EMOJI_ONLY_RE.test(t); };
const hasRealText = (c) => { const t = stripLabel(c); return !!t && !EMOJI_ONLY_RE.test(t); };

const OFFER_RE = /vamos garantir/i;
// Promessas que só podem sair junto com uma transferência de verdade
const PROMISE_RE = /(vou confirmar|confirmo (rapidinho|com)|j[aá] (te )?chamo|vou chamar|chamei uma das meninas|vou verificar|vou ver com a equipe|um segundo|j[aá] te passo a informa)/i;
// Sinais de que o texto é análise interna, não mensagem pra cliente
const LEAK_RE = /(^|\n)\s*---\s*(\n|$)|\b(a cliente|ela respondeu|ela reagiu|o story que ela|demonstrando entusiasmo|<\/?analise>)/i;
// Assuntos que exigem uma pessoa antes de qualquer venda
const ISSUE_RE = /(meu pedido|minha compra|fiz uma compra|fiz um pedido|minha entrega|v[aã]o entregar|dia (voc[eê]s )?(v[aã]o )?entreg|vou receber|n[aã]o recebi|n[aã]o chegou|rastreio|rastreamento|troca|trocar|defeito|reembolso|devolu|n[aã]o fui respondid|ningu[eé]m (me )?respond|sem resposta|meu pacote)/i;

const MENTION_THANKS = [
  'Que lindo, obrigada por marcar a gente! ✨',
  'Amamos ver você com a gente por aí, obrigada pela marcação! 🥰',
  'Obrigada por marcar a D\'Black, ficou lindo demais! 😍',
];

// Todas as mensagens desta cliente no Instagram (todas as conversas), mais recentes primeiro
async function customerHistory(phone, days = 30, limit = 60) {
  return queryAll(
    `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.phone = $1 AND c.channel = 'instagram' AND m.timestamp > NOW() - ($2 || ' days')::interval
      ORDER BY m.timestamp DESC LIMIT $3`, [phone, String(days), limit]);
}

// Reclamação/pedido da cliente sem resposta de uma PESSOA depois dela (a Lê não conta)
function pendingIssue(historyDesc) {
  const asc = [...historyDesc].reverse();
  let issueAt = -1;
  asc.forEach((m, i) => { if (!m.from_me && ISSUE_RE.test(stripLabel(m.content))) issueAt = i; });
  if (issueAt < 0) return null;
  const humanAfter = asc.slice(issueAt + 1).some(m => m.from_me && m.sender !== 'Lê (IA)');
  return humanAfter ? null : asc[issueAt];
}

// Já existe oferta da Lê nas últimas 24h que a cliente não respondeu com texto?
function unansweredOffer(historyDesc) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const m of historyDesc) { // mais recente primeiro
    if (new Date(m.timestamp).getTime() < dayAgo) return false;
    if (!m.from_me && hasRealText(m.content)) return false;          // ela respondeu de verdade depois
    if (m.from_me && m.sender === 'Lê (IA)' && OFFER_RE.test(m.content)) return true;
  }
  return false;
}

function buildSystemPrompt(pageContext, waNumber, aberta) {
  const fechamento = waNumber
    ? `- Quando a cliente decidir a peça e o tamanho (e você já souber a cidade), termine a mensagem com o marcador [ZAP: peça tamanho X | cidade]. UMA peça por barra, com o tamanho junto dela, e a cidade SEMPRE sozinha na última barra. O sistema troca o marcador por uma mensagem pronta com um BOTÃO que abre o WhatsApp da loja com o pedido já escrito — você NÃO precisa explicar nem escrever link: responda normalmente (preço, entrega, retirada) e feche com o marcador. Exemplo com uma peça: "Perfeito! Em Divino a retirada é gratuita na loja ✨ [ZAP: vestido midi preto tamanho 40 | Divino]". Exemplo com mais de uma: "[ZAP: cropped branco tamanho G | t-shirt poá marrom tamanho M | Realeza]"
- Se a cliente disser que prefere finalizar por aqui mesmo, ou voltar a falar depois do link, use [TRANSFERIR] para a equipe atender no Direct`
    : `- Quando a cliente decidir a peça e o tamanho, diga que vai passar para a equipe finalizar o pedido e coloque [TRANSFERIR]`;
  const transferirCompra = waNumber
    ? '- Cliente quer comprar mas prefere finalizar pelo Direct (senão, use o [ZAP: ...])'
    : '- Cliente decidiu comprar (fechar pedido/pagamento)';
  const avisoHorario = aberta
    ? 'A loja está ABERTA agora: ao transferir, pode dizer que uma das meninas responde por aqui.'
    : 'A loja física está FECHADA agora, mas VENDA NUNCA ESPERA: o WhatsApp da loja recebe mensagem a qualquer hora e as meninas respondem por ordem de mensagem. NUNCA mande uma cliente que quer comprar esperar a loja abrir — use o FUNIL DE VENDA (WhatsApp). Só troca/reclamação espera: aí diga que as meninas respondem por aqui assim que a loja abrir, sem prometer "rapidinho", "já" ou "agora".';

  return `Você é a Lê, vendedora online da D'Black Store, respondendo os Directs do Instagram @d_blackloja.

AGORA: ${agoraSP()}. ${avisoHorario}

FORMATO DA SUA RESPOSTA (OBRIGATÓRIO):
Primeiro pense dentro de <analise>...</analise>: qual story/peça, qual preço achou no contexto, qual regra abaixo se aplica. Esse trecho NUNCA é enviado. Análise CURTA: no máximo 4 frases. Use EXATAMENTE as tags <analise> e <msg> — nunca <thinking> nem variações.
Depois escreva SOMENTE a mensagem para a cliente dentro de <msg>...</msg>. Os marcadores [SKIP], [TRANSFERIR] e [ZAP: ...] vão dentro do <msg>. Tudo que estiver fora do <msg> é descartado.
Dentro do <msg> você fala COM a cliente: nunca fale dela em terceira pessoa, nunca descreva o story nem explique seu raciocínio.

QUEM VOCÊ É: Lê, 25 anos, mineira, simpática, acolhedora e carinhosa. Tom leve, descontraído, informal e humano — o mesmo tom da Srª D'Black nos stories. Você faz a cliente se sentir especial.

COMO VOCÊ ESCREVE:
- ESCREVA TODAS AS PALAVRAS POR EXTENSO. NUNCA abrevie ("vc", "pq", "tb" são proibidos)
- Mensagens curtas, máximo 300 caracteres, objetivas, em UMA mensagem só
- Emojis com moderação (1 por mensagem no máximo). NUNCA use o coração preto 🖤. Use só emojis leves e positivos (✨ 😍 🥰 😉 💕 🎉 👏). NUNCA use emojis tristes ou pesados (😢 💔 😡 😔 ☠️)
- NUNCA use listas, bullet points, negrito ou asteriscos
- NUNCA use apelidos (flor, querida, amor, miga). Use o nome se souber
- NUNCA repita saudação nem informação já dita na conversa
- Se a última mensagem da cliente JÁ estiver coberta pela sua resposta anterior, responda <msg>[SKIP]</msg>

O CANAL: a cliente chega respondendo um story, compartilhando um post ou mandando print. A imagem vem anexada na conversa — identifique a peça e cruze com o CONTEXTO DA PÁGINA abaixo. Mensagens com data entre colchetes, tipo [13/08], são de dias anteriores: leia para entender o histórico dela.

PRIORIDADE MÁXIMA — PEDIDO, ENTREGA, TROCA OU RECLAMAÇÃO: se a cliente falar de compra já feita, entrega, pacote, troca, defeito ou que ficou sem resposta (mesmo em dias anteriores e sem ninguém ter resolvido), NÃO venda nada. Peça desculpas em uma frase se ela ficou sem resposta e transfira com [TRANSFERIR].

MENSAGEM DE CARINHO (agradecimento, parabéns, elogio à loja, à Srª D'Black ou à modelo, "obrigada", "tá linda"): retribua em uma frase ou responda [SKIP]. NUNCA emende venda.

REAÇÃO A STORY (emoji ou elogio curto):
- Story SEM PRODUTO (campanha, sorteio, D'Black Lover, bastidores, aviso): agradeça em uma frase curta SÓ se ainda não falou dessa campanha com ela hoje; senão [SKIP]. Nunca ofereça produto.
- Story de PRODUTO: responda o preço da arte e pergunte APENAS "Vamos garantir o seu?" / "Vamos garantir a sua?". NÃO pergunte tamanho nem cidade ainda.
- Se você JÁ ofereceu alguma peça nas últimas 24h e ela não respondeu com texto (só reagiu de novo), responda [SKIP]. Oferta em sequência cansa a cliente.

PEDIDO EXPLÍCITO ("quero", "vou levar", "um de cada", "como compro?"): ela JÁ disse que quer — NUNCA pergunte se ela quer garantir. Responda o preço e JÁ pergunte o tamanho e a cidade (a cidade só se ainda não souber pela conversa). Se ela sumir depois disso e voltar reagindo a outro story, retome o pedido em aberto antes de oferecer outra peça.

REGRA DE OURO — PREÇOS E TAMANHOS:
- A ÚNICA fonte de preço, tamanho e cor é o CONTEXTO DA PÁGINA (o que a Srª D'Black escreveu nas artes)
- Copie o preço e o parcelamento EXATAMENTE como estão na arte
- COMO FUNCIONA O PREÇO DA D'BLACK: o valor cheio (ex.: R$79,90) é o preço À VISTA, que já tem 10% de desconto. No cartão não tem desconto: o parcelamento (ex.: 12x de R$7,40) é o preço cheio dividido SEM JUROS. Por isso a parcela vezes 12 dá mais que o valor à vista — está certo, não recalcule
- Escreva sempre deixando isso claro: "R$79,90 à vista ou 12x de R$7,40 sem juros no cartão". NUNCA diga que o cartão tem desconto nem que o valor à vista vale no cartão
- Os stories saem em SEQUÊNCIA: o look no provador e, nos minutos seguintes, um story de cada peça com o preço — procure o preço nos stories de horário vizinho
- Se o contexto NÃO tiver o preço ou tamanho da peça, NUNCA invente: mande para o WhatsApp com [ZAP: ...] (veja FUNIL DE VENDA) — lá as meninas confirmam e já finalizam
- Tamanho que ela pediu fora da grade da arte (ex.: pediu PP e a arte diz 36 ao 44): diga com clareza que a grade da peça é essa e mande para o WhatsApp com [ZAP: ...] para as meninas verem se tem

CHEGADA NAS LOJAS ("já chegou?", "já tem na loja de Divino?"): cada story/post do contexto vem com uma etiqueta calculada pelo sistema:
- [JÁ ESTÁ NAS LOJAS]: pode afirmar que a peça já está disponível nas lojas
- [CHEGA NAS LOJAS AMANHÃ (quarta), a partir das 9h]: é peça postada hoje, terça — diga que chega nas lojas amanhã a partir das 9h
Use SEMPRE a etiqueta da peça que ela perguntou; nunca deduza pelo dia da semana por conta própria. Isso vale para as 3 lojas. Você não sabe quantas peças ou quais tamanhos ainda restam: se ela quiser garantir um tamanho, siga o FECHAMENTO normal (a equipe confirma a grade). Se não conseguir identificar a peça no contexto, mande para o WhatsApp com [ZAP: ...].

COR OU TAMANHO QUE NÃO TEM NA ARTE: sugira UMA outra peça do contexto que tenha a cor ou tamanho que ela quer, se existir; se não existir, mande para o WhatsApp com [ZAP: ...] para as meninas verem reposição. Nunca encerre só com "não temos".

PROMESSAS: frases como "vou confirmar", "já chamo uma das meninas", "vou verificar" SÓ podem sair junto com [ZAP: ...] ou [TRANSFERIR]. Nunca prometa algo e continue a conversa sozinha. E NUNCA diga "as meninas te respondem quando a loja abrir" para quem quer COMPRAR — compra vai para o WhatsApp na hora.

PROMOÇÕES: TODA promoção divulgada nos stories/feed vale TAMBÉM nas compras online, além das lojas físicas. Restrição só existe se estiver escrita na arte.

FECHAMENTO DA VENDA:
- Entrega: retirada grátis nas lojas (São Domingos, Divino e São João do Manhuaçu); motoboy R$7 (Santa Margarida, Matipó, Abre Campo, Sericita, Padre Fialho, São Francisco do Glória, Fervedouro, Carangola, Pedra Bonita, Orizânia, Santo Amaro e Realeza); Correios R$25 para todo o Brasil (6 a 10 dias)
- Pagamento: à vista (com os 10% de desconto já no preço da arte) ou cartão de crédito em até 12x sem juros sem o desconto (cite as condições da arte, exatamente como estão)
${fechamento}

${waNumber ? `FUNIL DE VENDA — COMPRA NUNCA ESPERA: se a cliente demonstrou interesse em uma peça ("quero", "valor?", "tem?", "me separa", "reserva") e você NÃO consegue fechar sozinha — preço ou tamanho fora do contexto, pedido de reserva, cor/composição/equivalência a confirmar, peça que você não identificou — NÃO transfira para o Direct e NÃO prometa resposta depois. Responda o que souber e feche com [ZAP: ...] preenchendo o que já sabe: a peça como você a identificou (ou a dúvida dela), o tamanho e a cidade SE ela já disse. O WhatsApp funciona a qualquer hora, as meninas atendem por ordem de mensagem. Exemplos: "Esse conjunto é um arraso! As meninas confirmam o valor e já finalizam com você pelo WhatsApp 😉 [ZAP: conjunto jeans listrado]" · "[ZAP: vestido tule azul tamanho 42 | Santa Margarida]"

QUANDO TRANSFERIR pro Direct (texto curto + [TRANSFERIR] no final) — SOMENTE nestes casos:` : `QUANDO TRANSFERIR (texto curto + [TRANSFERIR] no final):
${transferirCompra}
- Informação que não está no contexto (inclusive peça que você não achou nos stories/posts)`}
- Pedido JÁ FEITO, entrega, troca, defeito, reclamação ou mensagem antiga sem resposta
- Cliente pede para falar com uma pessoa, ou prefere finalizar a compra pelo Direct em vez do WhatsApp
- Se perguntarem se é robô: confirme que é assistente virtual da loja e ofereça passar para a equipe
- SEMPRE avise de forma leve que uma pessoa da equipe vai continuar ali mesmo, respeitando o horário da loja (veja AGORA no topo). NUNCA transfira em silêncio

NUNCA: prometa reserva de peça, dê desconto por conta própria, invente promoção, fale de assunto fora da loja.

ÁUDIOS: peça com carinho para escrever, que você responde.

A D'BLACK: lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Srª D'Black (Letícia). 3 lojas físicas + online. Horários: segunda a sexta 09:00-19:00; sábado: todas as lojas das 08:00 às 14:00.

CONTEXTO DA PÁGINA (atualizado automaticamente a cada 5 minutos — é isto que está no ar):
${pageContext}`;
}

// Monta o histórico no formato da API — agora com TODAS as conversas da cliente
// (a conversa aberta pode ser nova e esconder uma reclamação da semana passada)
async function buildMessages(conv) {
  const rows = await queryAll(
    `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.phone = $1 AND c.channel = 'instagram'
      ORDER BY m.timestamp DESC LIMIT 24`, [conv.phone]);
  rows.reverse();

  const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const dataTag = (ts) => {
    const d = new Date(ts).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return d === hoje ? '' : `[${d.slice(0, 5)}] `;
  };

  // Só as 2 imagens mais recentes da cliente entram como imagem (custo/latência)
  const imageIds = rows.filter(m => !m.from_me && m.media_type === 'image' && m.media_url?.startsWith('/media/'))
    .slice(-2).map(m => m.id);

  const messages = [];
  for (const m of rows) {
    const role = m.from_me ? 'assistant' : 'user';
    const who = m.from_me && m.sender && m.sender !== 'Lê (IA)' ? '(equipe) ' : '';
    let contentBlocks = dataTag(m.timestamp) + who + (m.content || '[mensagem]');
    if (!m.from_me && imageIds.includes(m.id)) {
      const media = await queryOne("SELECT mime_type, data FROM media_files WHERE id = $1", [m.media_url.replace('/media/', '')]);
      if (media && media.mime_type.startsWith('image/')) {
        contentBlocks = [
          { type: 'image', source: { type: 'base64', media_type: media.mime_type, data: media.data } },
          { type: 'text', text: dataTag(m.timestamp) + (m.content || '(imagem)') },
        ];
      }
    }
    // Mescla mensagens consecutivas do mesmo papel (API exige alternância user/assistant)
    const last = messages[messages.length - 1];
    if (last && last.role === role && typeof last.content === 'string' && typeof contentBlocks === 'string') {
      last.content += '\n' + contentBlocks;
    } else if (last && last.role === role) {
      const toBlocks = (c) => typeof c === 'string' ? [{ type: 'text', text: c }] : c;
      last.content = [...toBlocks(last.content), ...toBlocks(contentBlocks)];
    } else {
      messages.push({ role, content: contentBlocks });
    }
  }
  if (messages.length === 0 || messages[0].role !== 'user') messages.unshift({ role: 'user', content: '(início da conversa)' });
  if (messages[messages.length - 1].role !== 'user') messages.push({ role: 'user', content: '(aguardando sua resposta)' });
  return messages;
}

// Trava por conversa: mensagens em rajada geram UMA resposta só
const inFlight = new Map(); // convId → { dirty: bool, lastMsg }

async function maybeReply(conv, msg) {
  const lock = inFlight.get(conv.id);
  if (lock) { lock.dirty = true; lock.lastMsg = msg; return; }
  inFlight.set(conv.id, { dirty: false, lastMsg: msg });
  try {
    let rounds = 0;
    do {
      await new Promise(r => setTimeout(r, DEBOUNCE_MS)); // agrupa mensagens em rajada
      const state = inFlight.get(conv.id);
      state.dirty = false;
      await generateAndSend(conv, state.lastMsg);
      rounds++;
    } while (inFlight.get(conv.id)?.dirty && rounds < 3);
  } finally {
    inFlight.delete(conv.id);
  }
}

// Extrai só a mensagem pra cliente; qualquer coisa suspeita vira null (→ fallback).
// Tolera </msg> ausente: com max_tokens a resposta pode ser cortada depois do <msg>.
function extractMsg(raw) {
  const m = raw.match(/<msg>([\s\S]*?)(?:<\/msg>|$)/i);
  if (!m) return null;
  return m[1].trim();
}

async function generateAndSend(convStale, msg) {
  try {
    // Estado fresco: a conversa pode ter sido aceita/transferida durante a espera
    let conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [convStale.id]);
    if (!conv || conv.channel !== 'instagram' || conv.status === 'finalizado') return;
    if ((await setting('ig_ai_enabled', 'false')) !== 'true') return;

    // Conversa presa com a equipe (aceita ou transferida) SEM resposta humana há 30+ min
    // e chegou mensagem nova: volta pra fila e a Lê reassume (decisão do dono, 23/09).
    // Exceções: reclamação/pedido pendente continua com a equipe; msg da equipe nos
    // últimos 30 min (inclusive echo "Instagram" do app) = atendimento ativo, Lê quieta.
    if (conv.status === 'atendendo' || conv.ai_muted) {
      const historyPeek = await customerHistory(conv.phone);
      if (pendingIssue(historyPeek)) return;
      const equipeAtiva = await queryOne(
        `SELECT 1 FROM messages WHERE conversation_id = $1 AND from_me = true
           AND sender IS DISTINCT FROM 'Lê (IA)' AND timestamp > NOW() - interval '30 minutes' LIMIT 1`,
        [conv.id]);
      if (equipeAtiva) return;
      await queryRun("UPDATE conversations SET status = 'aguardando', agent_id = NULL, agent_name = NULL, ai_muted = false WHERE id = $1", [conv.id]);
      conv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
      notify('conversation_updated', conv);
      console.log(`♻️ [le-ig] equipe ociosa há 30min+ — Lê reassumiu ${conv.customer_push_name || conv.phone}`);
    } else if (conv.status !== 'aguardando') return;

    // Modo teste: só responde os usuários da lista (ig_ai_test_users = '*' libera todos)
    const testUsers = (await setting('ig_ai_test_users', '')).trim();
    if (testUsers && testUsers !== '*') {
      const allowed = testUsers.split(',').map(u => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
      const uname = (conv.customer_push_name || '').replace(/^@/, '').toLowerCase();
      if (!allowed.includes(uname) && !allowed.includes(String(conv.phone))) return;
    }

    const aberta = lojaAberta();
    const history = await customerHistory(conv.phone);
    const lastContent = msg?.content || '';

    // Envio + registro no painel
    const recordSent = async (text, sentId) => {
      const msgId = sentId || genId();
      await queryRun(
        "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1, $2, true, 'Lê (IA)', $3, 1, NOW()) ON CONFLICT (id) DO NOTHING",
        [msgId, conv.id, text]);
      await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2", [text, conv.id]);
      notify('new_message', {
        conversation: { ...conv, last_message: text, last_message_from_me: true },
        message: { id: msgId, conversation_id: conv.id, from_me: true, sender: 'Lê (IA)', content: text, ack: 1, timestamp: new Date().toISOString() },
      });
    };
    const sendText = async (text) => {
      const r = await sendDirectMessage(conv.phone, text);
      await recordSent(text, r?.message_id);
    };
    const transferMsg = () => aberta
      ? 'Vou te passar para uma das meninas da nossa equipe, ela continua com você por aqui mesmo, tá bom? 😉'
      : 'Deixei anotado para as meninas da nossa equipe, elas te respondem por aqui assim que a loja abrir, tá bom? 😉';
    const doTransfer = async (reason) => {
      await queryRun("UPDATE conversations SET ai_muted = true WHERE id = $1", [conv.id]);
      const fresh = await queryOne("SELECT * FROM conversations WHERE id = $1", [conv.id]);
      notify('conversation_updated', fresh);
      // Alerta pra equipe: o painel deve tocar som/destacar. Se quiser, mande também
      // um WhatsApp pra vendedora de plantão aqui (setting 'ig_handoff_alert_number').
      notify('handoff_needed', { conversation: fresh, reason, at: new Date().toISOString() });
      console.log(`🙋 [le-ig] transferida ${conv.customer_push_name || conv.phone}: ${reason}`);
    };

    // 1) Pedido/entrega/reclamação sem resposta humana → pessoa primeiro, venda nunca
    const issue = pendingIssue(history);
    if (issue) {
      const nome = (conv.customer_name || '').split(' ')[0];
      const text = `${nome ? `Oi, ${nome}! ` : ''}Vi sua mensagem sobre o seu pedido e sinto muito pela demora. ${aberta ? 'Já chamei uma das meninas para resolver isso com você por aqui mesmo' : 'Deixei anotado para as meninas, elas resolvem isso com você por aqui assim que a loja abrir'}, tá bom?`;
      await sendText(text);
      await doTransfer(`pendência: "${stripLabel(issue.content).slice(0, 80)}"`);
      return;
    }

    // 2) Menção em story → agradecimento fixo, 1x por dia, sem IA
    if (lastContent.startsWith('📣') && !hasRealText(lastContent)) {
      const dayAgo = Date.now() - 24 * 3600 * 1000;
      const thankedToday = history.some(m => m.from_me && MENTION_THANKS.includes(m.content) && new Date(m.timestamp).getTime() > dayAgo);
      if (!thankedToday) await sendText(MENTION_THANKS[Math.floor(Math.random() * MENTION_THANKS.length)]);
      return;
    }

    // 3) Só reagiu de novo e já tem oferta sem resposta nas últimas 24h → não insiste
    if (isReactionOnly(lastContent) && unansweredOffer(history)) return;

    const apiKey = await getApiKey();
    if (!apiKey) return;

    const pageContext = await content.getPageContext();
    const waNumber = (await setting('wa_number', '')).replace(/\D/g, '');
    const system = buildSystemPrompt(pageContext, waNumber, aberta);
    let storyContext = '';
    // Parte que muda por conversa fica FORA do bloco cacheado (o prompt base + contexto
    // da página se repete em toda chamada — prompt caching paga 10% do preço nele)
    let systemExtra = '';

    if (msg?.ig_story_id) {
      await content.ensureStory(msg.ig_story_id);
      const seq = await content.getSequence(msg.ig_story_id);
      if (seq) {
        storyContext = seq.sequence;
        systemExtra += `\n\nATENÇÃO: a última mensagem da cliente é RESPOSTA a um story específico. Abaixo, a sequência de stories daquele horário — o PREÇO das peças do look costuma estar nos stories vizinhos desta lista:\n${seq.sequence}`;
      } else {
        systemExtra += `\n\nATENÇÃO: a última mensagem da cliente é resposta a um story — a imagem anexada É o story respondido. Identifique a peça pela imagem e procure o item correspondente no CONTEXTO DA PÁGINA pelo visual e pelo horário. Se não tiver certeza do preço, mande para o WhatsApp com [ZAP: ...].`;
      }
    }

    const systemBlocks = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }];
    if (systemExtra) systemBlocks.push({ type: 'text', text: systemExtra });

    const messages = await buildMessages(conv);

    const callClaude = async (msgs) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: content.jsonSafe({ model: MODEL, max_tokens: 1200, temperature: 0.3, system: systemBlocks, messages: msgs }),
        signal: AbortSignal.timeout(60000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) throw new Error(json.error?.message || `Anthropic HTTP ${res.status}`);
      return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    };

    let raw = await callClaude(messages);
    if (!raw) return;

    let text = extractMsg(raw);

    // Sem <msg> (tag errada tipo <thinking>, typo, corte): UMA nova tentativa antes de desistir
    if (text === null && !raw.includes('[SKIP]')) {
      console.error('[le-ig] resposta sem <msg>, tentando de novo:', raw.slice(0, 200));
      raw = await callClaude([...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: '(sistema: sua resposta veio SEM a tag <msg> e NÃO foi enviada à cliente. Reenvie agora SOMENTE <msg>sua mensagem</msg>, sem análise.)' },
      ]).catch(() => '');
      text = raw ? extractMsg(raw) : null;
    }

    let shouldTransfer = false;
    let transferReason = '';
    let zapButton = null;

    // Fallback quando a Lê falha (formato/vazamento): venda não espera —
    // em vez de "deixei anotado", manda a cliente pro WhatsApp com a mensagem dela pré-preenchida
    const zapFallbackButton = () => {
      if (!waNumber) return null;
      const ultima = stripLabel(lastContent).slice(0, 140);
      return {
        text: 'Pra você não ficar esperando: é só tocar no botão abaixo e mandar sua mensagem no nosso WhatsApp, as meninas resolvem tudo com você por lá, tá bom? 😉',
        url: `https://wa.me/${waNumber}?text=${encodeURIComponent(`Oi! Vim do Instagram.${ultima ? ` ${ultima}` : ''}`)}`,
      };
    };

    if (text === null) {
      if (raw.includes('[SKIP]')) return;
      // Reação/emoji não merece transferência por falha nossa: fica em silêncio
      if (isReactionOnly(lastContent)) { console.error('[le-ig] sem <msg> em reação, ignorada'); return; }
      console.error('[le-ig] resposta sem <msg> após retry, bloqueada:', raw.slice(0, 200));
      text = ''; shouldTransfer = true;
      zapButton = zapFallbackButton();
      transferReason = zapButton ? 'resposta fora do formato → WhatsApp' : 'resposta fora do formato';
    }

    if (text.includes('[SKIP]')) return;

    if (text.includes('[TRANSFERIR]')) { shouldTransfer = true; transferReason = transferReason || 'IA pediu transferência'; }
    text = text.replace(/\[TRANSFERIR\]/g, '').trim();

    // Trava: vazamento de análise → não envia; venda vai pro WhatsApp
    if (text && LEAK_RE.test(text)) {
      console.error('[le-ig] texto parecia análise interna, bloqueado:', text.slice(0, 200));
      text = ''; shouldTransfer = true;
      zapButton = zapButton || zapFallbackButton();
      transferReason = zapButton ? 'bloqueio de vazamento → WhatsApp' : 'bloqueio de vazamento';
    }

    // [ZAP: peça tamanho X | cidade] → mensagem com BOTÃO "Abrir WhatsApp".
    // "Vim do Instagram" é o marcador que o server.js usa pra etiquetar a origem.
    const zapMatch = text.match(/\[ZAP:?\s*([^\]]*)\]/i);
    if (zapMatch) {
      text = text.replace(zapMatch[0], '').trim();
      const partes = zapMatch[1].split('|').map(s => s.trim()).filter(Boolean);
      if (waNumber && partes.length) {
        const cidade = partes.length > 1 ? partes.pop() : null;
        const linhas = partes.map(p => `- ${p}`).join('\n');
        const prefill = `Oi! Vim do Instagram e quero finalizar meu pedido:\n${linhas}${cidade ? `\nCidade: ${cidade}` : ''}`;
        zapButton = {
          text: 'Pra finalizar é só tocar no botão abaixo, tá bom? Seu pedido já chega prontinho no nosso WhatsApp e a equipe fecha tudo com você por lá 😉',
          url: `https://wa.me/${waNumber}?text=${encodeURIComponent(prefill)}`,
        };
      }
      shouldTransfer = true; transferReason = transferReason || 'venda enviada pro WhatsApp';
    }

    // Trava: promessa sem transferência nem WhatsApp → transfere de verdade
    if (text && PROMISE_RE.test(text) && !shouldTransfer && !zapButton) {
      shouldTransfer = true; transferReason = 'promessa de confirmar com a equipe';
    }

    // Transferência NUNCA em silêncio
    if (shouldTransfer && !text && !zapButton) text = transferMsg();
    if (!text && !zapButton) return;

    if (text) await sendText(text);

    if (zapButton) {
      const buttons = [{ type: 'web_url', url: zapButton.url, title: 'Abrir WhatsApp' }];
      try {
        const btnResult = await sendButtonMessage(conv.phone, zapButton.text, buttons);
        await recordSent(`${zapButton.text}\n\n🔘 Abrir WhatsApp → ${zapButton.url}`, btnResult?.message_id);
      } catch (e) {
        console.error('[le-ig] botão do WhatsApp falhou, enviando link em texto:', e.message);
        const fallback = `${zapButton.text.replace('no botão abaixo', 'no link abaixo')}\n\n${zapButton.url}`;
        const igResult = await sendDirectMessage(conv.phone, fallback).catch(() => null);
        if (igResult) await recordSent(fallback, igResult?.message_id);
      }
    }

    console.log(`🤖 [le-ig] Lê respondeu ${conv.customer_push_name || conv.phone}${zapButton ? ' (botão WhatsApp)' : ''}${shouldTransfer ? ' (transferindo)' : ''}`);

    if (shouldTransfer) await doTransfer(transferReason);
  } catch (e) {
    console.error('[le-ig] erro ao responder:', e.message);
  }
}

module.exports = { init, maybeReply,
  // exportados pra teste
  _test: { lojaAberta, isReactionOnly, hasRealText, pendingIssue, unansweredOffer, extractMsg, LEAK_RE, PROMISE_RE } };
