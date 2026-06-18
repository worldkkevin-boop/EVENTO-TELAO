const express = require('express');
const os = require('os');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;

app.use(express.static('public'));

// Descobre os IPs da rede local (Wi-Fi / cabo) desta maquina
function getLocalIPs() {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
        }
    }
    return ips;
}

// O painel usa esta rota para montar os links dos teloes para outros PCs
app.get('/info', (req, res) => {
    res.json({ ips: getLocalIPs(), port: PORT });
});

let broadcaster;

io.on('connection', (socket) => {
    socket.on('broadcaster', () => {
        broadcaster = socket.id;
        socket.broadcast.emit('broadcaster');
    });

    // Agora o telao avisa QUAL telao ele e (1, 2 ou 3) e entra na sala dele
    socket.on('watcher', (telaoId) => {
        socket.data.telaoId = telaoId;
        socket.join('telao-' + telaoId); // Entra na sala especifica
        if (broadcaster) {
            socket.to(broadcaster).emit('watcher', socket.id, telaoId);
        }
    });

    // Roteamento de Sinalizacao WebRTC
    socket.on('offer', (id, message) => { socket.to(id).emit('offer', socket.id, message); });
    socket.on('answer', (id, message) => { socket.to(id).emit('answer', socket.id, message); });
    socket.on('candidate', (id, message) => { socket.to(id).emit('candidate', socket.id, message); });

    // Comandos de Estudio direcionados (por telao ou para todos)
    socket.on('switch-scene', (data) => {
        if (data.target === 'todos') { socket.broadcast.emit('scene-switched', data.scene); }
        else { io.to('telao-' + data.target).emit('scene-switched', data.scene); }
    });

    socket.on('send-overlay', (data) => {
        if (data.target === 'todos') { socket.broadcast.emit('overlay-updated', data); }
        else { io.to('telao-' + data.target).emit('overlay-updated', data); }
    });

    socket.on('disconnect', () => {
        if (socket.id === broadcaster) {
            socket.broadcast.emit('disconnectBroadcaster');
        } else {
            // Avisa o transmissor que um telao saiu, pra ele liberar a conexao
            socket.broadcast.emit('peer-left', socket.id);
        }
    });
});

http.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log('🚀 Servidor Multi-Telão rodando!');
    console.log(`   Painel:  http://localhost:${PORT}/transmit.html`);
    ips.forEach(ip => console.log(`   Telões:  http://${ip}:${PORT}/receive.html?t=1`));
});
