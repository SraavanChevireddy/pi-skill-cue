import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Skill,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { SkillInput } from "../src/catalog.js";
import { loadConfig } from "../src/config.js";
import { CueRuntime } from "../src/runtime.js";
import type { CueConfig } from "../src/types.js";

/**
 * Pi's Skill carries the SKILL.md location as `filePath`, and marks skills the model is not meant
 * to invoke on its own. Routing one of those would be arguing with the user's own configuration.
 */
function toSkillInputs(skills: readonly Skill[]): SkillInput[] {
  return skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => ({ name: skill.name, path: skill.filePath, description: skill.description }));
}

function cwdExtensions(cwd: string): string[] {
  try {
    const found = new Set<string>();
    for (const entry of readdirSync(cwd, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = entry.name.split(".").pop();
      if (ext && ext !== entry.name) found.add(ext.toLowerCase());
    }
    return [...found];
  } catch {
    return [];
  }
}

/** Read/edit/write are the only tool calls that carry a path, and the only ones a gate can guard. */
function toolPath(event: ToolCallEvent): string | undefined {
  if (isToolCallEventType("read", event)) return event.input.path;
  if (isToolCallEventType("edit", event)) return event.input.path;
  if (isToolCallEventType("write", event)) return event.input.path;
  return undefined;
}

interface Session {
  runtime: CueRuntime;
  config: CueConfig;
}

/**
 * Sessions are cheap and this map is process-lifetime, so it is not pruned on session_shutdown:
 * an abandoned entry is a few closed-over objects, not an open resource.
 */
const sessions = new Map<string, Session>();

function sessionFor(ctx: ExtensionContext): Session {
  const sessionId = ctx.sessionManager.getSessionId();
  let session = sessions.get(sessionId);
  if (!session) {
    const home = homedir();
    const config = loadConfig(
      join(home, ".pi", "agent", "skill-cue.json"),
      join(ctx.cwd, ".pi", "skill-cue.json"),
    );
    const runtime = new CueRuntime({
      config,
      ledgerDir: join(home, ".pi", "agent", "skill-cue"),
      sessionId,
    });
    session = { runtime, config };
    sessions.set(sessionId, session);
  }
  return session;
}

export default function activate(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    try {
      const session = sessionFor(ctx);
      const skills = toSkillInputs(event.systemPromptOptions.skills ?? []);
      const result = session.runtime.onPrompt(event.prompt, skills, cwdExtensions(ctx.cwd));
      if (!result) return undefined;

      if (session.config.verbose) {
        return {
          systemPrompt: `${event.systemPrompt}\n\n${result.directive}`,
          message: { customType: "skill-cue", content: result.directive, display: true },
        };
      }
      return { systemPrompt: `${event.systemPrompt}\n\n${result.directive}` };
    } catch {
      return undefined;
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    try {
      const session = sessionFor(ctx);
      const decision = session.runtime.onToolCall(event.toolName, { path: toolPath(event) });
      return decision ? { block: true as const, reason: decision.reason } : undefined;
    } catch {
      return undefined;
    }
  });

  pi.registerCommand("cue", {
    description: "pi-skill-cue status, or on/off for this session",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const session = sessionFor(ctx);
      const arg = args.trim().toLowerCase();
      if (arg === "off" || arg === "on") {
        session.runtime.setEnabled(arg === "on");
        ctx.ui.notify(`pi-skill-cue ${arg}`, "info");
        return;
      }
      ctx.ui.notify(
        `pi-skill-cue ${session.runtime.isEnabled() ? "on" : "off"} — last match: ${session.runtime.lastMatchSummary()}`,
        "info",
      );
    },
  });

  pi.registerCommand("cue-report", {
    description: "Show which skills actually fire; --purge clears the local ledger",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const session = sessionFor(ctx);
      if (args.trim() === "--purge") {
        session.runtime.purge();
        ctx.ui.notify("pi-skill-cue ledger purged", "info");
        return;
      }
      ctx.ui.notify(session.runtime.report(), "info");
    },
  });

  pi.registerCommand("skill-doctor", {
    description: "Lint installed skills for routability problems",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(sessionFor(ctx).runtime.doctor(), "info");
    },
  });
}
