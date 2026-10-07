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
// split por qualquer whitespace: nome com quebra de linha quebrava o template da Meta (#132018)
const firstName = (s) => String(s || '').trim().split(/\s+/)[0] || '';
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

// Data de nascimento: aceita DD/MM/AAAA, DD/MM/AA ou só DD/MM.
// Salva 'YYYY-MM-DD' (ou 'MM-DD' sem ano) — os dois formatos que o ERP entende.
function parseBirthDate(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[\/\-. ](\d{1,2})(?:[\/\-. ](\d{2,4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y = m[3] ? +m[3] : null;
  if (y !== null && y < 100) y += y > 26 ? 1900 : 2000;
  if (y !== null && (y < 1900 || y > 2020)) return null;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const dd = String(d).padStart(2, '0'), mm = String(mo).padStart(2, '0');
  return y ? `${y}-${mm}-${dd}` : `${mm}-${dd}`;
}

const DEFAULTS = {
  cb_enabled: 'true',
  cb_keywords: 'cliente black',
  cb_ask_cpf: 'Boa, {nome}! 🖤 Pra ativar seus benefícios *Cliente Black* me manda seu CPF (só números).\n\nCom ele suas compras dão desconto à vista e cashback automático. Seus dados ficam protegidos (LGPD).',
  cb_invalid_cpf: 'Hmm, esse CPF não confere 🤔 Confere os números e manda de novo, por favor.',
  cb_give_up: 'Sem problema! Quando quiser ativar é só mandar *cliente black* de novo. 🖤',
  cb_optout_done: 'Pronto! Você não vai mais receber mensagens do Cliente Black. Pra voltar é só mandar *cliente black*. 🖤',
  cb_cpf_conflict: 'Esse CPF já está cadastrado com outro WhatsApp. Fala com uma das nossas atendentes que a gente resolve rapidinho! 😉',
  cb_ask_birth: 'Pra completar seu cadastro: me manda sua data de nascimento (ex: 24/09/1990) — tem mimo de aniversário! 🎁\n\nSe preferir não informar, responda PULAR.',
  cb_birth_ok: 'Anotado, {nome}! 🎁 Seu cadastro Cliente Black está completo.',
  cb_birth_skip: 'Tudo bem! Se mudar de ideia é só mandar *cliente black* de novo. 😉',
  cb_template: '', // nome de template UTILITY aprovado p/ fallback fora da janela de 24h (vazio = sem fallback)
  // Broadcast de cupom de campanha: {nome} {codigo} {pct} {minimo} {periodo} vêm do cupom no ERP
  cb_coupon_message: '🖤 {nome}, chegou um presente EXCLUSIVO pra quem é Cliente Black!\n\nVocê ganhou *{pct}% OFF à vista (PIX ou dinheiro)* em compras acima de {minimo} — vale só {periodo}.\n\n🎟️ Seu cupom (é só seu, 1 uso): *{codigo}*\n\nVale nas lojas físicas e online. Na loja é só falar o código no caixa. Corre! 🏃🖤',
  cb_coupon_template: '', // template MARKETING aprovado ({{1}}=nome, {{2}}=código) p/ quem está fora da janela de 24h
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
// Mesmo número ignorando o nono dígito (31 99554-5210 ≡ 31 9554-5210)
function samePhone(a, b) {
  const canon = (p) => { const d = normPhone(p); return d.length === 11 ? d.slice(0, 2) + d.slice(-8) : d; };
  const ca = canon(a), cb = canon(b);
  return !!ca && ca === cb;
}

async function findErpByPhone(phoneRaw) {
  const d = normPhone(phoneRaw);
  if (d.length < 8) return null;
  // variantes com/sem o nono dígito, com/sem o 55
  const vars = new Set([d]);
  if (d.length === 11) vars.add(d.slice(0, 2) + d.slice(-8));
  if (d.length === 10) vars.add(d.slice(0, 2) + '9' + d.slice(-8));
  const list = [...vars];
  const all = list.concat(list.map(v => '55' + v));
  return erpQueryOne(
    `SELECT * FROM customers
     WHERE regexp_replace(COALESCE(whatsapp,''),'[^0-9]','','g') = ANY($1)
        OR regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = ANY($1)
     ORDER BY created_at LIMIT 1`, [all]);
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
  if (byCpf && !byPhone && !samePhone(byCpf.whatsapp || byCpf.phone, phone)) return { conflict: true };
  if (byPhone && onlyDigits(byPhone.cpf).length === 11 && onlyDigits(byPhone.cpf) !== cpf) return { conflict: true };

  // CPF já cadastrado e o número é da mesma pessoa → já é Cliente Black, não recadastra
  if (byCpf && isEnrolled(byCpf) && (!byPhone || byPhone.id === byCpf.id)) {
    await erpQuery("UPDATE customers SET whatsapp = COALESCE(NULLIF(whatsapp,''), $1) WHERE id = $2", [phone, byCpf.id]).catch(() => {});
    return { customer: byCpf, already: true };
  }

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
      if (r.already) { await sendText(conv, msg.phone, await summaryText(r.customer)); return true; }
      const c = r.customer;
      const t = c.tier || 'BLACK';
      const [desc, cb] = [await cfgNum('discount_' + t), await cfgNum('cashback_' + t)];
      let txt = `Bem-vindo(a) ao Cliente Black, ${firstName(c.name)}! 🖤✨\n\n💳 ${desc}% de desconto à vista (PIX/Dinheiro)\n💰 ${cb}% de volta em toda compra — vira saldo pra usar aqui\n\nTudo automático no seu CPF/WhatsApp, nas lojas e aqui no chat.`;
      if (t !== 'BLACK') txt += `\n\n👑 E pelo seu histórico você já entra direto como *${TIER_LABEL[t]}*!`;
      txt += `\n\nPra sair do programa é só responder SAIR.`;
      await sendText(conv, msg.phone, txt);
      if (conv) await addTag(conv.id);
      if (!String(c.birthdate || '').trim()) {
        await queryRun(
          `INSERT INTO cb_signup_state (phone, state, tries, updated_at) VALUES ($1,'await_birth',0,NOW())
           ON CONFLICT (phone) DO UPDATE SET state='await_birth', tries=0, updated_at=NOW()`, [phoneDigits]);
        await sendText(conv, msg.phone, await getSetting('cb_ask_birth'));
      }
      return true;
    }
    // mensagem sem CPF durante o fluxo: não engole (pode ser pergunta pra atendente/Lê)
    return false;
  }

  // aguardando data de nascimento (etapa final do cadastro)
  if (st && st.state === 'await_birth') {
    if (norm === 'pular') {
      await queryRun('DELETE FROM cb_signup_state WHERE phone = $1', [phoneDigits]);
      await sendText(conv, msg.phone, await getSetting('cb_birth_skip'));
      return true;
    }
    const bd = parseBirthDate(msg.content);
    if (bd) {
      const c = await findErpByPhone(msg.phone);
      if (c) await erpQuery('UPDATE customers SET birthdate = $1 WHERE id = $2', [bd, c.id]);
      await queryRun('DELETE FROM cb_signup_state WHERE phone = $1', [phoneDigits]);
      await sendText(conv, msg.phone, fillName(await getSetting('cb_birth_ok'), msg.pushName || conv?.name));
      return true;
    }
    // não parece data nem PULAR: não engole (pode ser pergunta pra atendente/Lê)
    return false;
  }

  // gatilho
  if (matchesKeyword(norm, await getSetting('cb_keywords'))) {
    await startSignup(conv, msg.phone, msg.pushName || conv?.name);
    return true;
  }
  return false;
}

// Inicia o fluxo de cadastro (usado pelo gatilho por keyword e pelo botão 🖤 do painel).
// Já inscrito: manda o resumo (e pede aniversário se faltar). Não inscrito: pede o CPF.
async function startSignup(conv, phoneRaw, pushName) {
  if ((await getSetting('cb_enabled')) !== 'true') return { error: 'Cliente Black está desativado (cb_enabled)' };
  const phoneDigits = normPhone(phoneRaw);
  if (!phoneDigits) return { error: 'Conversa sem telefone de WhatsApp' };
  const c = await findErpByPhone(phoneRaw);
  if (c && isEnrolled(c)) {
    if (Number(c.whatsapp_opt_out) === 1) await erpQuery('UPDATE customers SET whatsapp_opt_out = 0 WHERE id = $1', [c.id]);
    await sendText(conv, phoneRaw, await summaryText(c));
    if (conv) await addTag(conv.id);
    if (!String(c.birthdate || '').trim()) {
      await queryRun(
        `INSERT INTO cb_signup_state (phone, state, tries, updated_at) VALUES ($1,'await_birth',0,NOW())
         ON CONFLICT (phone) DO UPDATE SET state='await_birth', tries=0, updated_at=NOW()`, [phoneDigits]);
      await sendText(conv, phoneRaw, await getSetting('cb_ask_birth'));
    }
    return { enrolled: true, tier: c.tier || 'BLACK' };
  }
  await queryRun(
    `INSERT INTO cb_signup_state (phone, state, tries, updated_at) VALUES ($1,'await_cpf',0,NOW())
     ON CONFLICT (phone) DO UPDATE SET state='await_cpf', tries=0, updated_at=NOW()`, [phoneDigits]);
  await sendText(conv, phoneRaw, fillName(await getSetting('cb_ask_cpf'), pushName));
  return { started: true };
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
      return `Feliz aniversário, ${nome}! 🎂🖤 Só hoje seu cashback Cliente Black vale em DOBRO em todas as compras.`;
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

// ─── Broadcast do cupom de campanha (lê a tabela coupons do ERP) ───
// Idempotente: só alvos com sent_at IS NULL; marca sent_at após cada envio OK.
// dry-run por padrão — só envia com send:true explícito.
function renderCouponMsg(tpl, r) {
  const dm = (s) => String(s || '').slice(5, 10).split('-').reverse().join('/'); // DD/MM
  const periodo = r.valid_from === r.valid_to ? `HOJE (${dm(r.valid_from)})` : `${dm(r.valid_from)} e ${dm(r.valid_to)}`;
  const nm = firstName(r.name);
  return String(tpl)
    .replaceAll('{nome}', /[a-zà-ú]/i.test(nm) ? nm : 'cliente')
    .replaceAll('{codigo}', r.code)
    .replaceAll('{pct}', String(Number(r.pct) || 0))
    .replaceAll('{minimo}', fmtBRL(r.min_subtotal))
    .replaceAll('{periodo}', periodo);
}

let couponBusy = false;
async function couponBroadcast({ campaign, send = false, limit = 0, message = '', template = '' } = {}) {
  if (!campaign) throw new Error('campaign é obrigatório');
  if (couponBusy) throw new Error('Já existe um broadcast de cupom em andamento');
  const rows = await erpQuery(`
    SELECT cp.code, cp.pct, cp.min_subtotal, cp.valid_from, cp.valid_to, c.name, c.whatsapp
    FROM coupons cp JOIN customers c ON c.id = cp.customer_id
    WHERE cp.campaign = $1 AND cp.sent_at IS NULL AND cp.redeemed_at IS NULL
      AND COALESCE(c.whatsapp,'') <> '' AND COALESCE(c.whatsapp_opt_out,0) = 0 AND c.tags NOT LIKE '%Interno%'
    ORDER BY c.name ${Number(limit) > 0 ? 'LIMIT ' + Number(limit) : ''}`, [campaign]);
  const msgTpl = message || (await getSetting('cb_coupon_message'));
  const sample = rows[0] || { name: 'Cliente', code: 'BLK20-TESTE', pct: 20, min_subtotal: 83.7, valid_from: '2026-10-02', valid_to: '2026-10-03' };

  if (!send) {
    return {
      dryRun: true, targets: rows.length,
      sampleMessage: renderCouponMsg(msgTpl, sample),
      preview: rows.slice(0, 10).map((r) => ({ name: r.name, phone: normPhone(r.whatsapp), code: r.code })),
    };
  }

  couponBusy = true;
  const out = { sent: 0, viaTemplate: 0, failed: 0, errors: [] };
  try {
    for (const r of rows) {
      const digits = normPhone(r.whatsapp);
      if (digits.length < 10) { out.failed++; out.errors.push({ name: r.name, code: r.code, error: 'telefone inválido' }); continue; }
      const phone = '55' + digits;
      const text = renderCouponMsg(msgTpl, r);
      try {
        try {
          await deps.wa.sendMessage(phone, text, { isBot: true });
        } catch (err) {
          // fora da janela de 24h → template MARKETING aprovado ({{1}}=nome, {{2}}=código)
          const m = String(err?.message || err);
          const tpl = template || (await getSetting('cb_coupon_template'));
          if (tpl && /131047|re-?engagement|24 ?h/i.test(m) && typeof deps.wa.sendTemplate === 'function') {
            await deps.wa.sendTemplate(phone, tpl, 'pt_BR', [
              { type: 'body', parameters: [{ type: 'text', text: firstName(r.name) || 'cliente' }, { type: 'text', text: r.code }] },
            ]);
            out.viaTemplate++;
          } else throw err;
        }
        await erpQuery(`UPDATE coupons SET sent_at = NOW() WHERE code = $1`, [r.code]);
        out.sent++;
        const conv = await queryOne(
          `SELECT * FROM conversations WHERE regexp_replace(phone,'[^0-9]','','g') IN ($1,$2) ORDER BY created_at DESC LIMIT 1`,
          [phone, digits]).catch(() => null);
        if (conv) await saveBotMessage(conv.id, text);
      } catch (err) {
        out.failed++;
        out.errors.push({ name: r.name, code: r.code, error: String(err?.message || err).slice(0, 200) });
      }
      await new Promise((rs) => setTimeout(rs, 1200)); // ritmo do vip.js — nunca rajada
    }
  } finally {
    couponBusy = false;
  }
  console.log(`🎟️ Broadcast cupom ${campaign}: ${out.sent} enviados (${out.viaTemplate} via template), ${out.failed} falhas`);
  return out;
}

// ─── Segunda passada: quem está FORA da janela de 24h recebe pelo TEMPLATE ───
// A Meta aceita a mensagem normal e recusa DEPOIS (webhook "Re-engagement"), então a
// 1ª passada marca sent_at mas não entrega pra quem está fora da janela. Aqui:
// alvo = cupom já "enviado" sem 2ª passada; tem msg recebida nas últimas 24h → pula
// (1ª passada entregou); senão → manda o template. Idempotente via template_sent_at.
async function couponTemplateSweep({ campaign, template, send = false, limit = 0 } = {}) {
  if (!campaign) throw new Error('campaign é obrigatório');
  if (!template) throw new Error('template é obrigatório');
  await erpQuery(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS template_sent_at TIMESTAMP`).catch(() => {});
  const rows = await erpQuery(`
    SELECT cp.code, c.name, c.whatsapp
    FROM coupons cp JOIN customers c ON c.id = cp.customer_id
    WHERE cp.campaign = $1 AND cp.sent_at IS NOT NULL AND cp.template_sent_at IS NULL AND cp.redeemed_at IS NULL
      AND COALESCE(c.whatsapp,'') <> '' AND COALESCE(c.whatsapp_opt_out,0) = 0 AND c.tags NOT LIKE '%Interno%'
    ORDER BY c.name ${Number(limit) > 0 ? 'LIMIT ' + Number(limit) : ''}`, [campaign]);

  const out = { targets: rows.length, inWindowSkipped: 0, sent: 0, failed: 0, errors: [], dryRun: !send };
  for (const r of rows) {
    const digits = normPhone(r.whatsapp);
    if (digits.length < 10) { out.failed++; continue; }
    const phone = '55' + digits;
    // mensagem recebida nas últimas 24h = janela aberta = a 1ª passada entregou
    const inWindow = await queryOne(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE regexp_replace(c.phone,'[^0-9]','','g') IN ($1,$2) AND m.from_me = false
         AND m.timestamp > NOW() - interval '24 hours' LIMIT 1`, [phone, digits]).catch(() => null);
    if (inWindow) {
      out.inWindowSkipped++;
      if (send) await erpQuery(`UPDATE coupons SET template_sent_at = NOW() WHERE code = $1`, [r.code]);
      continue;
    }
    if (!send) { out.sent++; continue; } // dry-run: só conta quem receberia
    try {
      await deps.wa.sendTemplate(phone, template, 'pt_BR', [
        { type: 'body', parameters: [{ type: 'text', text: /[a-zà-ú]/i.test(firstName(r.name)) ? firstName(r.name) : 'cliente' }, { type: 'text', text: r.code }] },
      ]);
      await erpQuery(`UPDATE coupons SET template_sent_at = NOW() WHERE code = $1`, [r.code]);
      out.sent++;
    } catch (err) {
      out.failed++;
      out.errors.push({ name: r.name, code: r.code, error: String(err?.message || err).slice(0, 200) });
    }
    await new Promise((rs) => setTimeout(rs, 1200));
  }
  if (send) console.log(`🎟️ Template sweep ${campaign}: ${out.sent} templates, ${out.inWindowSkipped} já na janela, ${out.failed} falhas`);
  return out;
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

module.exports = { init, handleIncoming, processEvents, isValidCPF, renderEvent, parseBirthDate, startSignup, couponBroadcast, couponTemplateSweep };
