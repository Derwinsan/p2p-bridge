const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL || 'gate.nodemaven.com:8080';

function getSignature(queryString) {
    return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function test() {
    console.log("=== 1. PROBANDO CONEXION DIRECTA (SIN PROXY) ===");
    try {
        const res = await axios.get('https://api.binance.com/api/v3/time', { timeout: 5000 });
        console.log(`✅ Directa OK. ServerTime: ${res.data.serverTime}`);
    } catch (err) {
        console.log(`❌ Error directo (Bloqueo esperado): ${err.response ? err.response.status : err.message}`);
    }

    console.log("\n=== 2. PROBANDO CONEXION CON PROXY (ESPAÑA) ===");
    const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_URL}`;
    const agent = new HttpsProxyAgent(proxyUrl);

    try {
        const res = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent, timeout: 10000 });
        console.log(`✅ Proxy OK. ServerTime: ${res.data.serverTime}`);
        
        console.log("\n=== 3. PROBANDO API PRIVADA (HISTORIAL) CON PROXY ===");
        const timestamp = res.data.serverTime;
        const query = `timestamp=${timestamp}&recvWindow=60000&tradeType=SELL&page=1&rows=5`;
        const signature = getSignature(query);
        
        const apiRes = await axios.get(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`, {
            httpsAgent: agent,
            headers: { 'X-MBX-APIKEY': API_KEY }
        });
        
        if (apiRes.data && apiRes.data.code === '000000') {
            console.log(`✅ API Privada OK. Ordenes obtenidas: ${apiRes.data.data.length}`);
        } else {
            console.log(`⚠️ Respuesta:`, apiRes.data);
        }
    } catch (err) {
        console.log(`❌ Error por Proxy/API:`, err.response ? JSON.stringify(err.response.data) : err.message);
    }
}

test();