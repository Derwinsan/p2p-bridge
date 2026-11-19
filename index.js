const { getPrecios, getKlines, getMyTrades } = require('./binance_proxy');
const http = require('http');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { enviarResumenDiario } = require('./daily_summary');
const { enviarAnunciosTelegram } = require('./ads_bot');

// Tareas automatizadas
require('./ingesta_cloud');
require('./opex_bot');

const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Health check
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
  }

  // 2. Test Bot de Anuncios
  if (req.url === '/test-ads' && req.method === 'GET') {
    try {
      await enviarAnunciosTelegram();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', message: 'ADS BOT ejecutado manualmente' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // 3. Test Resumen Diario
  if (req.url === '/test-daily' && req.method === 'GET') {
    try {
      await enviarResumenDiario();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', message: 'Resumen diario ejecutado' }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // 4. Precios (Binance Spot)
  if (req.url === '/api/binance/precios') {
    try {
      const result = await getPrecios();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  // 5. Klines
      // NUEVO: Endpoint de Sincronización con el Worker
  if (req.url === '/api/sync' && req.method === 'POST') {
    (async () => {
      try {
        const pares = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
        const results = {};
        const startTime = null;

        for (const par of pares) {
          const trades = await getMyTrades(par, 100, startTime);
          const compras = trades
            .filter(t => t && t.isBuyer)
            .sort((a, b) => (b.time || 0) - (a.time || 0))
            .slice(0, 2);

          let buyQty = 0;
          let buyCost = 0;
          for (const t of compras) {
            buyQty += parseFloat(t.qty) || 0;
            buyCost += parseFloat(t.quoteQty) || 0;
          }
          if (buyQty > 0) {
            results[par] = {
              cantidadCripto: buyQty,
              precioEntradaPromedio: buyCost / buyQty,
              capitalUsado: buyCost
            };
          }
        }

        const workerToken = process.env.GRID_BOT_TOKEN || "gbp_k9X7mP2vQ8wR4nT6yU1iO5aZ3sD0fG7hJ2kL9mN4bV6cX8";
        await axios.post('https://grid-bot-api.derwinsan1.workers.dev/api/dca/sync', results, {
          headers: { 'Authorization': `Bearer ${workerToken}` }
        });
        res.end(JSON.stringify({ ok: true, synced: Object.keys(results), results }));
      } catch (e) {
        console.error("Error en sync:", e.message);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }
if (req.url.startsWith('/api/binance/klines')) {
    try {
      const urlParams = new URL(req.url, 'http://localhost').searchParams;
      const symbol = urlParams.get('symbol') || 'BTCUSDT';
      const interval = urlParams.get('interval') || '1h';
      const limit = urlParams.get('limit') || 48;
        const r = await getKlines(symbol, interval, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ klines: r.klines }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, klines: [] }));
    }
  }

  // 6. Proxy Binance Spot y Simple Earn (reenvio firmado)
  if (req.url === '/api/binance/proxy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        if (!data.url || !data.url.startsWith('https://api.binance.com/')) {
          if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'URL de Binance invalida o faltante' }));
          }
          return;
        }

        const headers = {};
        if (data.apiKey) {
          headers['X-MBX-APIKEY'] = data.apiKey;
        }

        const proxyUrl = process.env.BINANCE_PROXY_URL || "http://h8sU6CY4mnWrK8y:QyNuot5TdcGVXBW@51.146.17.165:46502";
        let bResStatus = 502;
        let rawText = "";

        if (proxyUrl) {
          const { HttpsProxyAgent } = await import("https-proxy-agent");
          const axiosMod = (await import("axios")).default;
          const agent = new HttpsProxyAgent(proxyUrl);
          const axRes = await axiosMod({
            method: "GET",
            url: data.url,
            headers,
            httpsAgent: agent,
            httpAgent: agent,
            proxy: false,
            validateStatus: () => true,
            timeout: 15000
          });
          bResStatus = axRes.status;
          rawText = typeof axRes.data === "string" ? axRes.data : JSON.stringify(axRes.data);
        } else {
          const bRes = await fetch(data.url, { headers });
          bResStatus = bRes.status;
          rawText = await bRes.text();
        }
        if (!res.headersSent) {
          res.writeHead(bResStatus, { 'Content-Type': 'application/json' });
          res.end(rawText);
        }
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    });
    return;
  }

  // 7. Default
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', tasks: ['ingesta', 'telegram_daily', 'ads_hourly', 'opex'] }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[CLEAN BRIDGE] Servidor en linea en el puerto ${PORT}`);
  console.log(`[CLEAN BRIDGE] Endpoints: /precios, /klines, /proxy, /test-ads, /test-daily`);
});

