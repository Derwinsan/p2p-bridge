const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

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

async function findTargetAd(tradeType) {
  for (let page = 1; page <= 5; page++) {
    const payload = { page, rows: 100, asset: 'USDT', fiat: 'USD' };
    const headers = { 'Content-Type': 'application/json' };
    
    try {
      const data = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType })
      });
      if (data.data && data.data.length > 0) {
        const found = data.data.find(ad => ad.adv.advNo === TARGET_ADV_NO);
        if (found) return found;
      } else {
        break; // no more pages
      }
    } catch (e) {
      log('WARN', 'fetch_page_error', { page, tradeType, error: e.message });
    }
  }
  return null;
}

async function fetchAndIngest() {
  log('INFO', 'polling_started');
  try {
    let ad = await findTargetAd('BUY');
    if (!ad) {
      ad = await findTargetAd('SELL');
    }

    if (ad) {
      const rate = parseFloat(ad.adv.price);
      const m_total_usd = 100; 
      const opex_periodo_usd = 10.70;
      const itbms_panama_usd = 1.40;
      const ganancia_neta_real = (rate * m_total_usd) - opex_periodo_usd - itbms_panama_usd;

      liveStatusData = {
        nombre: ad.advertiser.nickName,
        estado: 'Activo (Real)',
        tasa: rate.toString(),
        ganancia_neta_real_usd: ganancia_neta_real.toFixed(2),
        actualizado_al: new Date().toISOString()
      };
      log('INFO', 'live_status_calculated', liveStatusData);
    } else {
      log('WARN', 'ad_not_found', { message: 'Anuncio oculto por Binance (Restringido). Usando datos de respaldo.' });
      
      // Fallback de Seguridad (Basado en la captura del Presidente)
      const rate = 1.028;
      const m_total_usd = 100; 
      const opex_periodo_usd = 10.70;
      const itbms_panama_usd = 1.40;
      const ganancia_neta_real = (rate * m_total_usd) - opex_periodo_usd - itbms_panama_usd;

      liveStatusData = {
        nombre: 'Inversiones-DJS',
        estado: 'Restringido (API oculta)',
        tasa: rate.toString(),
        ganancia_neta_real_usd: ganancia_neta_real.toFixed(2),
        actualizado_al: new Date().toISOString()
      };
      log('INFO', 'fallback_used', liveStatusData);
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