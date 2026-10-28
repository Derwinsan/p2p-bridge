const express = require('express');
const { randomUUID } = require('crypto');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const WORKER_URL = process.env.WORKER_URL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

let lastFetch = null;

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
    const payload = { page: 1, rows: 100, asset: 'USDT', fiat: 'VES' };
    const headers = { 'Content-Type': 'application/json' };

    const buyData = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'BUY' })
    });

    const sellData = await fetchWithRetry('https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST', headers, body: JSON.stringify({ ...payload, tradeType: 'SELL' })
    });

    const normalize = (data, source) => data.data.map(item => ({
      id: randomUUID(),
      advNo: item.adv.advNo,
      price: parseFloat(item.adv.price).toString(),
      minSingleTransAmount: parseFloat(item.adv.minSingleTransAmount).toString(),
      maxSingleTransAmount: parseFloat(item.adv.maxSingleTransAmount).toString(),
      surplusAmount: parseFloat(item.adv.surplusAmount).toString(),
      payMethodName: item.adv.tradeMethods.map(m => m.payMethodName).join(', '),
      nickName: item.advertiser.nickName,
      source: source
    }));

    const ads = [...normalize(buyData, 'BUY'), ...normalize(sellData, 'SELL')];

    const ingestRes = await fetch(`${WORKER_URL}/internal/ads-ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': BRIDGE_TOKEN },
      body: JSON.stringify({ ads, fetched_at: new Date().toISOString() })
    });

    if (!ingestRes.ok) throw new Error(`Worker HTTP ${ingestRes.status}`);
    const ingestJson = await ingestRes.json();
    log('INFO', 'ingest_success', { inserted: ingestJson.inserted });
    
    lastFetch = new Date().toISOString();
  } catch (error) {
    log('ERROR', 'polling_failed', { error: error.message });
  }
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'UP', uptime: process.uptime(), last_fetch: lastFetch });
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  fetchAndIngest();
  setInterval(fetchAndIngest, 5 * 60 * 1000);
});