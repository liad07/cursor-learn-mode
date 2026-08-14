namespace LearnObserver;

internal sealed class OverlayForm : Form
{
    private readonly Label _title = new();
    private readonly Label _time = new();
    private readonly Label _events = new();
    private readonly Button _pause = new();
    private readonly Button _stop = new();
    private readonly System.Windows.Forms.Timer _tick = new();
    private Rectangle _pauseScreen;
    private Rectangle _stopScreen;

    public event Action? StopRequested;
    public event Action? PauseRequested;

    public OverlayForm()
    {
        FormBorderStyle = FormBorderStyle.None;
        TopMost = true;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Width = 340;
        Height = 196;
        BackColor = Color.FromArgb(22, 22, 26);
        ForeColor = Color.White;
        Padding = new Padding(16);
        var screen = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1280, 720);
        Location = new Point(screen.Right - Width - 24, screen.Bottom - Height - 24);

        _title.Text = "🔴  Learning";
        _title.Font = new Font("Segoe UI", 13, FontStyle.Bold);
        _title.AutoSize = true;
        _title.Location = new Point(16, 14);

        _time.Font = new Font("Segoe UI", 10);
        _time.AutoSize = true;
        _time.Location = new Point(16, 48);
        _time.ForeColor = Color.FromArgb(200, 200, 210);

        _events.Font = new Font("Segoe UI", 10);
        _events.AutoSize = true;
        _events.Location = new Point(16, 72);
        _events.ForeColor = Color.FromArgb(200, 200, 210);

        var hint = new Label
        {
            Text = "Stop: overlay or Ctrl+Shift+L",
            Font = new Font("Segoe UI", 8),
            AutoSize = true,
            Location = new Point(16, 94),
            ForeColor = Color.FromArgb(140, 140, 150),
        };

        _pause.Text = "Pause";
        _pause.Width = 140;
        _pause.Height = 36;
        _pause.Location = new Point(16, 140);
        _pause.FlatStyle = FlatStyle.Flat;
        _pause.BackColor = Color.FromArgb(48, 48, 56);
        _pause.ForeColor = Color.White;
        _pause.MouseDown += (_, _) => PauseRequested?.Invoke();

        _stop.Text = "■  Stop";
        _stop.Width = 140;
        _stop.Height = 36;
        _stop.Location = new Point(176, 140);
        _stop.FlatStyle = FlatStyle.Flat;
        _stop.BackColor = Color.FromArgb(176, 40, 40);
        _stop.ForeColor = Color.White;
        _stop.MouseDown += (_, _) => StopRequested?.Invoke();

        Controls.Add(_title);
        Controls.Add(_time);
        Controls.Add(_events);
        Controls.Add(hint);
        Controls.Add(_pause);
        Controls.Add(_stop);

        Load += (_, _) => CacheButtonRects();
        LocationChanged += (_, _) => CacheButtonRects();
        SizeChanged += (_, _) => CacheButtonRects();

        _tick.Interval = 250;
        _tick.Tick += (_, _) => RefreshStats();
        _tick.Start();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= 0x00000008 | 0x00000080 | 0x08000000; // WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
            return cp;
        }
    }

    public bool HitsControlButtons(int screenX, int screenY)
    {
        var pause = _pauseScreen;
        var stop = _stopScreen;
        return pause.Contains(screenX, screenY) || stop.Contains(screenX, screenY);
    }

    public void RefreshStats()
    {
        var elapsed = DateTime.UtcNow - Session.StartedAt;
        _title.Text = Session.Paused ? "⏸  Paused" : "🔴  Learning";
        _time.Text = $"Time: {elapsed:mm\\:ss}";
        _events.Text = $"Events: {Session.EventCount}";
        _pause.Text = Session.Paused ? "Resume" : "Pause";
        CacheButtonRects();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Color.FromArgb(80, 80, 90));
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == Win32.WM_NCHITTEST)
        {
            CacheButtonRects();
            var screen = Win32.PointFromLParam(m.LParam);
            if (HitsControlButtons(screen.X, screen.Y))
            {
                m.Result = (IntPtr)Win32.HTCLIENT;
                return;
            }
            m.Result = (IntPtr)Win32.HTTRANSPARENT;
            return;
        }
        if (m.Msg == Win32.WM_MOUSEACTIVATE)
        {
            m.Result = (IntPtr)Win32.MA_NOACTIVATE;
            return;
        }
        if (m.Msg == Win32.WM_CLIPBOARDUPDATE) Program.OnClipboard();
        base.WndProc(ref m);
    }

    private void CacheButtonRects()
    {
        if (!IsHandleCreated) return;
        _pauseScreen = RectangleToScreen(_pause.Bounds);
        _stopScreen = RectangleToScreen(_stop.Bounds);
    }
}
