# Cursor Learn Mode

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

<p align="center">
  <img src="docs/demo/learn-mode.gif" alt="Cursor Learn Mode demo" width="960" />
</p>
<p align="center">
  <em>Teach Cursor desktop and browser workflows by demonstration.</em>
</p>

**Learn Mode learns workflow intent. It is not a mouse macro recorder.**

Record a Windows or macOS demonstration, get a standard Cursor Skill (`SKILL.md` + `workflow.json`), then replay in a new chat with tools you already have — desktop computer-use, browser MCP, and the terminal.

Learn Mode does **not** execute workflows and does not invent a replay engine.

---

## How it works

```
Human demonstration
  → OS Observer (Windows / macOS)
  → events.jsonl + screenshots
  → semantic analysis
  → workflow + SKILL.md
  → Cursor Agent uses existing tools
```

1. Say `/learn` in Cursor.
2. Start Learning and demonstrate the process.
3. Stop (`Ctrl+Shift+L` / `Cmd+Shift+L`).
4. Review title, inputs, and steps (edit if needed).
5. Optionally **Teach Another Example** with different values.
6. Save Skill → `~/.cursor/skills/<name>/`.

Later, ask Cursor to perform the task with new inputs. The agent reads the Skill and chooses existing tools.

---

## Requirements

- Windows 10/11 or macOS
- Node.js 20+
- Cursor
- Windows: .NET 8 SDK
- macOS: Xcode Command Line Tools (`swiftc`) + Accessibility permission for Cursor

---

## Install

From a clone:

```bash
git clone https://github.com/liad07/cursor-learn-mode.git
cd cursor-learn-mode
npm install
node scripts/cli.mjs install
```

Or:

```bash
npm run install-mcp
```

The installer detects the OS, builds the observer, and **merges** a `learn-mode` entry into `~/.cursor/mcp.json` without removing other MCP servers.

Reload MCP in Cursor. On macOS, enable Cursor under **System Settings → Privacy & Security → Accessibility**.

Manual MCP entry (if you prefer): see [`mcp.json.example`](mcp.json.example).

> Publishing as `npx cursor-learn-mode install` is prepared (`bin` + `files`). The package stays `"private": true` until you intentionally publish to npm.

---

## Privacy

Passwords and secret-looking fields are redacted. Screenshots are skipped when the focused control is sensitive.

Optional environment flags (passed through to the observer):

| Variable | Default | Effect |
|----------|---------|--------|
| `LEARN_SCREENSHOTS` | `1` | Set `0` to disable screenshots entirely |
| `LEARN_CLIPBOARD` | `0` | Set `1` to capture clipboard (still redacts obvious secrets) |

Session metadata may include `recordingOptions` (`screenshots`, `clipboard`, `privacyMode`).

---

## Multi-demonstration learning

After the first Stop + preview, choose **Teach Another Example**.

Demo 1 and Demo 2 with different field values help the analyzer mark those fields as inputs and keep shared navigation as structure. All demonstration IDs are stored on the Skill.

---

## Platform metadata

Recorded sessions/workflows include `platform: "win32" | "darwin"`. Generated Skills recommend the matching desktop tools for the platform where the demo was recorded, while staying intent-based.

---

## MCP tools

`learn_open`, `learn_start`, `learn_status`, `learn_pause`, `learn_stop`, `learn_add_demonstration`, `learn_save`, `learn_list`, `learn_discard`

---

## Security

- Password / secure fields → `[REDACTED]`
- Tokens, Bearer headers, and similar clipboard secrets are not kept as plaintext
- Skills never embed credentials
- Do not commit `.learn-recordings/`

---

## License

MIT © [liad07](https://github.com/liad07)
