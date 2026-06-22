# Deploy do DisparaJá no VPS

VPS: `2.25.207.133` (Hostinger, Ubuntu) • Domínio: `disparaja.ksstudio.cloud`

Conecte no VPS pelo Termius (usuário `root`) e rode os passos abaixo.

## 1) Instalar tudo + pegar o código + Nginx
```bash
curl -fsSL https://raw.githubusercontent.com/worldkkevin-boop/EVENTO-TELAO/main/disparaja/deploy.sh | bash
```
(ou clone o repo e rode `bash /opt/EVENTO-TELAO/disparaja/deploy.sh`)

## 2) Criar o arquivo de segredos `.env`
```bash
cat > /opt/EVENTO-TELAO/disparaja/.env <<'EOF'
PORT=4000
BASE_URL=https://disparaja.ksstudio.cloud
SESSION_SECRET=COLE_UM_SEGREDO_ALEATORIO
MP_ACCESS_TOKEN=COLE_O_ACCESS_TOKEN_DO_MERCADO_PAGO
COMTELE_API_KEY=COLE_A_CHAVE_DA_COMTELE
COMTELE_ROTA=16
EOF
```

## 3) Subir o app (PM2 mantém ligado e reinicia sozinho)
```bash
cd /opt/EVENTO-TELAO/disparaja
pm2 start server.js --name disparaja
pm2 save
pm2 startup   # rode tambem a linha que ele mandar
```

## 4) Ligar o HTTPS (depois do DNS propagar)
```bash
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d disparaja.ksstudio.cloud --non-interactive --agree-tos -m SEU_EMAIL
```

## Atualizar o sistema depois (quando o código mudar)
```bash
cd /opt/EVENTO-TELAO && git pull && cd disparaja && npm install --omit=dev && pm2 restart disparaja
```

## Conferir
- `pm2 logs disparaja` — ver logs do app
- `pm2 status` — ver se está rodando
- Abrir `https://disparaja.ksstudio.cloud` no navegador
