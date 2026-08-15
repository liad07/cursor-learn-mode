# Cursor Learn Mode

<p align="center">
  <img src="docs/demo/learn-mode.gif" alt="Cursor Learn Mode: start learning, demonstrate a workflow, save a Skill, replay with new inputs" width="960" />
</p>
<p align="center">
  <em>Teach it once. Replay the intent — not a mouse-coordinate macro.</em>
</p>

Teach Cursor a Windows or browser process by demonstrating it. Learn Mode records the **meaning** of the steps and saves a standard Cursor Skill. The next time you ask, the Cursor Agent runs that Skill with tools you already have — Windows Computer MCP, Playwright MCP, and the terminal.

---

## How it works

1. In Cursor, say `/learn` or “teach Cursor what I’m doing now”.
2. Click **Start Learning**. An on-screen HUD shows time and event count.
3. Perform the process (desktop apps, browser, Explorer, terminal — including switching between them).
4. Click **Stop** on the overlay, or press `Ctrl+Shift+L`.
5. Review the preview (name, apps, inputs, steps) and **Save Skill**.

Later, in a new chat, ask Cursor to do the same job with different inputs. Learn Mode does **not** replay the recording. The agent reads the Skill and chooses existing tools.

Passwords, tokens, cookies, and `Authorization` headers are redacted. They are not written into the Skill.

---

## Example

The GIF above is a Notepad flow: type content → Save As → filename.

Learn Mode turns that into a Skill with inputs such as `content` and `filename`, not a list of screen coordinates. Replay is a new request with new values, for example a different file name and body text.

---

## Requirements

- Windows 10 or 11
- [Node.js 20+](https://nodejs.org/)
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0) (to build the observer)
- [Cursor](https://cursor.com/)

For replay, the Cursor Agent uses MCPs already configured in Cursor (Windows desktop, browser, terminal). This repo does not replace those engines.

---

## Install

```powershell
git clone https://github.com/liad07/cursor-learn-mode.git
cd cursor-learn-mode
npm install
npm run build-observer
```

Add a `learn-mode` server to `%USERPROFILE%\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "learn-mode": {
      "command": "npx",
      "args": ["--yes", "tsx", "C:\\Users\\<you>\\cursor-learn-mode\\src\\mcp\\server.ts"]
    }
  }
}
```

Use the real clone path. Reload MCP in Cursor (**MCP: Restart** or reload the window) and confirm `learn-mode` is connected.

Then in chat: `/learn` → Start → demonstrate → Stop → Save Skill.

---

## Usage

| You | Cursor |
|-----|--------|
| `/learn` | Opens Learn Mode in chat |
| **Start Learning** | Starts recording; HUD appears |
| Demonstrate the process | Observer records apps, UI targets, typing, and screenshots |
| **Stop** or `Ctrl+Shift+L` | Saves a sanitized session and shows a preview |
| **Save Skill** | Writes `~/.cursor/skills/<name>/SKILL.md` and `workflow.json` |
| “Do that again with these inputs” | Agent follows the Skill with existing tools |

Recordings stay in `.learn-recordings/` (gitignored). They are not the Skill.

---

## Security

- Password fields are stored as `[REDACTED]`
- Clipboard that looks like a secret (tokens, keys, Bearer headers) is not kept as plaintext
- Generated skills tell the agent to use your current logged-in session — never embedded credentials
- Do not commit `.learn-recordings/` or a machine-specific `mcp.json`

If you typed a secret during a demo, discard the session and record again without it.

---

## License

MIT © [liad07](https://github.com/liad07)
