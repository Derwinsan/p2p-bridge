const cron = require('node-cron');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;
const MY_USER_NO = process.env.MY_USER_NO || '319538093';
const P2P_API_URL = 'https://p2p-api.derwinsan1.workers.dev';

async function obtenerConfig() {
  try {
    const res = await axios.get(`${P2P_API_URL}/config/alertas`, {
      headers: { 'Authorization': `Bearer ${process.env.BRIDGE_TOKEN || ''}` }
    });
    return res.data.data || { activo: 0, precio_min: 0, precio_max: 9999 };
  } catch (e) {
    console.error('[ADS BOT] Error obteniendo config:', e.message);
    return { activo: 0, precio_min: 0, precio_max: 9999 };
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function enviarAnunciosTelegram() {
  const config = await obtenerConfig();
  if (!config.activo) {
    console.log('[ADS BOT] Alertas desactivadas. No se envía nada.');
    return;
  }

  try {
    const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    console.log(`[ADS BOT] Monitoreando Mercantil Panamá entre $${config.precio_min} y $${config.precio_max}...`);
    
    // Parámetros FIJOS (los que ya sabemos que funcionan)
    const res = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        page: 1, rows: 100, payTypes: ["MercantilBankPanama"], countries: ["VE"], publisherType: null, 
        asset: 'USDT', fiat: 'USD', tradeType: 'BUY', transAmount: 10
      },
      { httpsAgent: agent, timeout: 15000 }
    );

    const data = res.data.data;
    if (!data || data.length === 0) {
      console.log('[ADS BOT] Sin anuncios en el mercado.');
      return;
    }

    const miIndex = data.findIndex(a => String(a.advertiser.userNo) === String(MY_USER_NO));
    const miPosicion = miIndex !== -1 ? miIndex + 1 : null;

    // Filtrar por rango de precio configurado
    const dentroDelRango = data.filter(a => {
      const p = parseFloat(a.adv.price);
      return p >= config.precio_min && p <= config.precio_max;
    });

    let mensaje = `🚨 <b>ALERTA P2P (Mercantil Panamá)</b> 🚨\n`;
    mensaje += `📊 Rango: $${config.precio_min} - $${config.precio_max}\n\n`;

    if (dentroDelRango.length === 0) {
      mensaje += `⚠️ Ningún anuncio dentro de tu rango.\n\n`;
    } else {
      mensaje += `📈 <b>Top 7 en tu rango:</b>\n\n`;
      dentroDelRango.slice(0, 7).forEach((a, i) => {
        const precio = parseFloat(a.adv.price).toFixed(3);
        const esMio = String(a.advertiser.userNo) === String(MY_USER_NO);
        const prefijo = esMio ? '👉 <b>MI ANUNCIO</b> 👈' : `<b>${i + 1}.</b>`;
        mensaje += `${prefijo} $${precio} | ${escapeHtml(a.advertiser.nickName)}\n`;
      });
    }

    if (miPosicion) {
      mensaje += `\n📍 <b>Tu anuncio está en la posición #${miPosicion} de ${data.length}</b>\n`;
    } else {
      mensaje += `\n⚠️ Tu anuncio no está en el Top 100.\n`;
    }

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: 'HTML' },
      { timeout: 15000 }
    );
    console.log('[ADS BOT] Alerta enviada según configuración.');
  } catch (error) {
    console.error('[ADS BOT] Error:', error.message);
  }
}

cron.schedule('0 * * * *', () => {
  console.log('[ADS BOT] Ejecutando Cron...');
  enviarAnunciosTelegram();
}, { scheduled: true, timezone: 'America/Caracas' });

module.exports = { enviarAnunciosTelegram };