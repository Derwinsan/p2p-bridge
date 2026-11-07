const http = require('http');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Tareas automatizadas
require('./ingesta_cloud');
require('./daily_summary');
require('./ads_bot');
require('./opex_bot');

const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Endpoint Proxy para Binance (evita bloqueo 451)
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

        const response = await axios.get(url, {
          headers: { 'X-MBX-APIKEY': apiKey },
          httpsAgent: agent,
          timeout: 15000
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response.data));
      } catch (error) {
        console.error('[BINANCE PROXY] Error:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message, details: error.response?.data || null }));
      }
    });
    return;
  }

  // Endpoint de health
  if (req.url === '/health' || req.url === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', ts: Date.now(), tasks: ['ingesta', 'telegram_daily', 'ads_hourly', 'opex'] }));
  }

  // Respuesta por defecto
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', tasks: ['ingesta', 'telegram_daily', 'ads_hourly', 'opex'] }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[CLEAN BRIDGE] Servidor en linea en el puerto ${PORT}`);
  console.log(`[CLEAN BRIDGE] Tareas activas: Ingesta P2P, Telegram Diario, Anuncios y OPEX.`);
});
