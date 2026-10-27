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

    [Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolumeCallback {
        [PreserveSig]
        int OnNotify(IntPtr pNotifyData);
    }

    [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IAudioEndpointVolume {
        int RegisterControlChangeNotify([MarshalAs(UnmanagedType.Interface)] IAudioEndpointVolumeCallback pNotify);
        int UnregisterControlChangeNotify([MarshalAs(UnmanagedType.Interface)] IAudioEndpointVolumeCallback pNotify);
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

    internal class VolumeNotifyHandler : IAudioEndpointVolumeCallback {
        private readonly AutoResetEvent _signal;
        private readonly Guid _selfContext;
        public volatile int LastVolume = -1;
        public volatile bool LastMuted = false;
        public volatile bool LastIsExternal = true;
        public volatile bool HasNotification = false;

        public VolumeNotifyHandler(AutoResetEvent signal, Guid selfContext) {
            _signal = signal;
            _selfContext = selfContext;
        }

        public int OnNotify(IntPtr pNotifyData) {
            try {
                if (pNotifyData != IntPtr.Zero) {
                    byte[] guidBytes = new byte[16];
                    Marshal.Copy(pNotifyData, guidBytes, 0, 16);
                    Guid ctx = new Guid(guidBytes);

                    bool muted = Marshal.ReadInt32(pNotifyData, 16) != 0;
                    byte[] floatBytes = new byte[4];
                    Marshal.Copy(new IntPtr(pNotifyData.ToInt64() + 20), floatBytes, 0, 4);
                    float level = BitConverter.ToSingle(floatBytes, 0);
                    int pct = (int)Math.Round(level * 100.0f);
                    if (pct < 0) pct = 0;
                    if (pct > 100) pct = 100;

                    LastVolume = pct;
                    LastMuted = muted;
                    LastIsExternal = (ctx != _selfContext);
                    HasNotification = true;
                    _signal.Set();
                }
            } catch { }
            return 0;
        }
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

        [DllImport("user32.dll")]
        public static extern int GetDisplayConfigBufferSizes(
            uint flags,
            out uint numPathArrayElements,
            out uint numModeInfoArrayElements
        );

        [DllImport("user32.dll")]
        public static extern int QueryDisplayConfig(
            uint flags,
            ref uint numPathArrayElements,
            IntPtr pathArray,
            ref uint numModeInfoArrayElements,
            IntPtr modeInfoArray,
            out uint currentTopologyId
        );

        [DllImport("user32.dll")]
        public static extern int SetDisplayConfig(
            uint numPathArrayElements,
            IntPtr pathArray,
            uint numModeInfoArrayElements,
            IntPtr modeInfoArray,
            uint flags
        );

        private const uint QDC_DATABASE_CURRENT = 0x00000004;
        private const uint SDC_APPLY = 0x00000080;
        private const uint SDC_TOPOLOGY_INTERNAL = 0x00000001;
        private const uint SDC_TOPOLOGY_CLONE = 0x00000002;
        private const uint SDC_TOPOLOGY_EXTEND = 0x00000004;
        private const uint SDC_TOPOLOGY_EXTERNAL = 0x00000008;

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
                IntPtr hDesk = OpenDesktopW("Default", 0, false, 0x01FF);
                if (hDesk == IntPtr.Zero) {
                    hDesk = OpenInputDesktop(0, false, 0x01FF);
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

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct STARTUPINFOW {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool CreateProcessW(
            string lpApplicationName,
            string lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFOW lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        static void Launch(string filePath, string workingDir = "", string arguments = "") {
            if (string.IsNullOrEmpty(filePath)) return;

            bool isUri = filePath.Contains("://");
            string dir = workingDir ?? "";
            if (string.IsNullOrEmpty(dir) && !isUri) {
                try {
                    dir = Path.GetDirectoryName(filePath) ?? "";
                } catch {
                    dir = "";
                }
            }

            string cwd = (!string.IsNullOrEmpty(dir) && Directory.Exists(dir)) ? dir : null;

            // 1. Primary for direct .exe files: Win32 CreateProcessW directly on winsta0\default with SW_SHOWNORMAL
            if (!isUri && File.Exists(filePath) && filePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                try {
                    STARTUPINFOW siDirect = new STARTUPINFOW();
                    siDirect.cb = Marshal.SizeOf(typeof(STARTUPINFOW));
                    siDirect.lpDesktop = "winsta0\\default";
                    siDirect.dwFlags = 0x00000001; // STARTF_USESHOWWINDOW
                    siDirect.wShowWindow = 1;     // SW_SHOWNORMAL

                    PROCESS_INFORMATION piDirect;
                    string directCmd = "\"" + filePath + "\"" +
                        (string.IsNullOrEmpty(arguments) ? "" : (" " + arguments));

                    if (CreateProcessW(filePath, directCmd, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, cwd, ref siDirect, out piDirect)) {
                        if (piDirect.hProcess != IntPtr.Zero) CloseHandle(piDirect.hProcess);
                        if (piDirect.hThread != IntPtr.Zero) CloseHandle(piDirect.hThread);
                        Console.WriteLine("Launched via CreateProcessW direct (winsta0\\default) PID=" + piDirect.dwProcessId);
                        return;
                    }
                } catch (Exception ex) {
                    Console.WriteLine("CreateProcessW direct error: " + ex.Message);
                }
            }

            // 2. For URIs (steam://...), shortcuts, or UAC-elevated .exe (Error 740):
            //    Run cmd.exe /c start "" on winsta0\default so ShellExecuteEx runs on the interactive desktop
            try {
                STARTUPINFOW si = new STARTUPINFOW();
                si.cb = Marshal.SizeOf(typeof(STARTUPINFOW));
                si.lpDesktop = "winsta0\\default";

                PROCESS_INFORMATION pi;
                string cmdLine = "cmd.exe /c start \"\" \"" + filePath + "\"" +
                    (string.IsNullOrEmpty(arguments) ? "" : (" " + arguments));

                if (CreateProcessW(null, cmdLine, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, cwd, ref si, out pi)) {
                    if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
                    if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                    Console.WriteLine("Launched via CreateProcessW cmd/start (winsta0\\default)");
                    return;
                }
            } catch (Exception ex) {
                Console.WriteLine("CreateProcessW cmd/start error: " + ex.Message);
            }

            // 3. Final fallback: Process.Start
            try {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = filePath;
                if (!string.IsNullOrEmpty(arguments)) psi.Arguments = arguments;
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Normal;
                if (cwd != null) {
                    psi.WorkingDirectory = cwd;
                }
                Process.Start(psi);
                Console.WriteLine("Launched via Process.Start");
            } catch (Exception ex) {
                Console.WriteLine("Error: " + ex.Message);
            }
        }

        private static readonly Guid SelfEventContext = new Guid("7A91C3E2-4B5D-4F8E-9A1C-2D3E4F5A6B7C");

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

                Guid ctx = SelfEventContext;
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
                Guid ctx = SelfEventContext;
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
                Guid ctx = SelfEventContext;
                vol.SetMasterVolumeLevelScalar(pct / 100.0f, ref ctx);
                if (pct > 0) {
                    vol.SetMute(false, ref ctx);
                }
                PrintVolumeJson();
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + EscapeJson(ex.Message) + "\"}");
            }
        }

        static void WatchVolumeDaemon() {
            AutoResetEvent signal = new AutoResetEvent(false);
            VolumeNotifyHandler handler = new VolumeNotifyHandler(signal, SelfEventContext);
            Queue<string> pendingCommands = new Queue<string>();
            object cmdLock = new object();

            IMMDeviceEnumerator enumerator = null;
            IAudioEndpointVolume currentVol = null;
            string currentDeviceId = "";
            int lastEmittedVol = -1;
            bool lastEmittedMuted = false;

            // Thread assíncrona para receber comandos rápidos via stdin e acordar o loop principal imediatamente
            Thread stdinThread = new Thread(() => {
                try {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        string trimmed = line.Trim();
                        if (string.IsNullOrEmpty(trimmed)) continue;
                        lock (cmdLock) {
                            pendingCommands.Enqueue(trimmed);
                        }
                        signal.Set();
                    }
                } catch { }
            });
            stdinThread.IsBackground = true;
            stdinThread.Start();

            while (true) {
                try {
                    if (enumerator == null) {
                        enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
                    }

                    IMMDevice defaultDev = null;
                    string devId = "";
                    try {
                        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out defaultDev);
                        if (defaultDev != null) defaultDev.GetId(out devId);
                    } catch { }

                    bool deviceChanged = false;
                    if (!string.IsNullOrEmpty(devId) && devId != currentDeviceId) {
                        if (currentVol != null) {
                            try { currentVol.UnregisterControlChangeNotify(handler); } catch { }
                        }
                        Guid iid = typeof(IAudioEndpointVolume).GUID;
                        object o;
                        defaultDev.Activate(ref iid, 23, IntPtr.Zero, out o);
                        currentVol = (IAudioEndpointVolume)o;
                        currentVol.RegisterControlChangeNotify(handler);
                        currentDeviceId = devId;
                        deviceChanged = true;
                    }

                    bool hadInternalCommand = false;
                    if (currentVol != null) {
                        while (true) {
                            string cmdLine = null;
                            lock (cmdLock) {
                                if (pendingCommands.Count > 0) {
                                    cmdLine = pendingCommands.Dequeue();
                                }
                            }
                            if (cmdLine == null) break;

                            string[] parts = cmdLine.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                            if (parts.Length == 0) continue;
                            string cmd = parts[0].ToLowerInvariant();
                            try {
                                if (cmd == "setvol" && parts.Length > 1) {
                                    int pct;
                                    if (int.TryParse(parts[1], out pct)) {
                                        if (pct < 0) pct = 0;
                                        if (pct > 100) pct = 100;
                                        Guid ctx = SelfEventContext;
                                        currentVol.SetMasterVolumeLevelScalar(pct / 100.0f, ref ctx);
                                        if (pct > 0) currentVol.SetMute(false, ref ctx);
                                        hadInternalCommand = true;
                                    }
                                } else if (cmd == "volup") {
                                    int step = 2;
                                    if (parts.Length > 1) int.TryParse(parts[1], out step);
                                    float lvl = 0;
                                    currentVol.GetMasterVolumeLevelScalar(out lvl);
                                    int next = Math.Min(100, Math.Max(0, (int)Math.Round(lvl * 100) + step));
                                    Guid ctx = SelfEventContext;
                                    currentVol.SetMasterVolumeLevelScalar(next / 100.0f, ref ctx);
                                    currentVol.SetMute(false, ref ctx);
                                    hadInternalCommand = true;
                                } else if (cmd == "voldown") {
                                    int step = 2;
                                    if (parts.Length > 1) int.TryParse(parts[1], out step);
                                    float lvl = 0;
                                    currentVol.GetMasterVolumeLevelScalar(out lvl);
                                    int next = Math.Min(100, Math.Max(0, (int)Math.Round(lvl * 100) - step));
                                    Guid ctx = SelfEventContext;
                                    currentVol.SetMasterVolumeLevelScalar(next / 100.0f, ref ctx);
                                    hadInternalCommand = true;
                                } else if (cmd == "volmute") {
                                    bool m = false;
                                    currentVol.GetMute(out m);
                                    Guid ctx = SelfEventContext;
                                    currentVol.SetMute(!m, ref ctx);
                                    hadInternalCommand = true;
                                }
                            } catch { }
                        }

                        int pctNow;
                        bool mutedNow;
                        bool isExternal = !hadInternalCommand;

                        if (handler.HasNotification && !hadInternalCommand) {
                            handler.HasNotification = false;
                            pctNow = handler.LastVolume;
                            mutedNow = handler.LastMuted;
                            isExternal = handler.LastIsExternal;
                        } else {
                            handler.HasNotification = false;
                            float level = 0;
                            currentVol.GetMasterVolumeLevelScalar(out level);
                            currentVol.GetMute(out mutedNow);
                            pctNow = (int)Math.Round(level * 100.0f);
                            if (pctNow < 0) pctNow = 0;
                            if (pctNow > 100) pctNow = 100;
                        }

                        if (deviceChanged || pctNow != lastEmittedVol || mutedNow != lastEmittedMuted) {
                            lastEmittedVol = pctNow;
                            lastEmittedMuted = mutedNow;
                            string src = isExternal ? "external" : "internal";
                            Console.WriteLine(
                                "{\"type\":\"VOLUME_UPDATE\",\"value\":" + pctNow +
                                ",\"is_muted\":" + (mutedNow ? "true" : "false") +
                                ",\"volume\":" + pctNow +
                                ",\"muted\":" + (mutedNow ? "true" : "false") +
                                ",\"source\":\"" + src + "\"" +
                                ",\"deviceChanged\":" + (deviceChanged ? "true" : "false") + "}"
                            );
                            Console.Out.Flush();
                        }
                    }
                } catch {
                    Thread.Sleep(500);
                }

                signal.WaitOne(250);
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

        static string GetCurrentDisplayTopology() {
            try {
                uint numPath = 0;
                uint numMode = 0;
                int r1 = GetDisplayConfigBufferSizes(QDC_DATABASE_CURRENT, out numPath, out numMode);
                if (r1 == 0 && numPath > 0) {
                    IntPtr pPaths = Marshal.AllocHGlobal((int)numPath * 72);
                    IntPtr pModes = Marshal.AllocHGlobal((int)numMode * 64);
                    uint top = 0;
                    int r2 = QueryDisplayConfig(QDC_DATABASE_CURRENT, ref numPath, pPaths, ref numMode, pModes, out top);
                    Marshal.FreeHGlobal(pPaths);
                    Marshal.FreeHGlobal(pModes);

                    if (r2 == 0) {
                        if (top == 1) return "internal";
                        if (top == 8) return "external";
                        if (top == 4) return "extend";
                        if (top == 2) return "clone";
                    }
                }
            } catch { }
            return "unknown";
        }

        static void PrintDisplayJson() {
            string mode = GetCurrentDisplayTopology();
            string label = "Desconhecido";
            if (mode == "internal") label = "Tela do PC (Tela do computador somente)";
            else if (mode == "external") label = "TV (Segunda tela somente)";
            else if (mode == "extend") label = "Estender telas";
            else if (mode == "clone") label = "Duplicar telas";

            Console.WriteLine("{\"mode\":\"" + mode + "\",\"label\":\"" + EscapeJson(label) + "\"}");
        }

        static void SwitchDisplayViaDisplaySwitch(string arg) {
            try {
                string sysPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "DisplaySwitch.exe");
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = File.Exists(sysPath) ? sysPath : "DisplaySwitch.exe";
                psi.Arguments = arg;
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process p = Process.Start(psi);
                if (p != null) {
                    p.WaitForExit(3000);
                }
            } catch { }
        }

        static void SetDisplayMode(string target) {
            string safeTarget = (target ?? "").ToLowerInvariant().Trim();
            if (safeTarget == "pc") safeTarget = "internal";
            if (safeTarget == "tv") safeTarget = "external";

            uint topologyFlag = SDC_TOPOLOGY_INTERNAL;
            string switchArg = "/internal";

            if (safeTarget == "external") {
                topologyFlag = SDC_TOPOLOGY_EXTERNAL;
                switchArg = "/external";
            } else if (safeTarget == "clone") {
                topologyFlag = SDC_TOPOLOGY_CLONE;
                switchArg = "/clone";
            } else if (safeTarget == "extend") {
                topologyFlag = SDC_TOPOLOGY_EXTEND;
                switchArg = "/extend";
            } else {
                safeTarget = "internal";
                topologyFlag = SDC_TOPOLOGY_INTERNAL;
                switchArg = "/internal";
            }

            bool applied = false;
            try {
                int res = SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, SDC_APPLY | topologyFlag);
                if (res == 0) {
                    applied = true;
                }
            } catch { }

            if (!applied) {
                SwitchDisplayViaDisplaySwitch(switchArg);
            }

            Thread.Sleep(300);
            PrintDisplayJson();
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
                case "watchvol":
                    WatchVolumeDaemon();
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
                case "getdisplay":
                    PrintDisplayJson();
                    break;
                case "setdisplay":
                    if (args.Length > 1) {
                        SetDisplayMode(args[1]);
                    } else {
                        PrintDisplayJson();
                    }
                    break;
                case "toggledisplay":
                    string curTopology = GetCurrentDisplayTopology();
                    SetDisplayMode(curTopology == "external" ? "internal" : "external");
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
                        if (fullPath.Contains("|")) {
                            string[] parts = fullPath.Split('|');
                            Launch(parts[0], parts.Length > 1 ? parts[1] : "", parts.Length > 2 ? parts[2] : "");
                        } else {
                            Launch(fullPath);
                        }
                    }
                    break;
                case "launchb64":
                    if (args.Length > 1) {
                        try {
                            byte[] raw = Convert.FromBase64String(args[1]);
                            string payload = Encoding.UTF8.GetString(raw);
                            string[] parts = payload.Split('|');
                            Launch(parts[0], parts.Length > 1 ? parts[1] : "", parts.Length > 2 ? parts[2] : "");
                        } catch (Exception ex) {
                            Console.WriteLine("launchb64 error: " + ex.Message);
                        }
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
