// Teste do fluxo Cliente Black do chat (WA mockado, bancos reais, dados fictícios + limpeza)
// Rodar de dentro de dblack-chat/backend com DATABASE_URL (chat) e ERP_DATABASE_URL definidos.
const PHONE = '5533999990005';
const DIG = '33999990005';
const CPF = '52998224725';
const CONV = { id: 'testcb-conv-1', name: 'Teste CB', phone: PHONE };

const sent = [];
const cb = require('C:/Users/win/dblack-chat/backend/cliente-black.js');
const { Pool } = require('pg');
const chatDb = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const erpDb = new Pool({ connectionString: process.env.ERP_DATABASE_URL, ssl: { rejectUnauthorized: false } });

let pass = 0, fail = 0;
const check = (n, c, x) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FALHOU ' + n + ' — ' + JSON.stringify(x)); } };

async function cleanup() {
  await erpDb.query(`DELETE FROM loyalty_events WHERE customer_id IN (SELECT id FROM customers WHERE whatsapp=$1 OR cpf=$2)`, [DIG, CPF]);
  await erpDb.query(`DELETE FROM cashback_ledger WHERE customer_id IN (SELECT id FROM customers WHERE whatsapp=$1 OR cpf=$2)`, [DIG, CPF]);
  await erpDb.query(`DELETE FROM tier_history WHERE customer_id IN (SELECT id FROM customers WHERE whatsapp=$1 OR cpf=$2)`, [DIG, CPF]);
  await erpDb.query(`DELETE FROM customers WHERE whatsapp=$1 OR cpf=$2`, [DIG, CPF]);
  await chatDb.query(`DELETE FROM cb_signup_state WHERE phone=$1`, [DIG]);
  await chatDb.query(`DELETE FROM messages WHERE conversation_id=$1`, [CONV.id]);
  await chatDb.query(`DELETE FROM conversation_tags WHERE conversation_id=$1`, [CONV.id]);
}

(async () => {
  cb.init({ wa: { sendMessage: async (phone, text) => { sent.push({ phone, text }); } }, broadcast: null, genId: () => 'tcb' + Math.random().toString(36).slice(2, 10) });
  await new Promise(r => setTimeout(r, 1500)); // ensureTables
  await cleanup();

  const msg = (content) => ({ phone: PHONE, pushName: 'Teste CB', content });

  console.log('1) keyword inicia fluxo e pede CPF');
  let h = await cb.handleIncoming(CONV, msg('oi, quero ser CLIENTE BLACK'));
  check('handled', h === true);
  check('pediu CPF', /CPF/.test(sent.at(-1)?.text||''), sent.at(-1));

  console.log('2) CPF inválido é recusado');
  h = await cb.handleIncoming(CONV, msg('111.111.111-11'));
  check('handled', h === true);
  check('msg de inválido', /não confere/i.test(sent.at(-1)?.text||''), sent.at(-1));

  console.log('3) pergunta no meio do fluxo NÃO é engolida');
  h = await cb.handleIncoming(CONV, msg('pra que voces precisam disso?'));
  check('não tratada (vai p/ atendente)', h === false);

  console.log('4) CPF válido cadastra e dá boas-vindas');
  h = await cb.handleIncoming(CONV, msg('meu cpf é 529.982.247-25'));
  check('handled', h === true);
  check('boas-vindas', /Bem-vindo/.test(sent.at(-1)?.text||''), sent.at(-1));
  const c = (await erpDb.query('SELECT * FROM customers WHERE cpf=$1', [CPF])).rows[0];
  check('cliente no ERP com CPF e LGPD', c && c.whatsapp === DIG && !!c.lgpd_consent_at, c);
  check('estado limpo', (await chatDb.query('SELECT COUNT(*)::int n FROM cb_signup_state WHERE phone=$1', [DIG])).rows[0].n === 0);
  check('tag na conversa', (await chatDb.query('SELECT COUNT(*)::int n FROM conversation_tags WHERE conversation_id=$1', [CONV.id])).rows[0].n === 1);
  check('welcome já marcado enviado', (await erpDb.query(`SELECT COUNT(*)::int n FROM loyalty_events WHERE customer_id=$1 AND event='welcome' AND notified_at IS NOT NULL`, [c.id])).rows[0].n === 1);

  console.log('5) keyword de novo mostra resumo');
  h = await cb.handleIncoming(CONV, msg('cliente black'));
  check('resumo com nível', /Você já é BLACK/.test(sent.at(-1)?.text||''), sent.at(-1));

  console.log('6) SAIR faz opt-out');
  h = await cb.handleIncoming(CONV, msg('SAIR'));
  check('handled', h === true);
  const c2 = (await erpDb.query('SELECT whatsapp_opt_out FROM customers WHERE cpf=$1', [CPF])).rows[0];
  check('opt_out = 1', Number(c2.whatsapp_opt_out) === 1, c2);

  console.log('7) worker: evento não vai para quem deu opt-out');
  await erpDb.query(`INSERT INTO loyalty_events (id, event_id, event, customer_id, payload) VALUES ('testcb-ev1','x:'||$1||':t','tier_up',$1,'{"nivel":"GOLD","desconto":12,"cashback":3}')`, [c.id]);
  const before = sent.length;
  await cb.processEvents();
  const ev = (await erpDb.query(`SELECT * FROM loyalty_events WHERE id='testcb-ev1'`)).rows[0];
  check('marcado pulado sem enviar', sent.length === before && !!ev.notified_at && /pulado/.test(ev.last_error||''), ev);

  console.log('8) worker envia para cliente ativo');
  await erpDb.query('UPDATE customers SET whatsapp_opt_out=0 WHERE id=$1', [c.id]);
  await erpDb.query(`INSERT INTO loyalty_events (id, event_id, event, customer_id, payload) VALUES ('testcb-ev2','x:'||$1||':t2','expiring',$1,'{"valor":12.5,"dias":5}')`, [c.id]);
  await cb.processEvents();
  const last = sent.at(-1);
  check('mensagem de vencimento enviada p/ 55+digits', last && last.phone === '55' + DIG && /vence em 5 dias/.test(last.text), last);
  const ev2 = (await erpDb.query(`SELECT notified_at FROM loyalty_events WHERE id='testcb-ev2'`)).rows[0];
  check('evento marcado enviado', !!ev2.notified_at);

  await cleanup();
  console.log(`\n${pass} ok, ${fail} falhas`);
  await chatDb.end(); await erpDb.end();
  process.exit(fail ? 1 : 0);
})().catch(async e => { console.error('ERRO:', e); try { await cleanup(); } catch {} process.exit(1); });
