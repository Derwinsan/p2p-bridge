const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

// DATOS EXACTOS DEL ANUNCIO DEL PRESIDENTE
const TARGET_ADV_NO = "13788738308616540160"; 

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
    // 1. Consultamos el mercado de VENTA (SELL) con monto de 10 (para sortear los grandes)
    const payload = { 
      page: 1, 
      rows: 100, 
      asset: 'USDT', 
      fiat: 'USD',
      transAmount: '10'
    };
    const headers = { 'Content-Type': 'application/json' };
    
    const data = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'SELL' })
    });

    const totalAds = data.data ? data.data.length : 0;
    log('INFO', 'total_ads_escaneados', { cantidad: totalAds });

    // 2. Filtro Local: Buscamos el advNo exacto en la lista
    const djsAd = data.data ? data.data.find(ad => ad.adv.advNo === TARGET_ADV_NO) : null;

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
      log('WARN', 'ad_not_found', { message: 'No se encontró el advNo 13788738308616540160 en la lista' });
      // Log de diagnóstico: ¿Qué anuncios sí vinieron?
      if (data.data && data.data.length > 0) {
        const top5 = data.data.slice(0, 5).map(ad => `${ad.advertiser.nickName} (${ad.adv.advNo})`);
        log('INFO', 'primeros_5_anuncios', { lista: top5 });
      }
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