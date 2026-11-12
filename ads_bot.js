const cron = require('node-cron');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;
const MY_USER_NO = String(process.env.MY_USER_NO || '319538093');
const P2P_API_URL = 'https://p2p-api.derwinsan1.workers.dev';

async function obtenerConfigs() {
  try {
    const res = await axios.get(`${P2P_API_URL}/config/alertas`, {
      headers: { 'Authorization': `Bearer ${process.env.BRIDGE_TOKEN || ''}` }
    });
    return res.data.data || [];
  } catch (e) {
    console.error('[ADS BOT] Error obteniendo config:', e.message);
    return [];
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getBinancePayMethod(banco) {
  const map = {
    'Wally': 'Wally Tech',
    'MercantilBankPanama': 'MercantilBankPanama',
    'Mercantil': 'Mercantil',
    'Bancamiga': 'Bancamiga',
    'Zinli': 'Zinli',
    'Global66': 'Global66'
  };
  return map[banco] || banco;
}

async function procesarAlerta(config, agent) {
  if (!config.activo) return;

  const isWally = getBinancePayMethod(config.banco).toLowerCase().includes('wally');
  const pagesToFetch = isWally ? 5 : 2; 
  
  const fetchPage = async (page) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const queryPayTypes = isWally ? [] : [getBinancePayMethod(config.banco)];

        const res = await axios.post('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
          page: page, rows: 100,
          payTypes: queryPayTypes,
          countries: ['PA', 'VE'], // <-- RESTRICCIÓN LOCAL PARA VER EL MISMO MERCADO QUE USTED
          publisherType: null,
          asset: 'USDT', fiat: config.fiat || 'USD',
          tradeType: config.trade_type // <-- RESPETA SI ES COMPRA O VENTA
        }, { httpsAgent: agent, timeout: 15000, family: 4 });

        let finalAds = res.data && res.data.data ? res.data.data : [];

        if (isWally) {
          finalAds = finalAds.filter(a => {
            const methods = a.adv.tradeMethods || [];
            return methods.some(m => m.tradeMethodName && String(m.tradeMethodName).toLowerCase().includes('wally'));
          });
        }

        return { data: { data: finalAds } };
      } catch (e) {
        if (attempt === 3) throw e;
        console.log(`[ADS BOT] Fallo de red (Intento ${attempt}/3) en ${config.banco}. Reintentando en 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  };

  try {
    const promises = [];
    for (let i = 1; i <= pagesToFetch; i++) promises.push(fetchPage(i));
    const results = await Promise.all(promises);
    
    let data = [];
    for (const res of results) data = data.concat(res.data.data || []);

    if (data.length === 0) {
      console.log(`[ADS BOT] Sin anuncios en ${config.banco} ${config.trade_type === 'BUY' ? 'COMPRA' : 'VENTA'}.`);
      return;
    }

        const minPrice = parseFloat(config.precio_min) || 0;
    const maxPrice = parseFloat(config.precio_max) || 9999;
    const montoUsuario = parseFloat(config.monto) || 10;
    
    let filtrados = data.filter(a => {
        const price = parseFloat(a.adv.price) || 0;
        const minTrans = parseFloat(a.adv.minSingleTransAmount) || 0;
        const maxTrans = parseFloat(a.adv.maxSingleTransAmount) || 999999;
        
        // Filtramos por precio Y por monto (igual que Binance)
        return price >= minPrice && price <= maxPrice && montoUsuario >= minTrans && montoUsuario <= maxTrans;
    });

    if (filtrados.length === 0) {
        console.log(`[ADS BOT] Sin anuncios en el rango de precio (${config.precio_min} - ${config.precio_max}) o que acepten monto de $${montoUsuario} para ${config.banco}.`);
        return;
    }

    // ORDENAMIENTO INTELIGENTE (BUY: menor a mayor | SELL: mayor a menor)
    if (config.trade_type === 'BUY') {
        filtrados.sort((a, b) => parseFloat(a.adv.price) - parseFloat(b.adv.price));
    } else {
        filtrados.sort((a, b) => parseFloat(b.adv.price) - parseFloat(a.adv.price));
    }

    const top7 = filtrados.slice(0, 7);
    const emoji = config.trade_type === 'BUY' ? '🟢' : '🔵';
    let mensaje = `${emoji} ALERTA P2P (${escapeHtml(config.banco)} - ${config.trade_type === 'BUY' ? 'COMPRA' : 'VENTA'}) ${emoji}\n`;
    mensaje += `📊 Rango: $${config.precio_min} - $${config.precio_max} USD (Monto: $${config.monto})\n\n`;
    mensaje += `📈 Top ${top7.length} en tu rango:\n\n`;

    top7.forEach((ad, i) => {
        const price = parseFloat(ad.adv.price).toFixed(3);
        const merchant = escapeHtml(ad.advertiser.nickName);
        mensaje += `${i + 1}. $${price} | ${merchant}\n`;
    });

        // RASTREADOR DE COMPETENCIA
    const MY_NICKNAME = 'Inversiones-DJS';
    const miPuesto = filtrados.findIndex(a => a.advertiser.nickName.trim() === MY_NICKNAME);

    if (miPuesto !== -1) {
        const miPrecio = parseFloat(filtrados[miPuesto].adv.price).toFixed(3);
        mensaje += `\n📍 Tu anuncio (${MY_NICKNAME}) está en el puesto #${miPuesto + 1} a $${miPrecio}.`;
    } else {
        mensaje += `\n⚠️ Tu anuncio (${MY_NICKNAME}) no está en este rango de precio.`;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: mensaje,
            parse_mode: 'HTML'
        }, { timeout: 15000 });
        console.log(`[ADS BOT] Alerta enviada (${config.banco} ${config.trade_type === 'BUY' ? 'COMPRA' : 'VENTA'}).`);
    } catch (tgError) {
        console.error(`[ADS BOT] Fallo al enviar a Telegram para ${config.banco}:`, tgError.message);
    }

  } catch (error) {
    console.error(`[ADS BOT] Error procesando ${config.banco}:`, error.message);
  }
}

async function enviarAnunciosTelegram() {
  try {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID || !PROXY_USER || !PROXY_PASS || !PROXY_URL) {
      console.error('[ADS BOT] Faltan variables de entorno. No se ejecuta.');
      return;
    }

    const configs = await obtenerConfigs();
    if (configs.length === 0) {
      console.log('[ADS BOT] No hay configuraciones guardadas.');
      return;
    }

    const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    let enviados = 0;
    let fallos = 0;
    let activas = 0;
    
    for (const config of configs) {
      if (config.activo) activas++;
      try {
        await procesarAlerta(config, agent);
        if (config.activo) enviados++;
      } catch (e) {
        console.error(`[ADS BOT] Error en ${config.banco} ${config.trade_type}:`, e.message);
        fallos++;
      }
    }
    
    console.log(`[ADS BOT] Ejecución completada. Alertas procesadas: ${enviados}`);
  } catch (error) {
    console.error('[ADS BOT] Error general:', error.message);
  }
}

cron.schedule('0 6-22/2 * * *', () => {
  console.log('[ADS BOT] Ejecutando Cron...');
  enviarAnunciosTelegram();
}, { scheduled: true, timezone: 'America/Caracas' });

module.exports = { enviarAnunciosTelegram };