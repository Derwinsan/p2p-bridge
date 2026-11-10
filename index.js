const http = require('http');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { enviarResumenDiario } = require('./daily_summary');

// Tareas automatizadas
require('./ingesta_cloud');
require('./ads_bot');
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

  // Health check
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', ts: Date.now(), tasks: ['ingesta', 'telegram_daily', 'ads_hourly', 'opex'] }));
  }

  // Endpoint de prueba para el resumen diario
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

  // Precios
  if (req.url === '/api/binance/precios') {
    try {
      const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
      const agent = new HttpsProxyAgent(proxyUrl);
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

  // Klines
  if (req.url.startsWith('/api/binance/klines')) {
    try {
      const urlParams = new URL(req.url, 'http://localhost').searchParams;
      const symbol = urlParams.get('symbol') || 'BTCUSDT';
      const interval = urlParams.get('interval') || '1h';
      const limit = urlParams.get('limit') || 48;
      const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
      const agent = new HttpsProxyAgent(proxyUrl);
      const r = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { httpsAgent: agent, timeout: 15000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ klines: r.data }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, klines: [] }));
    }
  }

  // Proxy Binance Spot
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
        const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
        const agent = new HttpsProxyAgent(proxyUrl);
        const response = await axios.get(url, { headers: { 'X-MBX-APIKEY': apiKey }, httpsAgent: agent, timeout: 15000 });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.data));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message, details: error.response?.data || null }));
      }
    });
    return;
  }

  // Default
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', tasks: ['ingesta', 'telegram_daily', 'ads_hourly', 'opex'] }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[CLEAN BRIDGE] Servidor en linea en el puerto ${PORT}`);
  console.log(`[CLEAN BRIDGE] Tareas activas: Ingesta P2P, Telegram Diario, Anuncios y OPEX.`);
  console.log(`[CLEAN BRIDGE] Endpoints: /precios, /klines, /proxy, /test-daily`);
});
