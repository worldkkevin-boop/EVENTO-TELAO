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

// O painel usa esta rota para montar o link do telao para outros PCs
app.get('/info', (req, res) => {
    res.json({ ips: getLocalIPs(), port: PORT });
});

let broadcaster;

io.on('connection', (socket) => {
    // Registra quem está transmitindo a câmera
    socket.on('broadcaster', () => {
        broadcaster = socket.id;
        socket.broadcast.emit('broadcaster');
    });

    // Registra o telão de fora que vai assistir
    socket.on('watcher', () => {
        if (broadcaster) {
            socket.to(broadcaster).emit('watcher', socket.id);
        }
    });

    // Troca de sinalização WebRTC (mágica da conexão local)
    socket.on('offer', (id, message) => {
        socket.to(id).emit('offer', socket.id, message);
    });

    socket.on('answer', (id, message) => {
        socket.to(id).emit('answer', socket.id, message);
    });

    socket.on('candidate', (id, message) => {
        socket.to(id).emit('candidate', socket.id, message);
    });

    // Repassa a alteração de cena (ex: trocar de câmera para logo)
    socket.on('switch-scene', (scene) => {
        socket.broadcast.emit('scene-switched', scene);
    });

    // Repassa textos ou overlays criados no painel
    socket.on('send-overlay', (data) => {
        socket.broadcast.emit('overlay-updated', data);
    });

    socket.on('disconnect', () => {
        if (socket.id === broadcaster) {
            socket.broadcast.emit('disconnectBroadcaster');
        }
    });
});

http.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na rede local!`);
    console.log(`Acesse no Telão de Dentro: http://localhost:${PORT}/transmit.html`);
    console.log(`Acesse no Telão de Fora: http://<IP_DA_MAQUINA>:${PORT}/receive.html`);
});
