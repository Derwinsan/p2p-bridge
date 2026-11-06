const http = require('http');

// 1. Cargamos nuestras tareas automatizadas
require('./ingesta_cloud'); // Ingesta P2P cada 4 horas
require('./daily_summary'); // Bot de Telegram diario

// 2. Creamos un servidor HTTP básico
// (Render exige que los "Web Services" escuchen en un puerto, 
// aunque nosotros no usemos el frontend aquí).
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        status: 'ok', 
        message: 'P2P Bridge Cloud is running silently.',
        timestamp: new Date().toISOString()
    }));
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log(`[CLEAN BRIDGE] Servidor en linea en el puerto ${PORT}`);
    console.log(`[CLEAN BRIDGE] Tareas activas: Ingesta P2P y Bot de Telegram.`);
    console.log(`[CLEAN BRIDGE] Cero errores de DCA o anuncios.`);
});