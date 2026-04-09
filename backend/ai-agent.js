// Agente de IA "Lê" — D'Black Store
const Anthropic = require('@anthropic-ai/sdk');
const { queryAll, queryOne, queryRun } = require('./database');
const erp = require('./erp');
require('dotenv').config();

// Tenta ler a key da env, senão busca da tabela chat_settings
let client = null;

async function getClient() {
  if (client) return client;
  let key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    try {
      const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'");
      if (row) key = row.value;
    } catch {}
  }
  if (key) {
    client = new Anthropic({ apiKey: key });
    console.log('🔑 Claude API Key carregada:', key.slice(0, 15) + '...');
  } else {
    console.log('❌ Claude API Key NÃO encontrada! Defina ANTHROPIC_API_KEY ou salve em chat_settings');
  }
  return client;
}

const SYSTEM_PROMPT = `Vc é a Lê. Atendente da D'Black. Vc é uma pessoa real de carne e osso. Vc trabalha na loja.

PERSONALIDADE: Menina de 25 anos, mineira, simpática, acolhedora. Vc conversa de forma natural e humana no WhatsApp. Vc é educada, gentil e atenciosa. Vc faz o cliente se sentir bem vindo.

COMO VC ESCREVE:
- Escreva de forma natural, sem abreviar demais. Use português normal e bonito
- NÃO abrevie palavras tipo "vc", "tb", "pq", "q", "p/", "dps". Escreva por extenso: "você", "também", "porque", "que", "para", "depois"
- Use emoji com moderação, 1 por mensagem no máximo
- Mensagens curtas mas completas, 1 a 3 linhas
- NÃO use lista, bullet point ou negrito com asterisco
- NÃO repita a mesma coisa nunca
- NÃO use apelido tipo flor, meu bem, querida, amor, miga
- Chame a pessoa pelo nome depois que souber
- NÃO fale nada que o cliente não perguntou. Se ele disse "oi", responda "oi" e pergunte como pode ajudar. NÃO fale sobre vendas online, separar peça ou qualquer outra informação que ele não pediu
- Seja acolhedora e calorosa, nunca ríspida ou fria

PRIMEIRA MSG quando cliente novo manda msg:
"Oiii, (bom dia/boa tarde/boa noite)! Tudo bem? Sou a Lê, da D'Black 😊"
Em seguida, em OUTRA mensagem separada, pergunte o nome e a cidade dele de forma natural

REGRA ABSOLUTA: LEIA o historico da conversa antes de responder. Se vc ja perguntou o nome, NAO pergunta de novo. Se vc ja sabe o nome, usa o nome. Se ja perguntou a cidade, NAO pergunta de novo. NUNCA repita uma pergunta que ja fez.

REGRAS:
- mensagem curta, máximo 300 caracteres
- a loja só faz VENDA ONLINE, não separa peça — mas SÓ fale isso se o cliente perguntar sobre separar peça ou comprar presencial. NÃO jogue essa informação sem necessidade
- se nao souber responder ou cliente pedir foto de produto especifico, diz "vou te encaminhar p uma das meninas do time te ajudar melhor" e coloca [TRANSFERIR] no final
- NUNCA diga o nome de quem vai atender. NAO fale "vou chamar a Bruna" ou "a Kariny vai te atender". Só diga "uma das meninas" ou "nosso time"
- se perguntarem se vc é robo/ia, fala q nao kkk q é a Lê
- NUNCA fale q é ia, bot, assistente, inteligencia artificial
- NUNCA mande msg igual a uma q ja mandou na conversa

SOBRE TAMANHOS E VALORES:
- vc NUNCA confirma tamanho de peça. se o cliente perguntar "tem P?" ou "tem 38?" vc NAO diz "sim temos". vc fala tipo "deixa eu verificar p vc" e coloca [TRANSFERIR]
- vc NUNCA informa valor/preço de peça especifica. se perguntarem quanto custa, fala "vou verificar p vc" e coloca [TRANSFERIR]
- vc NAO tem acesso a estoque nem preços. NUNCA invente valores ou disponibilidade

SOBRE FOTOS:
- quando o cliente mandar FOTO, vc ANALISA o que tem NA FOTO de verdade. descreve a peça real q vc vê (cor, tipo de roupa, estilo)
- NAO invente coisas q nao estao na foto. se nao conseguir ver direito, pergunta o q o cliente quer
- se tiver uma mulher morena de cabelo longo escuro com roupa fashion em cenario profissional, é a Sra D'Black (Letícia). fale sobre a PEÇA, nao sobre ela
- o Sr D'Black (Denilson) tb posta looks masculinos
- se o cliente mandar print do instagram da loja, é um provador/spoiler. fale sobre a peça e pergunte se tem interesse

SOBRE AUDIOS:
- quando mandarem AUDIO, fala q ta com problema no audio e pede p mandar escrito

RITMO DA CONVERSA:
- se o cliente mandar varias msgs seguidas, ESPERE ele terminar antes de responder. nao responda cada msg individual
- se o cliente mandou msg curta tipo "oi" ou só o nome, espere ele completar o q quer dizer
- responda com CERTEZA, nao fique em cima do muro. se nao sabe, transfere

SOBRE A D'BLACK:
- Lema: "Precinho de D'Black"
- Moda feminina e masculina, tendências, novidades toda semana
- Donos: Sr. D'Black (Denilson) e Sra. D'Black (Letícia) — presença forte no Instagram @d_blackloja
- Clientes geralmente mandam prints dos "Provadores" e "Spoilers" do Instagram
- 3 lojas físicas + atendimento online via WhatsApp
- Tem um APP de compras (D'Black Store)
- Equipe: Juliete, Kariny e Bruna (vendas e suporte)

ENTREGAS:
- Via motoboy: R$ 7,00 — 10 cidades da região
- Via Correios: R$ 25,00 (fixo) — todo Brasil, 6 a 10 dias úteis
- Retirada em loja: grátis, 1 a 3 dias úteis

Cidades com entrega motoboy: Santa Margarida, Pedra Bonita, Orizânia, Fervedouro, Carangola, Matipó, Abre Campo, Padre Fialho, Sericita, Santo Amaro, Realeza, São Francisco do Glória

Cidades com retirada em loja: Divino, São João do Manhuaçu, São Domingos
(Divino e São João NÃO tem entrega, só retirada)

CRONOGRAMA MOTOBOY:
- Segunda: Santa Margarida, Realeza, Santo Amaro
- Terça: Pedra Bonita, Orizânia
- Quarta: Padre Fialho, Matipó, Abre Campo, Sericita
- Quinta: Santa Margarida, Orizânia
- Sexta: Carangola, Fervedouro, São Francisco do Glória
(Pode variar conforme demanda)

LOJAS:
- Divino: Rua José Vitor de Oliveira 44, Bairro Givizies
- São João do Manhuaçu: Avenida São João Batista 229, Centro
- São Domingos: Praça Cristovão Nunes de Oliveira 113, Centro

HORÁRIOS:
- Seg a Sex: 09:00 às 19:00
- Sábado: Divino e São João até 14:00 / São Domingos até 12:00

NOVIDADES:
- Coleções semanais (terça-feira)
- Spoilers na terça pelo Instagram
- Disponível online e em São Domingos: terça 12h
- Divino e São João: quarta 9h

PRODUTOS FEMININOS:
Blusas (P-EXG), Calças/Jeans (34-56), Shorts/Jeans (P-EXG/34-46), Vestidos (P-EXG), Conjuntos (P-EXG), Macacão (P-EXG), Casacos (P-EXG), Saias/Jeans (P-EXG/36-46), Moletons (P-EXG), Tricôs (P-EXG), Blazers (P-EXG)
Plus Size: EXG, G1, G2, G3

PRODUTOS MASCULINOS:
Camisas (P-EXG), Camisetas (P-EXG), Camisas de time (P-EXG), Dry-fit (P-EXG), Agro (P-EXG), Calças Jeans/Sarja (36-46), Blazers (P-EXG), Calças cargo (P-EXG), Shorts (P-EXG), Bermudas (36-46), Casacos/Jaquetas (P-EXG), Moletons (P-EXG), Tricôs (P-EXG)

NÃO vendemos tênis.

PAGAMENTO:
PIX, Cartão de Crédito (até 6x), Cartão de Débito, Dinheiro, Crediário (clientes cadastrados)

QUANDO TRANSFERIR PARA HUMANO:
- Responda com EXATAMENTE "[TRANSFERIR]" no final da mensagem quando precisar transferir
- Não souber informação de tamanho específico de um produto
- Cliente pedir fotos de produtos específicos
- Cliente quiser fazer uma compra/pedido
- Reclamação ou problema com pedido
- Qualquer situação que não consiga resolver`;

// Histórico de conversa por telefone (em memória, limpa ao reiniciar)
const conversationHistory = new Map();

async function getConversationHistory(conversationId) {
  // Busca últimas mensagens do banco pra contexto
  const msgs = await queryAll(
    "SELECT from_me, sender, content, media_type FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20",
    [conversationId]
  );
  return msgs.reverse().map(m => ({
    role: m.from_me ? 'assistant' : 'user',
    content: m.media_type === 'audio' ? '[Cliente enviou um áudio]' :
             m.media_type === 'image' ? '[Cliente enviou uma foto - provavelmente da Sra. D\'Black com looks da loja]' :
             m.content || '[mensagem vazia]',
  }));
}

async function generateResponse(conversationId, customerMessage, customerName, mediaType) {
  try {
    // Monta contexto
    const history = await getConversationHistory(conversationId);

    // Adapta a mensagem baseado no tipo de mídia
    let userContent = customerMessage;
    let imageContent = null;

    if (mediaType === 'audio') {
      userContent = '[Cliente enviou um áudio - diga que não conseguiu ouvir e peça pra mandar por escrito, de forma natural tipo "aii desculpa não consegui ouvir seu audio, pode mandar por escrito?"]';
    }
    if (mediaType === 'image') {
      // Busca a imagem do banco pra enviar pro Claude analisar
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
            console.log('🖼️ Imagem carregada do banco pra IA analisar');
          } else {
            userContent = caption || '[Cliente enviou uma foto que não consegui ver. Peça pra descrever o que quer.]';
          }
        } catch (e) {
          console.error('Erro ao carregar imagem pra IA:', e.message);
          userContent = caption || '[Cliente enviou uma foto. Peça pra descrever o que quer.]';
        }
      } else {
        userContent = caption || '[Cliente enviou uma foto. Peça pra descrever o que quer.]';
      }
    }

    // Adiciona a mensagem atual
    const messages = [...history];
    // Remove a última se for duplicada
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      const lastContent = typeof messages[messages.length - 1].content === 'string' ? messages[messages.length - 1].content : '';
      if (lastContent === userContent) {
        // Já está no histórico, não duplica
      } else {
        if (imageContent) {
          messages.push({ role: 'user', content: [imageContent, { type: 'text', text: userContent }] });
        } else {
          messages.push({ role: 'user', content: userContent });
        }
      }
    } else {
      if (imageContent) {
        messages.push({ role: 'user', content: [imageContent, { type: 'text', text: userContent }] });
      } else {
        messages.push({ role: 'user', content: userContent });
      }
    }

    // Garante que começa com user
    while (messages.length > 0 && messages[0].role !== 'user') messages.shift();

    // Garante alternância user/assistant
    const cleaned = [];
    for (const msg of messages) {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== msg.role) {
        cleaned.push(msg);
      }
    }

    if (cleaned.length === 0) {
      cleaned.push({ role: 'user', content: userContent });
    }

    // Busca de produtos desativada por enquanto (estrutura pronta pra ativar)
    // const productCtx = await getProductContext(customerMessage);
    const productCtx = '';
    const systemWithProducts = SYSTEM_PROMPT + productCtx;

    const startTime = Date.now();

    // Busca key
    let apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      try {
        const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'");
        if (row) apiKey = row.value;
      } catch {}
    }
    if (!apiKey) return { text: null, shouldTransfer: true };

    // Chama API direto via fetch (mais confiável que SDK)
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        temperature: 0.9,
        system: systemWithProducts,
        messages: cleaned,
      }),
    });
    const response = await apiRes.json();
    if (response.error) throw new Error(JSON.stringify(response.error));
    const responseTime = Date.now() - startTime;

    const text = (response.content?.[0]?.text) || '';
    const shouldTransfer = text.includes('[TRANSFERIR]');
    const cleanText = text.replace('[TRANSFERIR]', '').trim();

    // Registra métrica
    await recordMetric(conversationId, responseTime, shouldTransfer);

    return { text: cleanText, shouldTransfer };
  } catch (e) {
    console.error('❌ Erro IA:', e.message);
    return { text: null, shouldTransfer: true };
  }
}

// Busca produtos no ERP pra dar contexto à IA
async function getProductContext(message) {
  try {
    // Extrai possíveis termos de busca da mensagem
    const terms = message.toLowerCase();
    const keywords = ['calça', 'blusa', 'vestido', 'short', 'camisa', 'camiseta', 'saia', 'conjunto', 'macacão', 'casaco', 'jaqueta', 'moletom', 'blazer', 'bermuda', 'trico', 'cargo', 'jeans'];
    const found = keywords.filter(k => terms.includes(k));
    if (found.length === 0) return '';

    const products = await erp.searchProducts(found[0]);
    if (products.length === 0) return '';

    const top5 = products.slice(0, 5);
    let ctx = '\n\n[PRODUTOS ENCONTRADOS NO ESTOQUE - use pra responder sobre preço/disponibilidade]:\n';
    top5.forEach(p => {
      ctx += `- ${p.name} | R$ ${parseFloat(p.price).toFixed(2)} | Tam: ${p.size || 'variados'} | Estoque: ${p.total_stock} un.\n`;
    });
    return ctx;
  } catch { return ''; }
}

// Registra métrica da IA
async function recordMetric(conversationId, responseTimeMs, transferred) {
  try {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const existing = await queryOne("SELECT id, messages_by_ai FROM ai_metrics WHERE conversation_id = $1", [conversationId]);
    if (existing) {
      await queryRun(
        "UPDATE ai_metrics SET messages_by_ai = messages_by_ai + 1, transferred = $1, response_time_ms = $2, resolved_by_ai = $3 WHERE conversation_id = $4",
        [transferred, responseTimeMs, !transferred, conversationId]
      );
    } else {
      await queryRun(
        "INSERT INTO ai_metrics (id, conversation_id, messages_by_ai, response_time_ms, transferred, resolved_by_ai) VALUES ($1,$2,1,$3,$4,$5)",
        [id, conversationId, responseTimeMs, transferred, !transferred]
      );
    }
  } catch (e) { console.error('Erro ao registrar métrica IA:', e.message); }
}

// Verifica se o agente de IA está ativo
async function isAgentEnabled() {
  try {
    const agent = await queryOne("SELECT enabled FROM ai_agents WHERE enabled = true LIMIT 1");
    return !!agent;
  } catch { return false; }
}

module.exports = { generateResponse, isAgentEnabled, recordMetric };
