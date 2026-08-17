import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

final class Session {
    static var dir = ""
    static var startedAt = Date()
    static var eventCount = 0
    static var paused = false
    static var stopping = false
    static var screenshotsEnabled = true
    static var clipboardEnabled = false
}

func envFlag(_ name: String, default defaultValue: Bool) -> Bool {
    guard let raw = ProcessInfo.processInfo.environment[name]?.trimmingCharacters(in: .whitespacesAndNewlines),
          !raw.isEmpty else { return defaultValue }
    switch raw.lowercased() {
    case "0", "false", "no", "off": return false
    case "1", "true", "yes", "on": return true
    default: return defaultValue
    }
}

let sensitiveNamePattern = try! NSRegularExpression(
    pattern: "\\b(password|passwd|passcode|secret|token|authorization|api[-_ ]?key|session.?id|cookie|csrf|otp|ssn|credit.?card|cvv|private.?key)\\b",
    options: [.caseInsensitive]
)

func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    var value: AnyObject?
    AXUIElementCopyAttributeValue(element, attribute, &value)
    return value as? String
}

func isSensitiveElement(_ element: AXUIElement) -> Bool {
    let role = (axString(element, kAXRoleAttribute as CFString) ?? "").lowercased()
    let subrole = (axString(element, kAXSubroleAttribute as CFString) ?? "").lowercased()
    if role.contains("secure") || subrole.contains("secure") { return true }
    if role == (kAXTextFieldRole as String).lowercased() && subrole.contains("secure") { return true }
    let labels = [
        axString(element, kAXTitleAttribute as CFString),
        axString(element, kAXDescriptionAttribute as CFString),
        axString(element, kAXIdentifierAttribute as CFString),
        axString(element, kAXPlaceholderValueAttribute as CFString),
    ].compactMap { $0 }.joined(separator: " ")
    guard !labels.isEmpty else { return false }
    let range = NSRange(location: 0, length: (labels as NSString).length)
    return sensitiveNamePattern.firstMatch(in: labels, options: [], range: range) != nil
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var overlay: OverlayPanel?
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var poll: Timer?
    private var lastApp = ""
    private var lastTitle = ""
    private var lastShot = Date.distantPast
    private var textBuf = ""
    private var lastTextFlush = Date()
    private var events: FileHandle?
    private let gate = NSLock()

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let idx = CommandLine.arguments.firstIndex(of: "--session-dir"),
              CommandLine.arguments.indices.contains(idx + 1) else {
            fputs("Missing --session-dir\n", stderr)
            NSApp.terminate(nil)
            return
        }
        Session.dir = CommandLine.arguments[idx + 1]
        Session.startedAt = Date()
        Session.screenshotsEnabled = envFlag("LEARN_SCREENSHOTS", default: true)
        Session.clipboardEnabled = envFlag("LEARN_CLIPBOARD", default: false)
        try? FileManager.default.createDirectory(atPath: (Session.dir as NSString).appendingPathComponent("screenshots"), withIntermediateDirectories: true)
        let eventsPath = (Session.dir as NSString).appendingPathComponent("events.jsonl")
        FileManager.default.createFile(atPath: eventsPath, contents: nil)
        events = FileHandle(forWritingAtPath: eventsPath)
        writePrivacyOptions()

        overlay = OverlayPanel()
        overlay?.onStop = { [weak self] in self?.requestStop() }
        overlay?.onPause = { [weak self] in self?.togglePause() }
        overlay?.orderFrontRegardless()

        if !installTap() {
            writeStatus(state: "failed", error: "Accessibility permission required. System Settings → Privacy & Security → Accessibility → enable Cursor (and Terminal if you launch from there).")
            NSApp.terminate(nil)
            return
        }

        NSWorkspace.shared.notificationCenter.addObserver(self, selector: #selector(appChanged), name: NSWorkspace.didActivateApplicationNotification, object: nil)
        NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.onClick(event)
        }
        if Session.clipboardEnabled {
            NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
                if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers?.lowercased() == "c" {
                    self?.onClipboardCopy()
                }
            }
        }
        poll = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            self?.tick()
        }
        writeStatus(state: "recording")
        emitWindow(type: "app-change", takeShot: true)
    }

    private func installTap() -> Bool {
        let mask = (1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, refcon in
            guard let refcon else { return Unmanaged.passUnretained(event) }
            let delegate = Unmanaged<AppDelegate>.fromOpaque(refcon).takeUnretainedValue()
            if type == .keyDown { delegate.onKey(event) }
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: callback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }
        eventTap = tap
        runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        return true
    }

    @objc private func appChanged() {
        if Session.paused || Session.stopping { return }
        flushText()
        emitWindow(type: "app-change", takeShot: true)
    }

    private func onClick(_ event: NSEvent) {
        if Session.paused || Session.stopping { return }
        if overlay?.frame.contains(NSEvent.mouseLocation) == true { return }
        flushText()
        let ctx = readContext()
        var extra: [String: Any] = ["type": "click", "button": "left"]
        if let shot = captureScreenshotIfAllowed(reason: "click", context: ctx) {
            extra["screenshot"] = shot
        }
        emit(extra, ctx)
    }

    private func onKey(_ event: CGEvent) {
        if Session.stopping { return }
        let flags = event.flags
        let cmd = flags.contains(.maskCommand)
        let alt = flags.contains(.maskAlternate)
        let ctrl = flags.contains(.maskControl)
        let shift = flags.contains(.maskShift)
        let keycode = event.getIntegerValueField(.keyboardEventKeycode)
        if ctrl && shift && keycode == 37 {
            DispatchQueue.main.async { self.requestStop() }
            return
        }
        if cmd && shift && keycode == 37 {
            DispatchQueue.main.async { self.requestStop() }
            return
        }
        if Session.paused { return }
        DispatchQueue.main.async {
            let ctx = self.readContext()
            var modifiers: [String] = []
            if cmd { modifiers.append("Cmd") }
            if ctrl { modifiers.append("Ctrl") }
            if alt { modifiers.append("Alt") }
            if shift { modifiers.append("Shift") }
            let special: UInt16 = UInt16(keycode)
            if cmd || ctrl || alt || [36, 48, 51, 53, 117].contains(special) {
                self.flushText()
                let name: String
                switch special {
                case 36: name = "Enter"
                case 48: name = "Tab"
                case 51: name = "Backspace"
                case 53: name = "Escape"
                case 1 where cmd: name = "S"
                default: name = "Key"
                }
                self.emit(["type": "key", "key": name, "modifiers": modifiers], ctx)
                return
            }
            if ctx.isSensitive {
                self.emit(["type": "text", "text": "[REDACTED]", "redacted": true], ctx)
                return
            }
            if let ns = NSEvent(cgEvent: event), let chars = ns.charactersIgnoringModifiers, chars.contains(where: { $0.isLetter || $0.isNumber || $0.isPunctuation || $0.isWhitespace }) {
                if let printable = ns.characters { self.textBuf += printable }
                self.lastTextFlush = Date()
            }
        }
    }

    private func onClipboardCopy() {
        if Session.paused || Session.stopping || !Session.clipboardEnabled { return }
        let ctx = readContext()
        let pasteboard = NSPasteboard.general
        let text = pasteboard.string(forType: .string) ?? ""
        if text.isEmpty { return }
        let secret = ctx.isSensitive || looksSecret(text)
        emit([
            "type": "clipboard",
            "clipboardPreview": secret ? "[REDACTED]" : (text.count <= 80 && !text.contains("\n") ? text.trimmingCharacters(in: .whitespacesAndNewlines) : "[copied]"),
            "redacted": secret,
        ], ctx)
    }

    private func looksSecret(_ text: String) -> Bool {
        let lower = text.lowercased()
        return lower.contains("bearer ")
            || lower.contains("begin ")
            || lower.contains("password")
            || text.hasPrefix("ghp_")
            || text.hasPrefix("github_pat_")
            || text.hasPrefix("sk-")
            || text.hasPrefix("AKIA")
            || text.hasPrefix("eyJ")
    }

    private func tick() {
        if Session.stopping { return }
        pollControlFiles()
        if !textBuf.isEmpty, Date().timeIntervalSince(lastTextFlush) > 0.45 { flushText() }
        overlay?.refresh()
        writeStatus(state: Session.paused ? "paused" : "recording")
    }

    private func pollControlFiles() {
        if FileManager.default.fileExists(atPath: (Session.dir as NSString).appendingPathComponent("STOP")) {
            requestStop()
        }
        let pausePath = (Session.dir as NSString).appendingPathComponent("PAUSE")
        if let raw = try? String(contentsOfFile: pausePath, encoding: .utf8) {
            Session.paused = raw.trimmingCharacters(in: .whitespacesAndNewlines) == "1"
        }
    }

    private func togglePause() {
        Session.paused.toggle()
        if Session.paused { flushText() }
        writeStatus(state: Session.paused ? "paused" : "recording")
    }

    private func requestStop() {
        if Session.stopping { return }
        Session.stopping = true
        flushText()
        writeStatus(state: "stopped")
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false) }
        events?.closeFile()
        NSApp.terminate(nil)
    }

    private func flushText() {
        let text = textBuf
        textBuf = ""
        if text.isEmpty { return }
        let ctx = readContext()
        let value = ctx.isSensitive ? "[REDACTED]" : text
        emit(["type": "text", "text": value, "redacted": ctx.isSensitive], ctx)
    }

    private func emitWindow(type: String, takeShot: Bool) {
        let ctx = readContext()
        if ctx.processName.isEmpty && ctx.title.isEmpty { return }
        let appChanged = ctx.processName.caseInsensitiveCompare(lastApp) != .orderedSame
        let titleChanged = ctx.title != lastTitle
        if !appChanged && !titleChanged && type != "focus" { return }
        lastApp = ctx.processName
        lastTitle = ctx.title
        let eventType = appChanged ? "app-change" : type
        var extra: [String: Any] = ["type": eventType]
        if takeShot, let shot = captureScreenshotIfAllowed(reason: eventType, context: ctx) {
            extra["screenshot"] = shot
        }
        emit(extra, ctx)
    }

    private func emit(_ extra: [String: Any], _ ctx: Context) {
        var body: [String: Any] = [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "application": friendlyApp(ctx.processName),
            "processName": ctx.processName,
            "windowTitle": ctx.title,
        ]
        if let el = ctx.element { body["element"] = el }
        extra.forEach { body[$0.key] = $0.value }
        guard let data = try? JSONSerialization.data(withJSONObject: body), let line = String(data: data, encoding: .utf8) else { return }
        gate.lock()
        events?.write(contentsOf: Data((line + "\n").utf8))
        Session.eventCount += 1
        gate.unlock()
    }

    private func readContext() -> Context {
        let app = NSWorkspace.shared.frontmostApplication
        let processName = app?.localizedName ?? app?.bundleIdentifier ?? ""
        let title = frontWindowTitle() ?? ""
        let focused = focusedElement()
        return Context(processName: processName, title: title, element: focused.dict, isSensitive: focused.isSensitive)
    }

    private func frontWindowTitle() -> String? {
        let system = AXUIElementCreateSystemWide()
        var focusedApp: AnyObject?
        AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute as CFString, &focusedApp)
        guard let app = focusedApp else { return NSWorkspace.shared.frontmostApplication?.localizedName }
        var window: AnyObject?
        AXUIElementCopyAttributeValue(app as! AXUIElement, kAXFocusedWindowAttribute as CFString, &window)
        guard let win = window else { return nil }
        var title: AnyObject?
        AXUIElementCopyAttributeValue(win as! AXUIElement, kAXTitleAttribute as CFString, &title)
        return title as? String
    }

    private func focusedElement() -> (dict: [String: Any]?, isSensitive: Bool) {
        let system = AXUIElementCreateSystemWide()
        var focused: AnyObject?
        AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focused)
        guard let el = focused else { return (nil, false) }
        let element = el as! AXUIElement
        let roleName = axString(element, kAXRoleAttribute as CFString) ?? ""
        let subrole = axString(element, kAXSubroleAttribute as CFString) ?? ""
        var name = axString(element, kAXTitleAttribute as CFString)
        if name == nil || name?.isEmpty == true {
            name = axString(element, kAXDescriptionAttribute as CFString)
        }
        if name == nil || name?.isEmpty == true {
            name = axString(element, kAXPlaceholderValueAttribute as CFString)
        }
        let sensitive = isSensitiveElement(element)
        return ([
            "name": name ?? "",
            "controlType": roleName,
            "automationId": axString(element, kAXIdentifierAttribute as CFString) ?? "",
            "className": subrole,
            "isPassword": sensitive,
        ], sensitive)
    }

    private func captureScreenshotIfAllowed(reason: String, context: Context) -> String? {
        if Session.paused || Session.stopping { return nil }
        if !Session.screenshotsEnabled { return nil }
        if context.isSensitive { return nil }
        if Date().timeIntervalSince(lastShot) < 0.4 { return nil }
        return captureWindowOrDisplay(reason: reason)
    }

    private func captureWindowOrDisplay(reason: String) -> String? {
        guard let image = captureFrontWindowImage() else { return nil }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.45]) else { return nil }
        let name = String(format: "%.0f-%@.jpg", Date().timeIntervalSince1970 * 1000, reason)
        let rel = "screenshots/\(name)"
        let path = (Session.dir as NSString).appendingPathComponent(rel)
        try? data.write(to: URL(fileURLWithPath: path))
        lastShot = Date()
        return rel
    }

    private func captureFrontWindowImage() -> CGImage? {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        let pid = app.processIdentifier
        guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return nil
        }
        for info in windowList {
            guard let owner = info[kCGWindowOwnerPID as String] as? pid_t, owner == pid else { continue }
            guard let layer = info[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
            guard let windowId = info[kCGWindowNumber as String] as? CGWindowID else { continue }
            if let image = CGWindowListCreateImage(.null, .optionIncludingWindow, windowId, [.boundsIgnoreFraming, .bestResolution]) {
                return image
            }
        }
        return nil
    }

    private func friendlyApp(_ processName: String) -> String {
        let lower = processName.lowercased()
        if lower.contains("textedit") { return "TextEdit" }
        if lower.contains("safari") { return "Safari" }
        if lower.contains("chrome") { return "Chrome" }
        if lower.contains("finder") { return "Finder" }
        if lower.contains("terminal") { return "Terminal" }
        if lower.contains("notepad") { return "Notepad" }
        return processName.isEmpty ? "Unknown" : processName
    }

    private func writePrivacyOptions() {
        let body: [String: Any] = [
            "screenshots": Session.screenshotsEnabled,
            "clipboard": Session.clipboardEnabled,
            "privacyMode": !Session.screenshotsEnabled || !Session.clipboardEnabled,
        ]
        let dest = (Session.dir as NSString).appendingPathComponent("privacy.json")
        if let data = try? JSONSerialization.data(withJSONObject: body) {
            try? data.write(to: URL(fileURLWithPath: dest))
        }
    }

    private func writeStatus(state: String, error: String? = nil) {
        var body: [String: Any] = [
            "state": state,
            "startedAt": ISO8601DateFormatter().string(from: Session.startedAt),
            "eventCount": Session.eventCount,
            "elapsedMs": Int(Date().timeIntervalSince(Session.startedAt) * 1000),
        ]
        if let error { body["error"] = error }
        let dest = (Session.dir as NSString).appendingPathComponent("status.json")
        if let data = try? JSONSerialization.data(withJSONObject: body) {
            try? data.write(to: URL(fileURLWithPath: dest))
        }
    }
}

struct Context {
    var processName: String
    var title: String
    var element: [String: Any]?
    var isSensitive: Bool
}

final class OverlayPanel: NSPanel {
    var onStop: (() -> Void)?
    var onPause: (() -> Void)?
    private let titleLabel = NSTextField(labelWithString: "Learning")
    private let timeLabel = NSTextField(labelWithString: "Time: 00:00")
    private let eventsLabel = NSTextField(labelWithString: "Events: 0")
    private let pauseButton = NSButton(title: "Pause", target: nil, action: nil)
    private let stopButton = NSButton(title: "Stop", target: nil, action: nil)

    init() {
        super.init(
            contentRect: NSRect(x: 40, y: 40, width: 340, height: 196),
            styleMask: [.nonactivatingPanel, .titled, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .floating
        title = "Learn Mode"
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 720)
        setFrameOrigin(NSPoint(x: screen.maxX - 364, y: screen.minY + 24))

        let stack = NSStackView(views: [titleLabel, timeLabel, eventsLabel, pauseButton, stopButton])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView!.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: contentView!.trailingAnchor, constant: -16),
            stack.topAnchor.constraint(equalTo: contentView!.topAnchor, constant: 16),
        ])
        pauseButton.target = self
        pauseButton.action = #selector(pauseTapped)
        stopButton.target = self
        stopButton.action = #selector(stopTapped)
        stopButton.bezelColor = .systemRed
        titleLabel.font = .boldSystemFont(ofSize: 16)
    }

    @objc private func pauseTapped() { onPause?() }
    @objc private func stopTapped() { onStop?() }

    func refresh() {
        let elapsed = Int(Date().timeIntervalSince(Session.startedAt))
        titleLabel.stringValue = Session.paused ? "Paused" : "Learning"
        timeLabel.stringValue = String(format: "Time: %02d:%02d", elapsed / 60, elapsed % 60)
        eventsLabel.stringValue = "Events: \(Session.eventCount)"
        pauseButton.title = Session.paused ? "Resume" : "Pause"
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
