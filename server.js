const express = require('express');
const os = require('os');
const fs = require('fs');
const path = require('path');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;        // http  (PC/localhost)
const HTTPS_PORT = 3443;  // https (celular: libera a camera no iPhone/Android)

// Serve a pasta public; HTML sem cache pra todo F5 pegar a versao mais nova
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
    }
}));

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
    res.json({ ips: getLocalIPs(), port: PORT, webappUrl: WEBAPP_URL, evento: eventoAtual });
});

// Lista os vídeos prontos da pasta public/videos
app.get('/videos', (req, res) => {
    const dir = path.join(__dirname, 'public', 'videos');
    let videos = [];
    try {
        videos = fs.readdirSync(dir).filter(f => /\.(mp4|webm|mov|m4v|ogg)$/i.test(f));
    } catch (e) { /* pasta pode nao existir ainda */ }
    res.json({ videos });
});

// --- CONTADOR DE PRESENCA ---
let contadorPresencas = 0;   // contagem REAL (presencas/nuvem) usada no modo automatico
let contadorManual = 0;      // numero digitado no painel, usado no modo manual
let modoContador = 'auto';   // 'auto' = conta presencas | 'manual' = numero fixo do painel
let contadorVelocidade = 5000; // ms que o contador leva em cada numero (editavel no painel)
let listaPresencas = []; // { nome, whatsapp, hora }
let contadorVisivel = false; // lembra se o contador esta na tela

// Numero que aparece no telao, conforme o modo escolhido
function valorContador() {
    return modoContador === 'manual' ? contadorManual : contadorPresencas;
}
let qrVisivel = false; // lembra se o QR Code esta na tela
// Posição/tamanho do contador e do QR no telão (configurável pelo painel)
let layoutTelao = {
    contador: { corner: 'top-right', size: 100 },
    qr: { corner: 'bottom-right', size: 100 }
};

// Integração com a nuvem (Web App do Apps Script). Conta SÓ o evento atual.
// WEBAPP_URL = a URL .../exec (base). EVENTO = nome do evento (opcional, define o filtro).
let WEBAPP_URL = process.env.WEBAPP_URL || '';
if (!WEBAPP_URL && process.env.PRESENCA_URL) WEBAPP_URL = process.env.PRESENCA_URL.split('?')[0];
let eventoAtual = process.env.EVENTO || '';

function countUrl() {
    let u = WEBAPP_URL + (WEBAPP_URL.indexOf('?') >= 0 ? '&' : '?') + 'action=count';
    if (eventoAtual) u += '&evento=' + encodeURIComponent(eventoAtual);
    return u;
}

async function pollNuvem() {
    if (!WEBAPP_URL) return;
    try {
        const resp = await fetch(countUrl());
        const data = await resp.json();
        if (typeof data.total === 'number' && data.total !== contadorPresencas) {
            contadorPresencas = data.total;
            if (modoContador === 'auto') io.emit('atualizar-contador', contadorPresencas);
        }
    } catch (e) { /* rede instavel: tenta de novo no proximo ciclo */ }
}

if (WEBAPP_URL) {
    console.log('☁️  Contador na nuvem. Evento:', eventoAtual || '(todos)');
    setInterval(pollNuvem, 5000);
    pollNuvem();
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
        // No modo manual o numero do telao e fixo; a presenca so entra na lista/CSV.
        if (modoContador === 'auto') io.emit('atualizar-contador', contadorPresencas);
    });

    // Troca entre contagem automatica (presencas) e numero manual digitado no painel
    socket.on('set-contador-modo', (modo) => {
        modoContador = (modo === 'manual') ? 'manual' : 'auto';
        console.log('Contador no modo:', modoContador);
        io.emit('contador-modo', modoContador);
        io.emit('atualizar-contador', valorContador());
    });

    // Define o numero manual (ex: 500). Ja FORCA o modo manual e o telao sobe devagar ate o valor.
    socket.on('set-contador-valor', (valor) => {
        contadorManual = Math.max(0, parseInt(valor, 10) || 0);
        modoContador = 'manual'; // definir um numero = entrar no modo manual (nao puxa mais a lista)
        console.log('Contador manual definido em', contadorManual);
        io.emit('contador-modo', modoContador);
        io.emit('atualizar-contador', contadorManual);
    });

    // Velocidade da rolagem: quantos SEGUNDOS o contador leva em cada numero
    socket.on('set-contador-velocidade', (segundos) => {
        let s = parseFloat(segundos);
        if (isNaN(s) || s < 0) s = 0;
        contadorVelocidade = Math.round(s * 1000); // guarda em ms
        console.log('Velocidade do contador:', s, 's por numero');
        io.emit('contador-velocidade', contadorVelocidade);
    });

    // Liga/desliga o contador em todos os teloes (e lembra o estado)
    socket.on('toggle-contador', (mostrar) => {
        contadorVisivel = !!mostrar;
        io.emit('display-contador', contadorVisivel);
    });

    // Liga/desliga o QR Code em todos os teloes (e lembra o estado)
    socket.on('toggle-qr', (mostrar) => {
        qrVisivel = !!mostrar;
        io.emit('display-qr', qrVisivel);
    });

    // Toca um vídeo pronto (da pasta /videos) direto no telão escolhido
    // 'todos' = vai pros 3 telões, mas SO o T1 toca com som (evita audio duplicado/eco).
    socket.on('play-video', (data) => {
        if (data.target === 'todos') {
            socket.broadcast.emit('play-video', { file: data.file, loop: !!data.loop, todos: true });
        } else {
            io.to('telao-' + data.target).emit('play-video', { file: data.file, loop: !!data.loop, todos: false });
        }
    });
    socket.on('stop-video', (target) => {
        if (target === 'todos') socket.broadcast.emit('stop-video');
        else io.to('telao-' + target).emit('stop-video');
    });

    // Posição/tamanho do contador e do QR no telão
    socket.on('set-layout', (cfg) => {
        if (cfg && cfg.contador) layoutTelao.contador = { ...layoutTelao.contador, ...cfg.contador };
        if (cfg && cfg.qr) layoutTelao.qr = { ...layoutTelao.qr, ...cfg.qr };
        io.emit('layout', layoutTelao);
    });

    // Zera a contagem (botao do painel, com confirmacao no front)
    socket.on('reset-contador', () => {
        contadorPresencas = 0;
        contadorManual = 0;
        listaPresencas = [];
        console.log('Contador zerado pelo painel.');
        io.emit('atualizar-contador', valorContador());
    });

    // Define o evento atual (digitado no painel) -> filtra a contagem da nuvem
    socket.on('set-evento', (nome) => {
        eventoAtual = String(nome || '').trim();
        console.log('🎯 Evento atual:', eventoAtual || '(todos)');
        io.emit('evento-atual', eventoAtual);
        pollNuvem(); // atualiza o número na hora
    });

    // Ao conectar, ja manda o numero atual, o modo, o estado de visibilidade e o evento
    socket.emit('contador-modo', modoContador);
    socket.emit('contador-velocidade', contadorVelocidade);
    socket.emit('atualizar-contador', valorContador());
    socket.emit('display-contador', contadorVisivel);
    socket.emit('display-qr', qrVisivel);
    socket.emit('layout', layoutTelao);
    socket.emit('evento-atual', eventoAtual);

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

// Gera (ou reaproveita) um certificado caseiro pro HTTPS. Fica salvo em /certs
// pra nao mudar a cada reinicio (assim o celular nao precisa aceitar o aviso de novo).
// OBS: no selfsigned 5.x o generate() e ASSINCRONO (retorna Promise).
async function getHttpsOptions() {
    const dir = path.join(__dirname, 'certs');
    const keyPath = path.join(dir, 'key.pem');
    const certPath = path.join(dir, 'cert.pem');
    try {
        if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
            const key = fs.readFileSync(keyPath);
            const cert = fs.readFileSync(certPath);
            if (key.length && cert.length) return { key, cert };
        }
    } catch (e) { /* gera de novo abaixo */ }

    const selfsigned = require('selfsigned');
    const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
    getLocalIPs().forEach(ip => altNames.push({ type: 7, ip }));
    const pems = await selfsigned.generate(
        [{ name: 'commonName', value: 'meu-evento-telao' }],
        {
            days: 3650, keySize: 2048, algorithm: 'sha256',
            extensions: [
                { name: 'basicConstraints', cA: true },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                { name: 'extKeyUsage', serverAuth: true },
                { name: 'subjectAltName', altNames }
            ]
        }
    );
    try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(keyPath, pems.private);
        fs.writeFileSync(certPath, pems.cert);
    } catch (e) { /* sem disco: usa em memoria mesmo */ }
    return { key: pems.private, cert: pems.cert };
}

http.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log('🚀 Servidor Multi-Telão rodando!');
    console.log(`   Painel (PC):     http://localhost:${PORT}/transmit.html`);
    ips.forEach(ip => console.log(`   Telões (PC):     http://${ip}:${PORT}/receive.html?t=1`));

    // Servidor HTTPS pro celular (camera so libera em conexao segura)
    getHttpsOptions().then((opts) => {
        const https = require('https').createServer(opts, app);
        io.attach(https); // mesmo Socket.IO atende http e https
        https.listen(HTTPS_PORT, '0.0.0.0', () => {
            console.log('🔒 HTTPS ligado (use no CELULAR pra liberar a câmera):');
            ips.forEach(ip => console.log(`   Câmera (cel):    https://${ip}:${HTTPS_PORT}/transmit.html`));
        });
    }).catch((e) => {
        console.log('⚠️  Não consegui ligar o HTTPS:', e.message);
    });
});
