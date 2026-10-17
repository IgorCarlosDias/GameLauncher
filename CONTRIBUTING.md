# 🤝 Contribuindo com o GameLauncher

Obrigado pelo interesse em contribuir com o **GameLauncher**! Este projeto é de código aberto e qualquer contribuição (relato de bugs, sugestões, melhorias no código ou documentação) é muito bem-vinda.

---

## 🛠️ Ambiente de Desenvolvimento

### Pré-requisitos
- **Node.js**: v18 ou superior (recomendado v20 LTS)
- **NPM**: v9 ou superior
- **Git**
- **Sistema Operacional**: Windows 10/11 (recomendado para testar detecção de jogos locais e atalhos)

### 🚀 Primeiros Passos

1. **Faça um Fork e Clone:**
   ```bash
   git clone https://github.com/IgorCarlosDias/GameLauncher.git
   cd GameLauncher
   ```

2. **Instale as dependências:**
   ```bash
   # Na raiz (dependências do backend)
   npm install

   # No diretório frontend
   cd frontend
   npm install
   cd ..
   ```

3. **Inicie o ambiente de desenvolvimento:**
   ```bash
   # Inicia backend e frontend simultaneamente
   npm run dev
   ```

---

## 🧪 Padrões e Verificações de Código

Antes de abrir um Pull Request, certifique-se de que os testes e verificações estáticas foram aprovados:

```bash
# Validar sintaxe do backend
node --check backend/server.js

# Executar linter ultrarrápido (Oxlint) no frontend
cd frontend
npm run lint

# Validar compilação do Vite
npm run build
```

---

## 🌿 Fluxo Git

1. Crie uma branch a partir de `main` ou `dev`:
   ```bash
   git checkout -b feature/nome-da-sua-feature
   ```
2. Faça commits atômicos e com mensagens descritivas seguindo a convenção [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: adiciona suporte a launcher X`
   - `fix: corrige problema de ordenação de jogos`
   - `docs: atualiza instruções de instalação`
3. Abra um **Pull Request** detalhando o que foi alterado.
