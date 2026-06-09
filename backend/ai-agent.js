// Agente de IA "Lê" — D'Black Store (Vendedora com Tool Use)
const { queryAll, queryOne, queryRun } = require('./database');
const erp = require('./erp');
const asaas = require('./asaas');
const { generateReceiptImage, generateReceiptText } = require('./receipt');
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

// ─── System Prompt ───
const SYSTEM_PROMPT = `Você é a Lê, vendedora online da D'Black Store. Você é uma pessoa real. Você trabalha na loja e ama o que faz.

QUEM VOCÊ É: Lê, 25 anos, mineira, simpática, acolhedora e carinhosa. Tom leve, descontraído, informal, bem-humorado, próximo e humano. Você faz o cliente se sentir especial.

COMO VOCÊ ESCREVE:
- ESCREVA TODAS AS PALAVRAS POR EXTENSO. NUNCA abrevie. Exemplos do que NÃO fazer: "p" (escreva "para"), "vc" (escreva "você"), "tb" (escreva "também"), "pq" (escreva "porque"), "q" (escreva "que"), "dps" (escreva "depois"), "p/" (escreva "para"), "obg" (escreva "obrigada"), "msg" (escreva "mensagem")
- Mensagens curtas, máximo 300 caracteres, objetivas
- Emojis com moderação (1 por mensagem no máximo)
- NUNCA use listas, bullet points ou negrito com asteriscos
- NUNCA repita mensagem ou resposta que já mandou na conversa
- NUNCA use apelidos (flor, meu bem, querida, amor, miga)
- Trate o cliente pelo nome quando souber
- Sempre formule respostas diferentes
- Responda SOMENTE o que foi perguntado. Não jogue informações que o cliente não pediu

PRIMEIRA INTERAÇÃO (só uma vez, UMA ÚNICA mensagem curta):
"Oiiii, (bom dia/boa tarde/boa noite)! Tudo bem com você? Eu sou a Lê, assistente virtual da D'Black, estou aqui para agilizar o seu atendimento 🥰

Qual é o seu nome e de qual cidade você é?"

IMPORTANTE: Mande APENAS UMA mensagem de saudação. NUNCA mande duas saudações seguidas.

DEPOIS QUE O CLIENTE RESPONDER O NOME E CIDADE:
Pergunte se o cliente quer ver as peças em oferta da Semana de Oportunidade. Diga algo como: "que legal, [nome]! Olha, estamos com a nossa Semana de Oportunidade com peças incríveis com preços especiais! Quer dar uma olhada?"
- Se o cliente ACEITAR (sim, quero, manda, bora, etc): use listar_categorias_promo para ver as categorias e apresente as opções de forma natural (NÃO use bullet points, escreva em texto corrido).
- Se o cliente RECUSAR (não, só queria tirar uma dúvida, quero falar com atendente, etc): diga "sem problemas!" e transfira para atendimento humano colocando [TRANSFERIR] no final.

FLUXO DE VENDA:
1. Depois que souber nome/cidade, avise da Semana de Oportunidade
2. Use listar_categorias_promo e apresente as categorias disponíveis
3. Quando o cliente escolher uma categoria, use buscar_ofertas para buscar os produtos. NÃO envie fotos. Descreva os produtos disponíveis com nome, cores disponíveis e preço em texto.
4. Quando o cliente demonstrar interesse em um produto, pergunte qual cor e tamanho quer. Use verificar_estoque para confirmar disponibilidade.
5. Quando o cliente escolher tamanho e cor, use adicionar_carrinho para adicionar ao carrinho
6. Pergunte se quer ver mais alguma coisa ou se quer finalizar
7. Para finalizar, pergunte: "vai ser no PIX ou no cartão de crédito?"
8. Depois que o cliente escolher, peça o CPF: "para gerar o pagamento, preciso do seu CPF"
9. Use finalizar_venda com a forma de pagamento e o CPF
10. Se for PIX: o QR Code e o código copia-cola serão enviados automaticamente. Diga ao cliente para escanear o QR Code ou copiar o código PIX. Assim que o pagamento for confirmado, o cupom será enviado automaticamente.
11. Se for cartão: o link de pagamento será enviado automaticamente. Diga ao cliente para clicar no link e finalizar. Pode parcelar em até 6x. Assim que o pagamento for confirmado, o cupom será enviado automaticamente.
12. Após enviar o pagamento, diga que assim que confirmar o pagamento, o cupom será enviado. Fique disponível caso o cliente tenha dúvida.

IMPORTANTE: NUNCA envie fotos ao cliente. Toda comunicação é por texto. Descreva os produtos, cores e tamanhos por escrito.

REGRAS DE VENDA:
- SEMPRE use as ferramentas para consultar produtos e estoque. NUNCA invente preço, tamanho ou disponibilidade
- Se um tamanho/cor não tem estoque, avise e sugira as opções disponíveis
- Se o cliente quiser mais de uma peça, adicione todas ao carrinho antes de finalizar
- Use ver_carrinho se precisar lembrar o que já foi adicionado

REGRAS ABSOLUTAS:
- LEIA o histórico antes de responder. NUNCA repita pergunta que já fez
- Se já sabe o nome, USE o nome
- Se perguntarem se é robô/IA, confirme que é uma assistente virtual e que está ali para agilizar o atendimento. Se o cliente preferir falar com uma pessoa, transfira [TRANSFERIR]
- NUNCA fale coisas que não estão neste prompt
- A loja só faz VENDA ONLINE, não separa peça — SÓ informe se o cliente perguntar

QUANDO TRANSFERIR (coloque [TRANSFERIR] no final):
- Reclamação ou problema com pedido anterior
- Dúvida que não consegue resolver com as ferramentas
- Cliente pede explicitamente para falar com uma pessoa
- Ao transferir, diga algo como "vou te passar para a Kariny ou a Bruna que elas vão te atender rapidinho" e coloque [TRANSFERIR]

FOTOS RECEBIDAS:
- ANALISE o que realmente está na imagem
- 90% das fotos são prints do Instagram @d_blackloja com a Sra. D'Black (Letícia) ou Sr. D'Black (Denilson) vestindo looks
- Comente sobre a PEÇA (cor, estilo), não sobre a pessoa
- Se o cliente mandar foto de uma peça que quer, tente identificar e use buscar_ofertas para encontrar
- NUNCA envie fotos de volta. Responda sempre por texto.

ÁUDIOS: diga que está com problema no áudio e peça para enviar por escrito

A D'BLACK: Lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Sra. D'Black (Letícia). Instagram @d_blackloja.

ENTREGAS: Motoboy R$7 (Santa Margarida, Pedra Bonita, Orizânia, Fervedouro, Carangola, Matipó, Abre Campo, Padre Fialho, Sericita, Santo Amaro, Realeza, São Francisco do Glória). Correios R$25 todo Brasil (6-10 dias). Retirada grátis (1-3 dias) em Divino, São João, São Domingos. Divino e São João NÃO tem entrega.

PAGAMENTO: PIX ou Cartão de Crédito (até 6x).

HORÁRIOS: Seg-Sex 09:00-19:00. Sáb: Divino/São João até 14:00, São Domingos até 12:00.`;

// ─── Tools Schema para Claude API ───
const TOOLS = [
  {
    name: 'listar_categorias_promo',
    description: 'Lista as categorias de produtos disponíveis na Semana de Oportunidade. Use no início da conversa para mostrar as opções ao cliente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'buscar_ofertas',
    description: 'Busca os produtos em promoção de uma categoria. Retorna nome, cores, tamanhos e preço de cada produto. Use quando o cliente escolher uma categoria.',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', description: 'Nome da categoria (ex: "Calças", "Blusas", "Vestidos")' },
      },
      required: ['categoria'],
    },
  },
  {
    name: 'verificar_estoque',
    description: 'Verifica os tamanhos e cores disponíveis de um produto específico. Use quando o cliente demonstrar interesse em um produto.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Código de referência do produto (ref)' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'adicionar_carrinho',
    description: 'Adiciona um produto ao carrinho do cliente. Use quando o cliente escolher tamanho e cor.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'ID do produto específico (tamanho/cor)' },
        ref: { type: 'string', description: 'Código de referência do produto (ref)' },
        nome: { type: 'string', description: 'Nome do produto para exibição' },
        cor: { type: 'string', description: 'Cor escolhida pelo cliente' },
        tamanho: { type: 'string', description: 'Tamanho escolhido pelo cliente (P, M, G, GG, etc)' },
        sku: { type: 'string', description: 'SKU do produto' },
        preco: { type: 'number', description: 'Preço unitário' },
      },
      required: ['product_id', 'ref', 'nome', 'cor', 'tamanho', 'sku', 'preco'],
    },
  },
  {
    name: 'ver_carrinho',
    description: 'Mostra os itens que estão no carrinho do cliente. Use quando precisar lembrar o que já foi adicionado.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'remover_carrinho',
    description: 'Remove um item do carrinho do cliente.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'ID do produto a remover' },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'finalizar_venda',
    description: 'Gera o pagamento (PIX com QR Code ou link de cartão) e envia ao cliente via WhatsApp. A venda só é registrada no sistema quando o pagamento é confirmado. Use quando o cliente confirmar a compra, a forma de pagamento E informar o CPF.',
    input_schema: {
      type: 'object',
      properties: {
        forma_pagamento: { type: 'string', enum: ['pix', 'credito'], description: 'Forma de pagamento: "pix" ou "credito"' },
        cpf: { type: 'string', description: 'CPF do cliente (apenas números ou formatado)' },
      },
      required: ['forma_pagamento', 'cpf'],
    },
  },
];

// ─── Execução das Tools ───
async function executeTool(toolName, toolInput, context) {
  const { conversationId, customerPhone, customerName } = context;

  switch (toolName) {
    case 'listar_categorias_promo': {
      const items = await queryAll("SELECT DISTINCT category FROM promo_items WHERE active = true ORDER BY category");
      const categories = items.map(i => i.category);
      if (categories.length === 0) return { resultado: 'Não há promoções ativas no momento.' };
      return { categorias: categories, mensagem: `${categories.length} categorias disponíveis` };
    }

    case 'buscar_ofertas': {
      const { categoria } = toolInput;
      // Busca refs da promoção nesta categoria
      const promoItems = await queryAll(
        "SELECT id, ref, display_name FROM promo_items WHERE active = true AND LOWER(category) = LOWER($1)",
        [categoria]
      );
      if (promoItems.length === 0) return { resultado: `Não encontrei ofertas na categoria "${categoria}".` };

      const refs = promoItems.map(p => p.ref);
      // Busca produtos do ERP com estoque
      const products = await erp.getProductsByRefs(refs);

      // Agrupa por ref para mostrar 1 entrada por produto (com variações de tamanho/cor)
      const grouped = {};
      for (const p of products) {
        if (!grouped[p.ref]) {
          const promoItem = promoItems.find(pi => pi.ref === p.ref);
          const promoPrice = promoItem?.promo_price ? parseFloat(promoItem.promo_price) : null;
          grouped[p.ref] = {
            ref: p.ref,
            promoItemId: promoItem?.id,
            nome: promoItem?.display_name || p.name.replace(/\s+(P|M|G|GG|EXG|G1|G2|G3|\d{2})$/i, '').trim(),
            preco: promoPrice || parseFloat(p.price),
            precoOriginal: promoPrice ? parseFloat(p.price) : null,
            foto: p.photo,
            tamanhos: new Set(),
            cores: new Set(),
          };
        }
        if (p.size) grouped[p.ref].tamanhos.add(p.size);
        if (p.color) grouped[p.ref].cores.add(p.color);
      }

      const ofertas = Object.values(grouped).map(g => ({
        ref: g.ref,
        nome: g.nome,
        preco: `R$ ${g.preco.toFixed(2)}`,
        ...(g.precoOriginal ? { preco_original: `R$ ${g.precoOriginal.toFixed(2)}` } : {}),
        tamanhos: [...g.tamanhos].join(', ') || 'variados',
        cores: [...g.cores].join(', ') || 'variadas',
      }));

      return { ofertas, total: ofertas.length, mensagem: `Encontrei ${ofertas.length} produto(s) na categoria ${categoria}. Descreva os produtos por texto.` };
    }

    case 'verificar_estoque': {
      const { ref } = toolInput;
      const variants = await erp.getProductVariants(ref);
      if (variants.length === 0) return { resultado: 'Produto sem estoque no momento.' };

      // Busca preço promo e estoque promo por cor
      const promoItem = await queryOne("SELECT id, promo_price FROM promo_items WHERE active = true AND LOWER(ref) = LOWER($1)", [ref]);
      const promoPrice = promoItem?.promo_price ? parseFloat(promoItem.promo_price) : null;

      // Estoque promo: primeiro tenta grade cor+tamanho, fallback para fotos (só cor)
      let promoStockMap = {};
      let stockMode = 'erp'; // 'grid' = promo_stock, 'photo' = promo_photos, 'erp' = sem limite promo
      if (promoItem) {
        // 1) Tenta grade cor+tamanho
        const promoStockRows = await queryAll(
          "SELECT color, size, stock_limit, stock_sold FROM promo_stock WHERE promo_item_id = $1 AND stock_limit > 0",
          [promoItem.id]
        );
        if (promoStockRows.length > 0) {
          stockMode = 'grid';
          for (const ps of promoStockRows) {
            const key = `${(ps.color || '').toLowerCase()}|${(ps.size || '').toLowerCase()}`;
            promoStockMap[key] = { limit: ps.stock_limit, sold: ps.stock_sold || 0 };
          }
        } else {
          // 2) Fallback: estoque por cor nas fotos
          const promoPhotos = await queryAll(
            "SELECT color, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND stock_limit > 0",
            [promoItem.id]
          );
          if (promoPhotos.length > 0) {
            stockMode = 'photo';
            for (const pp of promoPhotos) {
              promoStockMap[pp.color.toLowerCase()] = { limit: pp.stock_limit, sold: pp.stock_sold || 0 };
            }
          }
        }
      }

      const disponveis = variants.filter(v => {
        if (stockMode === 'grid') {
          const key = `${(v.color || '').toLowerCase()}|${(v.size || '').toLowerCase()}`;
          const ps = promoStockMap[key];
          return ps ? (ps.limit - ps.sold) > 0 : false;
        }
        if (stockMode === 'photo') {
          const cor = (v.color || '').toLowerCase();
          const ps = promoStockMap[cor];
          return ps ? (ps.limit - ps.sold) > 0 : false;
        }
        // Modo ERP: usa estoque do ERP
        return parseInt(v.stock) > 0;
      }).map(v => {
        let estoquePromo = null;
        if (stockMode === 'grid') {
          const key = `${(v.color || '').toLowerCase()}|${(v.size || '').toLowerCase()}`;
          const ps = promoStockMap[key];
          estoquePromo = ps ? ps.limit - ps.sold : null;
        } else if (stockMode === 'photo') {
          const cor = (v.color || '').toLowerCase();
          const ps = promoStockMap[cor];
          estoquePromo = ps ? ps.limit - ps.sold : null;
        }
        return {
          id: v.id,
          sku: v.sku,
          nome: v.name,
          tamanho: v.size || '-',
          cor: v.color || '-',
          preco: `R$ ${(promoPrice || parseFloat(v.price)).toFixed(2)}`,
          ...(promoPrice ? { preco_original: `R$ ${parseFloat(v.price).toFixed(2)}` } : {}),
          estoque: estoquePromo !== null ? estoquePromo : parseInt(v.stock),
        };
      });

      if (disponveis.length === 0) return { resultado: 'Todas as variações deste produto estão esgotadas.' };
      return { variacoes_disponiveis: disponveis, total: disponveis.length };
    }

    case 'adicionar_carrinho': {
      const { product_id, ref, nome, cor, tamanho, sku, preco } = toolInput;
      const cart = getCart(conversationId);
      const existing = cart.items.find(i => i.product_id === product_id);
      if (existing) {
        existing.quantity++;
      } else {
        cart.items.push({ product_id, ref: ref || '', name: nome, color: cor || '', size: tamanho || '', sku, price: preco, quantity: 1 });
      }
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, quantidade: i.quantity, preco_unitario: `R$ ${i.price.toFixed(2)}`, subtotal: `R$ ${(i.price * i.quantity).toFixed(2)}` })),
        total: `R$ ${total.toFixed(2)}`,
        mensagem: `"${nome}" adicionado ao carrinho!`,
      };
    }

    case 'ver_carrinho': {
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { carrinho: [], total: 'R$ 0,00', mensagem: 'Carrinho vazio.' };
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, quantidade: i.quantity, preco_unitario: `R$ ${i.price.toFixed(2)}`, subtotal: `R$ ${(i.price * i.quantity).toFixed(2)}` })),
        total: `R$ ${total.toFixed(2)}`,
      };
    }

    case 'remover_carrinho': {
      const { product_id } = toolInput;
      const cart = getCart(conversationId);
      cart.items = cart.items.filter(i => i.product_id !== product_id);
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { carrinho: cart.items.map(i => ({ nome: i.name, quantidade: i.quantity })), total: `R$ ${total.toFixed(2)}`, mensagem: 'Item removido.' };
    }

    case 'finalizar_venda': {
      const { forma_pagamento, cpf } = toolInput;
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { erro: 'Carrinho vazio. Adicione itens antes de finalizar.' };

      try {
        // Valida estoque antes de finalizar
        const semEstoque = [];
        for (const item of cart.items) {
          const stockRows = await erp.erpQuery(
            "SELECT COALESCE(SUM(quantity), 0) AS qty FROM stock WHERE stock_id = 'loja4' AND product_id = $1",
            [item.product_id]
          );
          const disponivel = parseInt(stockRows[0]?.qty) || 0;
          if (disponivel < item.quantity) {
            semEstoque.push({ nome: item.name, pedido: item.quantity, disponivel });
          }
        }
        if (semEstoque.length > 0) {
          const lista = semEstoque.map(s => `${s.nome} (pedido: ${s.pedido}, disponível: ${s.disponivel})`).join('; ');
          return { erro: `Estoque insuficiente para: ${lista}. Verifique com o cliente se quer ajustar.` };
        }

        const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
        const descricao = cart.items.map(i => `${i.name} x${i.quantity}`).join(', ');

        // Cria/busca cliente no Asaas (CPF obrigatório para cobrança)
        const asaasCustomer = await asaas.findOrCreateCustomer(
          customerName || 'Cliente WhatsApp',
          customerPhone,
          cpf
        );

        let charge;
        if (forma_pagamento === 'pix') {
          charge = await asaas.createPixCharge(asaasCustomer.id, total, `D'Black Store — ${descricao}`);
        } else {
          charge = await asaas.createCardCharge(asaasCustomer.id, total, `D'Black Store — ${descricao}`);
        }

        // Salva pagamento pendente no banco
        const paymentId = deps.genId();
        await queryRun(
          `INSERT INTO pending_payments (id, conversation_id, customer_phone, customer_name, asaas_charge_id, asaas_customer_id, payment_method, amount, cart_data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [paymentId, conversationId, customerPhone || '', customerName || 'Cliente WhatsApp', charge.chargeId, asaasCustomer.id, forma_pagamento, total, JSON.stringify(cart.items)]
        );

        // Envia QR Code do PIX ou link de pagamento via WhatsApp
        if (deps.wa?.connected && customerPhone) {
          try {
            if (forma_pagamento === 'pix' && charge.pixQrCodeBase64) {
              // Envia imagem do QR Code
              const qrBuffer = Buffer.from(charge.pixQrCodeBase64, 'base64');
              const caption = `💰 PIX — R$ ${total.toFixed(2)}\n\nEscaneie o QR Code ou copie o código abaixo`;
              const waResult = await deps.wa.sendImage(customerPhone, qrBuffer, caption, { isBot: true });

              const msgId = waResult?._waId || deps.genId();
              const mediaId = 'img_' + msgId;
              await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
                [mediaId, 'image/png', charge.pixQrCodeBase64]);
              await queryRun(
                "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1,$2,true,$3,$4,'image',$5,1,NOW())",
                [msgId, conversationId, 'Lê (IA)', `/media/${mediaId}|${caption}`, `/media/${mediaId}`]
              );

              // Envia copia-cola do PIX
              if (charge.pixCode) {
                await deps.wa.sendText(customerPhone, charge.pixCode, { isBot: true });
                const pixMsgId = deps.genId();
                await queryRun(
                  "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
                  [pixMsgId, conversationId, 'Lê (IA)', charge.pixCode]
                );
              }

              await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
                [`💰 PIX enviado — R$ ${total.toFixed(2)}`, conversationId]);

              if (deps.broadcast) {
                deps.broadcast('new_message', {
                  conversation: { id: conversationId, last_message: `💰 PIX enviado — R$ ${total.toFixed(2)}`, last_message_from_me: true },
                  message: { id: msgId, conversation_id: conversationId, from_me: true, sender: 'Lê (IA)', content: `/media/${mediaId}|${caption}`, media_type: 'image', media_url: `/media/${mediaId}`, timestamp: new Date().toISOString() },
                });
              }
            } else {
              // Cartão — envia link de pagamento
              const linkMsg = `💳 Link de pagamento — R$ ${total.toFixed(2)}\n\n${charge.invoiceUrl}\n\nPode parcelar em até 6x!`;
              await deps.wa.sendText(customerPhone, linkMsg, { isBot: true });
              const linkMsgId = deps.genId();
              await queryRun(
                "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
                [linkMsgId, conversationId, 'Lê (IA)', linkMsg]
              );
              await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
                [`💳 Link enviado — R$ ${total.toFixed(2)}`, conversationId]);

              if (deps.broadcast) {
                deps.broadcast('new_message', {
                  conversation: { id: conversationId, last_message: `💳 Link enviado — R$ ${total.toFixed(2)}`, last_message_from_me: true },
                  message: { id: linkMsgId, conversation_id: conversationId, from_me: true, sender: 'Lê (IA)', content: linkMsg, timestamp: new Date().toISOString() },
                });
              }
            }
          } catch (e) {
            console.error('⚠️ Erro ao enviar pagamento:', e.message);
          }
        }

        // NÃO limpa carrinho ainda — só quando o pagamento for confirmado
        // Marca o carrinho como "aguardando pagamento"
        cart.paymentId = paymentId;
        cart.chargeId = charge.chargeId;

        const metodo = forma_pagamento === 'pix' ? 'PIX (QR Code e código copia-cola enviados)' : 'Cartão de Crédito (link de pagamento enviado)';
        return {
          sucesso: true,
          aguardando_pagamento: true,
          total: `R$ ${total.toFixed(2)}`,
          forma_pagamento: metodo,
          mensagem: `Pagamento gerado! ${forma_pagamento === 'pix' ? 'QR Code e código PIX enviados.' : 'Link de pagamento enviado.'} Assim que o pagamento for confirmado, a venda será registrada automaticamente e o cupom será enviado.`,
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
    "SELECT from_me, sender, content, media_type FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20",
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
          model: 'claude-sonnet-4-20250514',
          max_tokens: 550,
          temperature: 0.7,
          system: SYSTEM_PROMPT,
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

      // Executa tools e monta resultado
      const toolResults = [];
      for (const toolBlock of toolUseBlocks) {
        console.log(`🔧 Lê chamou: ${toolBlock.name}(${JSON.stringify(toolBlock.input)})`);
        const result = await executeTool(toolBlock.name, toolBlock.input, context);
        console.log(`🔧 Resultado: ${JSON.stringify(result).slice(0, 200)}`);

        if (result.transferir) shouldTransfer = true;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

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

module.exports = { generateResponse, isAgentEnabled, recordMetric, init };
