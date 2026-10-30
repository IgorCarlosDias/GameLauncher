using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace GameLauncher
{
    internal sealed class SettingsDialog : Form
    {
        private readonly ServerController server;
        private readonly Panel[] pages = new Panel[3];
        private readonly FlatButton[] tabs = new FlatButton[3];

        private InputBox ip, frontendPort, backendPort, gameFolder, token;
        private InputBox steamGridDb, steamApi, steamUser, supabaseUrl, supabaseKey, supabaseEmail, supabasePassword;
        private ToggleSwitch swFirewall, swAutoStart, swShortcut;
        private FlatButton btnSave;
        private Label status;

        public string Warning { get; private set; }

        public SettingsDialog(ServerController server, bool autoStartEnabled)
        {
            this.server = server;

            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterParent;
            ShowInTaskbar = false;
            KeyPreview = true;
            DoubleBuffered = true;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Text = "Configurações";
            ClientSize = new Size(Theme.Px(500), Theme.Px(540));

            var titleBar = new TitleBar
            {
                Text = "Configurações",
                Subtitle = "Setup & .env",
                ShowMinimize = false,
                Bounds = Theme.Area(0, 0, 500, 40)
            };
            titleBar.CloseClicked += delegate { DialogResult = DialogResult.Cancel; };
            Controls.Add(titleBar);

            BuildTabs();
            BuildNetworkPage(pages[0]);
            BuildKeysPage(pages[1]);
            BuildSystemPage(pages[2], autoStartEnabled);
            BuildFooter();
            ShowPage(0);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.StyleFramelessWindow(this, 12);
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            if (e.KeyCode == Keys.Escape) DialogResult = DialogResult.Cancel;
            base.OnKeyDown(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            using (var sep = new Pen(Theme.BorderSubtle))
            {
                g.DrawLine(sep, 0, Theme.Px(40), Width, Theme.Px(40));
                g.DrawLine(sep, Theme.Px(22), Theme.Px(474), Theme.Px(478), Theme.Px(474));
            }

            if (!Native.IsWin11)
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (GraphicsPath borderPath = Theme.RoundRect(new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f), Theme.Px(12)))
                using (var borderPen = new Pen(Theme.Border))
                    g.DrawPath(borderPen, borderPath);
            }
        }

        private void BuildTabs()
        {
            string[] titles = { "Rede e Jogos", "Chaves de API", "Sistema" };
            for (int i = 0; i < pages.Length; i++)
            {
                int index = i;
                tabs[i] = new FlatButton(titles[i], ButtonKind.Utility)
                {
                    Bounds = Theme.Area(22 + i * 118, 52, 112, 30),
                    Font = Theme.SmallBold
                };
                tabs[i].Click += delegate { ShowPage(index); };

                pages[i] = new Panel { Bounds = Theme.Area(22, 96, 456, 366), BackColor = Theme.Bg };
                Controls.Add(tabs[i]);
                Controls.Add(pages[i]);
            }
        }

        private void BuildNetworkPage(Panel page)
        {
            ip = AddField(page, "IP do servidor", 0, 0, 212, server.Env.Get("SERVER_IP", server.LocalIp));
            frontendPort = AddField(page, "Porta Frontend", 224, 0, 110, server.FrontendPort.ToString());
            backendPort = AddField(page, "Porta Backend", 346, 0, 110, server.BackendPort.ToString());

            gameFolder = AddField(page, "Pasta de jogos (GAME_FOLDER)", 0, 66, 344, server.Env.Get("GAME_FOLDER", ""));
            AddAction(page, "Procurar", 354, 86, delegate { BrowseFolder(); });

            token = AddField(page, "Token de segurança (API_TOKEN)", 0, 132, 344, server.Env.Get("API_TOKEN", ServerController.NewToken()));
            AddAction(page, "Gerar novo", 354, 152, delegate { token.Text = ServerController.NewToken(); });

            page.Controls.Add(new Label
            {
                Text = "Sincroniza automaticamente os arquivos .env da raiz, backend e frontend.\r\nReinicie o servidor após alterar portas.",
                ForeColor = Theme.Muted,
                Font = Theme.Small,
                Bounds = Theme.Area(0, 206, 456, 44)
            });
        }

        private void BuildKeysPage(Panel page)
        {
            steamGridDb = AddField(page, "SteamGridDB API Key", 0, 0, 456, server.Env.Get("STEAMGRIDDB_KEY", ""));
            steamApi = AddField(page, "Steam Web API Key", 0, 60, 456, server.Env.Get("STEAM_API_KEY", ""));
            steamUser = AddField(page, "Steam User ID64", 0, 120, 456, server.Env.Get("STEAM_USER_ID", ""));
            supabaseUrl = AddField(page, "Supabase URL", 0, 180, 456, server.Env.Get("SUPABASE_URL", ""));
            supabaseKey = AddField(page, "Supabase Key", 0, 240, 456, server.Env.Get("SUPABASE_KEY", ""));
            supabaseEmail = AddField(page, "Supabase E-mail", 0, 300, 222, server.Env.Get("SUPABASE_EMAIL", ""));
            supabasePassword = AddField(page, "Supabase Senha", 234, 300, 222, server.Env.Get("SUPABASE_PASSWORD", ""));
            supabasePassword.Box.UseSystemPasswordChar = true;
        }

        private void BuildSystemPage(Panel page, bool autoStartEnabled)
        {
            swFirewall = AddSwitch(page, "Aplicar regras de firewall para as portas configuradas", 8, true);
            swAutoStart = AddSwitch(page, "Iniciar o servidor silenciosamente com o Windows", 48, autoStartEnabled);
            swShortcut = AddSwitch(page, "Criar atalho do GameLauncher na Área de Trabalho", 88, false);
        }

        private void BuildFooter()
        {
            status = new Label
            {
                ForeColor = Theme.Muted,
                Font = Theme.Small,
                Bounds = Theme.Area(22, 488, 212, 36),
                TextAlign = ContentAlignment.MiddleLeft
            };

            var cancel = new FlatButton("Cancelar", ButtonKind.Secondary) { Bounds = Theme.Area(242, 488, 96, 36) };
            cancel.Click += delegate { DialogResult = DialogResult.Cancel; };

            btnSave = new FlatButton("Salvar e Aplicar", ButtonKind.Primary) { Bounds = Theme.Area(346, 488, 132, 36) };
            btnSave.Click += async (s, e) => await SaveAsync();

            Controls.AddRange(new Control[] { status, cancel, btnSave });
        }

        private void ShowPage(int index)
        {
            for (int i = 0; i < pages.Length; i++)
            {
                pages[i].Visible = i == index;
                tabs[i].Selected = i == index;
                tabs[i].Invalidate();
            }
        }

        private static InputBox AddField(Control parent, string caption, int x, int y, int width, string value)
        {
            parent.Controls.Add(new Label
            {
                Text = caption,
                ForeColor = Theme.Muted,
                Font = Theme.Small,
                Bounds = Theme.Area(x, y, width, 18)
            });

            var box = new InputBox { Bounds = Theme.Area(x, y + 20, width, 32), Text = value };
            parent.Controls.Add(box);
            return box;
        }

        private static void AddAction(Control parent, string text, int x, int y, EventHandler onClick)
        {
            var button = new FlatButton(text, ButtonKind.Secondary) { Bounds = Theme.Area(x, y, 102, 32), Font = Theme.SmallBold };
            button.Click += onClick;
            parent.Controls.Add(button);
        }

        private static ToggleSwitch AddSwitch(Control parent, string text, int y, bool isChecked)
        {
            var toggle = new ToggleSwitch { Text = text, Checked = isChecked, Bounds = Theme.Area(0, y, 456, 24) };
            parent.Controls.Add(toggle);
            return toggle;
        }

        private void BrowseFolder()
        {
            using (var dialog = new FolderBrowserDialog { Description = "Selecione a pasta onde seus jogos estão instalados" })
            {
                if (Directory.Exists(gameFolder.Text)) dialog.SelectedPath = gameFolder.Text;
                if (dialog.ShowDialog(this) == DialogResult.OK) gameFolder.Text = dialog.SelectedPath;
            }
        }

        private static bool IsValidPort(string text, out int port)
        {
            return int.TryParse(text.Trim(), out port) && port > 0 && port < 65536;
        }

        private void Fail(string message, int page)
        {
            status.ForeColor = Theme.DangerText;
            status.Text = message;
            ShowPage(page);
        }

        private async Task SaveAsync()
        {
            int fe, be;
            if (!IsValidPort(frontendPort.Text, out fe) || !IsValidPort(backendPort.Text, out be)) { Fail("Informe portas entre 1 e 65535.", 0); return; }
            if (fe == be) { Fail("Use portas distintas para front e back.", 0); return; }

            var settings = new AppSettings
            {
                ServerIp = ip.Text, FrontendPort = fe.ToString(), BackendPort = be.ToString(),
                GameFolder = gameFolder.Text, ApiToken = token.Text,
                SteamGridDbKey = steamGridDb.Text, SteamApiKey = steamApi.Text, SteamUserId = steamUser.Text,
                SupabaseUrl = supabaseUrl.Text, SupabaseKey = supabaseKey.Text,
                SupabaseEmail = supabaseEmail.Text, SupabasePassword = supabasePassword.Text
            };
            bool firewall = swFirewall.Checked, autoStart = swAutoStart.Checked, shortcut = swShortcut.Checked;

            btnSave.Enabled = false;
            status.ForeColor = Theme.Muted;
            status.Text = "Salvando configurações...";

            ApplyResult result = await Task.Run(() => server.ApplySettings(settings, firewall, autoStart, shortcut));
            if (!result.Saved)
            {
                btnSave.Enabled = true;
                Fail("Erro: " + result.Message, 0);
                return;
            }

            Warning = result.Message;
            DialogResult = DialogResult.OK;
        }
    }
}
