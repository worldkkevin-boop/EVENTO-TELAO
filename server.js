const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;

app.use(express.static('public'));

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
