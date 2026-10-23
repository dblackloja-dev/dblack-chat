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

      // Agrupa por venda: compra de R$ 199,80+ tem 2+ números e recebe UMA mensagem com todos
      const rows = await erpQuery(
        `SELECT sale_id, MIN(customer) AS customer, MIN(phone) AS phone,
                array_agg(n ORDER BY seq) AS nums
         FROM raffle_entries
         WHERE notified_at IS NULL AND COALESCE(phone, '') <> ''
         GROUP BY sale_id ORDER BY MIN(n) ASC LIMIT 15`);
      for (const r of rows) {
        const phone = normPhone(r.phone);
        const nums = (r.nums || []).map(n => String(n).padStart(4, '0')).join(', ');
        if (!phone) {
          await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE sale_id = $1', [r.sale_id]);
          console.log(`🎟️ Número(s) ${nums}: telefone inválido (${r.phone}) — sem aviso`);
          continue;
        }
        const nome = (r.customer || 'Cliente').trim().split(/\s+/)[0] || 'Cliente';
        try {
          await wa.sendTemplate(phone, TEMPLATE, 'pt_BR', [
            { type: 'body', parameters: [
              { type: 'text', text: nome },
              { type: 'text', text: nums },
              { type: 'text', text: when },
            ]},
          ]);
          await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE sale_id = $1', [r.sale_id]);
          console.log(`🎟️ Número(s) da sorte ${nums} enviado(s) no WhatsApp de ${nome} (${phone})`);
        } catch (e) {
          const msg = e.message || '';
          if (/does not exist|not approved|132001|132000|132012/i.test(msg)) {
            console.log('🎟️ Template numero_da_sorte ainda não aprovado pela Meta — nova tentativa em 15 min');
            templateBlockedAt = Date.now();
            return;
          }
          failures[r.sale_id] = (failures[r.sale_id] || 0) + 1;
          console.error(`🎟️ Falha ao enviar número(s) ${nums} p/ ${phone} (tentativa ${failures[r.sale_id]}):`, msg);
          if (failures[r.sale_id] >= 3) {
            await erpQuery('UPDATE raffle_entries SET notified_at = NOW() WHERE sale_id = $1', [r.sale_id]);
            console.error(`🎟️ Número(s) ${nums}: desisti após 3 tentativas — avisar manualmente`);
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
