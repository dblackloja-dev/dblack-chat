// Aviso automático do "Número da Sorte" (sorteio do ERP) via template WhatsApp.
// A cada 2 min: entradas do sorteio com telefone e sem notified_at recebem o
// template numero_da_sorte (funciona FORA da janela de 24h — exige aprovação da
// Meta; enquanto não aprovar, o worker espera e tenta de novo).
// Venda do painel Vender já avisa na hora pela legenda do cupom (marca notified_at direto).
const { erpQuery, erpQueryOne } = require('./erp');

const TEMPLATE = process.env.RAFFLE_TEMPLATE || 'numero_da_sorte';

function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (!d) return null;
  if (!d.startsWith('55') && (d.length === 10 || d.length === 11)) d = '55' + d;
  return d.length >= 12 && d.length <= 13 ? d : null;
}

function init({ wa }) {
  let running = false;
  let templateBlockedAt = 0; // template ainda não aprovado → backoff 15 min
  const failures = {};       // n -> tentativas (erro transiente: até 3 retries)

  async function cycle() {
    if (running) return;
    running = true;
    try {
      if (!wa?.connected || typeof wa.sendTemplate !== 'function') return;
      if (templateBlockedAt && Date.now() - templateBlockedAt < 15 * 60 * 1000) return;
      let cfg = null;
      try { cfg = JSON.parse((await erpQueryOne(`SELECT value FROM settings WHERE key = 'raffle'`))?.value || 'null'); } catch {}
      if (!cfg?.active) return;
      const when = cfg.when || 'sábado à noite';

      const rows = await erpQuery(
        `SELECT n, customer, phone FROM raffle_entries
         WHERE notified_at IS NULL AND COALESCE(phone, '') <> ''
         ORDER BY n ASC LIMIT 15`);
      for (const r of rows) {
        const phone = normPhone(r.phone);
        const num = String(r.n).padStart(4, '0');
        if (!phone) {
          await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE n = $1', [r.n]);
          console.log(`🎟️ Número ${num}: telefone inválido (${r.phone}) — sem aviso`);
          continue;
        }
        const nome = (r.customer || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
        try {
          await wa.sendTemplate(phone, TEMPLATE, 'pt_BR', [
            { type: 'body', parameters: [
              { type: 'text', text: nome },
              { type: 'text', text: num },
              { type: 'text', text: when },
            ]},
          ]);
          await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE n = $1', [r.n]);
          console.log(`🎟️ Número da sorte ${num} enviado no WhatsApp de ${nome} (${phone})`);
        } catch (e) {
          const msg = e.message || '';
          if (/does not exist|not approved|132001|132000|132012/i.test(msg)) {
            console.log('🎟️ Template numero_da_sorte ainda não aprovado pela Meta — nova tentativa em 15 min');
            templateBlockedAt = Date.now();
            return;
          }
          failures[r.n] = (failures[r.n] || 0) + 1;
          console.error(`🎟️ Falha ao enviar número ${num} p/ ${phone} (tentativa ${failures[r.n]}):`, msg);
          if (failures[r.n] >= 3) {
            await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE n = $1', [r.n]);
            console.error(`🎟️ Número ${num}: desisti após 3 tentativas — avisar manualmente`);
          }
        }
      }
    } catch (e) {
      console.error('🎟️ raffle-notify:', e.message);
    } finally {
      running = false;
    }
  }

  setInterval(cycle, 2 * 60 * 1000);
  setTimeout(cycle, 20 * 1000);
  console.log('🎟️ Worker do Número da Sorte ativo (template ' + TEMPLATE + ')');
}

module.exports = { init };
