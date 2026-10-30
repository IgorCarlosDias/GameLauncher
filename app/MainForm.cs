using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace GameLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Native.EnableDpiAwareness();

            bool created;
            using (new System.Threading.Mutex(true, "GameLauncher.Manager.SingleInstance", out created))
            {
                if (!created) return;

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(HasFlag(args, "--hidden"), HasFlag(args, "--setup")));
            }
        }

        private static bool HasFlag(string[] args, string flag)
        {
            return args != null && args.Any(a => a.Equals(flag, StringComparison.OrdinalIgnoreCase));
        }
    }

    internal sealed class MainForm : Form
    {
        private const int PollVisibleMs = 3000;
        private const int PollHiddenMs = 10000;
        private static readonly TimeSpan AutoStartRecheck = TimeSpan.FromSeconds(30);

        private readonly ServerController server = new ServerController();
        private readonly bool startHidden;
        private readonly Timer poll = new Timer();

        private TitleBar titleBar;
        private StatusCard card;
        private FlatButton btnStart, btnBrowser, btnStop, btnFirewall, btnAutoStart, btnSettings;
        private ToggleSwitch swTray;
        private LogFeed log;
        private NotifyIcon tray;
        private ToolStripMenuItem trayStatus;

        private bool busy, wasOnline, autoStart, trayHintShown, hiddenStartDone;
        private DateTime autoStartCheckedAt = DateTime.MinValue;

        public MainForm(bool startHidden, bool openSettings)
        {
            this.startHidden = startHidden;

            BuildWindow();
            BuildTray();

            poll.Interval = PollVisibleMs;
            poll.Tick += delegate { RefreshStatus(); };
            poll.Start();

            Log("Painel inicializado.", LogLevel.Info);
            RefreshStatus();

            if (!startHidden && (openSettings || !server.Env.Exists))
                Shown += delegate { OpenSettings(); };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.Style |= 0x20000; // WS_MINIMIZEBOX: permite minimizar pela barra de tarefas
                return cp;
            }
        }

        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && !hiddenStartDone)
            {
                hiddenStartDone = true;
                if (!IsHandleCreated) CreateHandle();
                BeginInvoke((Action)(async () => await StartAsync(true)));
                value = false;
            }
            base.SetVisibleCore(value);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.StyleFramelessWindow(this, 12);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            using (var sep = new Pen(Theme.BorderSubtle))
            {
                g.DrawLine(sep, 0, Theme.Px(40), Width, Theme.Px(40));
                g.DrawLine(sep, Theme.Px(22), Theme.Px(358), Theme.Px(458), Theme.Px(358));
            }

            if (!Native.IsWin11)
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                using (GraphicsPath borderPath = Theme.RoundRect(new RectangleF(0.5f, 0.5f, Width - 1f, Height - 1f), Theme.Px(12)))
                using (var borderPen = new Pen(Theme.Border))
                    g.DrawPath(borderPen, borderPath);
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing && swTray.Checked)
            {
                e.Cancel = true;
                Hide();
                if (!trayHintShown)
                {
                    trayHintShown = true;
                    tray.ShowBalloonTip(2000, "GameLauncher", "Continua ativo na bandeja do sistema.", ToolTipIcon.Info);
                }
                return;
            }
            base.OnFormClosing(e);
        }

        protected override void OnVisibleChanged(EventArgs e)
        {
            base.OnVisibleChanged(e);
            UpdateActivity();
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            UpdateActivity();
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                poll.Dispose();
                if (tray != null) tray.Dispose();
            }
            base.Dispose(disposing);
        }

        private void BuildWindow()
        {
            AutoScaleMode = AutoScaleMode.None;
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            DoubleBuffered = true;
            Text = "GameLauncher";
            ClientSize = new Size(Theme.Px(480), Theme.Px(580));
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { Icon = SystemIcons.Application; }

            titleBar = new TitleBar { Subtitle = "Dashboard", Bounds = Theme.Area(0, 0, 480, 40) };
            titleBar.MinimizeClicked += delegate { WindowState = FormWindowState.Minimized; };
            titleBar.CloseClicked += delegate { Close(); };

            card = new StatusCard { Bounds = Theme.Area(22, 54, 436, 136) };
            card.AddressClicked += delegate { OpenBrowser(); };

            btnStart = new FlatButton("Iniciar Servidor", ButtonKind.Primary, IconGlyph.Play) { Bounds = Theme.Area(22, 204, 436, 44) };
            btnBrowser = new FlatButton("Abrir no Navegador", ButtonKind.Secondary, IconGlyph.External) { Bounds = Theme.Area(22, 258, 214, 40) };
            btnStop = new FlatButton("Parar Servidor", ButtonKind.DangerOutline, IconGlyph.Stop) { Bounds = Theme.Area(244, 258, 214, 40) };

            btnFirewall = new FlatButton("Firewall", ButtonKind.Utility, IconGlyph.Shield) { Bounds = Theme.Area(22, 312, 140, 30), Font = Theme.SmallBold };
            btnAutoStart = new FlatButton("Auto-Start", ButtonKind.Utility) { Bounds = Theme.Area(170, 312, 140, 30), Font = Theme.SmallBold, DotColor = Theme.Faint };
            btnSettings = new FlatButton("Configurações", ButtonKind.Utility, IconGlyph.Sliders) { Bounds = Theme.Area(318, 312, 140, 30), Font = Theme.SmallBold };

            swTray = new ToggleSwitch { Text = "Minimizar para a bandeja", Checked = true, Bounds = Theme.Area(22, 370, 436, 24) };
            log = new LogFeed { Bounds = Theme.Area(22, 406, 436, 154) };

            btnStart.Click += async (s, e) => await StartAsync((ModifierKeys & Keys.Shift) == 0);
            btnBrowser.Click += delegate { OpenBrowser(); };
            btnStop.Click += async (s, e) => await StopAsync();
            btnFirewall.Click += async (s, e) => await FirewallAsync();
            btnAutoStart.Click += async (s, e) => await ToggleAutoStartAsync();
            btnSettings.Click += delegate { OpenSettings(); };

            var tips = new ToolTip();
            tips.SetToolTip(btnStart, "Inicia em segundo plano (segure Shift para abrir com console)");
            tips.SetToolTip(btnFirewall, "Libera as portas atuais para rede local e Tailscale");
            tips.SetToolTip(btnAutoStart, "Alterna inicialização automática silenciosa com o Windows");
            tips.SetToolTip(btnSettings, "Configurar portas, pasta de jogos e chaves de API");

            Controls.AddRange(new Control[] { titleBar, card, btnStart, btnBrowser, btnStop, btnFirewall, btnAutoStart, btnSettings, swTray, log });
        }

        private void BuildTray()
        {
            var menu = new ContextMenuStrip();
            trayStatus = new ToolStripMenuItem("Servidor offline") { Enabled = false };
            menu.Items.Add(trayStatus);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Iniciar servidor", null, async (s, e) => await StartAsync(true));
            menu.Items.Add("Iniciar com console", null, async (s, e) => await StartAsync(false));
            menu.Items.Add("Parar servidor", null, async (s, e) => await StopAsync());
            menu.Items.Add("Abrir no navegador", null, delegate { OpenBrowser(); });
            menu.Items.Add("Configurações", null, delegate { ShowPanel(); OpenSettings(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Mostrar painel", null, delegate { ShowPanel(); });
            menu.Items.Add("Sair", null, delegate { ExitApplication(); });

            tray = new NotifyIcon { Icon = Icon, Text = "GameLauncher", Visible = true, ContextMenuStrip = menu };
            tray.DoubleClick += delegate { ShowPanel(); };
        }

        private void ShowPanel()
        {
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        private void ExitApplication()
        {
            tray.Visible = false;
            Application.Exit();
        }

        private void UpdateActivity()
        {
            bool active = Visible && WindowState != FormWindowState.Minimized;
            poll.Interval = active ? PollVisibleMs : PollHiddenMs;
            if (card != null) card.SetWindowActive(active);
        }

        private void Log(string message, LogLevel level)
        {
            log.Add(message, level);
        }

        private void RefreshStatus()
        {
            ServerStatus status = server.Probe();
            card.SetState(status.Online, status.Frontend, status.Backend, server.Address, server.FrontendPort, server.BackendPort);

            string summary = status.Online ? "Online · " + server.Address : "Servidor offline";
            string trayText = "GameLauncher · " + summary;
            trayStatus.Text = summary;
            tray.Text = trayText.Length > 63 ? trayText.Substring(0, 63) : trayText;

            if (status.Online != wasOnline)
            {
                wasOnline = status.Online;
                Log(status.Online ? "Online em " + server.Url : "Servidor encerrado.", status.Online ? LogLevel.Ok : LogLevel.Info);
            }

            if (DateTime.UtcNow - autoStartCheckedAt > AutoStartRecheck)
                RefreshAutoStartAsync();
        }

        private async void RefreshAutoStartAsync()
        {
            autoStartCheckedAt = DateTime.UtcNow;
            bool enabled = await Task.Run(() => server.IsAutoStartEnabled());
            if (IsDisposed) return;

            autoStart = enabled;
            btnAutoStart.DotColor = enabled ? Theme.Accent : Theme.Faint;
            btnAutoStart.Selected = enabled;
            btnAutoStart.Invalidate();
        }

        private void SetBusy(bool value)
        {
            busy = value;
            btnStart.Enabled = btnStop.Enabled = btnFirewall.Enabled = btnAutoStart.Enabled = btnSettings.Enabled = !value;
        }

        private async Task<bool> WaitForStateAsync(bool online, int seconds)
        {
            for (int i = 0; i < seconds; i++)
            {
                if (server.Probe().Online == online) return true;
                await Task.Delay(1000);
            }
            return server.Probe().Online == online;
        }

        private async Task StartAsync(bool hidden)
        {
            if (busy) return;
            SetBusy(true);
            Log(hidden ? "Iniciando em segundo plano..." : "Iniciando com console...", LogLevel.Info);

            bool launched = await Task.Run(() => server.Start(hidden));
            bool up = launched && await WaitForStateAsync(true, 25);

            if (!launched) Log("Falha ao executar start-gamelauncher.ps1", LogLevel.Error);
            else if (!up) Log("Tempo esgotado aguardando portas.", LogLevel.Warn);

            SetBusy(false);
            RefreshStatus();
            if (up) tray.ShowBalloonTip(2000, "GameLauncher", "Servidor online em " + server.Url, ToolTipIcon.Info);
        }

        private async Task StopAsync()
        {
            if (busy) return;
            SetBusy(true);
            Log("Encerrando serviços...", LogLevel.Info);

            await Task.Run(() => server.Stop());
            bool down = await WaitForStateAsync(false, 10);
            if (!down) Log("Algumas portas permanecem em uso.", LogLevel.Warn);

            SetBusy(false);
            RefreshStatus();
        }

        private async Task FirewallAsync()
        {
            if (busy) return;
            SetBusy(true);
            int fe = server.FrontendPort, be = server.BackendPort;
            Log(string.Format("Liberando TCP {0}, {1} no firewall...", fe, be), LogLevel.Info);

            bool ok = await Task.Run(() => server.ApplyFirewall(fe, be));
            Log(ok ? string.Format("Firewall aplicado (TCP {0}, {1}).", fe, be) : "Falha ao aplicar regra de firewall.", ok ? LogLevel.Ok : LogLevel.Error);
            SetBusy(false);
        }

        private async Task ToggleAutoStartAsync()
        {
            if (busy) return;
            SetBusy(true);
            bool enable = !autoStart;
            Log(enable ? "Registrando tarefa de Auto-Start..." : "Removendo Auto-Start...", LogLevel.Info);

            bool ok = await Task.Run(() => server.SetAutoStart(enable));
            Log(ok ? (enable ? "Auto-Start ativado." : "Auto-Start desativado.") : "Falha ao alterar Auto-Start.", ok ? LogLevel.Ok : LogLevel.Error);

            SetBusy(false);
            RefreshAutoStartAsync();
        }

        private void OpenBrowser()
        {
            try
            {
                Process.Start(new ProcessStartInfo(server.Url) { UseShellExecute = true });
                Log("Navegador -> " + server.Url, LogLevel.Info);
            }
            catch (Exception ex)
            {
                Log("Erro ao abrir URL: " + ex.Message, LogLevel.Error);
            }
        }

        private void OpenSettings()
        {
            using (var dialog = new SettingsDialog(server, autoStart))
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;

                Log(wasOnline ? "Configurações salvas (reinicie o servidor)." : "Configurações salvas.", LogLevel.Ok);
                if (dialog.Warning != null) Log("Aviso: " + dialog.Warning, LogLevel.Warn);
                autoStartCheckedAt = DateTime.MinValue;
                RefreshStatus();
            }
        }
    }
}
