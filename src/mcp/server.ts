import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { learn } from "../learn/controller.ts";

const RESOURCE_URI = "ui://learn-mode/app.html";
const MIME = "text/html;profile=mcp-app";
const UI_DIR = path.dirname(fileURLToPath(import.meta.url));

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
    structuredContent: typeof data === "object" && data ? (data as Record<string, unknown>) : { value: data },
  };
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "cursor-learn-mode", version: "0.1.0" });

  server.registerResource(
    "learn-ui",
    RESOURCE_URI,
    {
      description: "Learn Mode UI",
      mimeType: MIME,
    },
    async () => {
      const html = await fs.readFile(path.join(UI_DIR, "app.html"), "utf8");
      return {
        contents: [{ uri: RESOURCE_URI, mimeType: MIME, text: html }],
      };
    },
  );

  server.registerTool(
    "learn_open",
    {
      title: "Learn Workflow",
      description:
        "Open Cursor Learn Mode in chat. Use when the user says /learn, תלמד מה שאני עושה עכשיו, or wants to teach Cursor a process by demonstration.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      try {
        const opened = await learn.open();
        return jsonResult({
          ...opened,
          ui: "Learn Workflow — Teach Cursor a new process. Call learn_start when the user is ready.",
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_start",
    {
      title: "Start Learning",
      description: "Start a Learn Mode recording session and show the on-screen overlay. The user then demonstrates the workflow.",
      inputSchema: {
        name: z.string().optional().describe("Optional kebab-case skill name hint"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ name }) => {
      try {
        const started = await learn.start(name);
        return jsonResult({
          ...started,
          message: "Recording. Demonstrate the process, then Stop from the overlay or call learn_stop.",
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_status",
    {
      title: "Learn Status",
      description: "Get the current Learn Mode session status (time, event count, preview if available).",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      try {
        return jsonResult(await learn.status());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_pause",
    {
      title: "Pause Learning",
      description: "Pause or resume the current Learn Mode recording.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      try {
        return jsonResult(await learn.pause());
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_stop",
    {
      title: "Stop Learning",
      description: "Stop recording, sanitize and save the demonstration, then return a semantic workflow preview.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => {
      try {
        const stopped = await learn.stop();
        return jsonResult({
          state: "stopped",
          sessionId: stopped.session.sessionId,
          sessionFile: stopped.sessionFile,
          eventCount: stopped.session.demonstrations[0]?.events.length ?? 0,
          applications: stopped.preview.applications,
          inputs: Object.keys(stopped.preview.inputs),
          steps: stopped.preview.steps.map((step) => step.intent),
          preview: stopped.preview.previewText,
          message: "Recording complete. Review the preview, then call learn_save to write a Cursor Skill.",
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_save",
    {
      title: "Save Skill",
      description: "Save the analyzed demonstration as a standard Cursor Skill (SKILL.md + workflow.json) under ~/.cursor/skills.",
      inputSchema: {
        name: z.string().optional().describe("Skill folder name (kebab-case)"),
        title: z.string().optional().describe("Human title"),
        inputs: z.array(z.string()).optional().describe("Input keys to keep after user review"),
      },
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async ({ name, title, inputs }) => {
      try {
        const saved = await learn.save({ name, title, inputs });
        return jsonResult({
          state: "stopped",
          ...saved,
          message:
            "Skill saved. In a new chat, ask Cursor to perform the task with new inputs. Cursor Agent will use existing Windows Computer MCP / browser / terminal tools. Learn Mode does not execute the workflow.",
        });
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "learn_discard",
    {
      title: "Discard Learn Session",
      description: "Stop and discard the current Learn Mode session without saving a Skill.",
      inputSchema: {},
    },
    async () => {
      try {
        await learn.discard();
        return jsonResult({ state: "idle", message: "Learn session discarded." });
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
