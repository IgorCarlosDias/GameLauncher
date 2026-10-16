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

---

## ⚙️ Instalação e Configuração

### Pré-requisitos
- **Windows 10 / 11**
- **Node.js** (v18 ou superior)
- Computador e celular conectados na mesma rede local (Wi-Fi / Cabo)
- Portas `8060` (Frontend) e `3060` (Backend) liberadas no Firewall do Windows

### 1. Clonar e Instalar Dependências

Na raiz do projeto, instale as dependências do projeto principal, backend e frontend:

```bash
npm install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Configurar os Arquivos `.env`

Todo o endereçamento de IP e portas do projeto é controlado via `.env` (use os arquivos `.env.example` como base):

**Na raiz (`.env`) e em `backend/.env`:**
```env
SERVER_IP=192.168.0.204
PORT=3060
FRONTEND_PORT=8060
GAME_FOLDER=C:\Caminho\Dos\Seus\Jogos
STEAMGRIDDB_KEY=sua_chave_api_do_steamgriddb
```

**Em `frontend/.env`:**
```env
VITE_SERVER_IP=192.168.0.204
VITE_API_PORT=3060
VITE_PORT=8060
VITE_API_URL=http://192.168.0.204:3060
```

> 💡 **Dica**: Caso precise recompilar o utilitário nativo `syscontrol.exe` após editar `backend/syscontrol.cs`, execute:
> ```powershell
> C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:exe /out:backend\syscontrol.exe backend\syscontrol.cs
> ```

### 3. Executar o GameLauncher

Você pode iniciar tudo com um único comando na raiz:

```bash
npm start
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