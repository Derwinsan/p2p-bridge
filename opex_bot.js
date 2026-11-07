const cron = require('node-cron');
const axios = require('axios');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function enviarRecordatorio(mensaje) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("[OPEX BOT] Faltan variables de entorno.");
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: mensaje,
      parse_mode: 'HTML'
    });
    console.log("[OPEX BOT] Recordatorio enviado.");
  } catch (e) {
    console.error("[OPEX BOT] Error:", e.message);
  }
}

// 1. Cloudflare: Pago el día 30. Avisar el día 29 a las 9:00 AM
cron.schedule('0 9 29 * *', () => {
  console.log("[OPEX BOT] Ejecutando cron Cloudflare...");
  enviarRecordatorio(`☁️ <b>RECORDATORIO CLOUDFLARE</b>\n\nMañana vence el pago de Cloudflare.\nMonto: <b>$5.00</b>\n\n<i>Asegure los fondos en la tarjeta.</i>`);
}, { scheduled: true, timezone: "America/Caracas" });

// 2. CyberYozh (Proxy): Pago el día 6. Avisar el día 5 a las 9:00 AM
cron.schedule('0 9 5 * *', () => {
  console.log("[OPEX BOT] Ejecutando cron CyberYozh...");
  enviarRecordatorio(`🕵️ <b>RECORDATORIO CYBERYOZH (PROXY)</b>\n\nMañana vence el pago del Proxy.\nMonto: <b>$5.39</b>\n\n<i>Asegure los fondos en la tarjeta.</i>`);
}, { scheduled: true, timezone: "America/Caracas" });

module.exports = { enviarRecordatorio };