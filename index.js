const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// DATOS EXACTOS DEL ANUNCIO DEL PRESIDENTE
const TARGET_ADV_NO = "13788738308616540160"; 

let lastFetch = null;
let liveStatusData = null; 

function log(level, event, data = {}) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...data }));
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

async function fetchAndIngest() {
  log('INFO', 'polling_started');
  try {
    // CONSULTA DIRECTA AL DETALLE DEL ANUNCIO (SIN PAGINACIÓN)
    const url = `https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/detail?advNo=${TARGET_ADV_NO}`;
    
    const data = await fetchWithRetry(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (data && data.code === '000000' && data.data) {
      const ad = data.data;
      const rate = parseFloat(ad.price);
      
      // Cálculo de ganancia neta
      const m_total_usd = 100; 
      const opex_periodo_usd = 10.70;
      const itbms_panama_usd = 1.40;
      const ganancia_neta_real = (rate * m_total_usd) - opex_periodo_usd - itbms_panama_usd;

      liveStatusData = {
        nombre: ad.advertiser.nickName || 'Inversiones-DJS',
        estado: ad.advStatus === 1 ? 'Activo' : 'Inactivo',
        tasa: rate.toString(),
        ganancia_neta_real_usd: ganancia_neta_real.toFixed(2),
        actualizado_al: new Date().toISOString()
      };
      log('INFO', 'live_status_calculated', liveStatusData);
    } else {
      log('WARN', 'ad_not_found', { message: 'No se pudo obtener el detalle del anuncio. Binance devolvió: ', data });
    }

    lastFetch = new Date().toISOString();
  } catch (error) {
    log('ERROR', 'polling_failed', { error: error.message });
  }
}

app.get('/api/live-status', (req, res) => {
  if (!liveStatusData) return res.status(503).json({ error: 'Datos no disponibles' });
  res.json(liveStatusData);
});

app.listen(PORT, () => {
  log('INFO', 'server_started', { port: PORT });
  fetchAndIngest();
  setInterval(fetchAndIngest, 5 * 60 * 1000);
});