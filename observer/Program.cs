using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using System.Windows.Forms;

namespace LearnObserver;

internal static class Session
{
    public static string Dir = "";
    public static DateTime StartedAt = DateTime.UtcNow;
    public static int EventCount;
    public static bool Paused;
    public static bool Stopping;
    public static bool ScreenshotsEnabled = EnvFlag("LEARN_SCREENSHOTS", true);
    public static bool ClipboardEnabled = EnvFlag("LEARN_CLIPBOARD", false);

    private static bool EnvFlag(string name, bool fallback)
    {
        var raw = Environment.GetEnvironmentVariable(name);
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        return raw.Trim() switch
        {
            "0" or "false" or "False" or "no" or "off" or "OFF" => false,
            "1" or "true" or "True" or "yes" or "on" or "ON" => true,
            _ => fallback,
        };
    }
}

internal static class Program
{
    private static readonly object Gate = new();
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    private static OverlayForm? _overlay;
    private static IntPtr _mouseHook;
    private static IntPtr _keyboardHook;
    private static IntPtr _fgHook;
    private static IntPtr _focusHook;
    private static Win32.HookProc? _mouseProc;
    private static Win32.HookProc? _keyboardProc;
    private static Win32.WinEventProc? _winEventProc;
    private static readonly StringBuilder TextBuf = new();
    private static DateTime _lastTextFlush = DateTime.UtcNow;
    private static DateTime _lastShot = DateTime.MinValue;
    private static string _lastApp = "";
    private static string _lastTitle = "";
    private static StreamWriter? _events;
    private static BlockingCollection<Action>? _captureQueue;
    private static Thread? _captureThread;

    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Session.Dir = ReadArg(args, "--session-dir") ?? throw new InvalidOperationException("Missing --session-dir");
        Directory.CreateDirectory(Path.Combine(Session.Dir, "screenshots"));
        Session.StartedAt = DateTime.UtcNow;
        _events = new StreamWriter(new FileStream(Path.Combine(Session.Dir, "events.jsonl"), FileMode.Create, FileAccess.Write, FileShare.Read))
        {
            AutoFlush = true,
        };
        StartCaptureThread();

        _overlay = new OverlayForm();
        _overlay.StopRequested += RequestStop;
        _overlay.PauseRequested += TogglePause;
        WritePrivacyOptions();
        _overlay.HandleCreated += (_, _) =>
        {
            if (Session.ClipboardEnabled) Win32.AddClipboardFormatListener(_overlay.Handle);
            InstallHooks();
            if (!Session.Stopping) WriteStatus("recording");
        };
        _overlay.FormClosed += (_, _) => RequestStop();

        var poll = new System.Windows.Forms.Timer { Interval = 250 };
        poll.Tick += (_, _) =>
        {
            if (Session.Stopping) return;
            PollControlFiles();
            FlushTextIfIdle();
            WriteStatus(Session.Paused ? "paused" : "recording");
        };
        poll.Start();

        Application.ApplicationExit += (_, _) => Cleanup();
        Application.Run(_overlay);
    }

    private static void InstallHooks()
    {
        _mouseProc = MouseProc;
        _keyboardProc = KeyboardProc;
        _winEventProc = WinEvent;
        var module = Win32.GetModuleHandle(null);
        _mouseHook = Win32.SetWindowsHookEx(Win32.WH_MOUSE_LL, _mouseProc, module, 0);
        _keyboardHook = Win32.SetWindowsHookEx(Win32.WH_KEYBOARD_LL, _keyboardProc, module, 0);
        _fgHook = Win32.SetWinEventHook(Win32.EVENT_SYSTEM_FOREGROUND, Win32.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _winEventProc, 0, 0, Win32.WINEVENT_OUTOFCONTEXT);
        _focusHook = Win32.SetWinEventHook(Win32.EVENT_OBJECT_FOCUS, Win32.EVENT_OBJECT_FOCUS, IntPtr.Zero, _winEventProc, 0, 0, Win32.WINEVENT_OUTOFCONTEXT);
        if (_mouseHook == IntPtr.Zero || _keyboardHook == IntPtr.Zero)
        {
            Session.Stopping = true;
            WriteStatus("failed", "Windows hooks failed to install.");
            _overlay?.BeginInvoke(() => _overlay.Close());
            return;
        }
        QueueCapture(() => CaptureWindowChange(Win32.GetForegroundWindow(), "app-change", takeShot: true));
    }

    private static IntPtr MouseProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && !Session.Paused && !Session.Stopping)
        {
            var msg = wParam.ToInt32();
            if (msg is Win32.WM_LBUTTONDOWN or Win32.WM_RBUTTONDOWN or Win32.WM_MBUTTONDOWN)
            {
                var data = Marshal.PtrToStructure<Win32.MSLLHOOKSTRUCT>(lParam);
                var button = msg == Win32.WM_LBUTTONDOWN ? "left" : msg == Win32.WM_RBUTTONDOWN ? "right" : "middle";
                var pt = data.pt;
                QueueCapture(() => OnClick(pt, button));
            }
        }
        return Win32.CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private static IntPtr KeyboardProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && !Session.Stopping)
        {
            var msg = wParam.ToInt32();
            if (msg is Win32.WM_KEYDOWN or Win32.WM_SYSKEYDOWN)
            {
                var data = Marshal.PtrToStructure<Win32.KBDLLHOOKSTRUCT>(lParam);
                var ctrl = KeyDown(0x11);
                var shift = KeyDown(0x10);
                if (ctrl && shift && data.vkCode is 76 or 0x4C)
                {
                    RequestStop();
                }
                else if (!Session.Paused)
                {
                    QueueCapture(() => OnKey(data));
                }
            }
        }
        return Win32.CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    private static void WinEvent(IntPtr hWinEventHook, uint eventType, IntPtr hwnd, int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
    {
        if (Session.Paused || Session.Stopping || hwnd == IntPtr.Zero) return;
        if (_overlay != null && hwnd == _overlay.Handle) return;
        if (eventType == Win32.EVENT_OBJECT_FOCUS && CaptureBacklog() > 48) return;
        QueueCapture(() =>
        {
            if (eventType == Win32.EVENT_SYSTEM_FOREGROUND) CaptureWindowChange(hwnd, "window-change", takeShot: true);
            else CaptureWindowChange(hwnd, "focus", takeShot: false);
        });
    }

    private static void OnClick(Win32.POINT pt, string button)
    {
        if (IsOverlayPoint(pt.X, pt.Y)) return;
        FlushText();
        var hwnd = Win32.WindowFromPoint(pt);
        var ctx = ReadContext(hwnd, pt);
        var shot = ctx.IsPassword ? null : MaybeScreenshot(ctx.Hwnd, "click");
        Emit(new EventDto
        {
            Type = "click",
            Button = button,
            Screenshot = shot,
        }, ctx);
    }

    private static void OnKey(Win32.KBDLLHOOKSTRUCT data)
    {
        var vk = data.vkCode;
        var ctrl = KeyDown(0x11);
        var alt = KeyDown(0x12);
        var shift = KeyDown(0x10);
        var win = KeyDown(0x5B) || KeyDown(0x5C);
        if (ctrl && shift && vk is 76 or 0x4C)
        {
            RequestStop();
            return;
        }
        if (_overlay != null && Win32.GetForegroundWindow() == _overlay.Handle) return;
        var ctx = ReadContext(Win32.GetForegroundWindow());
        var modifiers = new List<string>();
        if (ctrl) modifiers.Add("Ctrl");
        if (alt) modifiers.Add("Alt");
        if (shift) modifiers.Add("Shift");
        if (win) modifiers.Add("Win");

        if (ctrl || alt || win || vk is 13 or 27 or 9 or 8 or 46)
        {
            FlushText();
            var keyName = vk switch
            {
                13 => "Enter",
                27 => "Escape",
                9 => "Tab",
                8 => "Backspace",
                46 => "Delete",
                83 when ctrl => "S",
                _ => ((Keys)vk).ToString(),
            };
            Emit(new EventDto
            {
                Type = "key",
                Key = keyName,
                Modifiers = modifiers.Count > 0 ? modifiers : null,
            }, ctx);
            if (vk == 13 && IsSaveAs(ctx.Title)) FlushText();
            return;
        }

        if (ctx.IsPassword)
        {
            lock (Gate) TextBuf.Clear();
            Emit(new EventDto { Type = "text", Text = "[REDACTED]", Redacted = true }, ctx);
            return;
        }

        var ch = ToChar(vk, data.scanCode);
        if (ch != null)
        {
            lock (Gate) TextBuf.Append(ch);
        }
        _lastTextFlush = DateTime.UtcNow;
    }

    private static void CaptureWindowChange(IntPtr hwnd, string type, bool takeShot)
    {
        if (hwnd == IntPtr.Zero) return;
        if (_overlay != null && hwnd == _overlay.Handle) return;
        var ctx = ReadContext(hwnd);
        if (string.IsNullOrWhiteSpace(ctx.ProcessName) && string.IsNullOrWhiteSpace(ctx.Title)) return;
        var appChanged = !string.Equals(ctx.ProcessName, _lastApp, StringComparison.OrdinalIgnoreCase);
        var titleChanged = !string.Equals(ctx.Title, _lastTitle, StringComparison.Ordinal);
        if (!appChanged && !titleChanged && type != "focus") return;
        FlushText();
        _lastApp = ctx.ProcessName;
        _lastTitle = ctx.Title;
        var eventType = appChanged ? "app-change" : type;
        var shot = takeShot ? MaybeScreenshot(ctx.Hwnd, eventType) : null;
        Emit(new EventDto { Type = eventType, Screenshot = shot }, ctx);
    }

    private static void FlushTextIfIdle()
    {
        lock (Gate)
        {
            if (TextBuf.Length == 0) return;
            if ((DateTime.UtcNow - _lastTextFlush).TotalMilliseconds < 450) return;
        }
        QueueCapture(FlushText);
    }

    private static void FlushText()
    {
        string text;
        lock (Gate)
        {
            if (TextBuf.Length == 0) return;
            text = TextBuf.ToString();
            TextBuf.Clear();
        }
        var ctx = ReadContext(Win32.GetForegroundWindow());
        if (ctx.IsPassword) text = "[REDACTED]";
        Emit(new EventDto { Type = "text", Text = text, Redacted = ctx.IsPassword }, ctx);
    }

    private static void Emit(EventDto dto, Context ctx)
    {
        dto.Timestamp = DateTime.UtcNow.ToString("o");
        dto.Application = FriendlyApp(ctx.ProcessName, ctx.Title);
        dto.ProcessName = ctx.ProcessName;
        dto.WindowTitle = ctx.Title;
        dto.Element = ctx.Element;
        var line = JsonSerializer.Serialize(dto, JsonOpts);
        lock (Gate)
        {
            _events?.WriteLine(line);
            Session.EventCount++;
        }
    }

    private static string? MaybeScreenshot(IntPtr hwnd, string reason)
    {
        if (!Session.ScreenshotsEnabled || Session.Paused || Session.Stopping) return null;
        if ((DateTime.UtcNow - _lastShot).TotalMilliseconds < 400) return null;
        if (hwnd == IntPtr.Zero) hwnd = Win32.GetForegroundWindow();
        if (_overlay != null && hwnd == _overlay.Handle) return null;
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (focused != null)
            {
                if ((bool)focused.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty)) return null;
                var name = focused.Current.Name ?? "";
                var automationId = focused.Current.AutomationId ?? "";
                if (LooksSensitiveLabel(name) || LooksSensitiveLabel(automationId)) return null;
                var walker = TreeWalker.ControlViewWalker;
                var current = focused;
                for (var i = 0; i < 4 && current != null; i++)
                {
                    current = walker.GetParent(current);
                    if (current == null) break;
                    if (LooksSensitiveLabel(current.Current.Name ?? "") || LooksSensitiveLabel(current.Current.AutomationId ?? ""))
                        return null;
                }
            }
        }
        catch { /* ignore */ }
        if (!Win32.GetWindowRect(hwnd, out var rect)) return null;
        var width = Math.Max(1, rect.Right - rect.Left);
        var height = Math.Max(1, rect.Bottom - rect.Top);
        if (width < 20 || height < 20) return null;
        try
        {
            using var bmp = new Bitmap(width, height);
            using (var g = Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height));
            }
            var scaled = Scale(bmp, 1280);
            var name = $"{DateTime.UtcNow:yyyyMMdd-HHmmss-fff}-{reason}.jpg";
            var rel = Path.Combine("screenshots", name);
            var encoder = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);
            using var pars = new EncoderParameters(1);
            pars.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 55L);
            scaled.Save(Path.Combine(Session.Dir, rel), encoder, pars);
            if (!ReferenceEquals(scaled, bmp)) scaled.Dispose();
            _lastShot = DateTime.UtcNow;
            return rel.Replace('\\', '/');
        }
        catch
        {
            return null;
        }
    }

    private static Bitmap Scale(Bitmap src, int maxWidth)
    {
        if (src.Width <= maxWidth) return src;
        var height = Math.Max(1, src.Height * maxWidth / src.Width);
        var copy = new Bitmap(maxWidth, height);
        using var g = Graphics.FromImage(copy);
        g.DrawImage(src, 0, 0, maxWidth, height);
        return copy;
    }

    private static Context ReadContext(IntPtr hwnd, Win32.POINT? point = null)
    {
        if (hwnd == IntPtr.Zero) hwnd = Win32.GetForegroundWindow();
        var root = Win32.GetAncestor(hwnd, Win32.GA_ROOT);
        if (root != IntPtr.Zero) hwnd = root;
        var title = Win32.GetWindowTitle(hwnd);
        var processName = "";
        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        try
        {
            processName = Process.GetProcessById((int)pid).ProcessName;
        }
        catch { /* process may have exited */ }

        UiElementDto? element = null;
        var isPassword = false;
        try
        {
            AutomationElement? target = null;
            if (point != null)
            {
                try { target = AutomationElement.FromPoint(new System.Windows.Point(point.Value.X, point.Value.Y)); }
                catch { /* FromPoint can fail */ }
            }
            target ??= AutomationElement.FocusedElement;
            if (target != null)
            {
                isPassword = (bool)target.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty);
                element = Describe(target);
                if (LooksSensitiveLabel(element.Name ?? "") || LooksSensitiveLabel(element.AutomationId ?? ""))
                    isPassword = true;
                if (string.IsNullOrWhiteSpace(element.Name))
                {
                    var walker = TreeWalker.ControlViewWalker;
                    var current = target;
                    for (var i = 0; i < 6 && current != null && string.IsNullOrWhiteSpace(element.Name); i++)
                    {
                        current = walker.GetParent(current);
                        if (current == null) break;
                        var candidate = Describe(current);
                        if (!string.IsNullOrWhiteSpace(candidate.Name)) element = candidate;
                    }
                }
            }
        }
        catch { /* UIA can fail on elevated / empty focus */ }

        return new Context(hwnd, processName, title, element, isPassword);
    }

    private static UiElementDto Describe(AutomationElement el) => new()
    {
        Name = el.Current.Name,
        ControlType = el.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""),
        AutomationId = el.Current.AutomationId,
        ClassName = el.Current.ClassName,
        IsPassword = (bool)el.GetCurrentPropertyValue(AutomationElement.IsPasswordProperty),
    };

    private static bool IsOverlayPoint(int x, int y) => _overlay?.HitsControlButtons(x, y) == true;

    private static void StartCaptureThread()
    {
        _captureQueue = new BlockingCollection<Action>();
        _captureThread = new Thread(CaptureLoop)
        {
            IsBackground = true,
            Name = "LearnCapture",
        };
        _captureThread.SetApartmentState(ApartmentState.STA);
        _captureThread.Start();
    }

    private static void CaptureLoop()
    {
        if (_captureQueue == null) return;
        foreach (var work in _captureQueue.GetConsumingEnumerable())
        {
            try { work(); }
            catch { /* capture must not kill the observer */ }
        }
    }

    private static void QueueCapture(Action work)
    {
        try { _captureQueue?.Add(work); }
        catch (InvalidOperationException) { /* queue completing during shutdown */ }
    }

    private static int CaptureBacklog() => _captureQueue?.Count ?? 0;

    private static bool KeyDown(int vk) => (Win32.GetKeyState(vk) & 0x8000) != 0;

    private static string? ToChar(uint vk, uint scan)
    {
        var state = new byte[256];
        Win32.GetKeyboardState(state);
        var sb = new StringBuilder(8);
        var n = Win32.ToUnicode(vk, scan, state, sb, sb.Capacity, 0);
        if (n <= 0) return null;
        var ch = sb.ToString();
        return ch.All(c => char.IsControl(c)) ? null : ch;
    }

    private static string FriendlyApp(string processName, string title)
    {
        if (processName.Equals("notepad", StringComparison.OrdinalIgnoreCase)) return "Notepad";
        if (processName.Equals("explorer", StringComparison.OrdinalIgnoreCase)) return "File Explorer";
        if (processName is "chrome" or "msedge" or "firefox") return processName == "msedge" ? "Edge" : processName == "chrome" ? "Chrome" : "Firefox";
        if (!string.IsNullOrWhiteSpace(title))
        {
            var dash = title.LastIndexOf(" - ", StringComparison.Ordinal);
            if (dash > 0) return title[(dash + 3)..];
        }
        return string.IsNullOrWhiteSpace(processName) ? "Unknown" : processName;
    }

    private static bool IsSaveAs(string title) =>
        title.Contains("Save As", StringComparison.OrdinalIgnoreCase)
        || title.Contains("שמירה בשם", StringComparison.Ordinal);

    private static void TogglePause()
    {
        Session.Paused = !Session.Paused;
        if (Session.Paused) QueueCapture(FlushText);
        WriteStatus(Session.Paused ? "paused" : "recording");
    }

    private static void PollControlFiles()
    {
        try
        {
            var stop = Path.Combine(Session.Dir, "STOP");
            if (File.Exists(stop)) RequestStop();
            var pause = Path.Combine(Session.Dir, "PAUSE");
            if (File.Exists(pause))
            {
                var raw = File.ReadAllText(pause).Trim();
                Session.Paused = raw is "1" or "true";
            }
        }
        catch { /* ignore IO races */ }
    }

    private static void RequestStop()
    {
        if (Session.Stopping) return;
        Session.Stopping = true;
        QueueCapture(() =>
        {
            FlushText();
            WriteStatus("stopped");
        });
        if (_overlay != null && _overlay.IsHandleCreated)
            _overlay.BeginInvoke(() => _overlay.Close());
        else
            _overlay?.Close();
    }

    private static void Cleanup()
    {
        try { if (_overlay != null) Win32.RemoveClipboardFormatListener(_overlay.Handle); } catch { }
        try { if (_mouseHook != IntPtr.Zero) Win32.UnhookWindowsHookEx(_mouseHook); } catch { }
        try { if (_keyboardHook != IntPtr.Zero) Win32.UnhookWindowsHookEx(_keyboardHook); } catch { }
        try { if (_fgHook != IntPtr.Zero) Win32.UnhookWinEvent(_fgHook); } catch { }
        try { if (_focusHook != IntPtr.Zero) Win32.UnhookWinEvent(_focusHook); } catch { }
        try { _captureQueue?.CompleteAdding(); } catch { }
        try { _captureThread?.Join(2000); } catch { }
        lock (Gate)
        {
            try { _events?.Dispose(); } catch { }
            _events = null;
        }
    }

    private static void WriteStatus(string state, string? error = null)
    {
        var dto = new
        {
            state,
            error,
            startedAt = Session.StartedAt.ToString("o"),
            eventCount = Session.EventCount,
            elapsedMs = (long)(DateTime.UtcNow - Session.StartedAt).TotalMilliseconds,
        };
        var tmp = Path.Combine(Session.Dir, "status.json.tmp");
        var dest = Path.Combine(Session.Dir, "status.json");
        File.WriteAllText(tmp, JsonSerializer.Serialize(dto, JsonOpts));
        File.Copy(tmp, dest, overwrite: true);
    }

    private static string? ReadArg(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
            if (args[i] == name) return args[i + 1];
        return null;
    }

    internal static void OnClipboard()
    {
        if (!Session.ClipboardEnabled || Session.Paused || Session.Stopping) return;
        try
        {
            if (!Clipboard.ContainsText()) return;
            var text = Clipboard.GetText();
            if (string.IsNullOrWhiteSpace(text)) return;
            QueueCapture(() => EmitClipboard(text));
        }
        catch
        {
            // clipboard can be locked by another process
        }
    }

    private static void WritePrivacyOptions()
    {
        var dto = new
        {
            screenshots = Session.ScreenshotsEnabled,
            clipboard = Session.ClipboardEnabled,
            privacyMode = !Session.ScreenshotsEnabled || !Session.ClipboardEnabled,
        };
        File.WriteAllText(Path.Combine(Session.Dir, "privacy.json"), JsonSerializer.Serialize(dto, JsonOpts));
    }

    private static bool LooksSensitiveLabel(string value) =>
        System.Text.RegularExpressions.Regex.IsMatch(
            value,
            @"\b(password|passwd|passcode|secret|token|authorization|api[-_ ]?key|session.?id|cookie|csrf|otp|ssn|credit.?card|cvv|private.?key)\b",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    private static void EmitClipboard(string text)
    {
        var ctx = ReadContext(Win32.GetForegroundWindow());
        var secret = ctx.IsPassword || LooksSecret(text);
        var identifier = !secret && text.Length <= 80 && !text.Contains('\n') && !text.Contains('\r');
        Emit(new EventDto
        {
            Type = "clipboard",
            ClipboardPreview = secret ? "[REDACTED]" : identifier ? text.Trim() : "[copied]",
            Redacted = secret || !identifier,
        }, ctx);
    }

    private static bool LooksSecret(string text) =>
        text.Contains("Bearer ", StringComparison.OrdinalIgnoreCase)
        || text.Contains("BEGIN ", StringComparison.OrdinalIgnoreCase)
        || text.Contains("password", StringComparison.OrdinalIgnoreCase)
        || text.StartsWith("ghp_")
        || text.StartsWith("github_pat_")
        || text.StartsWith("sk-")
        || text.StartsWith("AKIA")
        || text.StartsWith("eyJ");

    private readonly record struct Context(IntPtr Hwnd, string ProcessName, string Title, UiElementDto? Element, bool IsPassword);

    private sealed class EventDto
    {
        public string Timestamp { get; set; } = "";
        public string Type { get; set; } = "";
        public string? Application { get; set; }
        public string? ProcessName { get; set; }
        public string? WindowTitle { get; set; }
        public UiElementDto? Element { get; set; }
        public string? Button { get; set; }
        public string? Key { get; set; }
        public string? Text { get; set; }
        public List<string>? Modifiers { get; set; }
        public string? Screenshot { get; set; }
        public string? ClipboardPreview { get; set; }
        public bool? Redacted { get; set; }
    }

    private sealed class UiElementDto
    {
        public string? Name { get; set; }
        public string? ControlType { get; set; }
        public string? AutomationId { get; set; }
        public string? ClassName { get; set; }
        public bool? IsPassword { get; set; }
    }
}
