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
} else {
  console.warn('[BINANCE_PROXY] ADVERTENCIA: No hay configuracion de proxy.');
}

const apiClient = axios.create({
  baseURL: 'https://api.binance.com',
  timeout: 20000,
  httpsAgent: agent,
  proxy: false
});

async function getPrecios() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  const precios = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await apiClient.get(`/api/v3/ticker/price?symbol=${sym}`);
      precios[sym] = parseFloat(res.data.price);
    } catch (e) { 
      console.error(`Error precio ${sym}:`, e.message); 
    }
  }));
  return { precios };
}

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

async function getMyTrades(symbol, limit = 50, startTime = null) {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_SECRET_KEY || process.env.BINANCE_API_SECRET;
  
  if (!apiKey || !apiSecret) {
    throw new Error(`Faltan credenciales. API_KEY: ${!!apiKey}, SECRET: ${!!apiSecret}`);
  }

  try {
    const timestamp = Date.now() - 1000;
    let query = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}&recvWindow=60000`;
    if (startTime) query += `&startTime=${startTime}`;
    
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const url = `/api/v3/myTrades?${query}&signature=${signature}`;
    
    const res = await apiClient.get(url, { headers: { 'X-MBX-APIKEY': apiKey } });
    return res.data;
  } catch (e) {
    console.error(`Error myTrades ${symbol}:`, e.response ? e.response.data : e.message);
    throw e;
  }
}

module.exports = { getPrecios, getKlines, getMyTrades };