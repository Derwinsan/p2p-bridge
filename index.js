const express = require('express');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

// DATOS EXACTOS DEL ANUNCIO DEL PRESIDENTE
const TARGET_ADV_NO = "13788738308616540160"; 
const TARGET_TRADE_TYPE = "SELL"; // Es una venta de USDT

let lastFetch = null;
let liveStatusData = null; 

function log(level, event, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...data }));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function fetchAndIngest() {
  log('INFO', 'polling_started');
  try {
    // Buscamos el anuncio exacto por su advNo
    const payload = { 
      page: 1, 
      rows: 10, 
      asset: 'USDT', 
      fiat: 'USD',
      advNo: TARGET_ADV_NO 
    };
    const headers = { 'Content-Type': 'application/json' };
    
    const data = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: TARGET_TRADE_TYPE })
    });

    log('INFO', 'resultado_busqueda_advNo', { cantidad: data.data ? data.data.length : 0 });

    const djsAd = data.data && data.data.length > 0 ? data.data[0] : null;

    if (djsAd) {
      const rate = parseFloat(djsAd.adv.price);
      const m_total_usd = 100; 
      const opex_periodo_usd = 10.70;
      const itbms_panama_usd = 1.40;
      const ganancia_neta_real = (rate * m_total_usd) - opex_periodo_usd - itbms_panama_usd;

      liveStatusData = {
        nombre: djsAd.advertiser.nickName,
        estado: 'Activo',
        tasa: rate.toString(),
        ganancia_neta_real_usd: ganancia_neta_real.toFixed(2),
        actualizado_al: new Date().toISOString()
      };
      log('INFO', 'live_status_calculated', liveStatusData);
    } else {
      log('WARN', 'ad_not_found', { message: 'No se encontró el advNo especificado. El anuncio puede estar pausado.' });
    }

    lastFetch = new Date().toISOString();
  } catch (error) {
    log('ERROR', 'polling_failed', { error: error.message });
  }
}

app.get('/api/live-status', (req, res) => {
  if (!liveStatusData) return res.status(503).json({ error: 'Datos no disponibles' });
  res.json(liveStatusData);
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  fetchAndIngest();
  setInterval(fetchAndIngest, 5 * 60 * 1000);
});