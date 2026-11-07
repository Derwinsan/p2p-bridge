const http = require('http');
require('./ingesta_cloud');
require('./daily_summary');
require('./ads_bot');
const binance = require('./binance_proxy');

// Endpoint Proxy para Binance (evita bloqueo 451)
app.post('/api/binance/proxy', async (req, res) => {
  try {
    const { url, apiKey } = req.body;
    if (!url || !apiKey) {
      return res.status(400).json({ error: 'Faltan url o apiKey' });
    }
    
    // Usamos axios con el proxy CyberYozh (el mismo que ya usamos para klines)
    const axios = require('axios');
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const PROXY_USER = process.env.PROXY_USER;
    const PROXY_PASS = process.env.PROXY_PASS;
    const PROXY_URL = process.env.PROXY_URL;
    const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    const response = await axios.get(url, {
      headers: { 'X-MBX-APIKEY': apiKey },
      httpsAgent: agent,
      timeout: 15000
    });

    res.json(response.data);
  } catch (error) {
    console.error('[BINANCE PROXY] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/health' || url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
  }
  if (url.pathname === '/api/binance/precios') {
    const data = await binance.getPrecios();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }
  if (url.pathname === '/api/binance/klines') {
    const symbol = url.searchParams.get('symbol') || 'BTCUSDT';
    const interval = url.searchParams.get('interval') || '1h';
    const limit = url.searchParams.get('limit') || 48;
    const startTime = url.searchParams.get('startTime');
    const endTime = url.searchParams.get('endTime');
    const data = await binance.getKlines(symbol, interval, limit, startTime, endTime);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(data));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', tasks: ['ingesta', 'telegram_daily', 'ads_hourly'] }));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`[CLEAN BRIDGE] Servidor en linea en el puerto ${PORT}`);
  console.log(`[CLEAN BRIDGE] Tareas activas: Ingesta, Telegram, Anuncios y Binance API.`);
});