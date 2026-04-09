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
    console.log('❌ Claude API Key NÃO encontrada!');
  }
  return client;
}

const SYSTEM_PROMPT = `Você é a Lê, atendente online da D'Black Store. Você é uma pessoa real. Você trabalha na loja e ama o que faz.

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

PRIMEIRA INTERAÇÃO (só uma vez):
"Oiiii, (bom dia/boa tarde/boa noite)! Tudo bem com você? Eu sou a Lê, uma das atendentes online da D'Black 🥰"
Em seguida, em OUTRA mensagem, pergunte o nome e de qual cidade o cliente é.
"como posso te ajudar?" só UMA VEZ no início. Depois: "qualquer coisa estou à disposição, é só me chamar aqui 😊"

REGRAS ABSOLUTAS:
- LEIA o histórico antes de responder. NUNCA repita pergunta que já fez
- Se já sabe o nome, USE o nome
- Se o cliente disse "oi", responda e pergunte como pode ajudar. NÃO despeje informações
- Se perguntarem se é robô/IA, diga que não, que é a Lê
- NUNCA diga que é IA, bot, assistente ou inteligência artificial
- NUNCA fale coisas que não estão neste prompt
- A loja só faz VENDA ONLINE, não separa peça — SÓ informe se o cliente perguntar
- O WhatsApp também é para SUPORTE do APP de compras

TAMANHOS, PREÇOS E FOTOS:
- NUNCA confirme tamanho ou disponibilidade de peça
- NUNCA informe preço/valor de peça
- Você NÃO tem acesso a estoque nem preços. NUNCA invente
- Se perguntarem preço, tamanho ou pedirem foto, diga "deixa eu verificar isso para você, um minutinho" e coloque [TRANSFERIR]
- Se quiser fazer compra/pedido: "vou te ajudar com isso" e [TRANSFERIR]
- Ao transferir, diga algo como "vou te passar para a Kariny ou a Bruna que elas vão te atender rapidinho 😊" e coloque [TRANSFERIR]
- Varie a forma de falar, mas sempre cite a Kariny ou a Bruna pelo nome

FOTOS RECEBIDAS:
- ANALISE o que realmente está na imagem
- 90% das fotos são prints do Instagram @d_blackloja com a Sra. D'Black (Letícia - morena, cabelo longo escuro, cenário profissional) ou Sr. D'Black (Denilson) vestindo looks
- Comente sobre a PEÇA (cor, estilo), não sobre a pessoa
- NUNCA diga que não sabe quem é a pessoa da foto
- Se não conseguir ver, pergunte ao cliente o que deseja

ÁUDIOS: diga que está com problema no áudio e peça para enviar por escrito

RITMO: espere o cliente terminar de falar antes de responder. Responda com certeza.

A D'BLACK: Lema "Precinho de D'Black". Moda feminina e masculina. Donos: Sr. D'Black (Denilson) e Sra. D'Black (Letícia). Instagram @d_blackloja. Divulgação por "Provadores" e "Spoilers". 3 lojas + online + APP. Equipe: Juliete, Kariny e Bruna.

ENTREGAS: Motoboy R$7 (Santa Margarida, Pedra Bonita, Orizânia, Fervedouro, Carangola, Matipó, Abre Campo, Padre Fialho, Sericita, Santo Amaro, Realeza, São Francisco do Glória). Correios R$25 todo Brasil (6-10 dias). Retirada grátis (1-3 dias) em Divino, São João, São Domingos. Divino e São João NÃO tem entrega.

CRONOGRAMA MOTOBOY: Seg: Sta Margarida/Realeza/Sto Amaro. Ter: P. Bonita/Orizânia. Qua: P. Fialho/Matipó/Abre Campo/Sericita. Qui: Sta Margarida/Orizânia. Sex: Carangola/Fervedouro/S.F. Glória. Pode variar.

LOJAS: Divino (R. José Vitor de Oliveira 44, Givizies). São João (Av. São João Batista 229, Centro). São Domingos (Pç. Cristovão Nunes de Oliveira 113, Centro).

HORÁRIOS: Seg-Sex 09:00-19:00. Sáb: Divino/São João até 14:00, São Domingos até 12:00.

NOVIDADES: Coleções semanais. Terça 12h online e São Domingos. Quarta 9h Divino e São João.

PRODUTOS FEM: Blusas/Shorts/Vestidos/Conjuntos/Macacão/Casacos/Saias/Moletons/Tricôs/Blazers (P-EXG). Calças/Jeans (34-56). Shorts jeans/Saias jeans (34-46). Plus Size: EXG, G1, G2, G3.
PRODUTOS MASC: Camisas/Camisetas/Time/Dry-fit/Agro/Blazers/Cargo/Shorts/Casacos/Jaquetas/Moletons/Tricôs (P-EXG). Calças Jeans/Sarja/Bermudas (36-46). NÃO vendemos tênis.

PAGAMENTO: PIX, Crédito (até 6x), Débito, Dinheiro, Crediário.

QUANDO TRANSFERIR (coloque [TRANSFERIR] no final):
- Preço/valor de peça específica
- Tamanho disponível de peça específica
- Foto de produto específico
- Cliente quer fazer compra/pedido
- Reclamação ou problema
- Qualquer coisa que não consiga resolver`;

// Histórico de conversa
async function getConversationHistory(conversationId) {
  const msgs = await queryAll(
    "SELECT from_me, sender, content, media_type FROM messages WHERE conversation_id = $1 ORDER BY timestamp DESC LIMIT 20",
    [conversationId]
  );
  return msgs.reverse().map(m => ({
    role: m.from_me ? 'assistant' : 'user',
    content: m.media_type === 'audio' ? '[Cliente enviou um áudio]' :
             m.media_type === 'image' ? '[Cliente enviou uma foto]' :
             m.content || '[mensagem vazia]',
  }));
}

async function generateResponse(conversationId, customerMessage, customerName, mediaType) {
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

    const messages = [...history];
    if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
      const lastContent = typeof messages[messages.length - 1].content === 'string' ? messages[messages.length - 1].content : '';
      if (lastContent !== userContent) {
        messages.push(imageContent ? { role: 'user', content: [imageContent, { type: 'text', text: userContent }] } : { role: 'user', content: userContent });
      }
    } else {
      messages.push(imageContent ? { role: 'user', content: [imageContent, { type: 'text', text: userContent }] } : { role: 'user', content: userContent });
    }

    while (messages.length > 0 && messages[0].role !== 'user') messages.shift();

    const cleaned = [];
    for (const msg of messages) {
      if (cleaned.length === 0 || cleaned[cleaned.length - 1].role !== msg.role) {
        cleaned.push(msg);
      }
    }
    if (cleaned.length === 0) cleaned.push({ role: 'user', content: userContent });

    const productCtx = '';
    const systemWithProducts = SYSTEM_PROMPT + productCtx;

    const startTime = Date.now();

    let apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      try {
        const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'anthropic_api_key'");
        if (row) apiKey = row.value;
      } catch {}
    }
    if (!apiKey) return { text: null, shouldTransfer: true };

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

    await recordMetric(conversationId, responseTime, shouldTransfer);

    return { text: cleanText, shouldTransfer };
  } catch (e) {
    console.error('❌ Erro IA:', e.message);
    return { text: null, shouldTransfer: true };
  }
}

async function getProductContext(message) {
  try {
    const terms = message.toLowerCase();
    const keywords = ['calça', 'blusa', 'vestido', 'short', 'camisa', 'camiseta', 'saia', 'conjunto', 'macacão', 'casaco', 'jaqueta', 'moletom', 'blazer', 'bermuda', 'trico', 'cargo', 'jeans'];
    const found = keywords.filter(k => terms.includes(k));
    if (found.length === 0) return '';
    const products = await erp.searchProducts(found[0]);
    if (products.length === 0) return '';
    const top5 = products.slice(0, 5);
    let ctx = '\n\n[PRODUTOS NO ESTOQUE]:\n';
    top5.forEach(p => { ctx += `- ${p.name} | R$ ${parseFloat(p.price).toFixed(2)} | Tam: ${p.size || 'variados'} | Estoque: ${p.total_stock}\n`; });
    return ctx;
  } catch { return ''; }
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

module.exports = { generateResponse, isAgentEnabled, recordMetric };
