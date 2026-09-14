// CLIENTE BLACK — adesão via WhatsApp (pede CPF) + worker que envia as mensagens
// do programa lendo o outbox loyalty_events do banco do ERP.
// O ERP é a fonte da verdade (níveis/cashback rodam em trigger lá); aqui só
// conversamos com o cliente. Padrões copiados do vip.js (Agosto Imbatível).
const { queryOne, queryRun } = require('./database');
const { erpQuery, erpQueryOne } = require('./erp');

let deps = { wa: null, broadcast: null, genId: null };

const TIER_LABEL = { BLACK: 'BLACK', GOLD: 'BLACK GOLD', DIAMOND: 'BLACK DIAMOND' };
const TAG = 'CLIENTE BLACK';
const TAG_COLOR = '#FFD740';

const fmtBRL = (n) => `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const firstName = (s) => String(s || '').trim().split(' ')[0] || '';
const brDate = (iso) => String(iso || '').slice(0, 10).split('-').reverse().join('/');

function normalize(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function matchesKeyword(norm, keywordsCsv) {
  return String(keywordsCsv || '').split(',').map((k) => normalize(k)).filter(Boolean)
    .some((kw) => new RegExp(`(^|[^a-z0-9])${escapeRegex(kw)}([^a-z0-9]|$)`).test(norm));
}

function isValidCPF(cpf) {
  cpf = onlyDigits(cpf);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === parseInt(cpf[9]) && calc(10) === parseInt(cpf[10]);
}
// Convenção do banco do ERP: dígitos SEM o 55
function normPhone(p) {
  let d = onlyDigits(p);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  return d;
}

const DEFAULTS = {
  cb_enabled: 'true',
  cb_keywords: 'cliente black',
  cb_ask_cpf: 'Boa, {nome}! 🖤 Pra ativar seus benefícios *Cliente Black* me manda seu CPF (só números).\n\nCom ele suas compras dão desconto à vista e cashback automático. Seus dados ficam protegidos (LGPD).',
  cb_invalid_cpf: 'Hmm, esse CPF não confere 🤔 Confere os números e manda de novo, por favor.',
  cb_give_up: 'Sem problema! Quando quiser ativar é só mandar *cliente black* de novo. 🖤',
  cb_optout_done: 'Pronto! Você não vai mais receber mensagens do Cliente Black. Pra voltar é só mandar *cliente black*. 🖤',
  cb_cpf_conflict: 'Esse CPF já está cadastrado com outro WhatsApp. Fala com uma das nossas atendentes que a gente resolve rapidinho! 😉',
  cb_template: '', // nome de template UTILITY aprovado p/ fallback fora da janela de 24h (vazio = sem fallback)
};
async function getSetting(key) {
  const row = await queryOne('SELECT value FROM chat_settings WHERE key = $1', [key]).catch(() => null);
  if (row && row.value !== null && row.value !== undefined && row.value !== '') return row.value;
  return DEFAULTS[key] ?? null;
}
const fillName = (text, pushName) => {
  const nome = firstName(pushName);
  return nome ? String(text).replaceAll('{nome}', nome) : String(text).replace(/,?\s*\{nome\}/g, '');
};

// ─── mensagens no histórico do painel (mesmo padrão do vip.js) ───
async function saveBotMessage(conversationId, text) {
  const id = deps.genId();
  await queryRun(
    "INSERT INTO messages (id, conversation_id, from_me, sender, content, ack, timestamp) VALUES ($1,$2,true,$3,$4,1,NOW())",
    [id, conversationId, "D'Black Bot", text]
  );
  if (deps.broadcast) {
    const freshConv = await queryOne('SELECT * FROM conversations WHERE id = $1', [conversationId]);
    deps.broadcast('new_message', {
      conversation: freshConv || { id: conversationId },
      message: { id, conversation_id: conversationId, from_me: true, sender: "D'Black Bot", content: text, timestamp: new Date().toISOString() },
    });
  }
}
async function sendText(conv, phone, text) {
  await deps.wa.sendMessage(phone, text, { isBot: true });
  if (conv) await saveBotMessage(conv.id, text);
}
async function addTag(conversationId) {
  const existing = await queryOne('SELECT id FROM conversation_tags WHERE conversation_id = $1 AND tag = $2', [conversationId, TAG]);
  if (!existing) {
    await queryRun('INSERT INTO conversation_tags (id, conversation_id, tag, color) VALUES ($1,$2,$3,$4)',
      [deps.genId(), conversationId, TAG, TAG_COLOR]);
  }
}

// ─── ERP ───
async function findErpByPhone(phoneRaw) {
  const d = normPhone(phoneRaw);
  if (d.length < 8) return null;
  return erpQueryOne(
    `SELECT * FROM customers
     WHERE regexp_replace(COALESCE(whatsapp,''),'[^0-9]','','g') IN ($1, '55'||$1)
        OR regexp_replace(COALESCE(phone,''),'[^0-9]','','g') IN ($1, '55'||$1)
     ORDER BY created_at LIMIT 1`, [d]);
}
const isEnrolled = (c) => !!c && onlyDigits(c.cpf).length === 11 && !String(c.tags || '').includes('Interno');
async function cfgNum(key) {
  const r = await erpQueryOne('SELECT loyalty_cfg_num($1) v', [key]);
  return Number(r?.v) || 0;
}
async function balanceOf(cid) {
  const r = await erpQueryOne('SELECT loyalty_balance($1) b', [cid]);
  return Number(r?.b) || 0;
}

function progressoText(p) {
  if (!p) return '';
  if (p.next_tier) {
    const s = Number(p.sales_missing || 0), v = Number(p.value_missing || 0);
    return `Faltam ${s} compra${s === 1 ? '' : 's'} ou ${fmtBRL(v)} para ${TIER_LABEL[p.next_tier]}`;
  }
  return 'Você está no nível máximo 👑';
}
function keepText(p) {
  if (!p || p.keep_sales_missing === undefined) return '';
  const s = Number(p.keep_sales_missing || 0), v = Number(p.keep_value_missing || 0);
  if (s === 0 || v === 0) return `você já garantiu seu nível`;
  return `${s} compra${s === 1 ? '' : 's'} ou ${fmtBRL(v)}`;
}

// ─── Adesão: espelho do enrollCustomer do ERP (mesmas travas anti-fraude) ───
async function enroll(phoneRaw, cpf, pushName) {
  const phone = normPhone(phoneRaw);
  const byCpf = await erpQueryOne('SELECT * FROM customers WHERE cpf = $1', [cpf]);
  const byPhone = await findErpByPhone(phoneRaw);
  if (byCpf && byPhone && byCpf.id !== byPhone.id) return { conflict: true };
  if (byCpf && !byPhone && normPhone(byCpf.whatsapp || byCpf.phone) !== phone) return { conflict: true };
  if (byPhone && onlyDigits(byPhone.cpf).length === 11 && onlyDigits(byPhone.cpf) !== cpf) return { conflict: true };

  let cid;
  const name = String(pushName || '').trim();
  if (byCpf || byPhone) {
    cid = (byCpf || byPhone).id;
    await erpQuery(
      `UPDATE customers SET cpf=$1, whatsapp=COALESCE(NULLIF(whatsapp,''),$2),
        name=CASE WHEN $3<>'' AND (name LIKE 'Cliente %' OR name='') THEN $3 ELSE name END,
        lgpd_consent_at=COALESCE(lgpd_consent_at, NOW()), tier_since=COALESCE(tier_since, NOW())
       WHERE id=$4`, [cpf, phone, name, cid]);
  } else {
    cid = require('crypto').randomUUID().split('-')[0] + Date.now().toString(36).slice(-4);
    await erpQuery(
      `INSERT INTO customers (id, name, phone, whatsapp, cpf, tags, lgpd_consent_at, tier, tier_since)
       VALUES ($1,$2,$3,$3,$4,'["Novo"]',NOW(),'BLACK',NOW())`,
      [cid, name || ('Cliente ' + phone.slice(-4)), phone, cpf]);
  }
  await erpQuery('SELECT loyalty_apply_tier($1)', [cid]);
  const fresh = await erpQueryOne('SELECT * FROM customers WHERE id=$1', [cid]);
  // registra o welcome no outbox já marcado como enviado (a resposta sai aqui na conversa)
  await erpQuery(
    `INSERT INTO loyalty_events (id, event_id, event, customer_id, payload, notified_at)
     VALUES (substr(md5(random()::text||clock_timestamp()::text),1,16), 'welcome:'||$1||':welcome', 'welcome', $1, '{}', NOW())
     ON CONFLICT (event_id) DO NOTHING`, [cid]);
  return { customer: fresh };
}

async function summaryText(c) {
  const t = (c.tier || 'BLACK');
  const [desc, cb, bal] = [await cfgNum('discount_' + t), await cfgNum('cashback_' + t), await balanceOf(c.id)];
  const p = (await erpQueryOne('SELECT loyalty_progress($1) p', [c.id]))?.p;
  let txt = `Você já é ${TIER_LABEL[t]}, ${firstName(c.name)}! 🖤\n\n💳 ${desc}% de desconto à vista (PIX/Dinheiro)\n💰 ${cb}% de volta em toda compra\n🪙 Saldo atual: ${fmtBRL(bal)}`;
  const pt = progressoText(p);
  if (pt) txt += `\n\n${pt}`;
  if (c.grace_until) txt += `\n⚠️ Pra manter o nível: ${keepText(p)} até ${brDate(c.grace_until)}`;
  return txt;
}

// ─── Fluxo de conversa (chamado pelo server.js após salvar a mensagem) ───
async function handleIncoming(conv, msg) {
  if ((await getSetting('cb_enabled')) !== 'true') return false;
  if (!msg.content || msg.mediaType) return false;
  const norm = normalize(msg.content);
  const phoneDigits = normPhone(msg.phone);
  if (!phoneDigits) return false;

  // opt-out
  if (norm === 'sair') {
    const c = await findErpByPhone(msg.phone);
    if (c && isEnrolled(c) && Number(c.whatsapp_opt_out) !== 1) {
      await erpQuery('UPDATE customers SET whatsapp_opt_out = 1 WHERE id = $1', [c.id]);
      await queryRun('DELETE FROM cb_signup_state WHERE phone = $1', [phoneDigits]).catch(() => {});
      await sendText(conv, msg.phone, await getSetting('cb_optout_done'));
      return true;
    }
    return false; // sem cadastro, deixa o SAIR para outros fluxos (vip)
  }

  const st = await queryOne('SELECT * FROM cb_signup_state WHERE phone = $1', [phoneDigits]).catch(() => null);

  // aguardando CPF
  if (st && st.state === 'await_cpf') {
    const cpf = onlyDigits(msg.content);
    if (cpf.length === 11) {
      if (!isValidCPF(cpf)) {
        const tries = (st.tries || 0) + 1;
        if (tries >= 3) {
          await queryRun('DELETE FROM cb_signup_state WHERE phone = $1', [phoneDigits]);
          await sendText(conv, msg.phone, await getSetting('cb_give_up'));
        } else {
          await queryRun('UPDATE cb_signup_state SET tries = $1, updated_at = NOW() WHERE phone = $2', [tries, phoneDigits]);
          await sendText(conv, msg.phone, await getSetting('cb_invalid_cpf'));
        }
        return true;
      }
      const r = await enroll(msg.phone, cpf, msg.pushName || conv?.name);
      await queryRun('DELETE FROM cb_signup_state WHERE phone = $1', [phoneDigits]);
      if (r.conflict) { await sendText(conv, msg.phone, await getSetting('cb_cpf_conflict')); return true; }
      const c = r.customer;
      const t = c.tier || 'BLACK';
      const [desc, cb] = [await cfgNum('discount_' + t), await cfgNum('cashback_' + t)];
      let txt = `Bem-vindo(a) ao Cliente Black, ${firstName(c.name)}! 🖤✨\n\n💳 ${desc}% de desconto à vista (PIX/Dinheiro)\n💰 ${cb}% de volta em toda compra — vira saldo pra usar aqui\n\nTudo automático no seu CPF/WhatsApp, nas lojas e aqui no chat.`;
      if (t !== 'BLACK') txt += `\n\n👑 E pelo seu histórico você já entra direto como *${TIER_LABEL[t]}*!`;
      txt += `\n\nPra sair do programa é só responder SAIR.`;
      await sendText(conv, msg.phone, txt);
      if (conv) await addTag(conv.id);
      return true;
    }
    // mensagem sem CPF durante o fluxo: não engole (pode ser pergunta pra atendente/Lê)
    return false;
  }

  // gatilho
  if (matchesKeyword(norm, await getSetting('cb_keywords'))) {
    const c = await findErpByPhone(msg.phone);
    if (c && isEnrolled(c)) {
      if (Number(c.whatsapp_opt_out) === 1) await erpQuery('UPDATE customers SET whatsapp_opt_out = 0 WHERE id = $1', [c.id]);
      await sendText(conv, msg.phone, await summaryText(c));
      if (conv) await addTag(conv.id);
      return true;
    }
    await queryRun(
      `INSERT INTO cb_signup_state (phone, state, tries, updated_at) VALUES ($1,'await_cpf',0,NOW())
       ON CONFLICT (phone) DO UPDATE SET state='await_cpf', tries=0, updated_at=NOW()`, [phoneDigits]);
    await sendText(conv, msg.phone, fillName(await getSetting('cb_ask_cpf'), msg.pushName || conv?.name));
    return true;
  }
  return false;
}

// ─── Worker de notificações: lê o outbox do ERP e envia WhatsApp ───
function renderEvent(ev, payload, nome) {
  const p = payload || {};
  switch (ev) {
    case 'welcome':
      return `Bem-vindo(a) ao Cliente Black, ${nome}! 🖤 Você tem ${p.desconto || ''}% à vista e ${p.cashback || ''}% de volta em toda compra.`;
    case 'sale_receipt': {
      let t = `${nome}, sua compra de ${fmtBRL(p.valor)} gerou ${fmtBRL(p.cashback)} de volta. Saldo Cliente Black: ${fmtBRL(p.saldo)}.`;
      const pt = progressoText(p.progresso);
      if (pt) t += ` ${pt}.`;
      return t;
    }
    case 'tier_up':
      return `Parabéns, ${nome}! 🖤👑 Você agora é *${TIER_LABEL[p.nivel] || p.nivel}*: ${p.desconto}% à vista e ${p.cashback}% de volta a partir de agora.`;
    case 'grace_warning':
      return `${nome}, pra manter seu *${TIER_LABEL[p.nivel] || p.nivel}* faltam ${keepText(p.progresso)} até ${brDate(p.data)}. A gente te espera! 🖤`;
    case 'tier_down': {
      let t = `${nome}, seu nível passou para *${TIER_LABEL[p.nivel] || p.nivel}*.`;
      const pt = progressoText(p.progresso);
      if (pt) t += ` ${pt} — bora recuperar! 🖤`;
      return t;
    }
    case 'expiring':
      return `${nome}, ${fmtBRL(p.valor)} do seu saldo Cliente Black vence em ${p.dias} dia${Number(p.dias) === 1 ? '' : 's'}. Vem usar! 🖤`;
    case 'birthday':
      return `Feliz aniversário, ${nome}! 🎂🖤 Este mês seu cashback Cliente Black é em DOBRO em todas as compras.`;
    default:
      return null; // eventos internos (ex.: balance_shortfall) não vão pro cliente
  }
}

let workerBusy = false;
async function processEvents() {
  if (workerBusy) return;
  workerBusy = true;
  try {
    const events = await erpQuery(`
      SELECT e.id, e.event, e.payload, c.name, c.whatsapp, c.whatsapp_opt_out, c.tags
      FROM loyalty_events e JOIN customers c ON c.id = e.customer_id
      WHERE e.notified_at IS NULL AND e.attempts < 3
      ORDER BY e.created_at ASC LIMIT 10`);
    for (const e of events) {
      const skip = Number(e.whatsapp_opt_out) === 1 || String(e.tags || '').includes('Interno') || !onlyDigits(e.whatsapp);
      let payload = {};
      try { payload = JSON.parse(e.payload || '{}'); } catch {}
      const text = renderEvent(e.event, payload, firstName(e.name) || 'cliente');
      if (skip || !text) {
        await erpQuery(`UPDATE loyalty_events SET notified_at = NOW(), last_error = $2 WHERE id = $1`, [e.id, skip ? 'pulado (opt-out/interno/sem fone)' : 'evento interno']);
        continue;
      }
      const digits = normPhone(e.whatsapp);
      const phone = '55' + digits;
      try {
        await deps.wa.sendMessage(phone, text, { isBot: true });
        await erpQuery(`UPDATE loyalty_events SET notified_at = NOW(), last_error = NULL WHERE id = $1`, [e.id]);
        const conv = await queryOne(`SELECT * FROM conversations WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2) ORDER BY created_at DESC LIMIT 1`, [phone, digits]).catch(() => null);
        if (conv) await saveBotMessage(conv.id, text);
      } catch (err) {
        const msg = String(err?.message || err).slice(0, 280);
        // fora da janela de 24h → tenta template aprovado (se configurado)
        const tpl = await getSetting('cb_template');
        let sent = false;
        if (tpl && /131047|re-?engagement|24 ?h/i.test(msg) && typeof deps.wa.sendTemplate === 'function') {
          try {
            await deps.wa.sendTemplate(phone, tpl, 'pt_BR', [
              { type: 'body', parameters: [{ type: 'text', text: firstName(e.name) || 'cliente' }, { type: 'text', text: text.replace(/\n+/g, ' ').slice(0, 500) }] },
            ]);
            await erpQuery(`UPDATE loyalty_events SET notified_at = NOW(), last_error = 'via template' WHERE id = $1`, [e.id]);
            sent = true;
          } catch (e2) { /* cai no attempts++ */ }
        }
        if (!sent) {
          await erpQuery(`UPDATE loyalty_events SET attempts = attempts + 1, last_error = $2 WHERE id = $1`, [e.id, msg]);
        }
      }
    }
  } catch (e) {
    console.error('🖤 CB worker:', e.message);
  } finally {
    workerBusy = false;
  }
}

async function ensureTables() {
  await queryRun(`CREATE TABLE IF NOT EXISTS cb_signup_state (
    phone TEXT PRIMARY KEY, state TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP DEFAULT NOW()
  )`).catch((e) => console.error('cb_signup_state:', e.message));
}

function init(d) {
  deps = d;
  ensureTables();
  setInterval(processEvents, 45000).unref();
  setTimeout(processEvents, 15000);
  console.log('🖤 Cliente Black: fluxo de adesão + worker de mensagens ativos');
}

module.exports = { init, handleIncoming, processEvents, isValidCPF, renderEvent };
