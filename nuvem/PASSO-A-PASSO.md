# Servidor de Presença na Nuvem (Google Apps Script + Sheets)

Objetivo: o público escaneia o QR Code pelo 4G → confirma presença → cai numa
planilha do Google → seu notebook lê o total e mostra no telão. Sem custo, sem
servidor pra cair, sem problema de rede local x 4G.

## Passo 1 — Criar a planilha
1. Acesse https://sheets.google.com e crie uma planilha em branco.
2. Pode deixar do jeito que está (o script cria a aba "Presencas" sozinho).

## Passo 2 — Abrir o editor de script
1. Na planilha: menu **Extensões → Apps Script**.
2. Vai abrir o editor de código.

## Passo 3 — Colar os arquivos
1. No arquivo `Código.gs` (já aberto): apague tudo e cole o conteúdo de **Codigo.gs** (desta pasta).
2. Crie o HTML: clique no **+** ao lado de "Arquivos" → **HTML** → nomeie como **`index`**
   (sem .html). Apague o conteúdo padrão e cole o conteúdo de **index.html** (desta pasta).
3. Salve tudo (ícone de disquete).

## Passo 4 — Publicar como Web App
1. Botão **Implantar → Nova implantação**.
2. Em "Tipo", escolha **App da Web**.
3. Configure:
   - **Executar como:** Eu (sua conta).
   - **Quem pode acessar:** **Qualquer pessoa**.
4. Clique **Implantar** e autorize as permissões (pode aparecer aviso "app não verificado" → Avançado → Acessar).
5. Copie a **URL do app da Web** (algo como `https://script.google.com/macros/s/XXXX/exec`).

## Passo 5 — Gerar o QR Code
- O QR Code do telão/slide deve apontar para a **URL do app da Web** (a do Passo 4).
- Pode gerar em qualquer site de QR (ex: qr-code-generator) ou pedir pro design.

## Passo 6 — Ligar o telão na nuvem (no seu notebook)
A "URL de contagem" é a URL do app da Web + `?action=count`.

Inicie o servidor assim (PowerShell, na pasta do projeto):

```powershell
$env:PRESENCA_URL = "https://script.google.com/macros/s/XXXX/exec?action=count"
node server.js
```

Pronto: o servidor passa a puxar o total da nuvem a cada 5s e atualizar os telões.
Sem a variável `PRESENCA_URL`, o sistema continua funcionando com o contador local
(página /presenca.html) — útil para testes na própria rede.

## Teste rápido
- Abra a URL do app da Web no celular (pelo 4G), confirme presença.
- Veja a linha aparecer na planilha do Google.
- Com o telão ligado e `PRESENCA_URL` configurada, o número sobe em até 5s.

## Nome do evento (identificar a lista depois)
Cada presença é gravada com o nome do evento numa coluna "Evento". Você define
de duas formas:

1. **Mais simples:** no `Codigo.gs`, edite a linha
   `const EVENTO_PADRAO = 'Plenária União Brasil - Laranjal do Jari';`
   com o nome do evento atual e reimplante (Implantar → Gerenciar → editar → Nova versão).

2. **Sem reimplantar (por QR):** aponte o QR para a URL com o parâmetro `evento`, ex:
   `https://script.google.com/macros/s/SEU_ID/exec?evento=Plenaria%20Laranjal%20do%20Jari`
   (use %20 no lugar de espaços). Assim dá pra ter vários eventos na mesma planilha.

> IMPORTANTE: como agora existe a coluna "Evento", se você JÁ tinha criado a aba
> "Presencas" antes, apague essa aba (ou as linhas de teste) — o script recria o
> cabeçalho certo: Evento | Nome | WhatsApp | Hora.

## Dica
- Os leads ficam na planilha do Google (Evento, Nome, WhatsApp, Hora) — é só
  exportar depois (Arquivo → Fazer download → CSV) e filtrar pela coluna Evento.
