using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace SysControl {
    // ==========================================
    // CoreAudio COM Interfaces (Volume & Devices)
    // ==========================================
    internal enum EDataFlow {
        eRender = 0,
        eCapture = 1,
        eAll = 2
    }

    internal enum ERole {
        eConsole = 0,
        eMultimedia = 1,
        eCommunications = 2
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROPERTYKEY {
        public Guid fmtid;
        public uint pid;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct PROPVARIANT {
        public ushort vt;
        public ushort wReserved1;
        public ushort wReserved2;
        public ushort wReserved3;
        public IntPtr p;
        public int p2;

        public string GetValue() {
            if (vt == 31 && p != IntPtr.Zero) { // VT_LPWSTR
                return Marshal.PtrToStringUni(p);
            }
            return null;
        }
    }

    [ComImport]
    [Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    internal class MMDeviceEnumeratorComObject { }

    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(EDataFlow dataFlow, uint dwStateMask, out IMMDeviceCollection ppDevices);
        int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppEndpoint);
        int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
    }

    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDeviceCollection {
        int GetCount(out uint pcDevices);
        int Item(uint nDevice, out IMMDevice ppDevice);
    }

    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMMDevice {
        int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        int OpenPropertyStore(uint stgmAccess, out IPropertyStore ppProperties);
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        int GetState(out uint pdwState);
    }

    [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPropertyStore {
        int GetCount(out uint cProps);
        int GetAt(uint iProp, out PROPERTYKEY pkey);
        int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
    }

    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    internal class PolicyConfigClientComObject { }

    [Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IPolicyConfig {
        int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr ppFormat);
        int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, bool bDefault, IntPtr ppFormat);
        int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName);
        int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pEndpointFormat, IntPtr MixFormat);
        int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, bool bDefault, IntPtr pmftDefaultPeriod, IntPtr pmftMinimumPeriod);
        int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pmftPeriod);
        int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr pMode);
        int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, IntPtr mode);
        int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, bool bFxStore, IntPtr key, IntPtr pv);
        int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, bool bFxStore, IntPtr key, IntPtr pv);
        int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, ERole role);
        int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string pszDeviceName, bool bVisible);
    }

    class Program {
        // Desktop attachment P/Invoke (ensures input goes to the real interactive TV/monitor screen)
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr OpenDesktopW(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern IntPtr PostMessageW(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("powrprof.dll", SetLastError = true)]
        public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT {
            public int X;
            public int Y;
        }

        private const byte VK_BACK = 0x08;    // Backspace
        private const byte VK_TAB = 0x09;     // Tab
        private const byte VK_RETURN = 0x0D;  // Enter
        private const byte VK_MENU = 0x12;    // Alt
        private const byte VK_ESCAPE = 0x1B;  // Esc
        private const byte VK_SPACE = 0x20;   // Space
        private const byte VK_LEFT = 0x25;    // Left
        private const byte VK_UP = 0x26;      // Up
        private const byte VK_RIGHT = 0x27;   // Right
        private const byte VK_DOWN = 0x28;    // Down
        private const byte VK_LWIN = 0x5B;    // Left Win
        private const byte VK_F4 = 0x73;      // F4

        // Hardware Media & Volume Virtual Keys
        private const byte VK_VOLUME_MUTE = 0xAD;
        private const byte VK_VOLUME_DOWN = 0xAE;
        private const byte VK_VOLUME_UP = 0xAF;
        private const byte VK_MEDIA_NEXT_TRACK = 0xB0;
        private const byte VK_MEDIA_PREV_TRACK = 0xB1;
        private const byte VK_MEDIA_STOP = 0xB2;
        private const byte VK_MEDIA_PLAY_PAUSE = 0xB3;

        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        private const uint WM_CLOSE = 0x0010;

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT {
            public uint type;
            public INPUTUNION u;
        }

        [StructLayout(LayoutKind.Explicit, Size = 32)]
        struct INPUTUNION {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        static extern uint MapVirtualKey(uint uCode, uint uMapType);

        private const uint INPUT_MOUSE = 0;
        private const uint INPUT_KEYBOARD = 1;
        private const uint KEYEVENTF_SCANCODE = 0x0008;
        private const uint KEYEVENTF_UNICODE = 0x0004;

        static void AttachToInteractiveDesktop() {
            try {
                IntPtr hDesk = OpenInputDesktop(0, false, 0x01FF);
                if (hDesk == IntPtr.Zero) {
                    hDesk = OpenDesktopW("Default", 0, false, 0x01FF);
                }
                if (hDesk != IntPtr.Zero) {
                    SetThreadDesktop(hDesk);
                }
            } catch { }
        }

        static void SendUnicodeText(string text) {
            if (string.IsNullOrEmpty(text)) return;
            List<INPUT> inputs = new List<INPUT>();
            foreach (char c in text) {
                INPUT down = new INPUT();
                down.type = INPUT_KEYBOARD;
                down.u.ki.wVk = 0;
                down.u.ki.wScan = c;
                down.u.ki.dwFlags = KEYEVENTF_UNICODE;
                inputs.Add(down);

                INPUT up = new INPUT();
                up.type = INPUT_KEYBOARD;
                up.u.ki.wVk = 0;
                up.u.ki.wScan = c;
                up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                inputs.Add(up);
            }
            uint sent = SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
            Console.WriteLine("{\"sent\":" + sent + ",\"size\":" + Marshal.SizeOf(typeof(INPUT)) + "}");
        }

        static void PressKey(byte vk, bool extended = false) {
            uint flags = extended ? KEYEVENTF_EXTENDEDKEY : 0;
            byte scan = (byte)MapVirtualKey(vk, 0);
            keybd_event(vk, scan, flags, 0);
            Thread.Sleep(25);
            keybd_event(vk, scan, flags | KEYEVENTF_KEYUP, 0);
        }

        static void PressCombo(byte vk1, byte vk2, bool ext1 = false) {
            uint flags1 = ext1 ? KEYEVENTF_EXTENDEDKEY : 0;
            byte scan1 = (byte)MapVirtualKey(vk1, 0);
            byte scan2 = (byte)MapVirtualKey(vk2, 0);
            keybd_event(vk1, scan1, flags1, 0);
            Thread.Sleep(35);
            keybd_event(vk2, scan2, 0, 0);
            Thread.Sleep(55);
            keybd_event(vk2, scan2, KEYEVENTF_KEYUP, 0);
            Thread.Sleep(35);
            keybd_event(vk1, scan1, flags1 | KEYEVENTF_KEYUP, 0);
        }

        static void SendSoftClose() {
            PressCombo(VK_MENU, VK_F4);
            try {
                IntPtr hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero) {
                    StringBuilder cls = new StringBuilder(128);
                    GetClassNameW(hwnd, cls, 128);
                    string clsName = cls.ToString();
                    if (clsName != "Progman" && clsName != "WorkerW" && clsName != "Shell_TrayWnd") {
                        PostMessageW(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    }
                }
            } catch { }
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

        static IAudioEndpointVolume GetAudioEndpointVolume() {
            IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
            IMMDevice dev;
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out dev);
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object o;
            dev.Activate(ref iid, 23, IntPtr.Zero, out o);
            return (IAudioEndpointVolume)o;
        }

        static void PrintVolumeJson() {
            try {
                IAudioEndpointVolume vol = GetAudioEndpointVolume();
                float level = 0;
                bool muted = false;
                vol.GetMasterVolumeLevelScalar(out level);
                vol.GetMute(out muted);
                int pct = (int)Math.Round(level * 100);
                Console.WriteLine("{\"volume\":" + pct + ",\"muted\":" + (muted ? "true" : "false") + "}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static void AdjustVolumeRelative(int deltaPct) {
            try {
                IAudioEndpointVolume vol = GetAudioEndpointVolume();
                float level = 0;
                vol.GetMasterVolumeLevelScalar(out level);
                int currentPct = (int)Math.Round(level * 100);
                int nextPct = currentPct + deltaPct;
                if (nextPct < 0) nextPct = 0;
                if (nextPct > 100) nextPct = 100;

                Guid ctx = Guid.Empty;
                vol.SetMasterVolumeLevelScalar(nextPct / 100.0f, ref ctx);
                if (deltaPct > 0) {
                    vol.SetMute(false, ref ctx);
                }
                PrintVolumeJson();
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static void ToggleMute() {
            try {
                IAudioEndpointVolume vol = GetAudioEndpointVolume();
                bool muted = false;
                vol.GetMute(out muted);
                Guid ctx = Guid.Empty;
                vol.SetMute(!muted, ref ctx);
                PrintVolumeJson();
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static void SetVolumeLevel(int pct) {
            try {
                if (pct < 0) pct = 0;
                if (pct > 100) pct = 100;
                IAudioEndpointVolume vol = GetAudioEndpointVolume();
                Guid ctx = Guid.Empty;
                vol.SetMasterVolumeLevelScalar(pct / 100.0f, ref ctx);
                if (pct > 0) {
                    vol.SetMute(false, ref ctx);
                }
                PrintVolumeJson();
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static string EscapeJson(string s) {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " ");
        }

        static void ListAudioDevicesJson() {
            try {
                IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                IMMDevice defaultDev = null;
                string defaultId = "";
                try {
                    enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out defaultDev);
                    if (defaultDev != null) defaultDev.GetId(out defaultId);
                } catch { }

                IMMDeviceCollection collection;
                enumerator.EnumAudioEndpoints(EDataFlow.eRender, 1 /* DEVICE_STATE_ACTIVE */, out collection);
                uint count = 0;
                collection.GetCount(out count);

                PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY();
                PKEY_Device_FriendlyName.fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0");
                PKEY_Device_FriendlyName.pid = 14;

                StringBuilder sb = new StringBuilder();
                sb.Append("[");
                bool first = true;
                for (uint i = 0; i < count; i++) {
                    IMMDevice dev;
                    collection.Item(i, out dev);
                    string id;
                    dev.GetId(out id);
                    IPropertyStore props;
                    dev.OpenPropertyStore(0, out props);
                    PROPVARIANT pv;
                    props.GetValue(ref PKEY_Device_FriendlyName, out pv);
                    string name = pv.GetValue() ?? ("Dispositivo " + (i + 1));
                    bool isDef = (id == defaultId);
                    if (!first) sb.Append(",");
                    first = false;
                    sb.Append("{\"id\":\"").Append(EscapeJson(id))
                      .Append("\",\"name\":\"").Append(EscapeJson(name))
                      .Append("\",\"isDefault\":").Append(isDef ? "true" : "false").Append("}");
                }
                sb.Append("]");
                Console.WriteLine(sb.ToString());
            } catch (Exception ex) {
                Console.WriteLine("[]");
                Console.Error.WriteLine(ex.Message);
            }
        }

        static void SetDefaultAudioDevice(string deviceId) {
            try {
                IPolicyConfig policy = (IPolicyConfig)(new PolicyConfigClientComObject());
                policy.SetDefaultEndpoint(deviceId, ERole.eConsole);
                policy.SetDefaultEndpoint(deviceId, ERole.eMultimedia);
                policy.SetDefaultEndpoint(deviceId, ERole.eCommunications);
                Console.WriteLine("{\"success\":true}");
            } catch (Exception ex) {
                Console.WriteLine("{\"success\":false,\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static void ExecuteCommand(string[] args) {
            AttachToInteractiveDesktop();

            string action = args[0].ToLowerInvariant();
            int steps = 1;
            if (args.Length > 1) int.TryParse(args[1], out steps);
            if (steps <= 0) steps = 1;

            switch (action) {
                case "volup":
                    AdjustVolumeRelative(steps * 2);
                    break;
                case "voldown":
                    AdjustVolumeRelative(-(steps * 2));
                    break;
                case "volmute":
                    ToggleMute();
                    break;
                case "getvol":
                    PrintVolumeJson();
                    break;
                case "setvol":
                    if (args.Length > 1) {
                        int targetPct = 50;
                        if (int.TryParse(args[1], out targetPct)) {
                            SetVolumeLevel(targetPct);
                        }
                    }
                    break;
                case "getaudiodevices":
                    ListAudioDevicesJson();
                    break;
                case "setaudiodevice":
                    if (args.Length > 1) {
                        string devId = string.Join(" ", args, 1, args.Length - 1).Trim().Trim('"');
                        SetDefaultAudioDevice(devId);
                    }
                    break;
                case "playpause":
                    PressKey(VK_MEDIA_PLAY_PAUSE, true);
                    break;
                case "next":
                    PressKey(VK_MEDIA_NEXT_TRACK, true);
                    break;
                case "prev":
                    PressKey(VK_MEDIA_PREV_TRACK, true);
                    break;
                case "alttab":
                    PressCombo(VK_MENU, VK_TAB);
                    break;
                case "altf4":
                    SendSoftClose();
                    break;
                case "escape":
                    PressKey(VK_ESCAPE);
                    break;
                case "enter":
                    PressKey(VK_RETURN);
                    break;
                case "backspace":
                    PressKey(VK_BACK);
                    break;
                case "space":
                    PressKey(VK_SPACE);
                    break;
                case "tab":
                    PressKey(VK_TAB);
                    break;
                case "up":
                    PressKey(VK_UP, true);
                    break;
                case "down":
                    PressKey(VK_DOWN, true);
                    break;
                case "left":
                    PressKey(VK_LEFT, true);
                    break;
                case "right":
                    PressKey(VK_RIGHT, true);
                    break;
                case "win":
                    PressKey(VK_LWIN, true);
                    break;
                case "wind":
                    PressCombo(VK_LWIN, 0x44, true);
                    break;
                case "mousemove":
                    if (args.Length >= 3) {
                        int dx = 0, dy = 0;
                        int.TryParse(args[1], out dx);
                        int.TryParse(args[2], out dy);
                        POINT pt;
                        if (GetCursorPos(out pt)) {
                            int screenW = GetSystemMetrics(0);
                            int screenH = GetSystemMetrics(1);
                            if (screenW <= 1) screenW = 1920;
                            if (screenH <= 1) screenH = 1080;
                            int targetX = Math.Max(0, Math.Min(screenW - 1, pt.X + dx));
                            int targetY = Math.Max(0, Math.Min(screenH - 1, pt.Y + dy));
                            int absX = (int)Math.Round((targetX * 65535.0) / (screenW - 1));
                            int absY = (int)Math.Round((targetY * 65535.0) / (screenH - 1));
                            SetCursorPos(targetX, targetY);
                            mouse_event(MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE, absX, absY, 0, 0);
                        } else {
                            mouse_event(MOUSEEVENTF_MOVE, dx, dy, 0, 0);
                        }
                    }
                    break;
                case "mouseclick":
                    string btn = args.Length > 1 ? args[1].ToLowerInvariant() : "left";
                    if (btn == "right") {
                        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(20);
                        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
                    } else if (btn == "double") {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(15);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                        Thread.Sleep(50);
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(15);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    } else {
                        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                        Thread.Sleep(20);
                        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                    }
                    break;
                case "mousescroll":
                    if (args.Length > 1) {
                        int delta = 0;
                        int.TryParse(args[1], out delta);
                        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
                    }
                    break;
                case "typetext":
                    if (args.Length > 1) {
                        try {
                            byte[] data = Convert.FromBase64String(args[1]);
                            string decoded = Encoding.UTF8.GetString(data);
                            SendUnicodeText(decoded);
                        } catch { }
                    }
                    break;
                case "sleep":
                    SetSuspendState(false, false, false);
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
                case "cursorpos":
                    POINT cur;
                    if (GetCursorPos(out cur)) {
                        Console.WriteLine("{\"x\":" + cur.X + ",\"y\":" + cur.Y + "}");
                    } else {
                        Console.WriteLine("{\"x\":0,\"y\":0}");
                    }
                    break;
                case "deskinfo":
                    POINT p1, p2;
                    bool g1 = GetCursorPos(out p1);
                    bool s1 = SetCursorPos(p1.X + 100, p1.Y + 100);
                    int e1 = Marshal.GetLastWin32Error();
                    GetCursorPos(out p2);
                    Console.WriteLine(string.Format("Get1={0}({1},{2}) Set1={3}(err={4}) After=({5},{6})",
                        g1, p1.X, p1.Y, s1, e1, p2.X, p2.Y));
                    break;
                default:
                    Console.WriteLine("Unknown command: " + action);
                    break;
            }
        }

        static void Main(string[] args) {
            Console.OutputEncoding = Encoding.UTF8;
            if (args.Length == 0) return;

            // Run on a dedicated fresh thread so SetThreadDesktop("Default") always succeeds
            Thread worker = new Thread(() => ExecuteCommand(args));
            worker.Start();
            worker.Join();
        }
    }
}
