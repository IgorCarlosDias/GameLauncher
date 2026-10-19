# 🎮 GameLauncher

Um launcher de jogos local e central de controle remoto desenvolvido para transformar um computador conectado à TV em um verdadeiro console de sala, controlado inteiramente pelo celular.

A ideia surgiu de uma necessidade real: com o PC conectado na TV da sala, trocar de jogo, ajustar o volume, alternar o áudio entre a TV e o headset ou digitar algo exigia levantar do sofá e usar mouse e teclado físicos.

Com o **GameLauncher**, basta abrir o app (ou PWA) no celular para navegar pela sua biblioteca com capas automáticas, iniciar ou encerrar jogos e controlar todo o Windows remotamente.

---

## 🚀 Funcionalidades

### 📚 Biblioteca & Experiência de Console
- **Carregamento Paralelo & Persistência SQLite (`better-sqlite3`)**: Escaneamento recursivo rápido de pastas (`.exe`, `.lnk`, `.url`) com cache local persistente.
- **⭐ Favoritos & "Continuar Jogando"**: Marque seus jogos preferidos e acesse rapidamente os últimos jogos abertos no topo da tela.
- **⏱️ Rastreamento Automático de Tempo de Jogo**: Contabiliza automaticamente o tempo total jogado e a quantidade de sessões de cada título.
- **🖼️ Galeria Interativa SteamGridDB & Edição**: Busque e escolha entre dezenas de capas oficiais direto pelo celular, envie uma URL personalizada ou renomeie o título de exibição de qualquer jogo.
- **🔍 Detecção Automática de Jogo em Execução**: Monitora em segundo plano se o processo do jogo continua aberto no PC e salva o tempo da sessão assim que você sai do jogo.
- **🛑 Fechamento Inteligente (`Alt+F4` vs `Taskkill`)**: Opção de fechamento suave (`Alt+F4` para salvar progresso) ou encerramento imediato da árvore de processos (`Taskkill /F /T`).

### 🕹️ Controle Remoto do PC Integrado
- **🖱️ Trackpad Virtual com Rastro Neon (60fps)**: Controle o cursor do mouse na TV deslizando o dedo no celular, com feedback visual de rastro luminoso em `<canvas>`, ondas de toque (ripple), clique esquerdo/direito, duplo clique e rolagem (scroll).
- **⌨️ Teclado Remoto Completo**: Digite textos, senhas ou pesquisas pelo celular (com opção de **Digitar** sem Enter ou **Enviar ↵** com Enter), além de teclas dedicadas (`Backspace`, `Espaço`, `Tab`, `Enter`, `Esc`, `Alt+Tab`, `Win`, `Win+D` e setas direcionais).
- **🔊 Controle de Volume & Saída de Áudio (CoreAudio / `IPolicyConfig`)**: Slider de volume em tempo real (`0–100%`), botão Mudo e seletor instantâneo de dispositivo de saída de áudio (alterne entre **TV HDMI** e **Headset/Caixas de Som** com 1 toque).
- **🎵 Controles de Mídia**: Botões para `Play/Pause`, `Próxima Faixa` e `Faixa Anterior`.
- **📊 Monitor de Desempenho em Tempo Real**: Barras de uso de **CPU (%)**, **RAM (GB)** e **Tempo Ativo (Uptime)** no topo do painel remoto.
- **⚡ Gerenciamento de Energia**: Suspender o PC ou agendar Desligamento com timer de segurança de 30 segundos e botão de cancelamento.
- **📱 Suporte PWA & Vibração Tátil (Haptics)**: Instalável na tela inicial do celular como aplicativo em tela cheia.

---

## 🖥️ Arquitetura

```
Celular (PWA / Navegador na Rede Local)
   │
   │  HTTP REST API (JSON)
   ▼
React 19 + Vite Frontend (Porta 8060)
   │
   ▼
Node.js + Express Backend (Porta 3060)
   ├── SQLite (better-sqlite3) ──► Favoritos, Tempo de Jogo, Capas e Metadados
   ├── SteamGridDB Service     ──► Busca e Download Automático de Capas
   └── syscontrol.exe (C#/Win32) ─► CoreAudio, IPolicyConfig, SendInput (Mouse/Teclado)
```

---

## 🛠️ Tecnologias Utilizadas

### Frontend
- **React 19** + **Vite**
- **Axios** para comunicação com a API
- **HTML5 Canvas** (rastro interativo do Trackpad Virtual)
- **CSS3 Moderno** (Design responsivo Dark Glassmorphism + PWA Manifest)

### Backend & Automação Nativa
- **Node.js** + **Express 5**
- **SQLite (`better-sqlite3`)** para banco de dados local zero-config
- **C# / Win32 Native Helper (`syscontrol.cs` / `syscontrol.exe`)**:
  - `IAudioEndpointVolume` & `IPolicyConfig` para controle de volume master e troca instantânea de saída de áudio no Windows
  - `SendInput` Unicode & Mouse 1:1 com suporte a sessão interativa (`WinSta0\Default`)
- **SteamGridDB API** para busca automática e galeria de capas

---

## 📂 Estrutura do Projeto

```
GameLauncher
│
├── .env.example                 # Modelo centralizado de variáveis de ambiente
├── start-gamelauncher.bat       # Script para iniciar Backend + Frontend
├── start-hidden.vbs             # Inicializador invisível em segundo plano (bandeja/tarefas)
├── stop-gamelauncher.bat        # Script para encerrar os servidores
│
├── backend
│   ├── server.js                # API Express, scanner de jogos, rotas de sistema e jogos
│   ├── database.js              # Camada de persistência SQLite (jogos, favoritos, playtime)
│   ├── syscontrol.cs            # Código-fonte do controlador nativo Win32/CoreAudio em C#
│   ├── syscontrol.exe           # Binário nativo compilado para controle rápido do Windows
│   ├── services
│   │   └── steamgriddb.js       # Integração com a API do SteamGridDB
│   ├── covers                   # Cache local das capas baixadas
│   ├── .env.example
│   └── package.json
│
└── frontend
    ├── public
    │   └── manifest.json        # Configuração PWA para instalação no celular
    ├── src
    │   ├── App.jsx              # Interface principal, Trackpad Canvas e Controle Remoto
    │   ├── main.jsx
    │   └── index.css            # Estilização completa e animações
    ├── vite.config.js           # Configuração Vite lendo IP e portas do .env
    ├── .env.example
    └── package.json
```

### 🔒 Segurança & Controle de Acesso (v1.1.0)
- **🛡️ Token de Autenticação (`API_TOKEN`)**: Todas as ações do sistema (abrir jogo, energia, mouse, teclado, configurações, sync) exigem token de autenticação protegido contra ataques de temporização (`crypto.timingSafeEqual`).
- **🌐 CORS Restrito**: Aceita requisições exclusivamente da origem do Frontend (`http://SERVER_IP:8060`).
- **🏡 Proteção de Sub-rede Local**: Backend e Frontend bloqueiam automaticamente conexões originadas fora da sua sub-rede privada (`192.168.0.0/24`, `10.0.0.0/8`, `172.16.0.0/12`).
- **🧱 Regras Automatizadas no Firewall do Windows**: Scripts inclusos (`setup-firewall.bat` / `setup-firewall.ps1`) para liberar as portas `3060` e `8060` apenas para a rede local, sem expor portas para outras redes.
- **☁️ Sincronização em Nuvem Segura (Supabase RLS)**: Suporte a backup em tempo real de tempos e sessões com autenticação direta (`to authenticated`). As chaves de API nunca são expostas em texto puro na interface (`••••••••XXXX`).

---

## 🖥️ Arquitetura

```
Celular (PWA / Navegador na Rede Local)
   │
   │  HTTP REST API (Headers: x-api-token | CORS Restrito)
   ▼
React 19 + Vite Frontend (Porta 8060)
   │  (Filtro de Sub-rede Local 192.168.0.0/24)
   ▼
Node.js + Express Backend (Porta 3060)
   ├── SQLite (better-sqlite3) ──► Favoritos, Tempo de Jogo, Capas e Metadados
   ├── SteamGridDB Service     ──► Busca e Download Automático de Capas
   ├── Supabase Sync (RLS)     ──► Backup Contínuo e Sincronização em Nuvem
   └── syscontrol.exe (C#/Win32) ─► CoreAudio, IPolicyConfig, SendInput (Mouse/Teclado)
```

---

## 🛠️ Tecnologias Utilizadas

### Frontend
- **React 19** + **Vite**
- **Axios** com interceptor para autenticação via `x-api-token`
- **HTML5 Canvas** (rastro interativo do Trackpad Virtual)
- **CSS3 Moderno** (Design responsivo Dark Glassmorphism + PWA Manifest)

### Backend & Automação Nativa
- **Node.js** + **Express 5**
- **SQLite (`better-sqlite3`)** para banco de dados local zero-config
- **Supabase JS Client** com suporte a autenticação por usuário e RLS
- **C# / Win32 Native Helper (`syscontrol.cs` / `syscontrol.exe`)**:
  - `IAudioEndpointVolume` & `IPolicyConfig` para controle de volume master e troca instantânea de saída de áudio no Windows
  - `SendInput` Unicode & Mouse 1:1 com suporte a sessão interativa (`WinSta0\Default`)
- **SteamGridDB API** para busca automática e galeria de capas

---

## 📂 Estrutura do Projeto

```
GameLauncher
│
├── .env.example                 # Modelo centralizado de variáveis de ambiente
├── start-gamelauncher.bat       # Script para iniciar Backend + Frontend
├── start-hidden.vbs             # Inicializador invisível em segundo plano (bandeja/tarefas)
├── stop-gamelauncher.bat        # Script para encerrar os servidores
├── setup-firewall.bat           # Configuração rápida de regras de sub-rede no Firewall
├── setup-firewall.ps1           # Script PowerShell elevado para regras restritas de firewall
│
├── backend
│   ├── server.js                # API Express, validações de segurança, scanner e rotas
│   ├── database.js              # Camada de persistência SQLite (jogos, favoritos, playtime)
│   ├── syscontrol.cs            # Código-fonte do controlador nativo Win32/CoreAudio em C#
│   ├── syscontrol.exe           # Binário nativo compilado para controle rápido do Windows
│   ├── services
│   │   ├── steamgriddb.js       # Integração com a API do SteamGridDB
│   │   └── supabaseSync.js      # Sincronização em nuvem e login autenticado no Supabase
│   ├── supabase_rls_authenticated.sql # Script SQL para aplicar RLS no Supabase
│   ├── covers                   # Cache local das capas baixadas
│   ├── .env.example
│   └── package.json
│
└── frontend
    ├── public
    │   └── manifest.json        # Configuração PWA para instalação no celular
    ├── src
    │   ├── App.jsx              # Interface principal, Trackpad Canvas e Configurações
    │   ├── main.jsx
    │   └── index.css            # Estilização completa e animações
    ├── vite.config.js           # Configuração Vite com proteção de sub-rede local
    ├── .env.example
    └── package.json
```

---

## ⚙️ Instalação e Configuração

### Pré-requisitos
- **Windows 10 / 11**
- **Node.js** (v18 ou superior)
- Computador e celular conectados na mesma rede local (Wi-Fi / Cabo)

### 1. Clonar e Instalar Dependências

Na raiz do projeto, instale as dependências do projeto principal, backend e frontend:

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configurar os Arquivos `.env`

Copie os modelos de `.env.example` e ajuste os valores:

**Na raiz (`.env`) e em `backend/.env`:**
```env
SERVER_IP=192.168.0.204
PORT=3060
FRONTEND_PORT=8060
GAME_FOLDER=C:\Caminho\Dos\Seus\Jogos
STEAMGRIDDB_KEY=sua_chave_api_do_steamgriddb
API_TOKEN=gl_sec_seu_token_aqui

# Opcional: Sincronização em Nuvem (Supabase)
SUPABASE_URL=https://xyz.supabase.co
SUPABASE_KEY=sb_publishable_...
SUPABASE_EMAIL=admin@gamelauncher.local
SUPABASE_PASSWORD=sua_senha_supabase
```

**Em `frontend/.env`:**
```env
VITE_SERVER_IP=192.168.0.204
VITE_API_PORT=3060
VITE_PORT=8060
VITE_API_URL=http://192.168.0.204:3060
VITE_API_TOKEN=gl_sec_seu_token_aqui
```

### 3. Configurar Firewall do Windows (Recomendado)

Execute como Administrador ou dê dois cliques em:
```text
setup-firewall.bat
```
Isso cria regras liberando as portas `3060` e `8060` estritamente para a sua sub-rede local (`192.168.0.0/24`), bloqueando qualquer tentativa externa. Se você formatar o PC ou trocar de rede, basta executar esse script novamente.

### 4. Executar o GameLauncher

Você pode iniciar tudo com um único comando na raiz:

```bash
npm run dev
```
Ou usar os atalhos do Windows:
- **`start-gamelauncher.bat`**: Inicia os servidores exibindo o status.
- **`start-hidden.vbs`**: Inicia o Backend e o Frontend silenciosamente em segundo plano (ideal para colocar na inicialização do Windows).
- **`stop-gamelauncher.bat`**: Encerra os processos do GameLauncher.

Acesse pelo navegador do celular:
```
http://SEU_SERVER_IP:8060
```

---

## 👨‍💻 Autor

**Igor Dias**

Desenvolvido para solucionar uma necessidade real do dia a dia, unindo desenvolvimento Full Stack (React + Node.js + SQLite), integração com APIs de jogos e automação nativa do Windows em C#/Win32.

---

⭐ Se esse projeto foi útil ou interessante, deixe uma estrela no repositório!