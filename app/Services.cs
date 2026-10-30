using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

namespace GameLauncher
{
    internal sealed class AppSettings
    {
        public string ServerIp, FrontendPort, BackendPort, GameFolder, ApiToken;
        public string SteamGridDbKey, SteamApiKey, SteamUserId;
        public string SupabaseUrl, SupabaseKey, SupabaseEmail, SupabasePassword;
    }

    internal sealed class ApplyResult
    {
        public bool Saved;
        public string Message;
    }

    internal struct ServerStatus
    {
        public bool Frontend;
        public bool Backend;
        public bool Online { get { return Frontend || Backend; } }
    }

    // Lê o .env somente quando o arquivo muda, evitando I/O a cada ciclo de status.
    internal sealed class EnvConfig
    {
        private readonly string path;
        private readonly Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        private DateTime stamp = DateTime.MinValue;

        public EnvConfig(string projectDir)
        {
            path = Path.Combine(projectDir, ".env");
        }

        public bool Exists { get { return File.Exists(path); } }

        public string Get(string key, string fallback)
        {
            Reload();
            string value;
            return values.TryGetValue(key, out value) && value.Length > 0 ? value : fallback;
        }

        public int GetPort(int fallback, params string[] keys)
        {
            Reload();
            foreach (string key in keys)
            {
                string raw;
                int port;
                if (values.TryGetValue(key, out raw) && int.TryParse(raw, out port) && port > 0 && port < 65536)
                    return port;
            }
            return fallback;
        }

        private void Reload()
        {
            try
            {
                DateTime written = File.GetLastWriteTimeUtc(path);
                if (written == stamp) return;
                stamp = written;
                values.Clear();
                if (!File.Exists(path)) return;

                foreach (string line in File.ReadAllLines(path))
                {
                    string trimmed = line.Trim().TrimStart('\uFEFF');
                    int split = trimmed.IndexOf('=');
                    if (trimmed.StartsWith("#") || split <= 0) continue;
                    values[trimmed.Substring(0, split).Trim()] = trimmed.Substring(split + 1).Trim().Trim('"', '\'');
                }
            }
            catch { }
        }
    }

    internal sealed class ServerController
    {
        private const string AutoStartTask = "GameLauncherAutostart";
        private static readonly TimeSpan IpCacheTime = TimeSpan.FromSeconds(30);

        private readonly EnvConfig env;
        private string cachedIp;
        private DateTime cachedIpAt = DateTime.MinValue;

        public ServerController()
        {
            ProjectDir = ResolveProjectDir();
            env = new EnvConfig(ProjectDir);
        }

        public string ProjectDir { get; private set; }
        public EnvConfig Env { get { return env; } }
        public int FrontendPort { get { return env.GetPort(8060, "FRONTEND_PORT", "VITE_PORT"); } }
        public int BackendPort { get { return env.GetPort(3060, "PORT"); } }
        public string Address { get { return LocalIp + ":" + FrontendPort; } }
        public string Url { get { return "http://" + Address; } }

        public string LocalIp
        {
            get
            {
                if (cachedIp == null || DateTime.UtcNow - cachedIpAt > IpCacheTime)
                {
                    cachedIp = DetectLocalIp() ?? env.Get("SERVER_IP", "127.0.0.1");
                    cachedIpAt = DateTime.UtcNow;
                }
                return cachedIp;
            }
        }

        public ServerStatus Probe()
        {
            var listening = new HashSet<int>();
            foreach (IPEndPoint endpoint in IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners())
                listening.Add(endpoint.Port);

            return new ServerStatus { Frontend = listening.Contains(FrontendPort), Backend = listening.Contains(BackendPort) };
        }

        public bool Start(bool hidden)
        {
            return RunPowerShell(ScriptArgs("start-gamelauncher.ps1", hidden ? " -Hidden" : ""), hidden, false);
        }

        public bool Stop()
        {
            return RunPowerShell(ScriptArgs("stop-gamelauncher.ps1", ""), true, true);
        }

        public bool ApplyFirewall()
        {
            return ApplyFirewall(FrontendPort, BackendPort);
        }

        public bool ApplyFirewall(int frontendPort, int backendPort)
        {
            string command = string.Format(
                "Get-NetFirewallRule -DisplayName 'GameLauncher*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue; " +
                "New-NetFirewallRule -DisplayName 'GameLauncher [TCP {0}, {1} - Sub-rede e Tailscale]' " +
                "-Direction Inbound -Action Allow -Protocol TCP -LocalPort {0}, {1} " +
                "-RemoteAddress '192.168.0.0/24', '100.64.0.0/10', '127.0.0.1' -Profile Any -Enabled True",
                backendPort, frontendPort);
            return RunPowerShell("-Command \"" + command + "\"", true, true);
        }

        public bool IsAutoStartEnabled()
        {
            return RunProcess("schtasks.exe", "/query /tn " + AutoStartTask);
        }

        public bool SetAutoStart(bool enable)
        {
            return enable
                ? RunPowerShell(ScriptArgs("setup-autostart.ps1", ""), true, true)
                : RunProcess("schtasks.exe", "/delete /tn " + AutoStartTask + " /f");
        }

        public ApplyResult ApplySettings(AppSettings settings, bool firewall, bool autoStart, bool desktopShortcut)
        {
            try
            {
                WriteEnvFiles(settings);
                cachedIpAt = DateTime.MinValue;
            }
            catch (Exception ex)
            {
                return new ApplyResult { Saved = false, Message = ex.Message };
            }

            var issues = new List<string>();
            int frontend, backend;
            if (!int.TryParse(settings.FrontendPort, out frontend)) frontend = 8060;
            if (!int.TryParse(settings.BackendPort, out backend)) backend = 3060;

            if (firewall && !ApplyFirewall(frontend, backend)) issues.Add("firewall não aplicado");
            if (autoStart && !SetAutoStart(true)) issues.Add("auto-start não configurado");
            if (!autoStart && IsAutoStartEnabled() && !SetAutoStart(false)) issues.Add("auto-start não removido");
            if (desktopShortcut && !CreateDesktopShortcut()) issues.Add("atalho não criado");

            return new ApplyResult { Saved = true, Message = issues.Count == 0 ? null : string.Join("; ", issues) };
        }

        public static string NewToken()
        {
            var bytes = new byte[16];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(bytes);
            var sb = new StringBuilder("gl_sec_");
            foreach (byte b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        private void WriteEnvFiles(AppSettings s)
        {
            string ip = Clean(s.ServerIp), fe = Clean(s.FrontendPort), be = Clean(s.BackendPort), token = Clean(s.ApiToken);

            var viteLines = new[]
            {
                "VITE_SERVER_IP=" + ip,
                "VITE_PORT=" + fe,
                "VITE_API_PORT=" + be,
                "VITE_API_URL=http://" + ip + ":" + be,
                "VITE_API_TOKEN=" + token
            };

            var root = new StringBuilder();
            root.AppendLine("# CONFIGURACAO CENTRAL DO GAMELAUNCHER");
            root.AppendLine("SERVER_IP=" + ip);
            root.AppendLine("PORT=" + be);
            root.AppendLine("FRONTEND_PORT=" + fe);
            root.AppendLine("GAME_FOLDER=" + Clean(s.GameFolder));
            root.AppendLine("API_TOKEN=" + token);
            root.AppendLine();
            foreach (string line in viteLines) root.AppendLine(line);
            root.AppendLine();
            root.AppendLine("STEAMGRIDDB_KEY=" + Clean(s.SteamGridDbKey));
            root.AppendLine("STEAM_API_KEY=" + Clean(s.SteamApiKey));
            root.AppendLine("STEAM_USER_ID=" + Clean(s.SteamUserId));
            root.AppendLine();
            root.AppendLine("SUPABASE_URL=" + Clean(s.SupabaseUrl));
            root.AppendLine("SUPABASE_KEY=" + Clean(s.SupabaseKey));
            root.AppendLine("SUPABASE_EMAIL=" + Clean(s.SupabaseEmail));
            root.AppendLine("SUPABASE_PASSWORD=" + Clean(s.SupabasePassword));

            // UTF-8 sem BOM: um BOM invalidaria a primeira chave lida pelo Vite/dotenv.
            var utf8 = new UTF8Encoding(false);
            File.WriteAllText(Path.Combine(ProjectDir, ".env"), root.ToString(), utf8);
            if (Directory.Exists(Path.Combine(ProjectDir, "backend")))
                File.WriteAllText(Path.Combine(ProjectDir, "backend", ".env"), root.ToString(), utf8);
            if (Directory.Exists(Path.Combine(ProjectDir, "frontend")))
                File.WriteAllText(Path.Combine(ProjectDir, "frontend", ".env"), string.Join(Environment.NewLine, viteLines) + Environment.NewLine, utf8);
        }

        private bool CreateDesktopShortcut()
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(shellType);
                string link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "GameLauncher.lnk");
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
                Type type = shortcut.GetType();

                type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { Application.ExecutablePath });
                type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { ProjectDir });
                type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Application.ExecutablePath });
                type.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private string ScriptArgs(string script, string extra)
        {
            return "-File \"" + Path.Combine(ProjectDir, script) + "\"" + extra;
        }

        private bool RunPowerShell(string arguments, bool hidden, bool wait)
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -ExecutionPolicy Bypass " + arguments,
                    WorkingDirectory = ProjectDir,
                    UseShellExecute = true,
                    WindowStyle = hidden ? ProcessWindowStyle.Hidden : ProcessWindowStyle.Normal
                };
                using (Process process = Process.Start(info))
                {
                    if (process == null) return false;
                    if (!wait) return true;
                    process.WaitForExit();
                    return process.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool RunProcess(string file, string arguments)
        {
            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = file,
                    Arguments = arguments,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using (Process process = Process.Start(info))
                {
                    process.StandardOutput.ReadToEnd();
                    process.WaitForExit();
                    return process.ExitCode == 0;
                }
            }
            catch
            {
                return false;
            }
        }

        // Prefere adaptadores físicos na faixa 192.168.x.x / 10.x.x.x, ignorando switches virtuais.
        private static string DetectLocalIp()
        {
            try
            {
                foreach (NetworkInterface nic in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;

                    string name = nic.Name.ToLowerInvariant();
                    if (name.Contains("vethernet") || name.Contains("virtual") || name.Contains("wsl")) continue;

                    foreach (UnicastIPAddressInformation address in nic.GetIPProperties().UnicastAddresses)
                    {
                        if (address.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        string ip = address.Address.ToString();
                        if (ip.StartsWith("192.168.") || ip.StartsWith("10.")) return ip;
                    }
                }
            }
            catch { }
            return null;
        }

        private static string ResolveProjectDir()
        {
            string exePath = Assembly.GetExecutingAssembly().Location;
            string dir = (!string.IsNullOrEmpty(exePath) ? Path.GetDirectoryName(exePath) : AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
            if (File.Exists(Path.Combine(dir, "package.json"))) return dir;

            DirectoryInfo parent = Directory.GetParent(dir);
            return parent != null && File.Exists(Path.Combine(parent.FullName, "package.json")) ? parent.FullName : dir;
        }

        private static string Clean(string value)
        {
            return (value ?? "").Replace("\r", "").Replace("\n", "").Trim();
        }
    }
}
