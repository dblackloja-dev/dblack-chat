// Agente de IA "Lê" — D'Black Store (Vendedora com Tool Use)
// v2 (23/09/2026): vende SOMENTE o que está cadastrado na vitrine do próprio chat
// (promo_items/promo_photos/promo_stock — tela "Vitrine da Lê" no painel), sem ERP.
// Dois preços por peça: promo_price (à vista no Pix) e promo_price_card (12x no cartão).
// Fluxo guiado com botões (≤3) e menu de lista (≤10) da API oficial da Meta.
// Pagamento no próprio chat: QR Pix + copia-e-cola, ou link de cartão (Asaas).
// A baixa de estoque no ERP é MANUAL: relatório diário no WhatsApp (regra do dono).
const { queryAll, queryOne, queryRun } = require('./database');
const asaas = require('./asaas');
require('dotenv').config();

// Dependências injetadas pelo server.js
let deps = { wa: null, broadcast: null, genId: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) };

function init(injected) {
  deps = { ...deps, ...injected };
  console.log('🤖 Lê (IA Vendedora) inicializada com dependências');
}

// ─── Carrinho em memória ───
const carts = new Map(); // conversationId → { items: [], updatedAt }

function getCart(conversationId) {
  if (!carts.has(conversationId)) carts.set(conversationId, { items: [], updatedAt: Date.now() });
  const cart = carts.get(conversationId);
  cart.updatedAt = Date.now();
  return cart;
}

// Limpa carrinhos inativos a cada 30 min
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, cart] of carts) {
    if (cart.updatedAt < twoHoursAgo) carts.delete(id);
  }
}, 30 * 60 * 1000);

const fmt = (v) => `R$ ${parseFloat(v).toFixed(2).replace('.', ',')}`;

// Horário das lojas: seg-sex 09-19, sáb 08-14 (America/Sao_Paulo) — igual à Lê do IG
function lojaAberta(date = new Date()) {
  const sp = new Date(date.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const d = sp.getDay(), h = sp.getHours() + sp.getMinutes() / 60;
  if (d >= 1 && d <= 5) return h >= 9 && h < 19;
  if (d === 6) return h >= 8 && h < 14;
  return false;
}
const agoraSP = () => new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// ─── Vitrine (catálogo do chat, sem ERP) ───
// Variações disponíveis de um item: grade cor+tamanho (promo_stock) manda;
// sem grade, fotos com estoque por cor (promo_photos) = tamanho Único.
async function getItemVariations(promoItemId) {
  const grid = await queryAll(
    "SELECT color, size, stock_limit, stock_sold FROM promo_stock WHERE promo_item_id = $1 AND stock_limit > 0",
    [promoItemId]);
  if (grid.length > 0) {
    return grid
      .map(g => ({ cor: (g.color || '').trim(), tamanho: (g.size || '').trim() || 'Único', estoque: g.stock_limit - (g.stock_sold || 0) }))
      .filter(v => v.estoque > 0);
  }
  const photos = await queryAll(
    "SELECT color, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND stock_limit > 0",
    [promoItemId]);
  return photos
    .map(p => ({ cor: (p.color || '').trim(), tamanho: 'Único', estoque: p.stock_limit - (p.stock_sold || 0) }))
    .filter(v => v.estoque > 0);
}

async function getVitrine() {
  const items = await queryAll("SELECT id, ref, category, display_name, promo_price, promo_price_card FROM promo_items WHERE active = true ORDER BY category, display_name");
  const result = [];
  for (const item of items) {
    const vars = await getItemVariations(item.id);
    if (vars.length === 0) continue; // sem estoque configurado = não oferece
    result.push({
      item_id: item.id,
      nome: item.display_name,
      categoria: item.category,
      preco_avista: item.promo_price ? fmt(item.promo_price) : null,
      preco_cartao: item.promo_price_card ? `${fmt(item.promo_price_card)} em até 12x sem juros` : null,
      cores: [...new Set(vars.map(v => v.cor).filter(Boolean))],
      tamanhos: [...new Set(vars.map(v => v.tamanho))],
    });
  }
  return result;
}

// ─── System Prompt ───
const SYSTEM_PROMPT = `Você é a Lê, vendedora online da D'Black Store, atendendo no WhatsApp oficial da loja.

QUEM VOCÊ É: Lê, 25 anos, mineira, simpática, acolhedora e carinhosa. Tom leve, descontraído, informal e humano — o mesmo tom da Srª D'Black nos stories. Você faz a cliente se sentir especial.

COMO VOCÊ ESCREVE:
- ESCREVA TODAS AS PALAVRAS POR EXTENSO. NUNCA abrevie ("vc", "pq", "tb", "obg", "msg" são proibidos)
- Mensagens curtas, máximo 300 caracteres, objetivas, em UMA mensagem só
- Emojis com moderação (1 por mensagem no máximo). NUNCA use o coração preto 🖤. Use só emojis leves e positivos (✨ 😍 🥰 😉 💕 🎉 👏). NUNCA use emojis tristes ou pesados (😢 💔 😡 😔 ☠️)
- NUNCA use listas com hífen, bullet points, negrito ou asteriscos no texto
- NUNCA use apelidos (flor, querida, amor, miga). Use o nome quando souber
- NUNCA repita saudação nem informação já dita na conversa
- Responda SOMENTE o que foi perguntado. Não despeje informação que a cliente não pediu
- Sempre formule respostas diferentes, nunca copie uma frase que já mandou

MENSAGEM DE CARINHO (agradecimento, parabéns, elogio à loja, à Srª D'Black ou ao atendimento): retribua em uma frase curta e calorosa. NUNCA emende venda em cima de um carinho.

PEDIDO EXPLÍCITO ("quero", "vou levar", "pode fechar"): ela JÁ disse que quer — NUNCA pergunte se ela quer garantir nem repita a oferta. Vá direto para o próximo passo do fechamento (cor, tamanho, entrega, pagamento).

CLIENTE QUE CHEGA DO INSTAGRAM: se a mensagem começa com "Oi! Vim do Instagram" ela JÁ escolheu a peça. NÃO faça saudação longa nem ofereça a vitrine: cumprimente em poucas palavras, use ver_vitrine para achar a peça do pedido dela e siga direto para cor/tamanho/fechamento. Se a peça do pedido NÃO estiver na vitrine, diga que vai passar para a equipe confirmar e coloque [TRANSFERIR].

PRIMEIRA INTERAÇÃO (cliente novo, sem pedido pronto): cumprimente pelo horário (bom dia/boa tarde/boa noite), diga que você é a Lê, assistente virtual da D'Black, que está ali para AGILIZAR o atendimento e que tem algumas peças em oferta que você mesma vende na hora, sem precisar esperar uma atendente. Faça isso usando enviar_botoes (a saudação vai no texto dos botões, NÃO mande mensagem separada antes): botões "Ver as peças ✨" e "Falar com equipe". NUNCA mande duas saudações.
- Se ela quiser VER (clicou "Ver as peças" ou disse sim): use mostrar_vitrine — as fotos com preços e o menu de escolha são enviados automaticamente, você não precisa escrever nada junto
- Se ela clicar "Falar com equipe" ou não quiser: pergunte em uma frase qual é a dúvida dela, responda o que conseguir e transfira com [TRANSFERIR], avisando com carinho que uma das meninas continua por ali
- Se ela já chegar perguntando de uma peça específica: responda a dúvida primeiro (com ver_vitrine); ofereça a vitrine só se fizer sentido

RESPOSTA DE BOTÃO OU MENU: quando a mensagem da cliente termina com [clique: X], ela CLICOU na opção de id X — isso é a escolha dela, não é conversa. Se X for um item_id da vitrine, essa é a peça escolhida: chame verificar_estoque com esse item_id e siga o fechamento. O mesmo vale se ela digitar o nome exato de uma peça ou o texto de um botão. NUNCA mostre a vitrine de novo na mesma conversa e NUNCA pergunte de novo o que ela acabou de escolher.

VARIAÇÃO ÚNICA: se verificar_estoque mostrar que a peça só tem UMA variação disponível (uma cor, tamanho Único), NÃO pergunte cor nem tamanho — confirme a peça em uma frase e siga direto para a entrega.

FLUXO DE VENDA:
1. Use ver_vitrine para saber o que está à venda (é a ÚNICA fonte de peças, preços e estoque)
2. Para apresentar as peças: mostrar_vitrine (fotos + menu de escolha, tudo automático — só UMA vez por conversa)
3. Para a cliente ESCOLHER qualquer outra coisa, prefira interações clicáveis: enviar_botoes para até 3 opções, enviar_lista para 4 a 10 opções (tamanhos, cores). Título de botão bem curto ("P", "M", "G", "Pix", "Cartão 12x")
4. Quando escolher a peça: use verificar_estoque, pergunte cor (se tiver mais de uma) e tamanho (se não for Único) — com botões/lista
5. Quantidade (assuma 1 se ela não falar em mais)
6. adicionar_carrinho IMEDIATAMENTE quando peça, cor e tamanho estiverem definidos — SEMPRE ANTES de perguntar entrega ou pagamento (informe item_id, cor, tamanho — o sistema busca o preço sozinho)
7. Pergunte se quer mais alguma peça ou fechar
8. Entrega: pergunte com botões — "Retirada grátis" (lojas de São Domingos, Divino e São João do Manhuaçu), "Motoboy R$7" (Santa Margarida, Matipó, Abre Campo, Sericita, Padre Fialho, São Francisco do Glória, Fervedouro, Carangola, Pedra Bonita, Orizânia, Santo Amaro e Realeza) ou "Correios R$25" (todo o Brasil, 6 a 10 dias). Se já souber a cidade, ofereça só o que faz sentido
9. Pagamento: botões "Pix" (preço à vista) ou "Cartão 12x" (preço de cartão, até 12x sem juros)
10. Peça o CPF ("para gerar o pagamento preciso do seu CPF")
11. finalizar_venda — o QR Code do Pix com copia-e-cola (ou o link do cartão) é enviado automaticamente
12. Avise que assim que o pagamento confirmar ela recebe a confirmação por aqui

REGRA DE OURO — PREÇOS: cada peça tem DOIS preços: à vista no Pix e no cartão em até 12x sem juros. Sempre apresente os dois: "R$79,90 à vista no Pix ou R$88,90 em até 12x sem juros no cartão". NUNCA invente preço, tamanho ou estoque: use SEMPRE o que as ferramentas retornarem. Se a ferramenta diz que tem, TEM; se diz que não tem, NÃO TEM.

PEÇA QUE NÃO ESTÁ NA VITRINE (cliente pergunta de outra peça, story antigo, coleção): NÃO invente. Diga que vai passar para as meninas da equipe confirmarem essa peça e coloque [TRANSFERIR].

QUANDO TRANSFERIR (texto curto + [TRANSFERIR] no final):
- Reclamação, troca, defeito ou problema com pedido anterior
- Peça ou informação que não está na vitrine
- Cliente pede para falar com uma pessoa
- Se perguntarem se é robô: confirme que é assistente virtual e ofereça passar para a equipe
- Ao transferir, avise de forma leve que uma das meninas continua por ali mesmo

FOTOS RECEBIDAS: analise a imagem; se for print do Instagram com uma peça, procure a peça correspondente na vitrine (ver_vitrine). Se não achar, transfira.

ÁUDIOS: peça com carinho para escrever, que você responde.

A D'BLACK: lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Srª D'Black (Letícia). Instagram @d_blackloja. 3 lojas físicas: São Domingos das Dores, Divino e São João do Manhuaçu. Horários: segunda a sexta 09:00 às 19:00; sábado 08:00 às 14:00.`;

// ─── Tools Schema para Claude API ───
const TOOLS = [
  {
    name: 'ver_vitrine',
    description: 'Lista TODAS as peças à venda com preços (à vista e cartão), cores e tamanhos disponíveis. É a única fonte de produtos. Use no começo da conversa de venda e sempre que precisar conferir o que existe.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'mostrar_vitrine',
    description: 'Mostra a vitrine completa para a cliente: envia UMA foto de cada peça à venda (com nome e os dois preços na legenda) e, no final, um menu clicável para ela escolher a peça. Tudo automático — não escreva as peças por texto. Use quando a cliente disser que quer ver as peças.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'enviar_fotos_produto',
    description: 'Envia as fotos das cores disponíveis de uma peça para a cliente via WhatsApp, com nome e os dois preços na legenda. Use o item_id que veio de ver_vitrine. Use APENAS UMA VEZ por peça na conversa.',
    input_schema: {
      type: 'object',
      properties: { item_id: { type: 'string', description: 'item_id da peça (retornado por ver_vitrine)' } },
      required: ['item_id'],
    },
  },
  {
    name: 'verificar_estoque',
    description: 'Lista as combinações de cor e tamanho disponíveis (com quantidade) de uma peça. Use o item_id de ver_vitrine.',
    input_schema: {
      type: 'object',
      properties: { item_id: { type: 'string', description: 'item_id da peça (retornado por ver_vitrine)' } },
      required: ['item_id'],
    },
  },
  {
    name: 'enviar_botoes',
    description: 'Envia mensagem com até 3 botões clicáveis. Use para escolhas de até 3 opções: forma de pagamento (Pix / Cartão 12x), tipo de entrega, sim/não. O texto do botão volta como resposta da cliente.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto da mensagem' },
        descricao: { type: 'string', description: 'Texto da mensagem' },
        botoes: {
          type: 'array',
          description: 'Até 3 botões, cada um com "texto" (máximo 20 caracteres)',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string', description: 'Texto do botão (máx 20 chars)' },
              id: { type: 'string', description: 'Identificador (ex: "pix", "tam_p")' },
            },
            required: ['texto', 'id'],
          },
        },
      },
      required: ['titulo', 'descricao', 'botoes'],
    },
  },
  {
    name: 'enviar_lista',
    description: 'Envia um menu de lista clicável com 4 a 10 opções. Use para a cliente escolher peça, cor ou tamanho quando são mais de 3 opções. O título da opção escolhida volta como resposta da cliente.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título curto da mensagem' },
        descricao: { type: 'string', description: 'Texto da mensagem' },
        botao: { type: 'string', description: 'Texto do botão que abre a lista (ex: "Ver opções", máx 20 chars)' },
        opcoes: {
          type: 'array',
          description: 'Até 10 opções, cada uma com "titulo" (máx 24 chars, único) e "descricao" opcional (máx 72 chars, ex: preço)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Identificador da opção' },
              titulo: { type: 'string', description: 'Título da opção (máx 24 chars)' },
              descricao: { type: 'string', description: 'Descrição opcional (máx 72 chars)' },
            },
            required: ['id', 'titulo'],
          },
        },
      },
      required: ['titulo', 'descricao', 'botao', 'opcoes'],
    },
  },
  {
    name: 'adicionar_carrinho',
    description: 'Adiciona uma peça ao carrinho. Informe item_id, cor e tamanho escolhidos — o preço é buscado automaticamente do cadastro. Valida o estoque.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'item_id da peça (de ver_vitrine)' },
        cor: { type: 'string', description: 'Cor escolhida (como aparece em verificar_estoque; vazio se a peça não tem cores)' },
        tamanho: { type: 'string', description: 'Tamanho escolhido (ou "Único")' },
        quantidade: { type: 'number', description: 'Quantidade (padrão 1)' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'ver_carrinho',
    description: 'Mostra os itens do carrinho com os totais nas duas formas de pagamento.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'remover_carrinho',
    description: 'Remove uma peça do carrinho.',
    input_schema: {
      type: 'object',
      properties: {
        item_id: { type: 'string', description: 'item_id da peça' },
        cor: { type: 'string', description: 'Cor do item a remover' },
        tamanho: { type: 'string', description: 'Tamanho do item a remover' },
      },
      required: ['item_id'],
    },
  },
  {
    name: 'finalizar_venda',
    description: 'Gera o pagamento (PIX com QR Code ou link de cartão em até 12x) e envia à cliente via WhatsApp. Pix cobra o preço à vista; cartão cobra o preço de cartão. Use quando a cliente confirmar carrinho, tipo de entrega, forma de pagamento E CPF.',
    input_schema: {
      type: 'object',
      properties: {
        forma_pagamento: { type: 'string', enum: ['pix', 'credito'], description: '"pix" (preço à vista) ou "credito" (preço de cartão, até 12x)' },
        cpf: { type: 'string', description: 'CPF da cliente' },
        tipo_entrega: { type: 'string', enum: ['entrega', 'retirada', 'correios'], description: '"entrega" = motoboy R$7 | "retirada" = grátis na loja | "correios" = R$25 todo o Brasil' },
        cidade: { type: 'string', description: 'Cidade da cliente (para a equipe organizar a entrega)' },
      },
      required: ['forma_pagamento', 'cpf', 'tipo_entrega'],
    },
  },
];

// ─── Persistência de mensagens enviadas pelas tools ───
async function recordOutgoing(conversationId, content, media = null) {
  const msgId = deps.genId();
  await queryRun(
    "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1,$2,true,$3,$4,$5,$6,1,NOW())",
    [msgId, conversationId, 'Lê (IA)', content, media?.type || null, media?.url || null]);
  await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
    [media ? content.split('|')[1] || content : content, conversationId]);
  if (deps.broadcast) {
    deps.broadcast('new_message', {
      conversation: { id: conversationId, last_message: content, last_message_from_me: true },
      message: { id: msgId, conversation_id: conversationId, from_me: true, sender: 'Lê (IA)', content, media_type: media?.type || null, media_url: media?.url || null, timestamp: new Date().toISOString() },
    });
  }
  return msgId;
}

// ─── Execução das Tools ───
async function executeTool(toolName, toolInput, context) {
  const { conversationId, customerPhone, customerName } = context;

  switch (toolName) {
    case 'ver_vitrine': {
      const vitrine = await getVitrine();
      if (vitrine.length === 0) return { resultado: 'A vitrine está vazia no momento. Transfira para a equipe com [TRANSFERIR].' };
      return { pecas: vitrine, total: vitrine.length, instrucao: 'Apresente por texto curto com os DOIS preços. Use enviar_fotos_produto quando a cliente se interessar por uma peça.' };
    }

    case 'mostrar_vitrine': {
      const vitrine = await getVitrine();
      if (vitrine.length === 0) return { resultado: 'A vitrine está vazia no momento. Diga que vai passar para a equipe e use [TRANSFERIR].' };
      if (!deps.wa || !customerPhone) return { erro: 'WhatsApp não conectado.' };

      // Trava anti-loop: vitrine mostrada UMA vez por conversa. Se a cliente responde
      // com o nome de uma peça depois disso, é ESCOLHA — nunca reexibição.
      const jaMostrou = await queryOne(
        "SELECT id FROM messages WHERE conversation_id = $1 AND from_me = true AND content LIKE 'Nossas peças ✨%' AND timestamp > NOW() - interval '6 hours' LIMIT 1",
        [conversationId]);
      if (jaMostrou) {
        return {
          ja_mostrada: true,
          pecas: vitrine.map(p => ({ item_id: p.item_id, nome: p.nome })),
          instrucao: 'A vitrine JÁ foi mostrada nesta conversa — NÃO mostre de novo. Se a última mensagem da cliente é o nome de uma peça, ela ESCOLHEU essa peça: use verificar_estoque com o item_id correspondente e siga para cor/tamanho.',
        };
      }

      let enviadas = 0;
      for (const p of vitrine.slice(0, 10)) {
        try {
          const precos = [p.preco_avista ? `${p.preco_avista} à vista no Pix` : null, p.preco_cartao ? `${p.preco_cartao} no cartão` : null]
            .filter(Boolean).join(' ou ');
          const caption = `${p.nome}\n${precos}`;
          const photo = await queryOne(
            "SELECT id, data, mime_type FROM promo_photos WHERE promo_item_id = $1 ORDER BY created_at, id LIMIT 1", [p.item_id]);
          if (photo?.data) {
            await deps.wa.sendImage(customerPhone, Buffer.from(photo.data, 'base64'), caption, { isBot: true });
            const mediaId = 'promo_' + photo.id;
            await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
              [mediaId, photo.mime_type || 'image/jpeg', photo.data]);
            await recordOutgoing(conversationId, `/media/${mediaId}|${caption}`, { type: 'image', url: `/media/${mediaId}` });
          } else {
            await deps.wa.sendMessage(customerPhone, caption, { isBot: true });
            await recordOutgoing(conversationId, caption);
          }
          enviadas++;
        } catch (e) {
          console.error(`⚠️ Erro ao mostrar peça ${p.nome}:`, e.message);
        }
      }

      // Menu de escolha no final
      try {
        const rows = vitrine.slice(0, 10).map(p => ({
          id: p.item_id,
          title: p.nome.slice(0, 24),
          description: [p.preco_avista, p.preco_cartao ? `${p.preco_cartao.split(' em ')[0]} 12x` : null].filter(Boolean).join(' | '),
        }));
        await deps.wa.sendList(customerPhone, 'Nossas peças ✨', 'Toca no botão e escolhe a peça que você amou', 'Escolher peça', rows, { isBot: true });
        await recordOutgoing(conversationId, `Nossas peças ✨\n[Lista: ${rows.map(r => r.title).join(' | ')}]`);
      } catch (e) {
        console.error('⚠️ Erro ao enviar menu da vitrine:', e.message);
      }

      return {
        sucesso: true,
        pecas_enviadas: enviadas,
        pecas: vitrine.map(p => ({ item_id: p.item_id, nome: p.nome })),
        instrucao: 'Vitrine enviada com fotos e menu de escolha. NÃO escreva as peças por texto — aguarde a cliente escolher no menu.',
      };
    }

    case 'enviar_fotos_produto': {
      const { item_id } = toolInput;
      const item = await queryOne("SELECT id, display_name, promo_price, promo_price_card FROM promo_items WHERE id = $1 AND active = true", [item_id]);
      if (!item) return { erro: 'Peça não encontrada na vitrine. Use o item_id de ver_vitrine.' };

      // Trava: não envia fotos da mesma peça 2x na mesma conversa
      const jaEnviou = await queryOne(
        "SELECT id FROM messages WHERE conversation_id = $1 AND from_me = true AND media_type = 'image' AND content LIKE $2 LIMIT 1",
        [conversationId, `%${item.display_name}%`]);
      if (jaEnviou) return { sucesso: true, ja_enviadas: true, instrucao: 'Fotos desta peça já foram enviadas antes. NÃO envie de novo. Siga para cor/tamanho.' };

      const photos = await queryAll(
        "SELECT id, color, mime_type, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 ORDER BY color", [item.id]);
      // Fotos com controle de estoque por cor só aparecem se ainda têm saldo;
      // fotos sem controle (limit 0) são ilustrativas e sempre aparecem
      const vars = await getItemVariations(item.id);
      const coresDisponiveis = new Set(vars.map(v => v.cor.toLowerCase()));
      const enviaveis = photos.filter(p =>
        p.stock_limit > 0 ? (p.stock_limit - (p.stock_sold || 0)) > 0 : (coresDisponiveis.size === 0 || coresDisponiveis.has((p.color || '').toLowerCase()) || !p.color));
      if (enviaveis.length === 0) return { resultado: 'Esta peça não tem foto cadastrada. Apresente por texto.' };

      const precos = [item.promo_price ? `${fmt(item.promo_price)} à vista no Pix` : null,
        item.promo_price_card ? `${fmt(item.promo_price_card)} em até 12x no cartão` : null].filter(Boolean).join(' ou ');
      let enviadas = 0;
      if (deps.wa && customerPhone) {
        for (const photo of enviaveis.slice(0, 6)) {
          try {
            const photoRow = await queryOne("SELECT data, mime_type FROM promo_photos WHERE id = $1", [photo.id]);
            if (!photoRow?.data) continue;
            const buffer = Buffer.from(photoRow.data, 'base64');
            const caption = `${item.display_name}${photo.color ? ` — ${photo.color.trim()}` : ''}\n${precos}`;
            await deps.wa.sendImage(customerPhone, buffer, caption, { isBot: true });

            const mediaId = 'promo_' + photo.id;
            await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
              [mediaId, photoRow.mime_type || 'image/jpeg', photoRow.data]);
            await recordOutgoing(conversationId, `/media/${mediaId}|${caption}`, { type: 'image', url: `/media/${mediaId}` });
            enviadas++;
          } catch (e) {
            console.error(`⚠️ Erro ao enviar foto ${photo.color}:`, e.message);
          }
        }
      }
      return {
        sucesso: true,
        fotos_enviadas: enviadas,
        cores: [...new Set(enviaveis.map(p => p.color).filter(Boolean))],
        instrucao: 'Fotos enviadas. Siga para a escolha de cor/tamanho (verificar_estoque).',
      };
    }

    case 'verificar_estoque': {
      const { item_id } = toolInput;
      const item = await queryOne("SELECT id, display_name, promo_price, promo_price_card FROM promo_items WHERE id = $1 AND active = true", [item_id]);
      if (!item) return { erro: 'Peça não encontrada na vitrine. Use o item_id de ver_vitrine.' };
      const vars = await getItemVariations(item.id);
      if (vars.length === 0) return { resultado: 'Todas as variações desta peça estão esgotadas.' };
      return {
        peca: item.display_name,
        preco_avista: item.promo_price ? fmt(item.promo_price) : null,
        preco_cartao: item.promo_price_card ? `${fmt(item.promo_price_card)} em até 12x sem juros` : null,
        variacoes_disponiveis: vars.map(v => ({ cor: v.cor || '-', tamanho: v.tamanho, estoque: v.estoque })),
      };
    }

    case 'enviar_botoes': {
      const { titulo, descricao, botoes } = toolInput;
      if (!botoes || botoes.length === 0) return { erro: 'Nenhum botão informado.' };
      if (botoes.length > 3) return { erro: 'Máximo 3 botões. Para mais opções use enviar_lista.' };
      if (deps.wa && customerPhone) {
        try {
          const btns = botoes.map(b => ({ text: b.texto, id: b.id }));
          await deps.wa.sendButtons(customerPhone, titulo, descricao, btns, { isBot: true });
          const content = `${titulo}\n${descricao}\n[Botões: ${botoes.map(b => b.texto).join(' | ')}]`;
          await recordOutgoing(conversationId, content);
          return { sucesso: true, mensagem: 'Botões enviados. NÃO repita a pergunta por texto.' };
        } catch (e) {
          console.error('⚠️ Erro ao enviar botões:', e.message);
          return { erro: 'Não consegui enviar os botões. Pergunte por texto.' };
        }
      }
      return { erro: 'WhatsApp não conectado.' };
    }

    case 'enviar_lista': {
      const { titulo, descricao, botao, opcoes } = toolInput;
      if (!opcoes || opcoes.length === 0) return { erro: 'Nenhuma opção informada.' };
      if (opcoes.length > 10) return { erro: 'Máximo 10 opções na lista.' };
      if (deps.wa && customerPhone) {
        try {
          const rows = opcoes.map((o, i) => ({ id: o.id || `op_${i}`, title: o.titulo, description: o.descricao }));
          await deps.wa.sendList(customerPhone, titulo, descricao, botao || 'Ver opções', rows, { isBot: true });
          const content = `${titulo}\n${descricao}\n[Lista: ${opcoes.map(o => o.titulo).join(' | ')}]`;
          await recordOutgoing(conversationId, content);
          return { sucesso: true, mensagem: 'Lista enviada. NÃO repita as opções por texto.' };
        } catch (e) {
          console.error('⚠️ Erro ao enviar lista:', e.message);
          return { erro: 'Não consegui enviar a lista. Pergunte por texto.' };
        }
      }
      return { erro: 'WhatsApp não conectado.' };
    }

    case 'adicionar_carrinho': {
      const { item_id, cor, tamanho, quantidade } = toolInput;
      const qty = Math.max(1, parseInt(quantidade) || 1);
      const item = await queryOne("SELECT id, ref, display_name, promo_price, promo_price_card FROM promo_items WHERE id = $1 AND active = true", [item_id]);
      if (!item) return { erro: 'Peça não encontrada na vitrine. Use o item_id de ver_vitrine.' };
      if (!item.promo_price && !item.promo_price_card) return { erro: 'Peça sem preço cadastrado. Transfira para a equipe com [TRANSFERIR].' };

      const vars = await getItemVariations(item.id);
      const match = vars.find(v =>
        (v.cor || '').toLowerCase() === (cor || '').toLowerCase() &&
        v.tamanho.toLowerCase() === (tamanho || 'Único').toLowerCase())
        || (vars.length === 1 && !cor && !tamanho ? vars[0] : null);
      if (!match) {
        return { erro: `Combinação indisponível. Disponíveis: ${vars.map(v => `${v.cor || '-'} ${v.tamanho}`).join(', ')}` };
      }

      const cart = getCart(conversationId);
      const jaNoCarrinho = cart.items.filter(i => i.promo_item_id === item.id && i.color === match.cor && i.size === match.tamanho)
        .reduce((s, i) => s + i.quantity, 0);
      if (match.estoque < qty + jaNoCarrinho) {
        return { erro: `Só restam ${match.estoque} unidade(s) dessa combinação${jaNoCarrinho ? ` (${jaNoCarrinho} já no carrinho)` : ''}.` };
      }

      const existing = cart.items.find(i => i.promo_item_id === item.id && i.color === match.cor && i.size === match.tamanho);
      if (existing) existing.quantity += qty;
      else cart.items.push({
        promo_item_id: item.id, ref: item.ref || '', name: item.display_name,
        color: match.cor, size: match.tamanho,
        price_pix: item.promo_price ? parseFloat(item.promo_price) : parseFloat(item.promo_price_card),
        price_card: item.promo_price_card ? parseFloat(item.promo_price_card) : parseFloat(item.promo_price),
        quantity: qty,
      });

      const totPix = cart.items.reduce((s, i) => s + i.price_pix * i.quantity, 0);
      const totCard = cart.items.reduce((s, i) => s + i.price_card * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', tamanho: i.size, quantidade: i.quantity })),
        total_avista: fmt(totPix),
        total_cartao: `${fmt(totCard)} em até 12x sem juros`,
        mensagem: `"${item.display_name}" adicionado!`,
      };
    }

    case 'ver_carrinho': {
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { carrinho: [], mensagem: 'Carrinho vazio.' };
      const totPix = cart.items.reduce((s, i) => s + i.price_pix * i.quantity, 0);
      const totCard = cart.items.reduce((s, i) => s + i.price_card * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', tamanho: i.size, quantidade: i.quantity, preco_avista: fmt(i.price_pix), preco_cartao: fmt(i.price_card) })),
        total_avista: fmt(totPix),
        total_cartao: `${fmt(totCard)} em até 12x sem juros`,
      };
    }

    case 'remover_carrinho': {
      const { item_id, cor, tamanho } = toolInput;
      const cart = getCart(conversationId);
      cart.items = cart.items.filter(i => !(i.promo_item_id === item_id
        && (cor === undefined || i.color.toLowerCase() === (cor || '').toLowerCase())
        && (tamanho === undefined || i.size.toLowerCase() === (tamanho || '').toLowerCase())));
      const totPix = cart.items.reduce((s, i) => s + i.price_pix * i.quantity, 0);
      return { carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', tamanho: i.size, quantidade: i.quantity })), total_avista: fmt(totPix), mensagem: 'Item removido.' };
    }

    case 'finalizar_venda': {
      const { forma_pagamento, cpf, tipo_entrega, cidade } = toolInput;
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { erro: 'Carrinho vazio. Adicione itens antes de finalizar.' };
      const taxaEntrega = tipo_entrega === 'entrega' ? 7.00 : tipo_entrega === 'correios' ? 25.00 : 0;

      try {
        // Revalida estoque de cada item na hora do fechamento
        const semEstoque = [];
        for (const item of cart.items) {
          const vars = await getItemVariations(item.promo_item_id);
          const match = vars.find(v => (v.cor || '').toLowerCase() === (item.color || '').toLowerCase() && v.tamanho.toLowerCase() === item.size.toLowerCase());
          const disponivel = match ? match.estoque : 0;
          if (disponivel < item.quantity) semEstoque.push({ nome: item.name, pedido: item.quantity, disponivel });
        }
        if (semEstoque.length > 0) {
          const lista = semEstoque.map(s => `${s.nome} (pedido: ${s.pedido}, disponível: ${s.disponivel})`).join('; ');
          return { erro: `Estoque insuficiente para: ${lista}. Verifique com a cliente se quer ajustar.` };
        }

        const priceOf = (i) => forma_pagamento === 'pix' ? i.price_pix : i.price_card;
        const subtotal = cart.items.reduce((s, i) => s + priceOf(i) * i.quantity, 0);
        const total = subtotal + taxaEntrega;
        const descricao = cart.items.map(i => `${i.name} x${i.quantity}`).join(', ') + (taxaEntrega > 0 ? ` + ${tipo_entrega === 'correios' ? 'Correios' : 'Entrega'}` : '');

        const asaasCustomer = await asaas.findOrCreateCustomer(customerName || 'Cliente WhatsApp', customerPhone, cpf);

        let charge;
        if (forma_pagamento === 'pix') {
          charge = await asaas.createPixCharge(asaasCustomer.id, total, `D'Black Store — ${descricao}`);
        } else {
          charge = await asaas.createCardCharge(asaasCustomer.id, total, `D'Black Store — ${descricao}`);
        }

        // Salva pagamento pendente (cart_data guarda a forma escolhida e o preço unitário cobrado)
        const paymentId = deps.genId();
        const cartData = cart.items.map(i => ({ ...i, price: priceOf(i), cidade: cidade || '' }));
        await queryRun(
          `INSERT INTO pending_payments (id, conversation_id, customer_phone, customer_name, asaas_charge_id, asaas_customer_id, payment_method, amount, cart_data, tipo_entrega, taxa_entrega)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [paymentId, conversationId, customerPhone || '', customerName || 'Cliente WhatsApp', charge.chargeId, asaasCustomer.id, forma_pagamento, total, JSON.stringify(cartData), tipo_entrega || 'retirada', taxaEntrega]);

        // Envia QR Code do PIX ou link de pagamento via WhatsApp
        if (deps.wa?.connected && customerPhone) {
          try {
            if (forma_pagamento === 'pix' && charge.pixQrCodeBase64) {
              const qrBuffer = Buffer.from(charge.pixQrCodeBase64, 'base64');
              const caption = `💰 PIX — R$ ${total.toFixed(2)}\n\nEscaneie o QR Code ou copie o código abaixo`;
              const waResult = await deps.wa.sendImage(customerPhone, qrBuffer, caption, { isBot: true });
              const mediaId = 'img_' + (waResult?._waId || deps.genId());
              await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
                [mediaId, 'image/png', charge.pixQrCodeBase64]);
              await recordOutgoing(conversationId, `/media/${mediaId}|${caption}`, { type: 'image', url: `/media/${mediaId}` });
              if (charge.pixCode) {
                await deps.wa.sendMessage(customerPhone, charge.pixCode, { isBot: true });
                await recordOutgoing(conversationId, charge.pixCode);
              }
            } else {
              const linkMsg = `💳 Link de pagamento — R$ ${total.toFixed(2)}\n\n${charge.invoiceUrl}\n\nPode parcelar em até 12x sem juros!`;
              await deps.wa.sendMessage(customerPhone, linkMsg, { isBot: true });
              await recordOutgoing(conversationId, linkMsg);
            }
          } catch (e) {
            console.error('⚠️ Erro ao enviar pagamento:', e.message);
          }
        }

        // NÃO limpa carrinho ainda — só quando o pagamento for confirmado
        cart.paymentId = paymentId;
        cart.chargeId = charge.chargeId;

        return {
          sucesso: true,
          aguardando_pagamento: true,
          subtotal: fmt(subtotal),
          entrega: taxaEntrega > 0 ? fmt(taxaEntrega) : 'grátis',
          total: fmt(total),
          mensagem: `Pagamento gerado e enviado (${forma_pagamento === 'pix' ? 'QR Code + copia-e-cola' : 'link do cartão'}). Avise que assim que confirmar, ela recebe a confirmação por aqui.`,
        };
      } catch (e) {
        console.error('❌ Erro ao gerar pagamento:', e.message);
        return { erro: 'Erro ao gerar o pagamento. Vou transferir para uma colega resolver.', transferir: true };
      }
    }

    default:
      return { erro: `Ferramenta "${toolName}" não encontrada.` };
  }
}

// ─── Histórico de conversa ───
async function getConversationHistory(conversationId) {
  const msgs = await queryAll(
    "SELECT from_me, sender, content, media_type FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 40",
    [conversationId]
  );
  return msgs.reverse().map(m => ({
    role: m.from_me ? 'assistant' : 'user',
    content: m.media_type === 'audio' ? '[Cliente enviou um áudio]' :
             m.media_type === 'image' ? (m.from_me ? '[Foto enviada ao cliente]' : '[Cliente enviou uma foto]') :
             m.content || '[mensagem vazia]',
  }));
}

// ─── Geração de resposta com Tool Use ───
async function generateResponse(conversationId, customerMessage, customerName, mediaType, customerPhone) {
  try {
    const history = await getConversationHistory(conversationId);

    let userContent = customerMessage;
    let imageContent = null;

    if (mediaType === 'audio') {
      userContent = '[Cliente enviou um áudio - diga que está com problema no áudio e peça para enviar por escrito, de forma natural]';
    }
    if (mediaType === 'image') {
      const caption = customerMessage.includes('|') ? customerMessage.split('|')[1] : '';
      const mediaPath = customerMessage.split('|')[0];

      if (mediaPath.startsWith('/media/')) {
        try {
          const mediaId = mediaPath.replace('/media/', '');
          const mediaRow = await queryOne("SELECT data, mime_type FROM media_files WHERE id = $1", [mediaId]);
          if (mediaRow?.data) {
            imageContent = {
              type: 'image',
              source: { type: 'base64', media_type: mediaRow.mime_type || 'image/jpeg', data: mediaRow.data },
            };
            userContent = caption || 'Cliente enviou esta foto. Analise o que tem na foto e responda sobre isso.';
          } else {
            userContent = caption || '[Cliente enviou uma foto que não consegui ver. Peça pra descrever o que quer.]';
          }
        } catch (e) {
          userContent = caption || '[Cliente enviou uma foto. Peça pra descrever o que quer.]';
        }
      } else {
        userContent = caption || '[Cliente enviou uma foto. Peça pra descrever o que quer.]';
      }
    }

    const messages = [...history];
    const newMsg = imageContent
      ? { role: 'user', content: [imageContent, { type: 'text', text: userContent }] }
      : { role: 'user', content: userContent };

    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      messages[messages.length - 1] = newMsg;
    } else {
      messages.push(newMsg);
    }

    // Limpa: primeiro msg deve ser user, sem roles consecutivos
    while (messages.length > 0 && messages[0].role !== 'user') messages.shift();
    const cleaned = [];
    for (const msg of messages) {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== msg.role) {
        cleaned.push(msg);
      }
    }
    if (cleaned.length === 0) cleaned.push({ role: 'user', content: userContent });

    // API key
    let apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      try {
        const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'");
        if (row) apiKey = row.value;
      } catch {}
    }
    if (!apiKey) return { text: null, shouldTransfer: true };

    const startTime = Date.now();
    const context = { conversationId, customerPhone, customerName };

    // Tool use loop (max 8 iterações)
    let currentMessages = cleaned;
    let finalText = null;
    let shouldTransfer = false;

    for (let i = 0; i < 8; i++) {
      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 800,
          temperature: 0.3,
          system: SYSTEM_PROMPT + `\n\nAGORA: ${agoraSP()}. ${lojaAberta()
            ? 'A loja está ABERTA: ao transferir, pode dizer que uma das meninas continua por aqui.'
            : 'A loja física está FECHADA agora, mas a COMPRA com você funciona a qualquer hora (o Pix confirma sozinho). Só ao TRANSFERIR para a equipe: NUNCA prometa "rapidinho", "já" ou "agora" — diga que as meninas respondem por aqui assim que a loja abrir.'}`,
          messages: currentMessages,
          tools: TOOLS,
        }),
      });

      if (!apiRes.ok) throw new Error(`API Anthropic retornou ${apiRes.status}: ${apiRes.statusText}`);
      const response = await apiRes.json();
      if (response.error) throw new Error(JSON.stringify(response.error));

      // Processa blocos da resposta
      const textBlocks = [];
      const toolUseBlocks = [];

      for (const block of (response.content || [])) {
        if (block.type === 'text') textBlocks.push(block.text);
        if (block.type === 'tool_use') toolUseBlocks.push(block);
      }

      // Se tem texto, captura
      if (textBlocks.length > 0) {
        finalText = textBlocks.join('\n');
      }

      // Se não tem tool_use, terminamos
      if (toolUseBlocks.length === 0) break;

      // Botões/lista enviados nesta rodada: o texto capturado antes já foi dito nas
      // mensagens interativas — não repete depois
      const interactiveSent = toolUseBlocks.some(b => ['enviar_botoes', 'enviar_lista', 'mostrar_vitrine'].includes(b.name));

      // Executa tools e monta resultado
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`🔧 Lê chamou: ${toolBlock.name}(${JSON.stringify(toolBlock.input).slice(0, 200)})`);
        const result = await executeTool(toolBlock.name, toolBlock.input, context);
        console.log(`🔧 Resultado: ${JSON.stringify(result).slice(0, 200)}`);

        if (result.transferir) shouldTransfer = true;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }
      if (interactiveSent) finalText = null;

      // Adiciona a resposta do assistant e os resultados das tools
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: response.content },
        { role: 'user', content: toolResults },
      ];
    }

    // Processa texto final
    if (finalText) {
      if (finalText.includes('[TRANSFERIR]')) shouldTransfer = true;
      finalText = finalText.replace('[TRANSFERIR]', '').trim();
    }

    const responseTime = Date.now() - startTime;
    await recordMetric(conversationId, responseTime, shouldTransfer);

    return { text: finalText, shouldTransfer };
  } catch (e) {
    console.error('❌ Erro IA:', e.message);
    return { text: null, shouldTransfer: true };
  }
}

async function recordMetric(conversationId, responseTimeMs, transferred) {
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const existing = await queryOne("SELECT id FROM ai_metrics WHERE conversation_id = $1", [conversationId]);
    if (existing) {
      await queryRun("UPDATE ai_metrics SET messages_by_ai = messages_by_ai + 1, transferred = $1, response_time_ms = $2, resolved_by_ai = $3 WHERE conversation_id = $4", [transferred, responseTimeMs, !transferred, conversationId]);
    } else {
      await queryRun("INSERT INTO ai_metrics (id, conversation_id, messages_by_ai, response_time_ms, transferred, resolved_by_ai) VALUES ($1,$2,1,$3,$4,$5)", [id, conversationId, responseTimeMs, transferred, !transferred]);
    }
  } catch (e) { console.error('Erro métrica IA:', e.message); }
}

async function isAgentEnabled() {
  try {
    const agent = await queryOne("SELECT enabled FROM ai_agents WHERE enabled = true LIMIT 1");
    return !!agent;
  } catch { return false; }
}

module.exports = { generateResponse, isAgentEnabled, recordMetric, init, getVitrine, getItemVariations };
