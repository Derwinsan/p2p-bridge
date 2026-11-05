const cron = require('node-cron');
const fetch = require('node-fetch');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WORKER_URL = 'https://p2p-api.derwinsan1.workers.dev';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN; 

async function enviarResumenDiario() {
    try {
        console.log("Solicitando resumen diario al Worker...");
        
        const res = await fetch(`${WORKER_URL}/internal/daily-summary`, {
            headers: { 'X-Bridge-Token': BRIDGE_TOKEN }
        });
        
        const json = await res.json();
        if (!json.ok) throw new Error("Error del Worker");

        const data = json.data;
        
        let mensaje = "🌙 *RESUMEN DIARIO P2P* 🌙\n\n";
        
        if (data.total_ops === 0) {
            mensaje += "Hoy no se registraron operaciones.\n¡A descansar! 💤";
        } else {
            mensaje += `📊 *Operaciones:* ${data.total_ops}\n`;
            mensaje += `💰 *Ganancia Bruta:* $${Number(data.gross_profit).toFixed(2)}\n`;
            mensaje += `💸 *Comisiones:* -$${Number(data.fees).toFixed(2)}\n`;
            mensaje += `📉 *OPEX Diario:* -$${(10.70 / 30).toFixed(2)}\n`;
            mensaje += `---------------------------\n`;
            
            const neto = Number(data.net_profit);
            const emoji = neto >= 0 ? "🟢" : "🔴";
            mensaje += `${emoji} *Ganancia Neta:* $${neto.toFixed(2)}\n\n`;
            mensaje += "¡Buen trabajo hoy, Presidente! 🚀";
        }

        await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: mensaje,
                parse_mode: 'Markdown'
            })
        });
        
        console.log("✅ Resumen enviado a Telegram.");
    } catch (error) {
        console.error("❌ Error enviando resumen:", error.message);
    }
}

cron.schedule('55 23 * * *', () => {
    console.log("Ejecutando cron del resumen diario...");
    enviarResumenDiario();
}, {
    scheduled: true,
    timezone: "America/Panama"
});

module.exports = { enviarResumenDiario };