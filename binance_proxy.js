const axios = require('axios');
const crypto = require('crypto');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

let agent = null;
if (PROXY_URL && PROXY_USER && PROXY_PASS) {
  let proxyUrlStr = PROXY_URL.trim();
  if (!proxyUrlStr.startsWith('http://') && !proxyUrlStr.startsWith('https://')) {
    proxyUrlStr = 'http://' + proxyUrlStr;
  }
  const proxyUrl = new URL(proxyUrlStr);
  proxyUrl.username = PROXY_USER;
  proxyUrl.password = PROXY_PASS;
  agent = new HttpsProxyAgent(proxyUrl.toString());
  console.log(`[BINANCE_PROXY] Proxy configurado exitosamente en ${proxyUrl.hostname}:${proxyUrl.port}`);
}

const apiClient = axios.create({
  baseURL: 'https://api.binance.com',
  timeout: 20000,
  httpsAgent: agent,
  proxy: false  // 👈 CLAVE: Desactiva el proxy nativo de axios
});

async function getPrecios() { /* ... igual ... */ }
async function getKlines(symbol, interval = '1h', limit = 48, startTime = null, endTime = null) {
  try {
    let url = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    const res = await apiClient.get(url);
    return { klines: res.data };
  } catch (e) {
    console.error(`Error klines ${symbol}:`, e.message);
    return { klines: [] };
  }
}
// ... resto de funciones usando apiClient