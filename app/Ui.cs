using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace GameLauncher
{
    internal static class Native
    {
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 2;

        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
        [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

        public static bool IsWin11
        {
            get { return Environment.OSVersion.Version.Build >= 22000; }
        }

        public static void EnableDpiAwareness()
        {
            try { SetProcessDPIAware(); } catch { }
        }

        public static void DragWindow(Control source)
        {
            Form form = source.FindForm();
            if (form == null) return;
            ReleaseCapture();
            SendMessage(form.Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        }

        // Windows 11 aplica cantos arredondados e borda escura via DWM; Windows 10 usa região GDI.
        public static void StyleFramelessWindow(Form form, int radius)
        {
            try
            {
                if (IsWin11)
                {
                    int dark = 1, round = 2, borderColor = 0x002E2722; // COLORREF BGR de #22272E
                    DwmSetWindowAttribute(form.Handle, 20, ref dark, 4);
                    DwmSetWindowAttribute(form.Handle, 33, ref round, 4);
                    DwmSetWindowAttribute(form.Handle, 34, ref borderColor, 4);
                }
                else
                {
                    IntPtr hrgn = CreateRoundRectRgn(0, 0, form.Width + 1, form.Height + 1, radius * 2, radius * 2);
                    try { form.Region = Region.FromHrgn(hrgn); }
                    finally { DeleteObject(hrgn); }
                }
            }
            catch { }
        }
    }

    internal static class Theme
    {
        public static readonly float Scale = ReadScale();

        public static readonly Color Bg = Hex("#111317");
        public static readonly Color Card = Hex("#161920");
        public static readonly Color Inset = Hex("#0D0F13");
        public static readonly Color Console = Hex("#0B0D11");
        public static readonly Color Border = Hex("#22272E");
        public static readonly Color BorderSubtle = Hex("#1B2027");
        public static readonly Color BorderStrong = Hex("#2E353E");
        public static readonly Color Hover = Hex("#1B2028");
        public static readonly Color Text = Hex("#E6EDF3");
        public static readonly Color TextSoft = Hex("#B1BAC4");
        public static readonly Color Muted = Hex("#7D8590");
        public static readonly Color Faint = Hex("#4E5661");
        public static readonly Color Accent = Hex("#10B981");
        public static readonly Color AccentText = Hex("#6EE7B7");
        public static readonly Color Danger = Hex("#F85149");
        public static readonly Color DangerText = Hex("#FF7B72");
        public static readonly Color Warn = Hex("#D29922");

        // Fontes estáticas em pixels lógicos; o escalonamento de DPI ocorre na matriz GDI+.
        public static readonly Font Body = new Font("Segoe UI", 13f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font BodyBold = new Font("Segoe UI Semibold", 13f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font Title = new Font("Segoe UI Semibold", 16f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font Small = new Font("Segoe UI", 12f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font SmallBold = new Font("Segoe UI Semibold", 12f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font TinyBold = new Font("Segoe UI Semibold", 10f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font Mono = new Font("Consolas", 12f, FontStyle.Regular, GraphicsUnit.Pixel);
        public static readonly Font MonoAddress = new Font("Consolas", 14f, FontStyle.Regular, GraphicsUnit.Pixel);

        private static readonly StringFormat[] Formats =
        {
            MakeFormat(StringAlignment.Near),
            MakeFormat(StringAlignment.Center),
            MakeFormat(StringAlignment.Far)
        };

        public static int Px(int logical)
        {
            return (int)Math.Round(logical * Scale);
        }

        public static Rectangle Area(int x, int y, int w, int h)
        {
            return new Rectangle(Px(x), Px(y), Px(w), Px(h));
        }

        public static Color Alpha(Color color, int alpha)
        {
            return Color.FromArgb(alpha, color);
        }

        public static GraphicsPath RoundRect(RectangleF r, float radius)
        {
            radius = Math.Min(radius, Math.Min(r.Width, r.Height) / 2f);
            float d = radius * 2f;
            var path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, RectangleF r, float radius, Color fill, Color border)
        {
            using (GraphicsPath path = RoundRect(r, radius))
            using (var brush = new SolidBrush(fill))
            using (var pen = new Pen(border))
            {
                g.FillPath(brush, path);
                g.DrawPath(pen, path);
            }
        }

        public static void Draw(Graphics g, string text, Font font, Color color, RectangleF bounds, StringAlignment align)
        {
            using (var brush = new SolidBrush(color))
                g.DrawString(text, font, brush, bounds, Formats[(int)align]);
        }

        public static float Measure(Graphics g, string text, Font font)
        {
            return g.MeasureString(text, font, PointF.Empty, StringFormat.GenericTypographic).Width;
        }

        private static float ReadScale()
        {
            using (Graphics g = Graphics.FromHwnd(IntPtr.Zero))
                return g.DpiX / 96f;
        }

        private static Color Hex(string html)
        {
            return ColorTranslator.FromHtml(html);
        }

        private static StringFormat MakeFormat(StringAlignment horizontal)
        {
            var format = (StringFormat)StringFormat.GenericTypographic.Clone();
            format.Alignment = horizontal;
            format.LineAlignment = StringAlignment.Center;
            format.Trimming = StringTrimming.EllipsisCharacter;
            format.FormatFlags |= StringFormatFlags.NoWrap;
            return format;
        }
    }

    internal enum IconGlyph { None, Play, Stop, External, Shield, Sliders }

    internal static class Icons
    {
        public static void Draw(Graphics g, IconGlyph glyph, float cx, float cy, Color color)
        {
            if (glyph == IconGlyph.None) return;

            using (var pen = new Pen(color, 1.35f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            using (var brush = new SolidBrush(color))
            {
                switch (glyph)
                {
                    case IconGlyph.Play:
                        g.FillPolygon(brush, new[]
                        {
                            new PointF(cx - 3.5f, cy - 4.8f),
                            new PointF(cx + 4.8f, cy),
                            new PointF(cx - 3.5f, cy + 4.8f)
                        });
                        break;

                    case IconGlyph.Stop:
                        Theme.FillRound(g, new RectangleF(cx - 4.2f, cy - 4.2f, 8.4f, 8.4f), 1.8f, color, color);
                        break;

                    case IconGlyph.External:
                        g.DrawLine(pen, cx - 3.8f, cy + 3.8f, cx + 3.8f, cy - 3.8f);
                        g.DrawLines(pen, new[]
                        {
                            new PointF(cx - 0.5f, cy - 3.8f),
                            new PointF(cx + 3.8f, cy - 3.8f),
                            new PointF(cx + 3.8f, cy + 0.5f)
                        });
                        break;

                    case IconGlyph.Shield:
                        g.DrawPolygon(pen, new[]
                        {
                            new PointF(cx, cy - 5.2f),
                            new PointF(cx + 4.6f, cy - 3.4f),
                            new PointF(cx + 4.0f, cy + 1.4f),
                            new PointF(cx, cy + 5.2f),
                            new PointF(cx - 4.0f, cy + 1.4f),
                            new PointF(cx - 4.6f, cy - 3.4f)
                        });
                        break;

                    case IconGlyph.Sliders:
                        g.DrawLine(pen, cx - 4.8f, cy - 2.6f, cx + 4.8f, cy - 2.6f);
                        g.DrawLine(pen, cx - 4.8f, cy + 2.6f, cx + 4.8f, cy + 2.6f);
                        g.FillEllipse(brush, cx + 0.6f, cy - 4.4f, 3.6f, 3.6f);
                        g.FillEllipse(brush, cx - 4.2f, cy + 0.8f, 3.6f, 3.6f);
                        break;
                }
            }
        }
    }

    // Controle base com buffer duplo e sistema de coordenadas lógicas (96 DPI).
    internal abstract class BufferedControl : Control
    {
        protected BufferedControl()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bg;
        }

        protected float LW { get { return Width / Theme.Scale; } }
        protected float LH { get { return Height / Theme.Scale; } }

        protected PointF ToLogical(Point p)
        {
            return new PointF(p.X / Theme.Scale, p.Y / Theme.Scale);
        }

        protected Graphics Begin(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.ScaleTransform(Theme.Scale, Theme.Scale);
            return g;
        }
    }

    internal enum ButtonKind { Primary, Secondary, Utility, DangerOutline }

    internal sealed class FlatButton : BufferedControl
    {
        private bool hover;
        private bool pressed;

        public ButtonKind Kind { get; set; }
        public IconGlyph Glyph { get; set; }
        public bool Selected { get; set; }
        public Color? DotColor { get; set; }

        public FlatButton(string text, ButtonKind kind, IconGlyph glyph = IconGlyph.None)
        {
            Text = text;
            Kind = kind;
            Glyph = glyph;
            Font = Theme.BodyBold;
            Cursor = Cursors.Hand;
            TabStop = false;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = Begin(e);
            Color fill, border, fore;
            ResolveColors(out fill, out border, out fore);

            if (!Enabled)
            {
                border = Theme.Alpha(border, 70);
                fore = Theme.Alpha(fore, 85);
                fill = Theme.Alpha(fill, 90);
            }

            float radius = Kind == ButtonKind.Utility ? 7f : 8.5f;
            Theme.FillRound(g, new RectangleF(0.5f, 0.5f, LW - 1, LH - 1), radius, fill, border);

            bool hasLead = Glyph != IconGlyph.None || DotColor.HasValue;
            if (!hasLead)
            {
                Theme.Draw(g, Text, Font, fore, new RectangleF(0, 0, LW, LH), StringAlignment.Center);
                return;
            }

            float textWidth = Theme.Measure(g, Text, Font);
            const float leadGap = 17f;
            float startX = (LW - (textWidth + leadGap)) / 2f;

            if (DotColor.HasValue)
            {
                Color dot = Enabled ? DotColor.Value : Theme.Alpha(DotColor.Value, 85);
                using (var brush = new SolidBrush(dot))
                    g.FillEllipse(brush, startX, LH / 2f - 3.2f, 6.4f, 6.4f);
            }
            else
            {
                Icons.Draw(g, Glyph, startX + 4.5f, LH / 2f, fore);
            }

            Theme.Draw(g, Text, Font, fore, new RectangleF(startX + leadGap, 0, textWidth + 8f, LH), StringAlignment.Near);
        }

        private void ResolveColors(out Color fill, out Color border, out Color fore)
        {
            switch (Kind)
            {
                case ButtonKind.Primary:
                    fill = Theme.Alpha(Theme.Accent, pressed ? 66 : hover ? 50 : 32);
                    border = Theme.Alpha(Theme.Accent, hover ? 195 : 115);
                    fore = hover ? Color.White : Theme.AccentText;
                    break;

                case ButtonKind.Secondary:
                    fill = pressed ? Theme.Border : (hover ? Theme.Hover : Theme.Card);
                    border = hover ? Theme.BorderStrong : Theme.Border;
                    fore = Theme.Text;
                    break;

                case ButtonKind.DangerOutline:
                    fill = hover ? Theme.Alpha(Theme.Danger, pressed ? 42 : 24) : Theme.Bg;
                    border = hover ? Theme.Alpha(Theme.Danger, 155) : Theme.BorderStrong;
                    fore = hover ? Theme.DangerText : Theme.TextSoft;
                    break;

                default:
                    fill = Selected ? Theme.Hover : (hover ? Theme.Card : Theme.Bg);
                    border = Selected ? Theme.Alpha(Theme.Accent, 120) : (hover ? Theme.Border : Theme.BorderSubtle);
                    fore = (Selected || hover) ? Theme.Text : Theme.Muted;
                    break;
            }
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; pressed = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { if (e.Button == MouseButtons.Left) { pressed = true; Invalidate(); } base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressed = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnEnabledChanged(EventArgs e) { Invalidate(); base.OnEnabledChanged(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
    }

    internal sealed class ToggleSwitch : BufferedControl
    {
        private bool isOn;
        private bool hover;

        public event EventHandler CheckedChanged;

        public bool Checked
        {
            get { return isOn; }
            set
            {
                if (isOn == value) return;
                isOn = value;
                Invalidate();
                EventHandler handler = CheckedChanged;
                if (handler != null) handler(this, EventArgs.Empty);
            }
        }

        public ToggleSwitch()
        {
            Font = Theme.Small;
            Cursor = Cursors.Hand;
            TabStop = false;
        }

        protected override void OnClick(EventArgs e)
        {
            Checked = !Checked;
            base.OnClick(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = Begin(e);
            float top = (LH - 18f) / 2f;
            Color track = isOn ? Theme.Accent : (hover ? Theme.BorderStrong : Theme.Card);
            Color trackBorder = isOn ? Theme.Accent : Theme.BorderStrong;
            Theme.FillRound(g, new RectangleF(0.5f, top, 32f, 18f), 9f, track, trackBorder);

            float knobX = isOn ? 0.5f + 32f - 12f - 3f : 0.5f + 3f;
            using (var brush = new SolidBrush(isOn ? Color.White : Theme.TextSoft))
                g.FillEllipse(brush, knobX, top + 3f, 12f, 12f);

            Theme.Draw(g, Text, Font, hover ? Theme.Text : Theme.TextSoft, new RectangleF(42f, 0, LW - 42f, LH), StringAlignment.Near);
        }

        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnTextChanged(EventArgs e) { Invalidate(); base.OnTextChanged(e); }
    }

    internal sealed class TitleBar : BufferedControl
    {
        private const int None = -1, Minimize = 0, Close = 1;
        private const float ButtonWidth = 44f;
        private int hot = None;

        public bool ShowMinimize { get; set; }
        public string Subtitle { get; set; }

        public event EventHandler MinimizeClicked;
        public event EventHandler CloseClicked;

        public TitleBar()
        {
            ShowMinimize = true;
            Text = "GameLauncher";
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = Begin(e);

            // Marca visual minimalista esmeralda no canto superior esquerdo
            var mark = new RectangleF(20f, LH / 2f - 7f, 14f, 14f);
            Theme.FillRound(g, mark, 4f, Theme.Alpha(Theme.Accent, 40), Theme.Alpha(Theme.Accent, 160));
            using (var dot = new SolidBrush(Theme.Accent))
                g.FillEllipse(dot, mark.X + 4.5f, mark.Y + 4.5f, 5f, 5f);

            float titleWidth = Theme.Measure(g, Text, Theme.BodyBold);
            Theme.Draw(g, Text, Theme.BodyBold, Theme.Text, new RectangleF(42f, 0, titleWidth + 8f, LH), StringAlignment.Near);

            if (!string.IsNullOrEmpty(Subtitle))
            {
                Theme.Draw(g, Subtitle, Theme.Small, Theme.Faint,
                    new RectangleF(48f + titleWidth, 0, 180f, LH), StringAlignment.Near);
            }

            if (ShowMinimize) DrawCaptionButton(g, Minimize, false);
            DrawCaptionButton(g, Close, true);
        }

        private void DrawCaptionButton(Graphics g, int index, bool isClose)
        {
            float rightOffset = isClose ? ButtonWidth : ButtonWidth * 2f;
            var rect = new RectangleF(LW - rightOffset, 0, ButtonWidth, LH);
            bool active = hot == index;
            if (active)
            {
                using (var brush = new SolidBrush(isClose ? Color.FromArgb(196, 43, 28) : Theme.Hover))
                    g.FillRectangle(brush, rect);
            }

            float cx = rect.X + rect.Width / 2f, cy = rect.Y + rect.Height / 2f;
            using (var pen = new Pen(active && isClose ? Color.White : Theme.Muted, 1.25f) { StartCap = LineCap.Round, EndCap = LineCap.Round })
            {
                if (isClose)
                {
                    g.DrawLine(pen, cx - 4.5f, cy - 4.5f, cx + 4.5f, cy + 4.5f);
                    g.DrawLine(pen, cx - 4.5f, cy + 4.5f, cx + 4.5f, cy - 4.5f);
                }
                else
                {
                    g.DrawLine(pen, cx - 5f, cy, cx + 5f, cy);
                }
            }
        }

        private int HitTest(Point location)
        {
            float x = ToLogical(location).X;
            if (x >= LW - ButtonWidth) return Close;
            if (ShowMinimize && x >= LW - ButtonWidth * 2f) return Minimize;
            return None;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            int hit = HitTest(e.Location);
            if (hit != hot) { hot = hit; Invalidate(); }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            if (hot != None) { hot = None; Invalidate(); }
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && HitTest(e.Location) == None)
                Native.DragWindow(this);
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            if (e.Button != MouseButtons.Left) return;
            int hit = HitTest(e.Location);
            EventHandler handler = hit == Close ? CloseClicked : hit == Minimize ? MinimizeClicked : null;
            if (handler != null) handler(this, EventArgs.Empty);
            base.OnMouseUp(e);
        }
    }

    internal sealed class StatusCard : BufferedControl
    {
        private readonly Timer pulse = new Timer { Interval = 45 };
        private float phase;
        private bool online, frontendUp, backendUp, windowActive = true, addressHover;
        private string address = "";
        private int frontendPort, backendPort;
        private RectangleF addressBox;

        public event EventHandler AddressClicked;

        public StatusCard()
        {
            pulse.Tick += delegate
            {
                phase += 0.032f;
                if (phase >= 1f) phase = 0f;
                Invalidate(Theme.Area(10, 10, 40, 40));
            };
        }

        public void SetState(bool isOnline, bool frontend, bool backend, string addr, int fePort, int bePort)
        {
            online = isOnline;
            frontendUp = frontend;
            backendUp = backend;
            address = addr;
            frontendPort = fePort;
            backendPort = bePort;
            UpdatePulse();
            Invalidate();
        }

        // Pausa a animação quando a janela está oculta/minimizada para manter 0% de CPU na bandeja.
        public void SetWindowActive(bool active)
        {
            windowActive = active;
            UpdatePulse();
        }

        private void UpdatePulse()
        {
            bool run = online && windowActive;
            if (pulse.Enabled == run) return;
            pulse.Enabled = run;
            if (!run) { phase = 0f; Invalidate(); }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = Begin(e);
            var cardRect = new RectangleF(0.5f, 0.5f, LW - 1f, LH - 1f);
            Theme.FillRound(g, cardRect, 12f, Theme.Card, Theme.Border);

            // Brilho superior sutil típico de superfícies estilo Raycast
            using (var highlight = new Pen(Color.FromArgb(14, Color.White)))
                g.DrawLine(highlight, 12f, 1.5f, LW - 12f, 1.5f);

            const float cx = 28f, cy = 29f;
            if (online)
            {
                float r = 5f + 10.5f * phase;
                int alpha = (int)(115 * (1f - phase));
                if (alpha > 0)
                {
                    using (var halo = new SolidBrush(Theme.Alpha(Theme.Accent, alpha)))
                        g.FillEllipse(halo, cx - r, cy - r, r * 2f, r * 2f);
                }
            }
            else
            {
                using (var idleRing = new SolidBrush(Theme.Alpha(Theme.Muted, 28)))
                    g.FillEllipse(idleRing, cx - 8f, cy - 8f, 16f, 16f);
            }

            using (var dot = new SolidBrush(online ? Theme.Accent : Theme.Faint))
                g.FillEllipse(dot, cx - 4.8f, cy - 4.8f, 9.6f, 9.6f);

            Theme.Draw(g, online ? "Servidor Online" : "Servidor Offline", Theme.Title, Theme.Text,
                new RectangleF(46f, 15f, 220f, 24f), StringAlignment.Near);

            string stateHint = online ? "Rede local ativa" : "Serviços parados";
            Theme.Draw(g, stateHint, Theme.Small, online ? Theme.AccentText : Theme.Muted,
                new RectangleF(LW - 160f, 17f, 142f, 20f), StringAlignment.Far);

            // Faixa interna clicável com IP local e porta
            addressBox = new RectangleF(16f, 52f, LW - 32f, 34f);
            Color addrFill = addressHover ? Theme.Hover : Theme.Inset;
            Color addrBorder = addressHover ? Theme.BorderStrong : Theme.BorderSubtle;
            Theme.FillRound(g, addressBox, 8f, addrFill, addrBorder);

            Theme.Draw(g, "HOST", Theme.TinyBold, Theme.Faint,
                new RectangleF(addressBox.X + 12f, addressBox.Y, 44f, addressBox.Height), StringAlignment.Near);
            Theme.Draw(g, "http://" + address, Theme.MonoAddress, addressHover ? Theme.AccentText : Theme.Text,
                new RectangleF(addressBox.X + 52f, addressBox.Y, addressBox.Width - 82f, addressBox.Height), StringAlignment.Near);
            Icons.Draw(g, IconGlyph.External, addressBox.Right - 16f, addressBox.Y + addressBox.Height / 2f,
                addressHover ? Theme.AccentText : Theme.Muted);

            // Badges compactas dos microsserviços
            float x = 16f;
            x += DrawBadge(g, x, 98f, "Frontend", frontendPort, frontendUp) + 8f;
            DrawBadge(g, x, 98f, "Backend", backendPort, backendUp);
        }

        private static float DrawBadge(Graphics g, float x, float y, string service, int port, bool active)
        {
            string label = string.Format("{0}: {1}", service, active ? "Ativo" : "Inativo");
            string portTag = ":" + port;
            float labelWidth = Theme.Measure(g, label, Theme.SmallBold);
            float portWidth = Theme.Measure(g, portTag, Theme.Mono);
            float width = 24f + labelWidth + 6f + portWidth + 12f;

            Color fill = active ? Theme.Alpha(Theme.Accent, 24) : Theme.Inset;
            Color border = active ? Theme.Alpha(Theme.Accent, 80) : Theme.Border;
            Color dotColor = active ? Theme.Accent : Theme.Faint;
            Color labelColor = active ? Theme.AccentText : Theme.TextSoft;

            Theme.FillRound(g, new RectangleF(x + 0.5f, y + 0.5f, width, 25f), 12.5f, fill, border);
            using (var dot = new SolidBrush(dotColor))
                g.FillEllipse(dot, x + 10f, y + 10f, 5.5f, 5.5f);

            Theme.Draw(g, label, Theme.SmallBold, labelColor,
                new RectangleF(x + 21f, y + 0.5f, labelWidth + 4f, 25f), StringAlignment.Near);
            Theme.Draw(g, portTag, Theme.Mono, Theme.Muted,
                new RectangleF(x + 24f + labelWidth, y + 0.5f, portWidth + 8f, 25f), StringAlignment.Near);

            return width;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            bool inside = addressBox.Contains(ToLogical(e.Location));
            if (inside != addressHover)
            {
                addressHover = inside;
                Cursor = inside ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            if (addressHover) { addressHover = false; Cursor = Cursors.Default; Invalidate(); }
            base.OnMouseLeave(e);
        }

        protected override void OnClick(EventArgs e)
        {
            EventHandler handler = AddressClicked;
            if (addressHover && handler != null) handler(this, EventArgs.Empty);
            base.OnClick(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) pulse.Dispose();
            base.Dispose(disposing);
        }
    }

    internal enum LogLevel { Info, Ok, Warn, Error }

    // Mini feed de logs minimalista: renderização direta sem controles pesados.
    internal sealed class LogFeed : BufferedControl
    {
        private struct Entry
        {
            public string Time;
            public string Text;
            public LogLevel Level;
        }

        private const float HeaderHeight = 24f;
        private const float LineHeight = 17.5f;
        private const int MaxEntries = 40;
        private readonly List<Entry> entries = new List<Entry>();
        private RectangleF clearRect;
        private bool clearHover;

        public void Add(string text, LogLevel level)
        {
            entries.Add(new Entry { Time = DateTime.Now.ToString("HH:mm:ss"), Text = text, Level = level });
            if (entries.Count > MaxEntries) entries.RemoveAt(0);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = Begin(e);
            Theme.FillRound(g, new RectangleF(0.5f, 0.5f, LW - 1f, LH - 1f), 10f, Theme.Console, Theme.Border);

            using (var sep = new Pen(Theme.BorderSubtle))
                g.DrawLine(sep, 1f, HeaderHeight, LW - 1f, HeaderHeight);

            Theme.Draw(g, "TERMINAL", Theme.TinyBold, Theme.Faint,
                new RectangleF(12f, 0f, 100f, HeaderHeight), StringAlignment.Near);

            clearRect = new RectangleF(LW - 56f, 0f, 46f, HeaderHeight);
            if (entries.Count > 0)
            {
                Theme.Draw(g, "limpar", Theme.Small, clearHover ? Theme.TextSoft : Theme.Faint,
                    clearRect, StringAlignment.Far);
            }

            int capacity = Math.Max(1, (int)((LH - HeaderHeight - 12f) / LineHeight));
            int start = Math.Max(0, entries.Count - capacity);
            float y = HeaderHeight + 6f;

            for (int i = start; i < entries.Count; i++, y += LineHeight)
            {
                Entry entry = entries[i];
                Color accent = AccentFor(entry.Level);
                Theme.Draw(g, entry.Time, Theme.Mono, Theme.Faint,
                    new RectangleF(12f, y, 56f, LineHeight), StringAlignment.Near);
                Theme.Draw(g, "›", Theme.Mono, accent,
                    new RectangleF(68f, y, 10f, LineHeight), StringAlignment.Center);
                Theme.Draw(g, entry.Text, Theme.Mono, TextFor(entry.Level),
                    new RectangleF(80f, y, LW - 92f, LineHeight), StringAlignment.Near);
            }
        }

        private static Color AccentFor(LogLevel level)
        {
            switch (level)
            {
                case LogLevel.Ok: return Theme.Accent;
                case LogLevel.Warn: return Theme.Warn;
                case LogLevel.Error: return Theme.Danger;
                default: return Theme.Faint;
            }
        }

        private static Color TextFor(LogLevel level)
        {
            switch (level)
            {
                case LogLevel.Ok: return Theme.AccentText;
                case LogLevel.Warn: return Theme.Warn;
                case LogLevel.Error: return Theme.DangerText;
                default: return Theme.TextSoft;
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            bool inside = entries.Count > 0 && clearRect.Contains(ToLogical(e.Location));
            if (inside != clearHover)
            {
                clearHover = inside;
                Cursor = inside ? Cursors.Hand : Cursors.Default;
                Invalidate();
            }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            if (clearHover) { clearHover = false; Cursor = Cursors.Default; Invalidate(); }
            base.OnMouseLeave(e);
        }

        protected override void OnClick(EventArgs e)
        {
            if (clearHover)
            {
                entries.Clear();
                clearHover = false;
                Cursor = Cursors.Default;
                Invalidate();
            }
            base.OnClick(e);
        }
    }

    internal sealed class InputBox : Panel
    {
        public readonly TextBox Box = new TextBox();

        public InputBox()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bg;
            Height = Theme.Px(32);
            Padding = new Padding(Theme.Px(10), Theme.Px(7), Theme.Px(10), Theme.Px(5));

            Box.BorderStyle = BorderStyle.None;
            Box.BackColor = Theme.Card;
            Box.ForeColor = Theme.Text;
            Box.Font = Theme.Body;
            Box.Dock = DockStyle.Fill;
            Box.Enter += delegate { Invalidate(); };
            Box.Leave += delegate { Invalidate(); };
            Controls.Add(Box);
        }

        public override string Text
        {
            get { return Box.Text; }
            set { Box.Text = value; }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(BackColor);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Color border = Box.Focused ? Theme.Alpha(Theme.Accent, 175) : Theme.Border;
            Theme.FillRound(g, new RectangleF(0.5f, 0.5f, Width - 1, Height - 1), Theme.Px(7), Theme.Card, border);
        }
    }
}
