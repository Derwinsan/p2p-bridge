const express = require('express');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

let lastFetch = null;
let liveStatusData = null; 

function log(level, event, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...data }));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const start = Date.now();
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      const duration = Date.now() - start;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log('INFO', 'fetch_success', { duration_ms: duration, retry_count: i });
      return await res.json();
    } catch (err) {
      const backoff = (1000 * Math.pow(2, i)) * (0.8 + Math.random() * 0.4);
      log('WARN', 'fetch_retry', { error: err.message, retry_count: i, backoff_ms: backoff });
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}

async function fetchAndIngest() {
  log('INFO', 'polling_started');
  try {
    let allAds = [];
    
    // BARRIDO: Consultamos las primeras 5 páginas (500 anuncios)
    for (let page = 1; page <= 5; page++) {
      // Filtro simple: USD, Monto 10, Banco Mercantil (sin nombres raros)
      const payload = { 
        page: page, 
        rows: 100, 
        asset: 'USDT', 
        fiat: 'USD', 
        transAmount: '10',
        payTypes: ['Mercantil'] 
      };
      const headers = { 'Content-Type': 'application/json' };
      
      const buyData = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'BUY' })
      });

      if (buyData.data && buyData.data.length > 0) {
        allAds = allAds.concat(buyData.data);
      } else {
        break; // Si una página viene vacía, nos detenemos
      }
    }

    log('INFO', 'total_ads_escaneados', { cantidad: allAds.length });

    // Buscar a Inversiones-DJS en los 500 anuncios
    const djsAd = allAds.find(ad => 
      ad.advertiser.nickName.includes('Inversiones') || 
      ad.advertiser.nickName.includes('DJS') ||
      ad.adv.price === '1.028'
    );

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
      log('WARN', 'ad_not_found', { message: 'No se encontró Inversiones-DJS en las 5 páginas' });
    }

    // Ingesta general (Solo de la primera página para no saturar)
    const normalize = (data, source) => data.slice(0, 100).map(item => ({
      id: randomUUID(), advNo: item.adv.advNo, price: parseFloat(item.adv.price).toString(),
      minSingleTransAmount: parseFloat(item.adv.minSingleTransAmount).toString(),
      maxSingleTransAmount: parseFloat(item.adv.maxSingleTransAmount).toString(),
      surplusAmount: parseFloat(item.adv.surplusAmount).toString(),
      payMethodName: item.adv.tradeMethods.map(m => m.tradeMethodName).join(', '),
      nickName: item.advertiser.nickName, source: source
    }));

    const adsToIngest = normalize(allAds, 'BUY');
    
    const ingestRes = await fetch(`${WORKER_URL}/internal/ads-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': BRIDGE_TOKEN },
      body: JSON.stringify({ ads: adsToIngest, fetched_at: new Date().toISOString() })
    });
    
    if (ingestRes.ok) {
      const ingestJson = await ingestRes.json();
      log('INFO', 'ingest_success', { inserted: ingestJson.inserted });
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', uptime: process.uptime(), last_fetch: lastFetch });
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  fetchAndIngest();
  setInterval(fetchAndIngest, 5 * 60 * 1000);
});