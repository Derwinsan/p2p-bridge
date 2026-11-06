const cron = require('node-cron');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET || process.env.BINANCE_SECRET_KEY; // Respaldo agregado
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;
const PROXY_URL = process.env.PROXY_URL || '51.146.17.165:46502';
const WORKER_URL = 'https://p2p-api.derwinsan1.workers.dev';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;

const proxyUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_URL}`;
const agent = new HttpsProxyAgent(proxyUrl);

function getSignature(queryString) {
    return crypto.createHmac('sha256', API_SECRET).update(queryString).digest('hex');
}

async function getBinanceOrders(serverTime, tradeType) {
    let allOrders = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
        const query = `timestamp=${serverTime}&recvWindow=60000&tradeType=${tradeType}&page=${page}&rows=100`;
        const signature = getSignature(query);

        try {
            const res = await axios.get(`https://api.binance.com/sapi/v1/c2c/orderMatch/listUserOrderHistory?${query}&signature=${signature}`, {
                httpsAgent: agent,
                headers: { 'X-MBX-APIKEY': API_KEY }
            });

            if (res.data && res.data.code === '000000' && res.data.data) {
                if (res.data.data.length > 0) {
                    allOrders = allOrders.concat(res.data.data);
                    console.log(`[CLOUD INGEST] Pagina ${page} (${tradeType}): ${res.data.data.length} ordenes.`);
                    page++;
                } else {
                    hasMore = false;
                }
            } else {
                console.error(`[CLOUD INGEST] Respuesta inesperada:`, res.data);
                hasMore = false;
            }
        } catch (error) {
            console.error(`[CLOUD INGEST] Error en pagina ${page}:`, error.response ? error.response.data : error.message);
            hasMore = false;
        }
    }
    return allOrders;
}

async function ejecutarIngesta() {
    console.log("[CLOUD INGEST] Iniciando extraccion automatica...");
    try {
        const timeRes = await axios.get('https://api.binance.com/api/v3/time', { httpsAgent: agent });
        const serverTime = timeRes.data.serverTime;

        const ventas = await getBinanceOrders(serverTime, 'SELL');
        const compras = await getBinanceOrders(serverTime, 'BUY');
        
        let todas = [...ventas, ...compras].filter(o => o.orderStatus === 'COMPLETED');
        console.log(`[CLOUD INGEST] Total ordenes extraidas: ${todas.length}`);

        if (todas.length === 0) return;

        const payload = todas.map(o => ({
            order_number: o.orderNumber,
            trade_type: o.tradeType,
            asset: o.asset,
            fiat: o.fiat,
            amount: o.amount,
            total_price: o.totalPrice,
            unit_price: o.unitPrice,
            order_status: o.orderStatus,
            create_time: o.createTime,
            commission: o.commission,
            pay_method: o.payMethodName,
            counter_part: o.counterPartNickName,
            advertisement_role: o.advertisementRole
        }));

        const res = await axios.post(`${WORKER_URL}/internal/p2p-history-sync`, { orders: payload }, {
            headers: { 'X-Bridge-Token': BRIDGE_TOKEN }
        });

        console.log(`[CLOUD INGEST] Inyeccion en D1 exitosa:`, res.data);

    } catch (error) {
        console.error("[CLOUD INGEST] Error en el proceso:", error.message);
    }
}

cron.schedule('0 0,4,8,12,16,20 * * *', () => {
    console.log("[CLOUD INGEST] Ejecutando Cron programado...");
    ejecutarIngesta();
}, {
    scheduled: true,
    timezone: "America/Panama"
});

ejecutarIngesta();
module.exports = { ejecutarIngesta };