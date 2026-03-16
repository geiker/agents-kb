/**
 * Wrapped re-export of the Claude Agent SDK query function.
 *
 * In packaged Electron apps the SDK resolves its cli.js from the asar archive,
 * but the executable lives in app.asar.unpacked. This wrapper transparently
 * injects `pathToClaudeCodeExecutable` so every call site is covered.
 *
 * All main-process code must import `query` from this module (or "./sdk")
 * rather than directly from "@anthropic-ai/claude-agent-sdk".
 * Type-only imports from the SDK are fine.
 */
import fs from "fs";
import path from "path";
import { app } from "electron";
import { query as rawQuery } from "@anthropic-ai/claude-agent-sdk";

let cachedPackagedCliPath: string | undefined;

function getPackagedCliPath(): string | undefined {
  if (!app.isPackaged) return undefined;
  if (cachedPackagedCliPath === undefined) {
    const sdkEntryPath = require.resolve("@anthropic-ai/claude-agent-sdk");
    const sdkDir = path.dirname(sdkEntryPath);
    const unpackedSdkDir = sdkDir.replace("app.asar", "app.asar.unpacked");
    const cliPath = path.join(unpackedSdkDir, "cli.js");

    if (!fs.existsSync(cliPath)) {
      throw new Error(
        `[claude-sdk] Packaged Claude CLI not found at "${cliPath}". ` +
          `Ensure electron-builder unpacks node_modules/@anthropic-ai/claude-agent-sdk/**.`,
      );
    }

    cachedPackagedCliPath = cliPath;
  }
  return cachedPackagedCliPath;
}

type QueryArgs = Parameters<typeof rawQuery>[0];
type QueryOptions = NonNullable<QueryArgs["options"]>;

function withPackagedCliPath<T extends Record<string, unknown>>(options: T): T {
  const cliPath = getPackagedCliPath();
  if (!cliPath || options.pathToClaudeCodeExecutable) {
    return options;
  }
  return { ...options, pathToClaudeCodeExecutable: cliPath };
}

export function withProjectScopedClaudeCodeOptions<T extends Record<string, unknown>>(options: T): T {
  return withPackagedCliPath({
    ...options,
    systemPrompt: options.systemPrompt ?? { type: "preset", preset: "claude_code" },
  });
}

export function query(args: QueryArgs): ReturnType<typeof rawQuery> {
  const opts = withPackagedCliPath({ ...((args.options ?? {}) as QueryOptions) });
  args = { ...args, options: opts };
  return rawQuery(args);
}

/**
 * Fetch the list of supported models from the SDK without starting a real session.
 * Spawns a lightweight query, grabs initializationResult (or supportedModels),
 * and immediately closes it.
 */
export async function fetchSupportedModels(): Promise<
  {
    value: string;
    displayName: string;
    description: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: string[];
    supportsAdaptiveThinking?: boolean;
  }[]
> {
  const q = query({ prompt: "", options: { maxTurns: 0 } });
  try {
    const initResult = await q.initializationResult();
    if (initResult?.models?.length) {
      return initResult.models;
    }
    // Fallback to dedicated method
    const models = await q.supportedModels();
    return models ?? [];
  } finally {
    q.close();
  }
}
