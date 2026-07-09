// Alertas de emergência via ntfy.sh — canal FORA do WhatsApp (que é o que cai)
// Setup: instalar o app "ntfy" no celular (Play Store/App Store) e assinar
// o tópico definido em ALERT_NTFY_TOPIC no .env. Sem custo, sem cadastro.
require('dotenv').config();

const TOPIC = process.env.ALERT_NTFY_TOPIC;

if (!TOPIC) {
  console.log('⚠️ ALERT_NTFY_TOPIC não configurado — alertas de queda do WhatsApp desativados');
}

async function sendAlert(title, message, { priority = 5, tags = ['rotating_light'] } = {}) {
  if (!TOPIC) return false;
  try {
    const res = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: TOPIC, title, message, priority, tags }),
    });
    if (!res.ok) {
      console.error('Erro ao enviar alerta ntfy:', res.status, await res.text().catch(() => ''));
      return false;
    }
    console.log('🔔 Alerta enviado:', title);
    return true;
  } catch (e) {
    console.error('Erro ao enviar alerta:', e.message);
    return false;
  }
}

module.exports = { sendAlert };
