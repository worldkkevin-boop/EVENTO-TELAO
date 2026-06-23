# Infra KS Studio — como a gente sobe os apps (cola isso numa IA pra criar um app novo no mesmo padrão)

> Este documento descreve a infraestrutura que já existe e o padrão pra colocar um app novo no ar.
> Ao criar um app novo, **siga as mesmas convenções abaixo** (porta própria, subdomínio próprio, mesmo VPS, mesmo fluxo de git).

## Stack padrão dos apps
- **Node.js (versão 22 ou superior)** + **Express**.
- Banco: **`node:sqlite`** (o SQLite nativo do Node, `DatabaseSync`) — NÃO usar dependência externa de banco, NÃO usar Postgres/MySQL. Arquivo `.db` local.
- Sessão/login (quando precisar): `express-session` com store em SQLite (sessão sobrevive a reinício).
- Senhas: `scrypt` do `node:crypto` (sem libs).
- Segredos: arquivo **`.env`** (carregado com `process.loadEnvFile()`), NUNCA commitado.
- Dinheiro (se tiver): sempre em **centavos** (inteiro).
- Pagamento (se tiver): **Mercado Pago** Checkout Pro (Pix + cartão).
- Front: HTML/CSS/JS simples servido pelo próprio Express (sem framework pesado). Tema escuro.

## Servidor (VPS)
- **Hostinger VPS**, Ubuntu. IP: **2.25.207.133**. Acesso: `ssh root@2.25.207.133`.
- **Nginx** como reverse proxy (cada app responde numa porta local, o Nginx liga o subdomínio→porta).
- **PM2** mantém os apps Node ligados (reinicia sozinho, sobe no boot).
- **HTTPS** via **Let's Encrypt / certbot** (um certificado por subdomínio).
- Apps ficam em `/opt/` (ex.: `/opt/EVENTO-TELAO`, dentro tem a subpasta `disparaja/`).

## Domínio (guarda-chuva)
- Domínio único: **`ksstudio.cloud`**. Cada projeto é um **subdomínio**:
  - `disparaja.ksstudio.cloud` → app DisparaJá (porta 4000)
  - `telao.ksstudio.cloud` → projeto telão
  - (novo app) → `NOME.ksstudio.cloud`
- Pra cada subdomínio novo: criar um **registro DNS tipo A** apontando `NOME` → **2.25.207.133**.

## Convenção de portas (cada app a sua)
- DisparaJá = **4000**.
- App novo = **próxima porta livre** (4001, 4002, ...). A porta fica no `.env` do app (`PORT=4001`).

## Git / deploy
- Código no **GitHub**. Fluxo: eu desenvolvo local → `git push` → no VPS faço `git pull`.
- O usuário (Kevin) testa pelo GitHub/produção. **Convenção: commitar e dar push após cada mudança.**
- Atualizar um app no VPS:
  ```bash
  cd /opt/NOME-DO-REPO && git pull && cd subpasta-do-app && npm install --omit=dev && pm2 restart NOME-DO-APP
  ```
- Arquivos sensíveis no `.gitignore`: `.env`, o banco `*.db`, e qualquer pasta com dados pessoais/leads (repo é público).

---

## RECEITA: colocar um APP NOVO no ar (passo a passo)

Suponha um app novo chamado `meuapp` na porta `4001`, subdomínio `meuapp.ksstudio.cloud`.

1. **Código** (local): app Express ouvindo em `process.env.PORT || 4001`, com `.env.example` documentando os segredos. Sobe pro GitHub.

2. **DNS**: criar registro **A**: `meuapp` → `2.25.207.133`.

3. **No VPS** — clonar e subir com PM2:
   ```bash
   cd /opt && git clone <url-do-repo> meuapp && cd meuapp
   cp .env.example .env && nano .env        # preencher segredos + PORT=4001
   npm install --omit=dev
   pm2 start server.js --name meuapp && pm2 save
   ```

4. **Nginx** — criar `/etc/nginx/sites-available/meuapp` com:
   ```nginx
   server {
     server_name meuapp.ksstudio.cloud;
     location / {
       proxy_pass http://127.0.0.1:4001;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
     }
   }
   ```
   Ativar e recarregar:
   ```bash
   ln -s /etc/nginx/sites-available/meuapp /etc/nginx/sites-enabled/
   nginx -t && systemctl reload nginx
   ```

5. **HTTPS** (certbot pega o certificado e já ajusta o Nginx):
   ```bash
   certbot --nginx -d meuapp.ksstudio.cloud
   ```

6. Pronto: `https://meuapp.ksstudio.cloud` no ar. Pra atualizar depois:
   `cd /opt/meuapp && git pull && npm install --omit=dev && pm2 restart meuapp`

---

## Observações pra IA que for criar o app novo
- **Reutilize o padrão acima** (Node+Express, `node:sqlite`, `.env`, porta própria, subdomínio próprio). Não introduza banco externo, Docker, nem framework de front pesado sem necessidade.
- Se o app tiver login/saldo/pagamento, espelhe o que o DisparaJá já faz (sessão em SQLite, dinheiro em centavos, Mercado Pago Checkout Pro).
- App e dados pessoais: nada de dado de cliente no repositório (é público).
