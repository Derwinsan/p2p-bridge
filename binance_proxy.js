const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL;

const proxyUrl = `http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_URL}`;
const agent = new HttpsProxyAgent(proxyUrl);

async function getPrecios() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  const precios = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`, { httpsAgent: agent, timeout: 10000 });
      precios[sym] = parseFloat(res.data.price);
    } catch (e) { console.error(`Error precio ${sym}:`, e.message); }
  }));
  return { precios };
}

async function getKlines(symbol, interval = '1h', limit = 48, startTime = null, endTime = null) {
  try {
    let url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;
    
    const res = await axios.get(url, { httpsAgent: agent, timeout: 15000 });
    return { klines: res.data };
  } catch (e) {
    console.error(`Error klines ${symbol}:`, e.message);
    return { klines: [] };
  }
}

module.exports = { getPrecios, getKlines };