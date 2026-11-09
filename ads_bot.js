const cron = require('node-cron');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

// AQUÍ VA SU USERNO DE BINANCE P2P (Lo configuramos en Render luego)
const MY_USER_NO = process.env.MY_USER_NO || '123456789'; 

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
    
    // Buscamos el Top 20 para asegurar que su anuncio esté ahí si está activo
    const res = await axios.post(
      'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search',
      {
        page: 1, rows: 20, payTypes: [], countries: [], publisherType: null, asset: 'USDT', fiat: 'VES', tradeType: 'SELL'
      },
      { httpsAgent: agent, timeout: 15000 }
    );

    const data = res.data.data;
    if (!data || data.length === 0) {
      console.log('[ADS BOT] Sin anuncios en la respuesta.');
      return;
    }

    // Encontrar la posición del usuario (0-indexed)
    const miIndex = data.findIndex(a => a.advertiser.userNo === MY_USER_NO);
    const miPosicion = miIndex !== -1 ? miIndex + 1 : null;

    let mensaje = '🚨 <b>TOP 7 ANUNCIOS P2P (USDT/VES)</b> 🚨\n\n';
    
    // Mostramos solo los primeros 7
    data.slice(0, 7).forEach((a, i) => {
      const precio = parseFloat(a.adv.price).toFixed(2);
      const banco = (a.adv.tradeMethods || []).map(m => m.tradeMethodName).join(', ') || 'N/A';
      const disponible = parseFloat(a.adv.surplusAmount).toFixed(2);
      const nickname = a.advertiser.nickName;
      
      const esMio = a.advertiser.userNo === MY_USER_NO;
      const prefijo = esMio ? '👉 <b>MI ANUNCIO</b> 👈' : `<b>${i + 1}.</b>`;
      
      mensaje += `${prefijo} Precio: <b>${precio} Bs</b> | Disp: ${disponible} USDT\n🏦 Banco: ${escapeHtml(banco)}\n👤 Vendedor: ${escapeHtml(nickname)}\n\n`;
    });

    // Agregar el resumen de su posición
    if (miPosicion) {
      mensaje += `📍 <b>Tu anuncio está en la posición #${miPosicion} de ${data.length}</b>\n`;
      if (miPosicion > 7) {
        mensaje += `<i>(Fuera del Top 7, considera bajar el precio o mejorar el límite)</i>\n`;
      }
    } else {
      mensaje += `⚠️ <b>Tu anuncio no está en el Top 20.</b>\n<i>(Puede que esté pausado o fuera de este rango).</i>\n`;
    }

    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text: mensaje, parse_mode: 'HTML' },
      { timeout: 15000 }
    );
    console.log('[ADS BOT] Anuncios enviados con inteligencia de posición.');
  } catch (error) {
    console.error('[ADS BOT] Error:', error.message);
  }
}

cron.schedule('0 * * * *', () => {
  console.log('[ADS BOT] Ejecutando Cron...');
  enviarAnunciosTelegram();
}, { scheduled: true, timezone: 'America/Caracas' });

module.exports = { enviarAnunciosTelegram };