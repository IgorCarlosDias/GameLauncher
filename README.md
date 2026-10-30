# 🎮 GameLauncher

Um launcher de jogos local e central de controle remoto desenvolvido para transformar um computador conectado à TV em um verdadeiro console de sala, controlado inteiramente pelo celular.

A ideia surgiu de uma necessidade real: com o PC conectado na TV da sala, trocar de jogo, ajustar o volume, alternar o áudio entre a TV e o headset ou digitar algo exigia levantar do sofá e usar mouse e teclado físicos.

Com o **GameLauncher**, basta abrir o app (ou PWA) no celular para navegar pela sua biblioteca com capas automáticas, iniciar ou encerrar jogos, acompanhar conquistas e controlar todo o Windows remotamente.

---

## 🚀 Funcionalidades

### 📚 Biblioteca & Experiência de Console
- **Carregamento Paralelo & Persistência SQLite (`better-sqlite3`)**: Escaneamento recursivo rápido de pastas (`.exe`, `.lnk`, `.url`) com cache local persistente.
- **⭐ Favoritos & "Continuar Jogando"**: Marque seus jogos preferidos e acesse rapidamente os últimos jogos abertos no topo da tela.
- **⏱️ Rastreamento Automático de Tempo de Jogo**: Contabiliza automaticamente o tempo total jogado e a quantidade de sessões de cada título.
- **🏆 Badges de Conquistas nos Cards (v1.3.0)**: Indicador visual com ícone de troféu (`🏆 X/Y`) exibido diretamente nos cartões e na visualização em lista, com destaque dourado para jogos platinados (100%).
- **🖼️ Galeria Interativa SteamGridDB & Edição**: Busque e escolha entre dezenas de capas oficiais direto pelo celular, envie uma URL personalizada ou renomeie o título de exibição de qualquer jogo.
- **🔍 Detecção Automática de Jogo em Execução**: Monitora em segundo plano se o processo do jogo continua aberto no PC e salva o tempo da sessão assim que você sai do jogo.
- **🛑 Fechamento Inteligente (`Alt+F4` vs `Taskkill`)**: Opção de fechamento suave (`Alt+F4` para salvar progresso) ou encerramento imediato da árvore de processos (`Taskkill /F /T`).
- **🔮 Notificações Esféricas Fluidas**: Animações visuais dinâmicas para quando um jogo é iniciado ou encerrado:
  - Uma esfera luminosa 3D com brilho radial surge sobre a posição da capa e pulsa.
  - Uma onda de choque se expande da esfera revelando o cartão em cerca de 0.9s.
  - Revelação sequencial suave da capa, badges (`🚀 INICIADO` em violeta ou `🏁 ENCERRADO` em rosa/laranja), título e duração da sessão.
  - Ao fechar ou após o tempo limite, o cartão recolhe suavemente de volta para a esfera antes de sumir.

### 🏆 Sistema Unificado de Conquistas (Steam & Jogos Locais) (v1.3.0)
- **Conquistas da Steam Oficial**: Integração com a Steam Web API e cache local para sincronizar troféus, títulos, descrições e ícones bloqueados/desbloqueados em tempo real.
- **Suporte Inovador a Jogos de PC Locais com Emuladores de Steam API**: Integração completa para jogos locais que utilizam emuladores como **Goldberg Emulator**, **CODEX**, **RUNE**, **Tenoke**, **EMPRESS**, **FLT**, entre outros:
  - Varredura e decodificação automática de arquivos de progresso locais (`achievements.json`, `achievements.ini`, `stats.ini`).
  - Suporte a múltiplos locais padrão de salvamento: `%PUBLIC%\Documents\Steam\<EMU>`, `%APPDATA%`, `%LOCALAPPDATA%` e diretório de instalação do jogo.
- **Detecção Automática de AppID**: Identificação inteligente do Steam AppID vasculhando atalhos `.lnk` (resolução do executável de destino) e até 4 níveis de profundidade de diretórios em busca de `steam_appid.txt`, `steam_emu.ini`, `steam_api64.ini` e `steam_api.ini`.
- **Modal Interativo de Conquistas**:
  - Resumo de troféus desbloqueados / total, barra de progresso com porcentagem e selo identificador (`CONQUISTAS (JOGO LOCAL)` vs oficial).
  - Exibição de ícones em alta resolução, nomes, descrições e data/hora exata do desbloqueio.
  - Botão de sincronização sob demanda e suporte a vinculação manual de Steam AppID via modal de edição rápida.

### 🕹️ Controle Remoto do PC Integrado
- **🖱️ Trackpad Virtual com Rastro Neon (60fps)**: Controle o cursor do mouse na TV deslizando o dedo no celular, com feedback visual de rastro luminoso em `<canvas>`, ondas de toque (ripple), clique esquerdo/direito, duplo clique e rolagem (scroll).
- **⌨️ Teclado Remoto Completo**: Digite textos, senhas ou pesquisas pelo celular (com opção de **Digitar** sem Enter ou **Enviar ↵** com Enter), além de teclas dedicadas (`Backspace`, `Espaço`, `Tab`, `Enter`, `Esc`, `Alt+Tab`, `Win`, `Win+D` e setas direcionais).
- **🔊 Controle de Volume & Saída de Áudio (CoreAudio / `IPolicyConfig`)**: Slider de volume em tempo real (`0–100%`), botão Mudo e seletor instantâneo de dispositivo de saída de áudio (alterne entre **TV HDMI** e **Headset/Caixas de Som** com 1 toque).
- **📺 Alternância de Tela / Projeção (PC / TV)**: Alterne a exibição entre o monitor do PC e a TV da sala com um toque através do controle remoto.
- **🎵 Controles de Mídia**: Botões para `Play/Pause`, `Próxima Faixa` e `Faixa Anterior`.
- **📊 Monitor de Desempenho em Tempo Real**: Barras de uso de **CPU (%)**, **RAM (GB)** e **Tempo Ativo (Uptime)** no topo do painel remoto.
- **⚡ Gerenciamento de Energia**: Suspender o PC ou agendar Desligamento com timer de segurança de 30 segundos e botão de cancelamento.
- **📱 Suporte PWA Completo & Vibração Tátil**: Ícones de alta resolução dedicados (192x192 e 512x512 maskable), registro automático de Service Worker para carregamento instantâneo e instalação como app nativo no smartphone.

### 🔒 Segurança & Painel de Configurações (v1.3.0)
- **🛡️ Token de Autenticação (`API_TOKEN`)**: Todas as ações do sistema (abrir jogo, energia, mouse, teclado, configurações, sync) exigem token de autenticação protegido contra ataques de temporização (`crypto.timingSafeEqual`).
- **⚙️ Painel Centralizado de Configurações**: Gerencie Steam Web API Key, SteamGridDB Key, credenciais do Supabase e API Token de segurança direto pela interface web no celular ou PC.
- **👁️ Visualização Segura com Botão de Revelação**: Visualize e copie chaves e senhas com segurança através de alternância dinâmica entre modo mascarado e texto puro, sem expor dados involuntariamente na tela.
- **📝 Persistência Automática em `.env`**: Atualização segura e imediata dos arquivos de ambiente do backend sem necessidade de edição manual de arquivos no servidor.
- **🌐 CORS Restrito**: Aceita requisições exclusivamente da origem do Frontend (`http://SERVER_IP:8060`).
- **🏡 Proteção de Sub-rede Local**: Backend e Frontend bloqueiam automaticamente conexões originadas fora da sua sub-rede privada (`192.168.0.0/24`, `10.0.0.0/8`, `172.16.0.0/12`).
- **🧱 Regras Automatizadas no Firewall do Windows**: Scripts inclusos (`setup-firewall.bat` / `setup-firewall.ps1`) para liberar as portas `3060` e `8060` apenas para a rede local, sem expor portas para outras redes.
- **☁️ Sincronização em Nuvem Segura (Supabase RLS)**: Suporte a backup em tempo real de tempos e sessões com autenticação direta (`to authenticated`).

### ⚡ Tempo Real, Autenticação & Cache Offline (v1.4.0)
- **⚡ WebSockets Bidirecionais (`/ws`)**: Comunicação em tempo real substituindo polling HTTP para status de host (Online/Offline com Heartbeat de 5s), status de jogos em execução e sincronização instantânea de volume do sistema operacional.
- **🎧 Monitor de Volume de Hardware (CoreAudio Daemon)**: Processo daemon em C# (`syscontrol.exe watchvol`) com listener de callbacks do Windows (`IAudioEndpointVolumeCallback`). Qualquer alteração física (teclado, mixer) reflete no celular imediatamente, com supressão de eco durante o arrasto do slider.
- **🛡️ Autenticação Leve Bearer & Modal de Pareamento**: Proteção de rotas REST e handshake WebSocket via `Authorization: Bearer <TOKEN>` ou query param com modal de primeiro acesso no celular ("Lembrar neste aparelho" via `localStorage`).
- **🖼️ Cache Local de Capas & Pré-Carregamento em Background**: Armazenamento offline de posters via Cache Storage API (`gamelauncher-covers-v1`) com fallback transparente para IndexedDB, carregamento a 0ms e pré-carregamento não bloqueante (`requestIdleCallback`).
- **📱 Header Mobile Compacto**: Dimensões otimizadas e espaçamento reduzido para telas menores de smartphones, mantendo layout estendido em desktops via media queries.

### 🎛️ Executável Central Nativo, Dark Dashboard & Gerenciador Unificado (v1.6.0)
- **🎨 Dark Dashboard Desktop Moderno (`GameLauncher.exe`)**: Aplicativo nativo em C# Windows (.NET 4.x, apenas ~85 KB) com estética inspirada no Raycast e Discord:
  - Janela frameless compacta (~480x580px) com cantos arredondados e borda integrada `#22272E` nativa via DWM no Windows 11 / região GDI no Windows 10.
  - **Status Card Elevado**: Indicador em verde esmeralda com pulso radial reativo, exibição do link de acesso local com cópia rápida e badges compactas em pílula de status para Frontend e Backend (`Frontend: Ativo :8060 | Backend: Ativo :3060`).
  - **Botões Ergonômicos**: Ação primária destacada (*Iniciar Servidor* com suporte a `Shift` para console), secundária elegante (*Abrir no Navegador* com resolução automática de IP e porta), contorno de perigo neutro que se ilumina em vermelho apenas no hover (*Parar Servidor*) e pílulas utilitárias para *Firewall*, *Auto-Start* e *Configurações*.
  - **Mini Feed de Logs Terminal**: Console minimalista integrado em fonte monoespaçada com timestamps, separadores semânticos (`›`) e botão de limpeza rápida.
  - **System Tray Inteligente**: Minimiza diretamente para a bandeja perto do relógio com clique duplo para restaurar, menu de contexto completo e **zero consumo de CPU** quando minimizado (animações pausadas automaticamente).
- **⚙️ Setup & Configurações Integradas**: Diálogo frameless escuro integrado para alterar portas, pasta de jogos (`GAME_FOLDER`) com seletor de pastas nativo e chaves de API, com **sincronização automática entre os 3 arquivos `.env`** (`.env`, `backend/.env`, `frontend/.env`).
- **🛡️ CORS Dinâmico & Flexibilidade Total de Portas**: O backend agora aceita requisições HTTP e WebSockets de qualquer porta de frontend originada da rede local autorizada (`192.168.0.0/24`), `localhost` ou `Tailscale`.
- **📜 Scripts PowerShell Unificados**: Automação completa com `start-gamelauncher.ps1`, `stop-gamelauncher.ps1`, `gamelauncher-manager.ps1` e compilação instantânea com `build.ps1` usando o compilador nativo `csc.exe` do Windows.

### 🎮 Suporte Unicode UTF-8 em Atalhos & Tolerância de Nomes (v1.5.2)
- **🔤 Resolução Nativa de Atalhos em Unicode (`resolvelnkb64`)**: Integração do comando `resolvelnkb64` no helper C# nativo (`syscontrol.exe`), resolvendo atalhos `.lnk` com suporte completo a caracteres acentuados (UTF-8/UTF-16) sem perda ou corrupção de diacríticos em caminhos e argumentos.
- **🛡️ Tolerância a Renomeação de Arquivos**: Fallback automático com normalização de diacríticos para localizar atalhos renomeados (ex: `POKKÉN` ↔ `POKKEN`) e atualizar o banco de dados dinamicamente.
- **🚀 Correção de Inicialização no Yuzu**: Fim do erro *"O formato da ROM não é suportado"* em jogos cujos caminhos ou ROMs contenham acentos.

### 🖱️ Touchpad Virtual com Botões de Mouse Real & Otimizações (v1.5.0)
- **🖱️ Botões Físicos de Mouse Real**: Dois botões dedicados (Botão Esquerdo e Botão Direito) integrados logo abaixo do Touchpad Virtual com ergonomia e estética de mouse físico (deck com fenda central, indicador de apoio tátil e ícones direcionais).
- **⚡ Resposta Imediata & Háptica**: Disparo instantâneo com feedback háptico (`haptic.tap()`), animação mecânica de clique no estado ativo e prevenção de menu de contexto nativo do navegador.
- **🚀 Otimizações de Desempenho no Backend**: Verificação nativa $O(1)$ de processos via `process.kill(pid, 0)`, delegação de tarefas pesadas ao `syscontrol.exe` em C# nativo, e execução com classe de prioridade otimizada para jogos.

---

## 🖥️ Arquitetura

```
Celular (PWA / Navegador na Rede Local)
   │
   │  WebSocket Bidirecional (/ws) + HTTP REST (Bearer Auth / CORS Restrito)
   ▼
React 19 + Vite Frontend (Porta 8060)
   │  (Filtro de Sub-rede Local 192.168.0.0/24 + Cache de Capas CacheStorage/IDB)
   ▼
Node.js + Express Backend (Porta 3060)
   ├── WebSocket Server (/ws)     ──► Heartbeats, Push de Volume & Jogos Ativos
   ├── SQLite (better-sqlite3)    ──► Favoritos, Playtime, Capas, Conquistas e Metadados
   ├── Steam Achievements Service ──► Steam Web API + Cache Local + Emuladores (Goldberg, CODEX, RUNE, Tenoke, EMPRESS, FLT)
   ├── SteamGridDB Service        ──► Busca e Download Automático de Capas
   ├── Supabase Sync (RLS)        ──► Backup Contínuo e Sincronização em Nuvem
   └── syscontrol.exe (C#/Win32)  ──► CoreAudio Daemon (watchvol), IPolicyConfig, SendInput (Mouse/Teclado)
```

---

## 🛠️ Tecnologias Utilizadas

### Frontend
- **React 19** + **Vite**
- **Axios** com interceptor para autenticação via `x-api-token`
- **HTML5 Canvas** (rastro interativo do Trackpad Virtual)
- **CSS3 Moderno** (Design responsivo Dark Glassmorphism, Animações 3D com Clip-Path + PWA Manifest)
- **Vite PWA Plugin** (Service Worker com precaching de assets)

### Backend & Automação Nativa
- **Node.js** + **Express 5**
- **SQLite (`better-sqlite3`)** para banco de dados local zero-config
- **Steam Web API & Motor de Emuladores de Jogos Locais**:
  - Parsers especializados para `.ini` e `.json` de salvamentos de emuladores (Goldberg, CODEX, RUNE, Tenoke, EMPRESS, FLT)
  - Inspeção de registro do Windows para identificação de usuário Steam ativo
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
├── start-gamelauncher.bat       # Script para iniciar Backend + Frontend com elevação
├── start-hidden.vbs             # Inicializador invisível em segundo plano (sem console)
├── stop-gamelauncher.bat        # Script para encerrar instâncias ativas como Administrador
├── setup-autostart.bat          # Registra inicialização automática silenciosa no Agendador do Windows
├── setup-autostart.ps1          # Cria tarefa agendada com privilégios elevados (RunLevel Highest)
├── setup-firewall.bat           # Configuração rápida de regras de sub-rede no Firewall
├── setup-firewall.ps1           # Script PowerShell elevado para regras restritas de firewall
│
├── backend
│   ├── server.js                # API Express, validações de segurança, scanner e rotas
│   ├── database.js              # Camada de persistência SQLite (jogos, favoritos, conquistas, playtime)
│   ├── syscontrol.cs            # Código-fonte do controlador nativo Win32/CoreAudio em C#
│   ├── syscontrol.exe           # Binário nativo compilado para controle rápido do Windows
│   ├── services
│   │   ├── steamAchievements.js # Integração Steam Web API, cache local e emuladores (Goldberg, CODEX, RUNE, etc.)
│   │   ├── steamgriddb.js       # Integração com a API do SteamGridDB
│   │   └── supabaseSync.js      # Sincronização em nuvem e login autenticado no Supabase
│   ├── supabase_rls_authenticated.sql # Script SQL para aplicar RLS no Supabase
│   ├── covers                   # Cache local das capas baixadas
│   ├── .env.example
│   └── package.json
│
└── frontend
    ├── public
    │   ├── manifest.json        # Configuração PWA para instalação no celular
    │   ├── pwa-192x192.png      # Ícone PWA alta resolução
    │   └── pwa-512x512.png      # Ícone PWA maskable
    ├── src
    │   ├── components           # Componentes modulares
    │   │   ├── AchievementsModal.jsx  # Modal detalhado de conquistas e progresso
    │   │   ├── GameActionsSheet.jsx   # Menu de ações rápidas, capas, conquistas e edição de AppID
    │   │   ├── GameCard.jsx           # Card com badge visual de conquistas e capa
    │   │   ├── GameRow.jsx            # Linha da lista com indicador de troféus
    │   │   └── ...
    │   ├── pages
    │   │   └── SettingsPage.jsx # Painel de configurações com revelação de credenciais
    │   ├── App.jsx              # Interface principal, Trackpad Canvas, Notificações e Controle
    │   ├── main.jsx
    │   └── index.css            # Estilização completa e animações da notificação esférica
    ├── vite.config.js           # Configuração Vite com proteção de sub-rede local e strictPort
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
API_TOKEN=gl_sec_seu_token_aqui
STEAMGRIDDB_KEY=sua_chave_api_do_steamgriddb

# Conquistas Steam & Jogos Locais (Opcional)
STEAM_API_KEY=sua_chave_api_da_steam
STEAM_ID64=7656119... # Opcional: detectado automaticamente do Windows se omitido

# Sincronização em Nuvem - Supabase (Opcional)
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

> **💡 Dica sobre Conquistas**: 
> - A `STEAM_API_KEY` pode ser gerada gratuitamente em [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey). Ela permite baixar automaticamente os nomes, descrições e ícones de alta resolução de todas as conquistas do jogo da Steam, mesmo para jogos locais com emuladores.
> - Se o seu jogo local estiver com um emulador de Steam API (Goldberg, CODEX, RUNE, Tenoke, EMPRESS, FLT), o GameLauncher detectará o AppID automaticamente e lerá as conquistas salvas no seu computador. Você também pode associar manualmente o AppID clicando nos três pontinhos (`⋮`) do jogo -> **Editar Informações**.

### 3. Configurar Firewall do Windows (Recomendado)

Execute como Administrador ou dê dois cliques em:
```text
setup-firewall.bat
```
Isso cria regras liberando as portas `3060` e `8060` estritamente para a sua sub-rede local (`192.168.0.0/24`), bloqueando qualquer tentativa externa. Se você formatar o PC ou trocar de rede, basta executar esse script novamente.

---

## 🚀 Execução, Controle e Configurações

### 🎛️ Executável Central Unificado (Tudo-em-Um)
- **`GameLauncher.exe`**: Painel de controle nativo Windows com ícone na bandeja do sistema (System Tray) e central de configurações integrada:
  - 🟢 **Status em Tempo Real:** Monitora as portas ativas do Frontend e Backend e exibe a URL de acesso dinamicamente.
  - ▶ **Iniciar Servidor:** Modo oculto (segundo plano) ou com janela de logs.
  - ⏹ **Parar Servidor:** Encerra os serviços e libera as portas.
  - 🌐 **Abrir no Navegador:** Dispara diretamente a URL `http://<IP_DO_PC>:<PORTA_FRONT>`.
  - ⚙️ **Configurações & Setup:** Abre o painel completo de configuração para escolher a pasta dos jogos, portas do frontend e backend, e chaves de API com persistência automática nos arquivos `.env`.
  - 🛡 **Firewall com 1 Clique:** Aplica regras no Windows Defender Firewall para as portas configuradas.
  - ⏰ **Auto-Start no Windows:** Ativa ou desativa a inicialização automática silenciosa como Administrador.
  - 📌 **Minimizar para a Bandeja:** Fica discreto perto do relógio do Windows com atalhos rápidos ao clicar com o botão direito.

### Scripts PowerShell & Automação
- **`gamelauncher-manager.ps1`**: Gerenciador via PowerShell com menu interativo no terminal ou parâmetros (`-Action Start`, `-Action Stop`, `-Action Firewall`, `-Action AutoStart`, `-Action OpenBrowser`).
- **`start-gamelauncher.ps1`**: Inicia backend e frontend como Administrador (suporta flag `-Hidden`).
- **`stop-gamelauncher.ps1`**: Encerra os processos nas portas configuradas e `syscontrol`.
- **`setup-firewall.ps1`**: Configura as regras restritas no Firewall do Windows.
- **`setup-autostart.ps1`**: Configura o Agendador de Tarefas para iniciar com o Windows como Administrador silencioso.
- **`build.ps1`**: Script de compilação que recompila o `GameLauncher.exe` unificado instantaneamente.

### Inicialização Automática com o Windows (Silenciosa & Sem Console)

Para que o GameLauncher inicie automaticamente quando você ligar o PC, **sem abrir janela preta de console** e **sem pedir confirmação de UAC na TV**:

1. Dê dois cliques em **`setup-autostart.bat`**.
2. Conceda permissão de Administrador uma única vez.
3. O script registra a tarefa **`GameLauncherAutostart`** no Agendador de Tarefas do Windows com nível de privilégio máximo (`RunLevel: Highest`) e executa o inicializador invisível (`start-hidden.vbs`).

> **💡 Por que usar o Agendador de Tarefas em vez da pasta `shell:startup`?**
> A pasta tradicional de Inicializar do Windows não permite iniciar programas em modo Administrador sem disparar a janela de prompt e a tela do UAC. Usando o Agendador de Tarefas com privilégios elevados, o GameLauncher inicia silenciosamente e ganha permissão nativa para controlar jogos que rodam como Administrador (UIPI do Windows).

### Prevenção de Conflito de Portas
- O script de inicialização limpa automaticamente processos órfãos nas portas `3060` e `8060` antes de inicializar.
- O Vite está configurado com `strictPort: true`, impedindo que o frontend mude silenciosamente para a porta `8061` e quebre as conexões do celular ou regras de firewall.

---

## 📱 Acessando pelo Celular

Acesse pelo navegador do smartphone conectado ao mesmo Wi-Fi:
```
http://SEU_SERVER_IP:8060
```
- No **Chrome / Android**: Toque no menu e selecione **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
- No **Safari / iOS**: Toque no botão de compartilhar e selecione **"Adicionar à Tela de Início"**.

---

## 👨‍💻 Autor

**Igor Dias**

Desenvolvido para solucionar uma necessidade real do dia a dia, unindo desenvolvimento Full Stack (React + Node.js + SQLite), integração com APIs de jogos e automação nativa do Windows em C#/Win32.

---

⭐ Se esse projeto foi útil ou interessante, deixe uma estrela no repositório!
