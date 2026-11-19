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
      const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
      const precios = {};
      await Promise.all(symbols.map(async (sym) => {
        try {
          const r = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, { httpsAgent: agent, timeout: 10000 });
          precios[sym] = parseFloat(r.data.price);
        } catch (e) { }
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ precios }));
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
        const startTime = Date.now() - (24 * 60 * 60 * 1000); // Forzar ultimas 24h

        for (const par of pares) {
          const trades = await getMyTrades(par, 100, startTime);
          let totalQty = 0;
          let totalCost = 0;
          for (const t of trades) {
            if (t.isBuyer) {
              totalQty += parseFloat(t.qty);
              totalCost += parseFloat(t.quoteQty);
            }
          }
          if (totalQty > 0) {
            results[par] = {
              cantidadCripto: totalQty,
              precioEntradaPromedio: totalCost / totalQty,
              capitalUsado: totalCost
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
      return res.end(JSON.stringify({ klines: r.data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, klines: [] }));
    }
  }

  // 6. Proxy Binance Spot (para saldos)
  if (req.url === '/api/binance/proxy' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { url, apiKey } = JSON.parse(body);
        if (!url || !apiKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Faltan url o apiKey' }));
        }
        const response = await axios.get(url, { headers: { 'X-MBX-APIKEY': apiKey }, httpsAgent: agent, timeout: 15000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.data));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
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
