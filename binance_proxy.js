const axios = require('axios');
const crypto = require('crypto');

// Lista de espejos de Binance (algunos pueden no estar bloqueados)
const BINANCE_HOSTS = [
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com',
  'https://api4.binance.com',
  'https://api.binance.com'
];

// Función para intentar con todos los hosts hasta que uno funcione
async function fetchWithFallback(path, options = {}) {
  let lastError;
  for (const host of BINANCE_HOSTS) {
    try {
      const res = await axios.get(`${host}${path}`, { ...options, timeout: 10000 });
      return res.data;
    } catch (e) {
      lastError = e;
      console.warn(`Falló ${host}${path}: ${e.message}`);
    }
  }
  throw lastError;
}

async function getPrecios() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
  const precios = {};
  await Promise.all(symbols.map(async (sym) => {
    try {
      const data = await fetchWithFallback(`/api/v3/ticker/price?symbol=${sym}`);
      precios[sym] = parseFloat(data.price);
    } catch (e) { console.error(`Error precio ${sym}:`, e.message); }
  }));
  return { precios };
}

async function getKlines(symbol, interval = '1h', limit = 48, startTime = null, endTime = null) {
  try {
    let path = `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    if (startTime) path += `&startTime=${startTime}`;
    if (endTime) path += `&endTime=${endTime}`;
    const data = await fetchWithFallback(path);
    return { klines: data };
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
    const path = `/api/v3/myTrades?${query}&signature=${signature}`;
    
    let lastError;
    for (const host of BINANCE_HOSTS) {
      try {
        const res = await axios.get(`${host}${path}`, { headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000 });
        return res.data;
      } catch (e) {
        lastError = e;
        console.warn(`Falló myTrades en ${host}: ${e.message}`);
      }
    }
    throw lastError;
  } catch (e) {
    console.error(`Error myTrades ${symbol}:`, e.response ? e.response.data : e.message);
    throw e;
  }
}

module.exports = { getPrecios, getKlines, getMyTrades };