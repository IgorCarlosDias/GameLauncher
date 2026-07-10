# 🎮 GameLauncher

Um launcher de jogos local desenvolvido para transformar um computador conectado à TV em uma central de jogos controlada pelo celular.

A ideia surgiu de uma necessidade real: com o PC conectado na TV da sala, trocar de jogo exigia levantar do sofá, acessar o computador e abrir manualmente outro jogo.

Com o GameLauncher, basta acessar uma página pelo celular, escolher o jogo e iniciar remotamente pelo computador.

---

## 🚀 Funcionalidades

✅ Biblioteca automática de jogos  
✅ Escaneamento recursivo de pastas  
✅ Suporte para executáveis `.exe`  
✅ Suporte para atalhos do Windows `.lnk`  
✅ Suporte para atalhos de internet `.url`  
✅ Execução remota dos jogos pela rede local  
✅ Interface responsiva para celular  
✅ Busca de jogos  
✅ Download automático das capas dos jogos  
✅ Integração com SteamGridDB para capas estilo Steam  

---

## 🖥️ Como funciona

```
Celular
   |
   | HTTP Request
   |
   ▼
React Frontend
   |
   |
   ▼
Node.js + Express API
   |
   |
   ▼
Windows
   |
   ▼
Executa o jogo (.exe/.lnk/.url)
```

---

# 🛠️ Tecnologias utilizadas

## Frontend

- React
- Vite
- Axios
- CSS3

## Backend

- Node.js
- Express
- REST API
- Axios
- dotenv

## Integrações

- SteamGridDB API para busca automática de capas

---

# 📂 Estrutura do projeto

```
GameLauncher
│
├── backend
│   ├── server.js
│   ├── services
│   │   └── steamgriddb.js
│   ├── covers
│   ├── .env.example
│   └── package.json
│
└── frontend
    ├── src
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    ├── .env.example
    └── package.json
```

---

# ⚙️ Instalação

## Pré-requisitos

- Node.js instalado
- Windows
- Computador e celular conectados na mesma rede
- Liberação da porta 5173 no firewall

---

# Backend

Entre na pasta:

```bash
cd backend
```

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env` baseado no exemplo:

```
PORT=3000

GAME_FOLDER=C:\Caminho\Dos\Jogos

SERVER_IP=192.168.0.XXX

STEAMGRIDDB_KEY=Chave api do Steam GridDB
```

Inicie o servidor:

```bash
node server.js
```

---

# Frontend

Entre na pasta:

```bash
cd frontend
```

Instale as dependências:

```bash
npm install
```

Crie um arquivo `.env`:

```
VITE_API_URL=http://IP_DO_SERVIDOR:3000
```

Execute:

```bash
npm run dev -- --host
```

Acesse pelo navegador:

```
http://IP_DO_SERVIDOR:5173
```

---

# 🎮 Utilização

1. Configure uma pasta contendo seus jogos:

Exemplo:

```
Jogos
│
├── Terraria.lnk
├── GTA V.exe
├── Elden Ring.url
└── Jogos
    └── OutroGame.exe
```

2. O servidor irá analisar os arquivos automaticamente.

3. Abra o launcher pelo celular.

4. Escolha o jogo.

5. O computador irá iniciar o jogo.

---

# 🔒 Configuração do ambiente

Os arquivos `.env` não são enviados para o GitHub.

Utilize:

```
.env.example
```

como referência para criar suas configurações locais.

---

# 👨‍💻 Autor

Igor Dias

Desenvolvido como projeto pessoal para solucionar uma necessidade real utilizando desenvolvimento Full Stack, automação Windows e comunicação em rede local.

---

⭐ Se esse projeto foi útil ou interessante, deixe uma estrela no repositório!