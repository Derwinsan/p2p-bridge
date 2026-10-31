const express = require('express');
const { randomUUID, createHmac } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;

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
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function getBinanceSignature(query, secret) {
  return createHmac('sha256', secret).update(query).digest('hex');
}

async function fetchMyAdsFromBinance() {
  const serverTime = await fetchWithRetry('https://api.binance.com/api/v3/time', { method: 'GET' });
  const timestamp = serverTime.serverTime;
  const params = { timestamp, recvWindow: 10000 };
  const query = Object.keys(params).map(k => `${k}=${params[k]}`).join('&');
  const signature = getBinanceSignature(query, BINANCE_SECRET_KEY);
  const url = `https://api.binance.com/sapi/v1/c2c/agent/ads/listWithPagination?${query}&signature=${signature}`;

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'X-MBX-APIKEY': BINANCE_API_KEY,
      'clientType': 'WEB',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ page: 1, rows: 20 })
  });

  return res.data || [];
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
    if (!BINANCE_API_KEY || !BINANCE_SECRET_KEY) {
      log('ERROR', 'fleet_status_missing_credentials', { msg: 'Faltan BINANCE_API_KEY o BINANCE_SECRET_KEY' });
      return;
    }

    const myAds = await fetchMyAdsFromBinance();
    const adsMap = {};
    for (const ad of myAds) {
      adsMap[ad.advNo] = ad;
    }

    const currentStatusArray = MY_ADS.map(myAd => {
      const realAd = adsMap[myAd.advNo];
      let currentRate = myAd.defaultRate;
      let status = 'Desconectado / Oculto';

      if (realAd) {
        currentRate = parseFloat(realAd.price);
        // advStatus: 1 = Online, 3 = Offline, 2 = ?
        status = realAd.advStatus === 1 ? 'En lÃ­nea (Real)' : 'Desconectado / Oculto';
      }

      let ganancia = 0;
      if (myAd.fiat === 'USD') {
        ganancia = (currentRate * 100) - 10.70 - 1.40;
      }

      return {
        advNo: myAd.advNo,
        nombre: 'Inversiones-DJS',
        tipo: myAd.type,
        fiat: myAd.fiat,
        banco: myAd.bank,
        tasa: currentRate.toString(),
        estado: status,
        ganancia_estimada_usd: ganancia.toFixed(2)
      };
    });

    liveStatusArray = currentStatusArray;
    log('INFO', 'fleet_status_updated', { total_anuncios: liveStatusArray.length, activos: liveStatusArray.filter(a => a.estado === 'En lÃ­nea (Real)').length });
  } catch (error) {
    log('ERROR', 'polling_fleet_failed', { error: error.message });
  }
}

async function runAll() {
  await fetchAndIngestGlobal();
  await fetchMyFleetStatus();
}

app.get('/', (req, res) => res.status(200).send('P2P Bridge is running perfectly.'));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'UP', uptime: process.uptime(), last_fetch: lastFetch }));
app.get('/api/live-status', (req, res) => {
  if (!liveStatusArray || liveStatusArray.length === 0) return res.status(503).json({ error: 'Datos no disponibles' });
  res.json(liveStatusArray);
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  runAll();
  setInterval(runAll, 5 * 60 * 1000);
});