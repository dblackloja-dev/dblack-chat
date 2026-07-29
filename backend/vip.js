// Lista VIP — campanha "Agosto Imbatível 2026"
// Captura inscritos por palavra-chave no WhatsApp, gerencia opt-out e dispara
// o catálogo antecipado via template aprovado da Meta (fora da janela de 24h).
// Roda em paralelo ao atendimento: nunca muda status de conversa nem fila.
const { queryAll, queryOne, queryRun } = require('./database');

let deps = {}; // { wa, broadcast, genId } — injetados pelo server.js
function init(injected) { deps = injected; }

const TAG_VIP = '🔥 VIP';
const TAG_COLOR = '#e11d48';
// Opt-out só por mensagem EXATA (evita marcar saída em "não quero o tamanho M")
const OPT_OUT_WORDS = ['sair', 'parar', 'nao quero', 'nao quero mais'];
const OPT_OUT_CONFIRM = 'Tudo bem! Você saiu da Lista Imbatível. Se mudar de ideia é só mandar IMBATÍVEL de novo. 👍';

// Defaults usados se a chave não existir em chat_settings (o initDB também as cria)
const DEFAULTS = {
  vip_enabled: 'true',
  vip_keywords: 'imbativel,lista imbativel,quero entrar na lista,vip',
  vip_welcome_text: 'Você tá dentro da Lista Imbatível, {nome}! 👑🔥\n\nDia 11/08 você recebe em primeira mão o catálogo do AGOSTO IMBATÍVEL e pode garantir suas peças ANTES da abertura oficial.\n\nFica de olho aqui no WhatsApp!',
  vip_rules_text: '📋 *Como funciona a Lista Imbatível*\n\n1️⃣ Dia 11/08 você recebe aqui o catálogo antecipado do AGOSTO IMBATÍVEL\n2️⃣ Escolhe suas peças e garante ANTES da abertura oficial\n3️⃣ Estoque limitado — quem vê primeiro, compra primeiro 👑\n\nPra sair da lista é só responder SAIR.',
  vip_already_text: 'Você já está na Lista Imbatível! 👑 Dia 11/08 te chamo aqui.',
};

async function getSetting(key) {
  try {
    const row = await queryOne("SELECT value FROM chat_settings WHERE key = $1", [key]);
    if (row && row.value != null && row.value !== '') return row.value;
  } catch {}
  return DEFAULTS[key] ?? null;
}

// minúsculas, sem acentos, espaços normalizados
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Palavra-chave vale dentro de frase, mas só como palavra inteira
// ("vip" casa em "quero ser vip", não em "vipera")
function matchesKeyword(norm, keywordsCsv) {
  return String(keywordsCsv || '').split(',').map(k => normalize(k)).filter(Boolean)
    .some(kw => new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}([^a-z0-9]|$)`).test(norm));
}

// Primeiro nome no {nome}; sem nome, remove a vírgula órfã
function fillName(text, pushName) {
  const nome = String(pushName || '').trim().split(' ')[0];
  return nome ? text.replaceAll('{nome}', nome) : text.replace(/,?\s*\{nome\}/g, '');
}

// Grava a resposta do bot no histórico e avisa o painel (mesmo padrão da saudação;
// NÃO atualiza last_message da conversa pra não interferir na fila)
async function saveBotMessage(conversationId, text) {
  const id = deps.genId();
  await queryRun(
    "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
    [id, conversationId, "D'Black Bot", text]
  );
  if (deps.broadcast) {
    const freshConv = await queryOne("SELECT * FROM conversations WHERE id = $1", [conversationId]);
    deps.broadcast('new_message', {
      conversation: freshConv || { id: conversationId },
      message: { id, conversation_id: conversationId, from_me: true, sender: "D'Black Bot", content: text, timestamp: new Date().toISOString() },
    });
  }
}

async function sendVipText(conv, phone, text) {
  await deps.wa.sendMessage(phone, text, { isBot: true });
  await saveBotMessage(conv.id, text);
}

// Boas-vindas com botão "Como funciona?"; se botão falhar, cai pra texto simples
async function sendWelcome(conv, phone, pushName) {
  const text = fillName(await getSetting('vip_welcome_text'), pushName);
  try {
    await deps.wa.sendButtons(phone, null, text, [{ id: 'vip_regras', text: 'Como funciona? 📋' }], { isBot: true });
  } catch (e) {
    console.error('⚠️ VIP: botões falharam, enviando texto simples:', e.message);
    await deps.wa.sendMessage(phone, text, { isBot: true });
  }
  await saveBotMessage(conv.id, text);
}

async function addVipTag(conversationId) {
  const existing = await queryOne(
    "SELECT id FROM conversation_tags WHERE conversation_id = $1 AND tag = $2", [conversationId, TAG_VIP]);
  if (!existing) {
    await queryRun(
      "INSERT INTO conversation_tags (id, conversation_id, tag, color) VALUES ($1,$2,$3,$4)",
      [deps.genId(), conversationId, TAG_VIP, TAG_COLOR]);
  }
}

// ─── Captura — chamado pelo server.js após salvar a mensagem recebida ───
// Retorna true se o fluxo VIP respondeu esta mensagem (pra Lê não responder junto).
async function handleIncoming(conv, msg) {
  if ((await getSetting('vip_enabled')) !== 'true') return false;
  if (!msg.content || msg.mediaType) return false; // só texto e respostas de botão
  const norm = normalize(msg.content);
  if (!norm) return false;
  const phone = String(msg.phone || '').replace(/\D/g, '');
  if (!phone) return false;

  const sub = await queryOne("SELECT * FROM vip_subscribers WHERE phone = $1", [phone]);

  // Clique no botão "Como funciona? 📋" (o webhook entrega o TÍTULO do botão como texto)
  if (sub && /^como funciona\b/.test(norm) && norm.length <= 25) {
    await sendVipText(conv, msg.phone, await getSetting('vip_rules_text'));
    return true;
  }

  // Opt-out: inscrito ativo pedindo pra sair (mensagem exata)
  if (sub && !sub.opted_out && OPT_OUT_WORDS.includes(norm.replace(/[!.?🙏]+$/g, '').trim())) {
    await queryRun("UPDATE vip_subscribers SET opted_out = true WHERE phone = $1", [phone]);
    await sendVipText(conv, msg.phone, OPT_OUT_CONFIRM);
    console.log(`👋 VIP opt-out: ${phone}`);
    return true;
  }

  // Palavra-chave da campanha
  if (!matchesKeyword(norm, await getSetting('vip_keywords'))) return false;

  if (sub && !sub.opted_out) {
    await sendVipText(conv, msg.phone, await getSetting('vip_already_text'));
    return true;
  }

  if (sub && sub.opted_out) {
    // O próprio cliente pediu pra voltar — reativa
    await queryRun("UPDATE vip_subscribers SET opted_out = false WHERE phone = $1", [phone]);
    await addVipTag(conv.id);
    await sendWelcome(conv, msg.phone, msg.pushName);
    console.log(`👑 VIP reativado: ${phone}`);
    return true;
  }

  // Cadastro novo
  await queryRun(
    "INSERT INTO vip_subscribers (id, phone, name, conversation_id, source) VALUES ($1,$2,$3,$4,'whatsapp') ON CONFLICT (phone) DO NOTHING",
    [deps.genId(), phone, msg.pushName || '', conv.id]);
  await addVipTag(conv.id);
  await sendWelcome(conv, msg.phone, msg.pushName);
  console.log(`👑 VIP novo inscrito: ${phone} (${msg.pushName || 'sem nome'})`);
  return true;
}

// ═══════════════════════════════════════════
// ═══  BROADCAST via template aprovado    ═══
// ═══════════════════════════════════════════
const broadcasts = new Map(); // broadcastId → progresso em memória (o log fica no banco)
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Troca {nome} pelo primeiro nome do inscrito em qualquer string dos components
function personalize(value, name) {
  const first = String(name || '').trim().split(' ')[0] || 'cliente';
  if (typeof value === 'string') return value.replaceAll('{nome}', first);
  if (Array.isArray(value)) return value.map(v => personalize(v, name));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = personalize(v, name);
    return out;
  }
  return value;
}

// Alvos: ativos que ainda não receberam ESTE template (idempotente — rodar 2x não duplica)
async function getTargets(templateName, batchSize = 200, testOnly = false) {
  const limit = Math.max(1, Math.min(parseInt(batchSize) || 200, 10000));
  let targets = await queryAll(
    `SELECT phone, name FROM vip_subscribers
     WHERE opted_out = false
       AND phone NOT IN (SELECT phone FROM vip_broadcast_log WHERE template_name = $1 AND status = 'sent')
     ORDER BY created_at
     LIMIT $2`,
    [templateName, limit]);

  // Modo teste: só números da allowlist ai_test_phones
  if (testOnly) {
    const row = await queryOne("SELECT value FROM chat_settings WHERE key = 'ai_test_phones'");
    const testPhones = String(row?.value || '').split(',').map(p => p.trim().replace(/\D/g, '')).filter(Boolean);
    targets = targets.filter(t => testPhones.some(tp => t.phone.includes(tp) || tp.includes(t.phone.slice(-11))));
  }
  return targets;
}

// Dispara em background (loop sequencial — NUNCA Promise.all) e retorna o id na hora
function startBroadcast(targets, { templateName, languageCode = 'pt_BR', components = [], intervalMs = 1200 }) {
  const broadcastId = deps.genId();
  const interval = Math.max(500, parseInt(intervalMs) || 1200);
  const state = { total: targets.length, sent: 0, failed: 0, done: false, templateName, startedAt: new Date().toISOString() };
  broadcasts.set(broadcastId, state);

  setImmediate(async () => {
    console.log(`📣 Broadcast ${broadcastId} iniciado: ${targets.length} destinatários, template "${templateName}"`);
    for (const t of targets) {
      try {
        const result = await deps.wa.sendTemplate(t.phone, templateName, languageCode, personalize(components, t.name));
        await queryRun(
          "INSERT INTO vip_broadcast_log (id, broadcast_id, phone, template_name, status, wa_message_id) VALUES ($1,$2,$3,$4,'sent',$5)",
          [deps.genId(), broadcastId, t.phone, templateName, result?._waId || null]);
        state.sent++;
      } catch (e) {
        await queryRun(
          "INSERT INTO vip_broadcast_log (id, broadcast_id, phone, template_name, status, error) VALUES ($1,$2,$3,$4,'failed',$5)",
          [deps.genId(), broadcastId, t.phone, templateName, String(e.message).slice(0, 300)]);
        state.failed++;
        // 131050 = usuário pediu pra não receber marketing — respeita e nunca mais envia
        if (e.code === 131050) {
          await queryRun("UPDATE vip_subscribers SET opted_out = true WHERE phone = $1", [t.phone]).catch(() => {});
          console.log(`👋 VIP opt-out automático (131050): ${t.phone}`);
        }
      }
      await sleep(interval);
    }
    state.done = true;
    console.log(`📣 Broadcast ${broadcastId} concluído: ${state.sent} enviados, ${state.failed} falhas`);
  });

  return broadcastId;
}

async function getBroadcastStatus(broadcastId) {
  const rows = await queryAll(
    "SELECT status, COUNT(*) c FROM vip_broadcast_log WHERE broadcast_id = $1 GROUP BY status", [broadcastId]);
  const counts = { sent: 0, failed: 0 };
  rows.forEach(r => { counts[r.status] = parseInt(r.c); });
  const mem = broadcasts.get(broadcastId);
  return {
    broadcastId,
    templateName: mem?.templateName || null,
    sent: counts.sent,
    failed: counts.failed,
    total: mem ? mem.total : counts.sent + counts.failed,
    remaining: mem ? Math.max(0, mem.total - mem.sent - mem.failed) : 0,
    done: mem ? mem.done : true,
    startedAt: mem?.startedAt || null,
  };
}

// Reenvia SÓ as falhas de um broadcast (atualiza as linhas do log em vez de duplicar)
async function retryBroadcast(broadcastId, { languageCode = 'pt_BR', components = [], intervalMs = 1200 } = {}) {
  const failed = await queryAll(
    `SELECT l.id, l.phone, l.template_name, s.name, s.opted_out
     FROM vip_broadcast_log l
     LEFT JOIN vip_subscribers s ON s.phone = l.phone
     WHERE l.broadcast_id = $1 AND l.status = 'failed'`,
    [broadcastId]);
  const targets = failed.filter(f => !f.opted_out);
  if (!targets.length) return { retried: 0 };

  const interval = Math.max(500, parseInt(intervalMs) || 1200);
  const state = { total: targets.length, sent: 0, failed: 0, done: false, templateName: targets[0].template_name, startedAt: new Date().toISOString() };
  broadcasts.set(broadcastId, state);

  setImmediate(async () => {
    console.log(`🔁 Retry do broadcast ${broadcastId}: ${targets.length} falhas`);
    for (const t of targets) {
      try {
        const result = await deps.wa.sendTemplate(t.phone, t.template_name, languageCode, personalize(components, t.name));
        await queryRun("UPDATE vip_broadcast_log SET status = 'sent', error = NULL, wa_message_id = $1 WHERE id = $2",
          [result?._waId || null, t.id]);
        state.sent++;
      } catch (e) {
        await queryRun("UPDATE vip_broadcast_log SET error = $1 WHERE id = $2", [String(e.message).slice(0, 300), t.id]);
        state.failed++;
        if (e.code === 131050) {
          await queryRun("UPDATE vip_subscribers SET opted_out = true WHERE phone = $1", [t.phone]).catch(() => {});
        }
      }
      await sleep(interval);
    }
    state.done = true;
    console.log(`🔁 Retry ${broadcastId} concluído: ${state.sent} reenviados, ${state.failed} falharam de novo`);
  });

  return { retried: targets.length };
}

module.exports = {
  init, handleIncoming,
  getTargets, startBroadcast, getBroadcastStatus, retryBroadcast,
  // expostos pra teste
  _normalize: normalize, _matchesKeyword: matchesKeyword, _fillName: fillName, _personalize: personalize,
};
