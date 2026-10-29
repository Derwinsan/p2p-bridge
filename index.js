const express = require('express');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

const MY_ADS = [
  { advNo: "13788738308616540160", type: "Venta", fiat: "USD", bank: "Mony / Mercantil", defaultRate: 1.028 },
  { advNo: "12788743243852333056", type: "Compra", fiat: "USD", bank: "Mony / Mercantil", defaultRate: 0.995 },
  { advNo: "13889651524355346432", type: "Venta", fiat: "USD", bank: "Zinli", defaultRate: 1.015 },
  { advNo: "12846937295282139136", type: "Compra", fiat: "USD", bank: "Global66", defaultRate: 0.965 },
  { advNo: "13846928069702168576", type: "Venta", fiat: "USD", bank: "Global66", defaultRate: 1.040 },
  { advNo: "13845160920031973376", type: "Venta", fiat: "USD", bank: "Wally Tech", defaultRate: 1.032 },
  { advNo: "12825301616433655808", type: "Compra", fiat: "USD", bank: "Wally Tech", defaultRate: 1.000 },
  { advNo: "12809282872302145536", type: "Compra", fiat: "VES", bank: "Mercantil", defaultRate: 990.100 },
  { advNo: "13809282175735218176", type: "Venta", fiat: "VES", bank: "Mercantil", defaultRate: 980.500 },
  { advNo: "12799453012358836224", type: "Compra", fiat: "USD", bank: "Mony / Mercantil", defaultRate: 1.002 },
  { advNo: "12793323393524480000", type: "Compra", fiat: "VES", bank: "Bancamiga", defaultRate: 879.200 },
  { advNo: "13793304353196560384", type: "Venta", fiat: "VES", bank: "Bancamiga", defaultRate: 979.500 }
];

let lastFetch = null;
let liveStatusArray = []; 

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

async function fetchAndIngestGlobal() {
  try {
    const payload = { page: 1, rows: 100, asset: 'USDT', fiat: 'VES' };
    const headers = { 'Content-Type': 'application/json' };
    
    const buyData = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'BUY' })
    });
    const sellData = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'SELL' })
    });

    const normalize = (data, source) => data.data ? data.data.map(item => ({
      id: randomUUID(), advNo: item.adv.advNo, price: parseFloat(item.adv.price).toString(),
      minSingleTransAmount: parseFloat(item.adv.minSingleTransAmount).toString(),
      maxSingleTransAmount: parseFloat(item.adv.maxSingleTransAmount).toString(),
      surplusAmount: parseFloat(item.adv.surplusAmount).toString(),
      payMethodName: item.adv.tradeMethods.map(m => m.tradeMethodName).join(', '),
      nickName: item.advertiser.nickName, source: source
    })) : [];

    const ads = [...normalize(buyData, 'BUY'), ...normalize(sellData, 'SELL')];
    
    if (ads.length > 0) {
      const ingestRes = await fetch(`${WORKER_URL}/internal/ads-ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': BRIDGE_TOKEN },
        body: JSON.stringify({ ads, fetched_at: new Date().toISOString() })
      });
      if (ingestRes.ok) {
        const ingestJson = await ingestRes.json();
        log('INFO', 'ingest_success', { inserted: ingestJson.inserted });
      }
    }
    lastFetch = new Date().toISOString();
  } catch (error) {
    log('ERROR', 'polling_global_failed', { error: error.message });
  }
}

async function fetchMyFleetStatus() {
  try {
    let currentStatusArray = [];
    let allMarketAds = [];
    for (let page = 1; page <= 3; page++) {
      const payload = { page, rows: 100, asset: 'USDT', fiat: 'USD' };
      const headers = { 'Content-Type': 'application/json' };
      const data = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
        method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'SELL' })
      });
      if (data.data && data.data.length > 0) allMarketAds = allMarketAds.concat(data.data);
    }

    for (const myAd of MY_ADS) {
      const found = allMarketAds.find(ad => ad.adv.advNo === myAd.advNo);
      let currentRate = myAd.defaultRate;
      let status = 'Desconectado / Oculto';
      
      if (found) {
        currentRate = parseFloat(found.adv.price);
        status = 'En línea (Real)';
      }

      let ganancia = 0;
      if (myAd.fiat === 'USD') {
        ganancia = (currentRate * 100) - 10.70 - 1.40;
      }

      currentStatusArray.push({
        advNo: myAd.advNo,
        nombre: 'Inversiones-DJS',
        tipo: myAd.type,
        fiat: myAd.fiat,
        banco: myAd.bank,
        tasa: currentRate.toString(),
        estado: status,
        ganancia_estimada_usd: ganancia.toFixed(2)
      });
    }

    liveStatusArray = currentStatusArray;
    log('INFO', 'fleet_status_updated', { total_anuncios: liveStatusArray.length });

  } catch (error) {
    log('ERROR', 'polling_fleet_failed', { error: error.message });
  }
}

async function runAll() {
  await fetchAndIngestGlobal();
  await fetchMyFleetStatus();
}

// --- RUTAS DE SALUD (Para el Monitor de Render) ---
app.get('/', (req, res) => {
  res.status(200).send('P2P Bridge is running perfectly.');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'UP', uptime: process.uptime(), last_fetch: lastFetch });
});

// --- RUTA DE DATOS ---
app.get('/api/live-status', (req, res) => {
  if (!liveStatusArray || liveStatusArray.length === 0) return res.status(503).json({ error: 'Datos no disponibles' });
  res.json(liveStatusArray); 
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  runAll();
  setInterval(runAll, 5 * 60 * 1000);
});