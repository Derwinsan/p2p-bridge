const axios = require('axios');
const crypto = require('crypto');

// Usamos data-api.binance.vision para datos públicos (sin geo-block)
// Usamos api.binance.com para datos privados (myTrades)
const BASE_PUBLIC = 'https://data-api.binance.vision';
const BASE_PRIVATE = 'https://api.binance.com';

async function getPrecios() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  const precios = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const res = await axios.get(`${BASE_PUBLIC}/api/v3/ticker/price?symbol=${sym}`, { timeout: 10000 });
      precios[sym] = parseFloat(res.data.price);
    } catch (e) { console.error(`Error precio ${sym}:`, e.message); }
  }));
  return { precios };
}

async function getKlines(symbol, interval = '1h', limit = 48, startTime = null, endTime = null) {
  try {
    let url = `${BASE_PUBLIC}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) url += `&startTime=${startTime}`;
    if (endTime) url += `&endTime=${endTime}`;

    const res = await axios.get(url, { timeout: 15000 });
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
    const timestamp = Date.now();
    let query = `symbol=${symbol}&limit=${limit}&timestamp=${timestamp}`;
    if (startTime) query += `&startTime=${startTime}`;
    
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const url = `${BASE_PRIVATE}/api/v3/myTrades?${query}&signature=${signature}`;
    
    const res = await axios.get(url, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 });
    return res.data;
  } catch (e) {
    console.error(`Error myTrades ${symbol}:`, e.response ? e.response.data : e.message);
    throw e;
  }
}

module.exports = { getPrecios, getKlines, getMyTrades };