#!/usr/bin/env bash
# Deploy do DisparaJa num VPS Ubuntu/Debian (rode como root).
# Instala Node + Nginx, pega o codigo e configura o site. NAO mexe em segredos.
# Depois de rodar: crie o .env e rode o certbot (ver DEPLOY.md).
set -e

DOMINIO="disparaja.ksstudio.cloud"
REPO="https://github.com/worldkkevin-boop/EVENTO-TELAO.git"
APPDIR="/opt/EVENTO-TELAO/disparaja"

echo "==> 1/4 Instalando Node 22, git e Nginx..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git nginx

echo "==> 2/4 Baixando o codigo..."
mkdir -p /opt && cd /opt
if [ -d EVENTO-TELAO ]; then (cd EVENTO-TELAO && git pull); else git clone "$REPO"; fi
cd "$APPDIR"
npm install --omit=dev
npm install -g pm2

echo "==> 3/4 Configurando o Nginx para $DOMINIO..."
cat > /etc/nginx/sites-available/disparaja <<NGINX
server {
  listen 80;
  server_name $DOMINIO;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/disparaja /etc/nginx/sites-enabled/disparaja
nginx -t && systemctl reload nginx

echo "==> 4/4 Prontos os pre-requisitos."
echo ""
echo "AGORA FALTA (ver DEPLOY.md):"
echo "  1) Criar o arquivo $APPDIR/.env com os segredos"
echo "  2) pm2 start server.js --name disparaja && pm2 save && pm2 startup"
echo "  3) certbot --nginx -d $DOMINIO   (HTTPS, depois do DNS propagar)"
