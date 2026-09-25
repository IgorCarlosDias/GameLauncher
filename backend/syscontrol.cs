using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

class Program {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern IntPtr SendMessageW(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private const int WM_APPCOMMAND = 0x0319;
    private const int APPCOMMAND_VOLUME_MUTE = 0x80000;
    private const int APPCOMMAND_VOLUME_DOWN = 0x90000;
    private const int APPCOMMAND_VOLUME_UP = 0xA0000;
    private const int APPCOMMAND_MEDIA_NEXTTRACK = 0xB0000;
    private const int APPCOMMAND_MEDIA_PREVIOUSTRACK = 0xC0000;
    private const int APPCOMMAND_MEDIA_PLAY_PAUSE = 0xE0000;

    private const byte VK_MENU = 0x12;    // Alt
    private const byte VK_TAB = 0x09;     // Tab
    private const byte VK_F4 = 0x73;      // F4
    private const byte VK_ESCAPE = 0x1B;  // Esc
    private const byte VK_RETURN = 0x0D;  // Enter
    private const uint KEYEVENTF_KEYUP = 0x0002;

    static void PressKey(byte vk) {
        keybd_event(vk, 0, 0, 0);
        Thread.Sleep(15);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
    }

    static void PressCombo(byte vk1, byte vk2) {
        keybd_event(vk1, 0, 0, 0);
        Thread.Sleep(15);
        keybd_event(vk2, 0, 0, 0);
        Thread.Sleep(15);
        keybd_event(vk2, 0, KEYEVENTF_KEYUP, 0);
        Thread.Sleep(15);
        keybd_event(vk1, 0, KEYEVENTF_KEYUP, 0);
    }

    static void SendAppCmd(int cmd) {
        SendMessageW((IntPtr)0xffff, WM_APPCOMMAND, IntPtr.Zero, (IntPtr)cmd);
    }

    static void KillPid(int pid) {
        if (pid <= 4) return;
        try {
            Process proc = Process.GetProcessById(pid);
            proc.Kill();
        } catch { }
        try {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "taskkill.exe";
            psi.Arguments = "/F /PID " + pid + " /T";
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(2000);
        } catch { }
    }

    static void KillName(string name) {
        if (string.IsNullOrEmpty(name)) return;
        string cleanName = name.Trim().Trim('"');
        string baseName = cleanName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? cleanName.Substring(0, cleanName.Length - 4)
            : cleanName;

        try {
            Process[] procs = Process.GetProcessesByName(baseName);
            for (int i = 0; i < procs.Length; i++) {
                try {
                    procs[i].Kill();
                } catch { }
            }
        } catch { }

        try {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "taskkill.exe";
            psi.Arguments = "/F /IM \"" + cleanName + "\" /T";
            psi.CreateNoWindow = true;
            psi.UseShellExecute = false;
            Process p = Process.Start(psi);
            if (p != null) p.WaitForExit(2000);
        } catch { }
    }


    static void KillForeground() {
        IntPtr hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return;
        uint pid = 0;
        GetWindowThreadProcessId(hwnd, out pid);
        if (pid <= 4) return;
        try {
            Process proc = Process.GetProcessById((int)pid);
            string pName = proc.ProcessName.ToLowerInvariant();
            if (pName != "explorer" && pName != "dwm" && pName != "taskhostw" && pName != "node") {
                KillPid((int)pid);
            }
        } catch { }
    }

    static void Launch(string filePath) {
        if (string.IsNullOrEmpty(filePath)) return;
        try {
            Type shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType != null) {
                object shell = Activator.CreateInstance(shellType);
                string dir = Path.GetDirectoryName(filePath);
                shellType.InvokeMember("ShellExecute",
                    System.Reflection.BindingFlags.InvokeMethod,
                    null, shell, new object[] { filePath, "", dir ?? "", "open", 1 });
                Console.WriteLine("Launched via Shell.Application");
                return;
            }
        } catch (Exception ex) {
            Console.WriteLine("Shell.Application error: " + ex.Message);
        }

        try {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = filePath;
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Normal;
            string dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) {
                psi.WorkingDirectory = dir;
            }
            Process.Start(psi);
            Console.WriteLine("Launched via Process.Start");
        } catch (Exception ex) {
            Console.WriteLine("Error: " + ex.Message);
        }
    }


    static void Main(string[] args) {
        if (args.Length == 0) return;
        string action = args[0].ToLowerInvariant();
        int steps = 1;
        if (args.Length > 1) int.TryParse(args[1], out steps);
        if (steps <= 0) steps = 1;

        switch (action) {
            case "volup":
                for (int i = 0; i < steps; i++) {
                    SendAppCmd(APPCOMMAND_VOLUME_UP);
                    Thread.Sleep(20);
                }
                break;
            case "voldown":
                for (int i = 0; i < steps; i++) {
                    SendAppCmd(APPCOMMAND_VOLUME_DOWN);
                    Thread.Sleep(20);
                }
                break;
            case "volmute":
                SendAppCmd(APPCOMMAND_VOLUME_MUTE);
                break;
            case "playpause":
                SendAppCmd(APPCOMMAND_MEDIA_PLAY_PAUSE);
                break;
            case "next":
                SendAppCmd(APPCOMMAND_MEDIA_NEXTTRACK);
                break;
            case "prev":
                SendAppCmd(APPCOMMAND_MEDIA_PREVIOUSTRACK);
                break;
            case "alttab":
                PressCombo(VK_MENU, VK_TAB);
                break;
            case "altf4":
                PressCombo(VK_MENU, VK_F4);
                break;
            case "escape":
                PressKey(VK_ESCAPE);
                break;
            case "enter":
                PressKey(VK_RETURN);
                break;
            case "killpid":
                int targetPid = 0;
                if (args.Length > 1 && int.TryParse(args[1], out targetPid)) {
                    KillPid(targetPid);
                }
                break;
            case "killname":
                if (args.Length > 1) {
                    string fullProcName = string.Join(" ", args, 1, args.Length - 1).Trim().Trim('"');
                    KillName(fullProcName);
                }
                break;

            case "killforeground":
                KillForeground();
                break;
            case "launch":
                if (args.Length > 1) {
                    string fullPath = string.Join(" ", args, 1, args.Length - 1).Trim('"');
                    Launch(fullPath);
                }
                break;
            default:
                Console.WriteLine("Unknown command: " + action);
                break;
        }
    }
}
