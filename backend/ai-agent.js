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
"Oiiii, (bom dia/boa tarde/boa noite)! Tudo bem? Eu sou a Lê, assistente virtual da D'Black 🥰

Estou aqui para agilizar a compra das peças em oferta, em 5 minutinhos você finaliza sua compra comigo!

Qual é o seu nome e de qual cidade você é?"

IMPORTANTE: Mande APENAS UMA mensagem de saudação. NUNCA mande duas saudações seguidas.

DEPOIS QUE O CLIENTE RESPONDER O NOME E CIDADE:
Pergunte: "[nome], você gostaria de realizar sua compra comigo ou prefere o atendimento das meninas do online?"

- Se o cliente escolher COMPRAR COM VOCÊ (sim, quero, pode ser, com você, bora, etc): use listar_categorias_promo para ver as categorias e JÁ apresente as ofertas disponíveis de forma natural (NÃO use bullet points, escreva em texto corrido).
- Se o cliente escolher ATENDIMENTO HUMANO (meninas, atendente, pessoa, etc): diga "sem problemas! vou te passar para a Kariny ou a Bruna" e transfira colocando [TRANSFERIR] no final.

FLUXO DE VENDA (tudo por texto, sem botões, sem fotos):
1. Depois que souber nome/cidade, pergunte se quer comprar com você ou com as meninas
2. Se escolher você, use listar_categorias_promo e apresente as categorias disponíveis
3. Quando o cliente escolher uma categoria, use buscar_ofertas com o nome EXATO da categoria (que veio de listar_categorias_promo). Se o cliente pedir direto sem ver categorias, use listar_categorias_promo primeiro para saber os nomes corretos
4. Apresente os produtos por TEXTO: nome, preço, cores disponíveis
5. Pergunte qual cor o cliente quer
6. Quando o cliente escolher a cor, use verificar_estoque (com a ref numérica do produto!) para ver tamanhos disponíveis
7. Se o resultado mostrar tamanho "Único", NÃO pergunte tamanho — pule direto pra quantidade
8. Se tiver tamanhos variados (P, M, G, etc), pergunte qual tamanho
9. Pergunte a quantidade
10. Use adicionar_carrinho para adicionar ao carrinho
11. Pergunte se quer ver mais alguma coisa ou finalizar
12. Para finalizar, pergunte: "vai ser entrega (R$7,00) ou retirada na loja (grátis)?"
13. Pergunte: "vai ser no PIX ou no cartão de crédito?"
14. Peça o CPF: "para gerar o pagamento, preciso do seu CPF"
15. Use finalizar_venda com forma de pagamento, CPF e tipo de entrega
16. Se for PIX: QR Code e código copia-cola são enviados automaticamente
17. Se for cartão: link de pagamento enviado automaticamente (até 6x)
18. Diga que assim que confirmar o pagamento, o cupom será enviado

REGRAS DE VENDA:
- SEMPRE use as ferramentas para consultar produtos e estoque. NUNCA invente preço, tamanho ou disponibilidade
- NÃO envie fotos e NÃO use enviar_botoes nem enviar_fotos_produto. Tudo por texto
- Se um tamanho/cor não tem estoque, avise e sugira as opções disponíveis
- Se o verificar_estoque retornar tamanho "Único" para todas as variações, NÃO pergunte tamanho ao cliente. Pule direto pra quantidade
- Se o cliente quiser mais de uma peça, adicione todas ao carrinho antes de finalizar
- Use ver_carrinho se precisar lembrar o que já foi adicionado
- SEMPRE pergunte se é entrega (R$7,00) ou retirada na loja (grátis) antes de finalizar

REGRAS ABSOLUTAS:
- LEIA TODO o histórico antes de responder. NUNCA repita informação, pergunta ou frase que já apareceu na conversa
- Se já perguntou o nome, NÃO pergunte de novo. Se já apresentou as categorias, NÃO apresente de novo. Se já mostrou os produtos de uma categoria, NÃO mostre de novo a menos que o cliente peça
- Se já sabe o nome, USE o nome
- Se o cliente voltar a falar depois de um tempo, NÃO repita a saudação. Apenas retome de onde parou
- Se perguntarem se é robô/IA, confirme que é uma assistente virtual e que está ali para agilizar o atendimento. Se o cliente preferir falar com uma pessoa, transfira [TRANSFERIR]
- NUNCA fale coisas que não estão neste prompt
- A loja só faz VENDA ONLINE, não separa peça — SÓ informe se o cliente perguntar
- Confie nos resultados das ferramentas. Se a ferramenta diz que tem estoque, TEM. Se diz que não tem, NÃO TEM. NUNCA contradiga a ferramenta
- NUNCA invente códigos de referência (ref). Use SEMPRE a ref que veio do resultado de buscar_ofertas. Ex: se buscar_ofertas retornou ref "50083", use "50083" nas outras ferramentas

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
    name: 'enviar_fotos_produto',
    description: 'Envia as fotos das cores disponíveis de um produto para o cliente via WhatsApp. Use a ref que veio do resultado de buscar_ofertas (ex: "50083"). NUNCA invente uma ref. Use APENAS UMA VEZ por produto, logo depois de buscar_ofertas. NÃO use de novo se já enviou as fotos antes na conversa.',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Código de referência do produto (ref)' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'verificar_estoque',
    description: 'Verifica tamanhos e cores disponíveis. O parâmetro ref DEVE ser o código numérico retornado por buscar_ofertas ou enviar_fotos_produto (ex: "50083").',
    input_schema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Código numérico do produto retornado por buscar_ofertas (ex: "50083"). NÃO invente, copie exatamente do resultado anterior.' },
      },
      required: ['ref'],
    },
  },
  {
    name: 'adicionar_carrinho',
    description: 'Adiciona um produto ao carrinho do cliente. Use quando o cliente escolher cor, tamanho e quantidade.',
    input_schema: {
      type: 'object',
      properties: {
        product_id: { type: 'string', description: 'ID do produto específico (tamanho/cor)' },
        ref: { type: 'string', description: 'Código de referência do produto (ref)' },
        nome: { type: 'string', description: 'Nome do produto para exibição' },
        cor: { type: 'string', description: 'Cor escolhida pelo cliente' },
        tamanho: { type: 'string', description: 'Tamanho escolhido pelo cliente (P, M, G, GG, Único, etc)' },
        sku: { type: 'string', description: 'SKU do produto' },
        preco: { type: 'number', description: 'Preço unitário' },
        quantidade: { type: 'number', description: 'Quantidade desejada (padrão 1)' },
      },
      required: ['product_id', 'ref', 'nome', 'cor', 'tamanho', 'sku', 'preco'],
    },
  },
  {
    name: 'enviar_botoes',
    description: 'Envia uma mensagem com botões clicáveis para o cliente escolher (máximo 3 botões). Use para perguntar tamanho, quantidade, tipo de entrega ou forma de pagamento.',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título da mensagem (em negrito)' },
        descricao: { type: 'string', description: 'Texto descritivo da mensagem' },
        botoes: {
          type: 'array',
          description: 'Lista de botões (máximo 3). Cada botão tem "texto" (o que aparece) e "id" (identificador)',
          items: {
            type: 'object',
            properties: {
              texto: { type: 'string', description: 'Texto do botão' },
              id: { type: 'string', description: 'ID do botão (ex: "tam_p", "qtd_1", "entrega")' },
            },
            required: ['texto', 'id'],
          },
        },
      },
      required: ['titulo', 'descricao', 'botoes'],
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
    description: 'Gera o pagamento (PIX com QR Code ou link de cartão) e envia ao cliente via WhatsApp. A venda só é registrada no sistema quando o pagamento é confirmado. Use quando o cliente confirmar a compra, tipo de entrega, forma de pagamento E CPF.',
    input_schema: {
      type: 'object',
      properties: {
        forma_pagamento: { type: 'string', enum: ['pix', 'credito'], description: 'Forma de pagamento: "pix" ou "credito"' },
        cpf: { type: 'string', description: 'CPF do cliente (apenas números ou formatado)' },
        tipo_entrega: { type: 'string', enum: ['entrega', 'retirada'], description: 'Tipo de entrega: "entrega" (R$7,00) ou "retirada" (grátis)' },
      },
      required: ['forma_pagamento', 'cpf', 'tipo_entrega'],
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
      // Busca refs da promoção nesta categoria (exato ou aproximado)
      let promoItems = await queryAll(
        "SELECT id, ref, display_name, promo_price FROM promo_items WHERE active = true AND LOWER(category) = LOWER($1)",
        [categoria]
      );
      // Se não encontrou, tenta busca aproximada (LIKE)
      if (promoItems.length === 0) {
        promoItems = await queryAll(
          "SELECT id, ref, display_name, promo_price FROM promo_items WHERE active = true AND LOWER(category) LIKE LOWER($1)",
          [`%${categoria.replace(/s$/i, '')}%`]
        );
      }
      if (promoItems.length === 0) {
        // Retorna categorias disponíveis pra ajudar
        const cats = await queryAll("SELECT DISTINCT category FROM promo_items WHERE active = true ORDER BY category");
        return { resultado: `Não encontrei "${categoria}". Categorias disponíveis: ${cats.map(c => c.category).join(', ')}. Use o nome exato.` };
      }

      const refs = promoItems.map(p => p.ref);
      // Busca produtos do ERP
      const products = await erp.getProductsByRefs(refs);

      // Para cada ref, determina quais cores/tamanhos realmente estão disponíveis
      // usando a mesma lógica de estoque do verificar_estoque
      const grouped = {};
      for (const p of products) {
        const refKey = (p.ref || '').toLowerCase();
        if (!grouped[refKey]) {
          const promoItem = promoItems.find(pi => pi.ref.toLowerCase() === refKey);
          const promoPrice = promoItem?.promo_price ? parseFloat(promoItem.promo_price) : null;
          grouped[refKey] = {
            ref: p.ref,
            promoItemId: promoItem?.id,
            nome: promoItem?.display_name || p.name.replace(/\s+(P|M|G|GG|EXG|G1|G2|G3|\d{2})$/i, '').trim(),
            preco: promoPrice || parseFloat(p.price),
            precoOriginal: promoPrice ? parseFloat(p.price) : null,
            foto: p.photo,
            tamanhos: new Set(),
            cores: new Set(),
            variants: [],
          };
        }
        grouped[refKey].variants.push(p);
      }

      // Filtra cores/tamanhos por disponibilidade real (promo_stock ou ERP)
      const ofertas = [];
      for (const g of Object.values(grouped)) {
        let stockMode = 'erp';
        let promoStockMap = {};

        if (g.promoItemId) {
          const promoStockRows = await queryAll(
            "SELECT color, size, stock_limit, stock_sold FROM promo_stock WHERE promo_item_id = $1 AND stock_limit > 0",
            [g.promoItemId]
          );
          if (promoStockRows.length > 0) {
            stockMode = 'grid';
            for (const ps of promoStockRows) {
              const key = `${(ps.color || '').toLowerCase()}|${(ps.size || '').toLowerCase()}`;
              promoStockMap[key] = { limit: ps.stock_limit, sold: ps.stock_sold || 0 };
            }
          } else {
            const promoPhotos = await queryAll(
              "SELECT color, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND stock_limit > 0",
              [g.promoItemId]
            );
            if (promoPhotos.length > 0) {
              stockMode = 'photo';
              for (const pp of promoPhotos) {
                promoStockMap[pp.color.toLowerCase()] = { limit: pp.stock_limit, sold: pp.stock_sold || 0 };
              }
            }
          }
        }

        // Filtra variantes com estoque real (promo_stock manda, NÃO cai no ERP)
        if (stockMode === 'grid') {
          // Mostra tamanhos/cores que têm estoque no grid promo
          for (const [key, ps] of Object.entries(promoStockMap)) {
            if ((ps.limit - ps.sold) > 0) {
              const [cor, tam] = key.split('|');
              if (tam) g.tamanhos.add(tam.toUpperCase());
              if (cor) g.cores.add(cor.charAt(0).toUpperCase() + cor.slice(1));
            }
          }
        } else if (stockMode === 'photo') {
          // Mostra cores que têm estoque nas fotos promo
          for (const [cor, ps] of Object.entries(promoStockMap)) {
            if ((ps.limit - ps.sold) > 0) {
              g.cores.add(cor.charAt(0).toUpperCase() + cor.slice(1));
            }
          }
          // Tamanhos vêm do ERP (foto não controla tamanho)
          for (const v of g.variants) {
            if (v.size) g.tamanhos.add(v.size);
          }
        } else {
          // Sem promo_stock: produto promo sem controle = indisponível
          // (admin precisa cadastrar estoque promo)
        }

        // Só inclui produto se tem pelo menos 1 variação disponível
        if (g.tamanhos.size > 0 || g.cores.size > 0) {
          ofertas.push({
            ref: g.ref,
            nome: g.nome,
            preco: `R$ ${g.preco.toFixed(2)}`,
            ...(g.precoOriginal ? { preco_original: `R$ ${g.precoOriginal.toFixed(2)}` } : {}),
            tamanhos: [...g.tamanhos].join(', ') || 'variados',
            cores: [...g.cores].join(', ') || 'variadas',
          });
        }
      }

      if (ofertas.length === 0) return { resultado: `Todos os produtos da categoria "${categoria}" estão esgotados no momento.` };
      return { ofertas, total: ofertas.length, instrucao: `Use enviar_fotos_produto com a ref de cada produto para enviar fotos. Exemplo: enviar_fotos_produto(ref: "${ofertas[0]?.ref}")` };
    }

    case 'enviar_fotos_produto': {
      const { ref } = toolInput;

      // Trava: não envia fotos do mesmo produto 2x na mesma conversa
      const jaEnviou = await queryOne(
        "SELECT id FROM messages WHERE conversation_id = $1 AND from_me = true AND content LIKE $2 AND media_type = 'image' LIMIT 1",
        [conversationId, `%${ref}%`]
      );
      if (jaEnviou) return { sucesso: true, ref, ja_enviadas: true, instrucao: `Fotos deste produto já foram enviadas antes. NÃO envie de novo. Pergunte ao cliente qual cor quer. Use verificar_estoque com ref "${ref}" quando ele escolher.` };

      const promoItem = await queryOne("SELECT id, display_name, promo_price FROM promo_items WHERE active = true AND LOWER(ref) = LOWER($1)", [ref]);
      if (!promoItem) return { resultado: 'Produto não encontrado na promoção.' };

      const photos = await queryAll(
        "SELECT id, color, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND stock_limit > 0 ORDER BY color",
        [promoItem.id]
      );
      const disponiveis = photos.filter(p => (p.stock_limit - (p.stock_sold || 0)) > 0);
      if (disponiveis.length === 0) return { resultado: 'Nenhuma cor disponível com estoque.' };

      // Envia cada foto via WhatsApp
      const preco = promoItem.promo_price ? `R$ ${parseFloat(promoItem.promo_price).toFixed(2)}` : '';
      let enviadas = 0;
      if (deps.wa && customerPhone) {
        for (const photo of disponiveis) {
          try {
            const photoRow = await queryOne("SELECT data, mime_type FROM promo_photos WHERE id = $1", [photo.id]);
            if (!photoRow?.data) continue;
            const buffer = Buffer.from(photoRow.data, 'base64');
            const restante = photo.stock_limit - (photo.stock_sold || 0);
            const caption = `${promoItem.display_name} — ${photo.color.trim()}\n${preco}`;
            await deps.wa.sendImage(customerPhone, buffer, caption, { isBot: true });

            // Salva no histórico
            const msgId = deps.genId();
            const mediaId = 'promo_' + photo.id;
            await queryRun("INSERT INTO media_files (id, mime_type, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
              [mediaId, photoRow.mime_type || 'image/jpeg', photoRow.data]);
            await queryRun(
              "INSERT INTO messages (id, conversation_id, from_me, sender, content, media_type, media_url, ack, timestamp) VALUES ($1,$2,true,$3,$4,'image',$5,1,NOW())",
              [msgId, conversationId, 'Lê (IA)', `/media/${mediaId}|${caption}`, `/media/${mediaId}`]
            );
            if (deps.broadcast) {
              deps.broadcast('new_message', {
                conversation: { id: conversationId },
                message: { id: msgId, conversation_id: conversationId, from_me: true, sender: 'Lê (IA)', content: `/media/${mediaId}|${caption}`, media_type: 'image', media_url: `/media/${mediaId}`, timestamp: new Date().toISOString() },
              });
            }
            enviadas++;
          } catch (e) {
            console.error(`⚠️ Erro ao enviar foto ${photo.color}:`, e.message);
          }
        }
      }

      const coresEnviadas = disponiveis.map(p => p.color.trim()).join(', ');
      return {
        sucesso: true,
        ref: ref,
        fotos_enviadas: enviadas,
        cores_disponiveis: coresEnviadas,
        instrucao: `Fotos enviadas. Pergunte qual cor o cliente quer. Quando escolher, use verificar_estoque com ref "${ref}" para ver tamanhos.`
      };
    }

    case 'verificar_estoque': {
      const { ref } = toolInput;
      const variants = await erp.getProductVariants(ref);

      // Busca preço promo e estoque promo
      const promoItem = await queryOne("SELECT id, promo_price FROM promo_items WHERE active = true AND LOWER(ref) = LOWER($1)", [ref]);
      const promoPrice = promoItem?.promo_price ? parseFloat(promoItem.promo_price) : null;

      // Estoque promo: grade cor+tamanho > fotos por cor > ERP
      let promoStockMap = {};
      let stockMode = 'erp';
      if (promoItem) {
        const promoStockRows = await queryAll(
          "SELECT color, size, stock_limit, stock_sold FROM promo_stock WHERE promo_item_id = $1 AND stock_limit > 0",
          [promoItem.id]
        );
        if (promoStockRows.length > 0) {
          stockMode = 'grid';
          for (const ps of promoStockRows) {
            const key = `${(ps.color || '').toLowerCase()}|${(ps.size || '').toLowerCase()}`;
            promoStockMap[key] = { limit: ps.stock_limit, sold: ps.stock_sold || 0, color: ps.color, size: ps.size };
          }
        } else {
          const promoPhotos = await queryAll(
            "SELECT color, stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND stock_limit > 0",
            [promoItem.id]
          );
          if (promoPhotos.length > 0) {
            stockMode = 'photo';
            for (const pp of promoPhotos) {
              promoStockMap[pp.color.toLowerCase()] = { limit: pp.stock_limit, sold: pp.stock_sold || 0, color: pp.color };
            }
          }
        }
      }

      // Promo_stock manda — não cai no ERP para peças de oferta
      const baseVariant = variants[0]; // produto base do ERP (para pegar id, sku, price)

      if (stockMode === 'grid') {
        // Grid promo: mostra apenas variações cadastradas com estoque
        const disponveis = [];
        for (const [key, ps] of Object.entries(promoStockMap)) {
          const restante = ps.limit - ps.sold;
          if (restante <= 0) continue;
          // Tenta achar variante correspondente no ERP para pegar id/sku
          const erpVariant = variants.find(v =>
            (v.color || '').toLowerCase() === (ps.color || '').toLowerCase() &&
            (v.size || '').toLowerCase() === (ps.size || '').toLowerCase()
          ) || baseVariant;
          const baseId = erpVariant?.id || baseVariant?.id;
          const uniqueId = erpVariant?.id !== baseVariant?.id ? baseId : `${baseId}_${(ps.color || '').replace(/\s+/g, '').toLowerCase()}_${(ps.size || '').replace(/\s+/g, '').toLowerCase()}`;
          disponveis.push({
            id: uniqueId,
            sku: erpVariant?.sku || baseVariant?.sku,
            nome: erpVariant?.name || baseVariant?.name,
            tamanho: ps.size || 'Único',
            cor: ps.color || '-',
            preco: `R$ ${(promoPrice || parseFloat(erpVariant?.price || baseVariant?.price || 0)).toFixed(2)}`,
            ...(promoPrice ? { preco_original: `R$ ${parseFloat(erpVariant?.price || baseVariant?.price || 0).toFixed(2)}` } : {}),
            estoque: restante,
          });
        }
        if (disponveis.length === 0) return { resultado: 'Todas as variações deste produto estão esgotadas.' };
        return { variacoes_disponiveis: disponveis, total: disponveis.length };
      }

      if (stockMode === 'photo') {
        // Foto promo: filtra por cor com estoque
        const coresDisponiveis = {};
        for (const [cor, ps] of Object.entries(promoStockMap)) {
          if ((ps.limit - ps.sold) > 0) coresDisponiveis[cor] = ps.limit - ps.sold;
        }
        // Se ERP tem variações com cor, filtra por cor
        const erpTemCores = variants.some(v => v.color);
        let disponveis;
        if (erpTemCores) {
          disponveis = variants.filter(v => {
            const cor = (v.color || '').toLowerCase();
            return coresDisponiveis[cor] > 0;
          }).map(v => ({
            id: v.id, sku: v.sku, nome: v.name,
            tamanho: v.size || '-', cor: v.color || '-',
            preco: `R$ ${(promoPrice || parseFloat(v.price)).toFixed(2)}`,
            ...(promoPrice ? { preco_original: `R$ ${parseFloat(v.price).toFixed(2)}` } : {}),
            estoque: coresDisponiveis[(v.color || '').toLowerCase()],
          }));
        } else {
          // ERP sem variações de cor: gera variações virtuais a partir das fotos promo
          // ID único por cor pra diferenciar no carrinho
          disponveis = Object.entries(coresDisponiveis).map(([cor, estoque]) => ({
            id: `${baseVariant?.id}_${cor.replace(/\s+/g, '').toLowerCase()}`, sku: baseVariant?.sku, nome: baseVariant?.name,
            tamanho: 'Único', cor: cor.charAt(0).toUpperCase() + cor.slice(1),
            preco: `R$ ${(promoPrice || parseFloat(baseVariant?.price || 0)).toFixed(2)}`,
            ...(promoPrice ? { preco_original: `R$ ${parseFloat(baseVariant?.price || 0).toFixed(2)}` } : {}),
            estoque,
          }));
        }
        if (disponveis.length === 0) return { resultado: 'Todas as variações deste produto estão esgotadas.' };
        return { variacoes_disponiveis: disponveis, total: disponveis.length };
      }

      // Sem promo_stock: produto promo sem controle de estoque cadastrado
      return { resultado: 'Este produto ainda não teve o estoque da promoção configurado. Avise a equipe.' };
    }

    case 'adicionar_carrinho': {
      const { product_id, ref, nome, cor, tamanho, sku, preco, quantidade } = toolInput;
      const qty = quantidade || 1;
      const cart = getCart(conversationId);
      const existing = cart.items.find(i => i.product_id === product_id && i.color === (cor || '') && i.size === (tamanho || ''));
      if (existing) {
        existing.quantity += qty;
      } else {
        cart.items.push({ product_id, ref: ref || '', name: nome, color: cor || '', size: tamanho || '', sku, price: preco, quantity: qty });
      }
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', tamanho: i.size || '-', quantidade: i.quantity, preco_unitario: `R$ ${i.price.toFixed(2)}`, subtotal: `R$ ${(i.price * i.quantity).toFixed(2)}` })),
        total: `R$ ${total.toFixed(2)}`,
        mensagem: `"${nome}" adicionado ao carrinho!`,
      };
    }

    case 'enviar_botoes': {
      const { titulo, descricao, botoes } = toolInput;
      if (!botoes || botoes.length === 0) return { erro: 'Nenhum botão informado.' };
      if (botoes.length > 3) return { erro: 'Máximo 3 botões por mensagem.' };

      if (deps.wa && customerPhone) {
        try {
          const btns = botoes.map(b => ({ text: b.texto, id: b.id }));
          const waResult = await deps.wa.sendButtons(customerPhone, titulo, descricao, btns, { isBot: true });

          // Salva no histórico
          const msgId = waResult?._waId || deps.genId();
          const btnTexts = botoes.map(b => b.texto).join(' | ');
          const content = `${titulo}\n${descricao}\n[Botões: ${btnTexts}]`;
          await queryRun(
            "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
            [msgId, conversationId, 'Lê (IA)', content]
          );
          await queryRun("UPDATE conversations SET last_message = $1, last_message_at = NOW(), last_message_from_me = true WHERE id = $2",
            [content, conversationId]);
          if (deps.broadcast) {
            deps.broadcast('new_message', {
              conversation: { id: conversationId, last_message: content, last_message_from_me: true },
              message: { id: msgId, conversation_id: conversationId, from_me: true, sender: 'Lê (IA)', content, timestamp: new Date().toISOString() },
            });
          }
          return { sucesso: true, mensagem: `Botões enviados: ${btnTexts}` };
        } catch (e) {
          console.error('⚠️ Erro ao enviar botões:', e.message);
          return { erro: 'Não consegui enviar os botões. Pergunte por texto.' };
        }
      }
      return { erro: 'WhatsApp não conectado.' };
    }

    case 'ver_carrinho': {
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { carrinho: [], total: 'R$ 0,00', mensagem: 'Carrinho vazio.' };
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return {
        carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', tamanho: i.size || '-', quantidade: i.quantity, preco_unitario: `R$ ${i.price.toFixed(2)}`, subtotal: `R$ ${(i.price * i.quantity).toFixed(2)}` })),
        total: `R$ ${total.toFixed(2)}`,
      };
    }

    case 'remover_carrinho': {
      const { product_id } = toolInput;
      const cart = getCart(conversationId);
      cart.items = cart.items.filter(i => i.product_id !== product_id);
      const total = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
      return { carrinho: cart.items.map(i => ({ nome: i.name, cor: i.color || '-', quantidade: i.quantity })), total: `R$ ${total.toFixed(2)}`, mensagem: 'Item removido.' };
    }

    case 'finalizar_venda': {
      const { forma_pagamento, cpf, tipo_entrega } = toolInput;
      const cart = getCart(conversationId);
      if (cart.items.length === 0) return { erro: 'Carrinho vazio. Adicione itens antes de finalizar.' };
      const taxaEntrega = tipo_entrega === 'entrega' ? 7.00 : 0;

      try {
        // Valida estoque no promo_stock antes de finalizar
        const semEstoque = [];
        for (const item of cart.items) {
          const ref = item.ref || '';
          const promoItem = ref ? await queryOne("SELECT id FROM promo_items WHERE active = true AND LOWER(ref) = LOWER($1)", [ref]) : null;
          if (promoItem) {
            // Verifica no promo_stock (grid: cor+tamanho, photo: só cor)
            const gridRow = await queryOne(
              "SELECT stock_limit, stock_sold FROM promo_stock WHERE promo_item_id = $1 AND LOWER(color) = LOWER($2) AND LOWER(size) = LOWER($3) AND stock_limit > 0",
              [promoItem.id, item.color || '', item.size || '']
            );
            if (gridRow) {
              const restante = gridRow.stock_limit - (gridRow.stock_sold || 0);
              if (restante < item.quantity) {
                semEstoque.push({ nome: item.name, pedido: item.quantity, disponivel: restante });
              }
            } else {
              // Tenta foto (só por cor)
              const photoRow = await queryOne(
                "SELECT stock_limit, stock_sold FROM promo_photos WHERE promo_item_id = $1 AND LOWER(color) = LOWER($2) AND stock_limit > 0",
                [promoItem.id, item.color || '']
              );
              if (photoRow) {
                const restante = photoRow.stock_limit - (photoRow.stock_sold || 0);
                if (restante < item.quantity) {
                  semEstoque.push({ nome: item.name, pedido: item.quantity, disponivel: restante });
                }
              }
              // Sem promo_stock: permite (já foi validado no verificar_estoque)
            }
          }
          // Produto sem ref promo: sem validação extra
        }
        if (semEstoque.length > 0) {
          const lista = semEstoque.map(s => `${s.nome} (pedido: ${s.pedido}, disponível: ${s.disponivel})`).join('; ');
          return { erro: `Estoque insuficiente para: ${lista}. Verifique com o cliente se quer ajustar.` };
        }

        const subtotal = cart.items.reduce((s, i) => s + i.price * i.quantity, 0);
        const total = subtotal + taxaEntrega;
        const descricao = cart.items.map(i => `${i.name} x${i.quantity}`).join(', ') + (taxaEntrega > 0 ? ' + Entrega' : '');

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
          `INSERT INTO pending_payments (id, conversation_id, customer_phone, customer_name, asaas_charge_id, asaas_customer_id, payment_method, amount, cart_data, tipo_entrega, taxa_entrega)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [paymentId, conversationId, customerPhone || '', customerName || 'Cliente WhatsApp', charge.chargeId, asaasCustomer.id, forma_pagamento, total, JSON.stringify(cart.items), tipo_entrega || 'retirada', taxaEntrega]
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
                await deps.wa.sendMessage(customerPhone, charge.pixCode, { isBot: true });
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
              await deps.wa.sendMessage(customerPhone, linkMsg, { isBot: true });
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
        const entregaInfo = tipo_entrega === 'entrega' ? `Entrega: R$ 7,00` : 'Retirada na loja (grátis)';
        return {
          sucesso: true,
          aguardando_pagamento: true,
          subtotal: `R$ ${subtotal.toFixed(2)}`,
          entrega: entregaInfo,
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
