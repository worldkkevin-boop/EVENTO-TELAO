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

// --- CONTADOR DE PRESENCA ---
let contadorPresencas = 0;
let listaPresencas = []; // { nome, whatsapp, hora }
let contadorVisivel = false; // lembra se o contador esta na tela

// Se PRESENCA_URL estiver definida (Web App do Apps Script + "?action=count"),
// o servidor puxa o total da nuvem a cada 5s e atualiza os teloes.
const PRESENCA_URL = process.env.PRESENCA_URL || '';
if (PRESENCA_URL) {
    console.log('☁️  Contador integrado a nuvem:', PRESENCA_URL);
    setInterval(async () => {
        try {
            const resp = await fetch(PRESENCA_URL);
            const data = await resp.json();
            if (typeof data.total === 'number' && data.total !== contadorPresencas) {
                contadorPresencas = data.total;
                io.emit('atualizar-contador', contadorPresencas);
            }
        } catch (e) { /* rede instavel: tenta de novo no proximo ciclo */ }
    }, 5000);
}

// Exporta a lista de presencas em CSV (leads do evento)
app.get('/presencas.csv', (req, res) => {
    const linhas = [['Nome', 'WhatsApp', 'Hora']]
        .concat(listaPresencas.map(p => [p.nome, p.whatsapp, p.hora]));
    const csv = linhas
        .map(cols => cols.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(','))
        .join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="presencas.csv"');
    res.send('﻿' + csv); // BOM para acentos abrirem certo no Excel
});

let broadcaster;
let adTimer = null; // Controla o timer do anuncio L-Shape

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

    // --- CONTADOR DE PRESENCA ---
    // Quando alguem confirma no celular
    socket.on('nova-presenca', (dados) => {
        contadorPresencas++;
        listaPresencas.push({
            nome: dados.nome,
            whatsapp: dados.whatsapp,
            hora: new Date().toLocaleString('pt-BR')
        });
        console.log(`Nova presença: ${dados.nome}. Total: ${contadorPresencas}`);
        io.emit('atualizar-contador', contadorPresencas);
    });

    // Liga/desliga o contador em todos os teloes (e lembra o estado)
    socket.on('toggle-contador', (mostrar) => {
        contadorVisivel = !!mostrar;
        io.emit('display-contador', contadorVisivel);
    });

    // Zera a contagem (botao do painel, com confirmacao no front)
    socket.on('reset-contador', () => {
        contadorPresencas = 0;
        listaPresencas = [];
        console.log('Contador zerado pelo painel.');
        io.emit('atualizar-contador', contadorPresencas);
    });

    // Ao conectar, ja manda o numero atual e o estado de visibilidade
    socket.emit('atualizar-contador', contadorPresencas);
    socket.emit('display-contador', contadorVisivel);

    // --- ANUNCIOS L-SHAPE ---
    // Ativa o L-Shape por X segundos e desativa sozinho
    socket.on('start-ads', (duration) => {
        io.emit('toggle-ads', true);
        const segundos = Math.max(1, parseInt(duration, 10) || 5);
        console.log(`📡 Anúncio L-Shape ativado por ${segundos} segundos.`);
        if (adTimer) clearTimeout(adTimer);
        adTimer = setTimeout(() => {
            io.emit('toggle-ads', false);
            console.log('📡 Anúncio finalizado. Vídeo voltando.');
            adTimer = null;
        }, segundos * 1000);
    });

    // Para o anuncio manualmente
    socket.on('stop-ads', () => {
        if (adTimer) { clearTimeout(adTimer); adTimer = null; }
        io.emit('toggle-ads', false);
        console.log('📡 Anúncio interrompido manualmente.');
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
