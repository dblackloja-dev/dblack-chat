// Teste da captura VIP com banco e WhatsApp simulados (não toca em produção).
// Roda: node _test-vip.js  — sai com código 1 se algum critério falhar.
const path = require('path');

// ── Banco fake: intercepta o require('./database') do vip.js ──
const store = {
  settings: new Map(),
  subs: new Map(),      // phone → row
  tags: [],             // {conversation_id, tag}
  msgs: [],             // mensagens de bot gravadas
};
const fakeDb = {
  queryOne: async (sql, params = []) => {
    if (sql.includes('FROM chat_settings')) {
      const v = store.settings.get(params[0]);
      return v === undefined ? null : { value: v };
    }
    if (sql.includes('FROM vip_subscribers')) return store.subs.get(params[0]) || null;
    if (sql.includes('FROM conversation_tags')) {
      return store.tags.find(t => t.conversation_id === params[0] && t.tag === params[1]) || null;
    }
    if (sql.includes('FROM conversations')) return { id: params[0], status: 'aguardando' };
    return null;
  },
  queryRun: async (sql, params = []) => {
    if (sql.includes('INSERT INTO vip_subscribers')) {
      if (store.subs.has(params[1])) return { rowCount: 0 }; // ON CONFLICT DO NOTHING
      store.subs.set(params[1], { id: params[0], phone: params[1], name: params[2], conversation_id: params[3], opted_out: false });
      return { rowCount: 1 };
    }
    if (sql.includes('SET opted_out = true')) {
      const s = store.subs.get(params[0]); if (s) s.opted_out = true;
      return { rowCount: s ? 1 : 0 };
    }
    if (sql.includes('SET opted_out = false')) {
      const s = store.subs.get(params[0]); if (s) s.opted_out = false;
      return { rowCount: s ? 1 : 0 };
    }
    if (sql.includes('INSERT INTO conversation_tags')) {
      store.tags.push({ conversation_id: params[1], tag: params[2] });
      return { rowCount: 1 };
    }
    if (sql.includes('INSERT INTO messages')) {
      store.msgs.push({ conversation_id: params[1], content: params[3] });
      return { rowCount: 1 };
    }
    return { rowCount: 0 };
  },
  queryAll: async () => [],
  initDB: async () => {},
  pool: {},
};
const dbPath = require.resolve('./database');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakeDb };

const vip = require('./vip');

// ── WhatsApp fake ──
const sent = []; // {type, phone, text}
const fakeWa = {
  sendMessage: async (phone, text) => { sent.push({ type: 'text', phone, text }); return { _waId: 'wamid.fake' }; },
  sendButtons: async (phone, title, body, buttons) => { sent.push({ type: 'buttons', phone, text: body, buttons }); return { _waId: 'wamid.fake' }; },
  sendTemplate: async () => ({ _waId: 'wamid.fake' }),
};
let seq = 0;
vip.init({ wa: fakeWa, broadcast: null, genId: () => 'id' + (++seq) });

// ── Cenários ──
let failures = 0;
const check = (label, cond) => {
  console.log((cond ? '✅' : '❌') + ' ' + label);
  if (!cond) failures++;
};
const msg = (phone, content, pushName = 'Cliente Teste') => ({ phone, content, pushName, mediaType: null });
const conv = (id) => ({ id, status: 'aguardando' });

(async () => {
  // helpers puros
  check('normalize remove acento/caixa', vip._normalize('IMBATÍVEL!') === 'imbativel!');
  check('keyword dentro de frase', vip._matchesKeyword('quero entrar na lista imbativel', 'imbativel,vip'));
  check('keyword é palavra inteira (vipera ≠ vip)', !vip._matchesKeyword('cuidado com a vipera', 'vip'));
  check('personalize troca {nome} em components', JSON.stringify(vip._personalize([{ type: 'body', parameters: [{ type: 'text', text: '{nome}' }] }], 'Maria Silva')).includes('Maria'));
  check('fillName sem nome não deixa vírgula órfã', vip._fillName('Oi, {nome}!', '') === 'Oi!');

  // 1. Número novo manda palavra-chave → cadastro + tag + boas-vindas com botão
  let r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'IMBATÍVEL!!!'));
  check('captura: retorna true', r === true);
  check('captura: inscrito criado', store.subs.has('5531999990001'));
  check('captura: tag 🔥 VIP na conversa', store.tags.some(t => t.conversation_id === 'c1' && t.tag === '🔥 VIP'));
  check('captura: boas-vindas com botão', sent.at(-1)?.type === 'buttons' && sent.at(-1).buttons[0].id === 'vip_regras');
  check('captura: {nome} preenchido', sent.at(-1).text.includes('Cliente'));
  check('captura: mensagem do bot salva no histórico', store.msgs.some(m => m.conversation_id === 'c1'));

  // 2. Mesmo número de novo → "já está na lista", sem duplicar
  const before = store.subs.size;
  r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'imbativel'));
  check('repetido: retorna true', r === true);
  check('repetido: sem duplicata', store.subs.size === before);
  check('repetido: texto de já inscrito', sent.at(-1).text.includes('já está na Lista'));

  // 3. Frase com a keyword composta
  r = await vip.handleIncoming(conv('c2'), msg('5531999990002', 'Oi! Quero entrar na lista, pode ser?'));
  check('frase composta captura', r === true && store.subs.has('5531999990002'));

  // 4. Mensagem normal → intacto
  r = await vip.handleIncoming(conv('c3'), msg('5531999990003', 'oi, tem vestido tamanho M?'));
  check('mensagem normal: não captura', r === false && !store.subs.has('5531999990003'));

  // 5. Botão "Como funciona?" (webhook entrega o título como texto)
  r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'Como funciona? 📋'));
  check('botão regras: responde regras', r === true && sent.at(-1).text.includes('Como funciona a Lista'));

  // 5b. Inscrito perguntando "como funciona a troca?" NÃO dispara regras
  r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'como funciona a troca de peças compradas?'));
  check('pergunta longa de troca não dispara regras', r === false);

  // 6. Opt-out por mensagem exata
  r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'SAIR'));
  check('opt-out: marcado', r === true && store.subs.get('5531999990001').opted_out === true);

  // 6b. "não quero o tamanho M" NÃO marca opt-out
  store.subs.get('5531999990002').opted_out = false;
  r = await vip.handleIncoming(conv('c2'), msg('5531999990002', 'não quero o tamanho M'));
  check('frase com "não quero" não marca opt-out', store.subs.get('5531999990002').opted_out === false);

  // 7. Opted-out manda keyword de novo → reativa
  r = await vip.handleIncoming(conv('c1'), msg('5531999990001', 'quero ser VIP'));
  check('reativação: opted_out volta a false', r === true && store.subs.get('5531999990001').opted_out === false);

  // 8. vip_enabled = false → nada acontece
  store.settings.set('vip_enabled', 'false');
  r = await vip.handleIncoming(conv('c4'), msg('5531999990004', 'IMBATIVEL'));
  check('vip_enabled=false desliga tudo', r === false && !store.subs.has('5531999990004'));
  store.settings.delete('vip_enabled');

  console.log(failures === 0 ? '\n🎉 Todos os critérios passaram' : `\n💥 ${failures} falha(s)`);
  process.exit(failures === 0 ? 0 : 1);
})();
