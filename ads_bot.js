const cron = require('node-cron');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function enviarAnunciosTelegram() {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID || !PROXY_USER || !PROXY_PASS || !PROXY_URL) {
      console.error('[ADS BOT] Faltan variables de entorno. No se ejecuta.');
      return;
    }

    const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    console.log('[ADS BOT] Buscando anuncios publicos...');
    const res = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        page: 1,
        rows: 5,
        payTypes: [],
        countries: [],
        publisherType: null,
        asset: 'USDT',
        fiat: 'VES',
        tradeType: 'SELL'
      },
      { httpsAgent: agent, timeout: 15000 }
    );

    const data = res.data;
    if (!data.data || data.data.length === 0) {
      console.log('[ADS BOT] Sin anuncios en la respuesta.');
      return;
    }

    let mensaje = '🚨 <b>TOP 5 ANUNCIOS P2P (USDT/VES)</b> 🚨\n\n';
    data.data.forEach((a, i) => {
      const precio = parseFloat(a.adv.price).toFixed(2);
      const banco = (a.adv.tradeMethods || []).map(m => m.tradeMethodName).join(', ') || 'N/A';
      const disponible = parseFloat(a.adv.surplusAmount).toFixed(2);
      mensaje += `<b>${i + 1}.</b> Precio: <b>${precio} Bs</b> | Disp: ${disponible} USDT\n🏦 Banco: ${escapeHtml(banco)}\n\n`;
    });

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: 'HTML' },
      { timeout: 15000 }
    );
    console.log('[ADS BOT] Anuncios enviados.');
  } catch (error) {
    console.error('[ADS BOT] Error:', error.message);
  }
}

cron.schedule('0 * * * *', () => {
  console.log('[ADS BOT] Ejecutando Cron...');
  enviarAnunciosTelegram();
}, { scheduled: true, timezone: 'America/Caracas' });

module.exports = { enviarAnunciosTelegram };