import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionResult, CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { OutputEntry, PendingQuestion, QuestionOption, PermissionMode, Skill } from "../shared/types";

export type SessionPhase = "plan" | "dev";

export interface ClaudeSessionOptions {
  jobId: string;
  projectPath: string;
  prompt: string;
  phase: SessionPhase;
  sessionId?: string; // for resuming
  images?: string[];
  model?: string;
  effort?: string;
  permissionMode?: PermissionMode;
  allowedTools?: string[]; // tools explicitly granted by the user (e.g. after permission approval)
}

/** Tracks accumulated content from partial assistant messages for delta computation */
interface ContentBlockSnapshot {
  type: string;
  textLength: number;
  name?: string;
}

/** Pending tool block waiting for finalization */
interface PendingToolBlock {
  name: string;
  id?: string;
  input: Record<string, unknown>;
  emittedStart: boolean;
}

/** Context for a pending canUseTool callback waiting for user input */
interface PendingInputContext {
  type: "question" | "permission";
  toolInput: Record<string, unknown>;
  toolName?: string;
}

/** Options passed to the canUseTool callback by the SDK */
type CanUseToolOptions = Parameters<CanUseTool>[2];

export class ClaudeSession extends EventEmitter {
  readonly jobId: string;
  sessionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private queryInstance: any = null;
  private abortController: AbortController;
  private killed = false;
  private planEmitted = false;
  private assistantTextBuffer = "";
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _currentMsgOutputTokens = 0;

  // canUseTool resolution
  private pendingInputResolve: ((result: PermissionResult) => void) | null = null;
  private pendingInputContext: PendingInputContext | null = null;

  // Tools granted by user during this session (permission responses)
  private grantedTools = new Set<string>();

  // Delta computation state for partial messages
  private prevContentSnapshot: ContentBlockSnapshot[] = [];
  private pendingToolBlocks = new Map<number, PendingToolBlock>();

  // File checkpointing: track user message UUIDs for rewindFiles()
  private userMessageUuids: string[] = [];

  /** Tools handled internally — never treated as permission denials */
  private static readonly INTERNAL_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);
  private static readonly SKIP_ALL_PLAN_TOOLS = new Set(["WebFetch", "WebSearch", "Bash"]);

  /** All standard Claude tools (used to auto-allow in bypass mode via canUseTool) */
  private static readonly ALL_STANDARD_TOOLS = new Set([
    "Read",
    "Write",
    "Edit",
    "Bash",
    "Glob",
    "Grep",
    "Agent",
    "TodoWrite",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "ExitPlanMode",
  ]);

  constructor(private options: ClaudeSessionOptions) {
    super();
    this.jobId = options.jobId;
    this.sessionId = options.sessionId || uuidv4();
    this.abortController = new AbortController();

    // Pre-grant any explicitly allowed tools
    if (options.allowedTools?.length) {
      for (const tool of options.allowedTools) {
        this.grantedTools.add(tool);
      }
    }
  }

  start(): void {
    let prompt = this.options.prompt;
    if (this.options.images && this.options.images.length > 0) {
      const imageList = this.options.images.map((p) => `- ${p}`).join("\n");
      prompt += `\n\nThe following image files are attached for reference. Please read and examine them:\n${imageList}`;
    }

    const permissionMode: PermissionMode = this.options.permissionMode ?? "bypassPermissions";
    const sdkPermissionMode = this.options.phase === "plan" ? "plan" : "default";

    // Build allowed tools list for auto-approval (SDK won't call canUseTool for these)
    // Never include AskUserQuestion — we always handle it via canUseTool
    const allowedTools: string[] = [];
    if (this.options.phase === "plan") {
      if (permissionMode === "bypassPermissions") {
        for (const tool of ClaudeSession.SKIP_ALL_PLAN_TOOLS) {
          allowedTools.push(tool);
        }
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkOptions: Record<string, any> = {
      cwd: this.options.projectPath,
      permissionMode: sdkPermissionMode,
      includePartialMessages: true,
      abortController: this.abortController,
      canUseTool: this.handleCanUseTool.bind(this),
      settingSources: ["user", "project"],
      // Enable file checkpointing in dev phase for rewindFiles() support
      enableFileCheckpointing: this.options.phase === "dev",
    };

    if (allowedTools.length > 0) {
      sdkOptions.allowedTools = allowedTools;
    }

    if (this.options.effort) {
      sdkOptions.effort = this.options.effort;
    }

    if (this.options.model) {
      sdkOptions.model = this.options.model;
    }

    if (this.options.sessionId) {
      sdkOptions.resume = this.options.sessionId;
    }

    // Strip CLAUDECODE env var to avoid "nested session" error
    const env = { ...process.env };
    delete env.CLAUDECODE;
    sdkOptions.env = env;

    const effectiveMode = this.options.phase === "plan" ? "plan (read-only)" : permissionMode;
    console.log("[claude-session] SDK launch config:", {
      phase: this.options.phase,
      resume: Boolean(this.options.sessionId),
      permissionMode: effectiveMode,
      sdkPermissionMode,
      allowedTools: allowedTools.length > 0 ? allowedTools : "(all via canUseTool)",
    });
    console.log("[claude-session] CWD:", this.options.projectPath);

    this.queryInstance = query({ prompt, options: sdkOptions });
    void this.iterateMessages();
    void this.fetchInitData();
  }

  /**
   * Fetch the full initialization result from the SDK.
   * Replaces separate supportedModels() call — gets models, commands, agents,
   * and account info in one shot.
   */
  private async fetchInitData(): Promise<void> {
    try {
      if (!this.queryInstance) return;
      const initResult = await this.queryInstance.initializationResult();
      if (!initResult) return;

      // Models
      if (initResult.models?.length) {
        this.emit("supported-models", initResult.models);
      }

      // Commands (slash commands / skills)
      if (initResult.commands?.length) {
        const skills: Skill[] = initResult.commands.map(
          (cmd: { name: string; description?: string; argumentHint?: string }) => ({
            name: cmd.name,
            description: cmd.description || "",
            source: "global" as const,
            filePath: "",
          }),
        );
        this.emit("skills", skills);
      }

      // Account info (supplements the CLI-based startup fetch)
      if (initResult.account) {
        this.emit("account-info", initResult.account);
      }
    } catch (err) {
      console.log("[claude-session] Failed to fetch init data, falling back to supportedModels:", err);
      // Fallback: try the individual method for models
      try {
        if (!this.queryInstance) return;
        const models = await this.queryInstance.supportedModels();
        if (models?.length) {
          this.emit("supported-models", models);
        }
      } catch {
        // Silently ignore — models will use the static catalog
      }
    }
  }

  // ---------------------------------------------------------------------------
  // canUseTool callback — handles AskUserQuestion, permissions, and auto-allow
  // ---------------------------------------------------------------------------

  private async handleCanUseTool(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> {
    // AskUserQuestion — always prompt user interactively
    if (toolName === "AskUserQuestion") {
      return this.handleAskUserQuestion(input, options);
    }

    // ExitPlanMode — in plan phase, stop the session to wait for user approval
    if (toolName === "ExitPlanMode") {
      if (this.options.phase === "plan") {
        // Plan phase complete. Deny ExitPlanMode to prevent the SDK from
        // transitioning to development mode. Then kill the session and emit
        // close(0) so the ipc-handlers flow marks the plan as ready.
        process.nextTick(() => {
          this.emit("plan-complete");
          this.killed = true;
          this.abortController.abort();
          if (this.queryInstance) {
            try {
              this.queryInstance.close();
            } catch {
              /* already closed */
            }
            this.queryInstance = null;
          }
          this.emit("close", 0);
        });
        return { behavior: "deny", message: "Plan complete." };
      }
      return { behavior: "allow", updatedInput: input };
    }

    // Tools granted by user during this session
    if (this.grantedTools.has(toolName)) {
      return { behavior: "allow", updatedInput: input };
    }

    // Bypass mode (dev phase): auto-allow all standard tools
    const permissionMode = this.options.permissionMode ?? "bypassPermissions";
    if (this.options.phase !== "plan" && permissionMode === "bypassPermissions") {
      return { behavior: "allow", updatedInput: input };
    }

    // Plan phase with bypass: auto-allow SKIP_ALL_PLAN_TOOLS
    if (this.options.phase === "plan" && permissionMode === "bypassPermissions") {
      if (ClaudeSession.SKIP_ALL_PLAN_TOOLS.has(toolName)) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Default mode: prompt user for permission
    return this.promptUserForPermission(toolName, input, options);
  }

  private handleAskUserQuestion(input: Record<string, unknown>, options: CanUseToolOptions): Promise<PermissionResult> {
    // Parse and emit the question to the UI
    this.emitQuestion(input);

    // Block until user responds (resolved by sendResponse) or abort signal fires
    return new Promise((resolve) => {
      this.pendingInputResolve = resolve;
      this.pendingInputContext = { type: "question", toolInput: input };

      // If the operation is aborted while waiting, resolve with deny
      if (options.signal.aborted) {
        this.pendingInputResolve = null;
        this.pendingInputContext = null;
        resolve({ behavior: "deny", message: "Operation aborted" });
        return;
      }
      const onAbort = (): void => {
        if (this.pendingInputResolve === resolve) {
          this.pendingInputResolve = null;
          this.pendingInputContext = null;
          resolve({ behavior: "deny", message: "Operation aborted" });
        }
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private promptUserForPermission(
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> {
    const reasonText = options.decisionReason ? `\n\nReason: ${options.decisionReason}` : "";
    const question: PendingQuestion = {
      questionId: `perm-${Date.now()}`,
      text: `Claude needs permission to use: ${toolName}${reasonText}`,
      header: "Permission Required",
      options: [
        { label: "Allow", description: `Grant ${toolName} for this session` },
        { label: "Deny", description: "Deny this operation" },
      ],
      isPermissionRequest: true,
      deniedTools: [toolName],
      timestamp: new Date().toISOString(),
    };

    this.emit("needs-input", question);

    // Block until user responds (resolved by sendResponse) or abort signal fires
    return new Promise((resolve) => {
      this.pendingInputResolve = resolve;
      this.pendingInputContext = { type: "permission", toolInput: input, toolName };

      if (options.signal.aborted) {
        this.pendingInputResolve = null;
        this.pendingInputContext = null;
        resolve({ behavior: "deny", message: "Operation aborted" });
        return;
      }
      const onAbort = (): void => {
        if (this.pendingInputResolve === resolve) {
          this.pendingInputResolve = null;
          this.pendingInputContext = null;
          resolve({ behavior: "deny", message: "Operation aborted" });
        }
      };
      options.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Public API (used by ipc-handlers)
  // ---------------------------------------------------------------------------

  /**
   * Respond to a pending AskUserQuestion or permission prompt.
   * Resolves the canUseTool promise so the SDK continues.
   */
  sendResponse(text: string): void {
    if (!this.pendingInputResolve || !this.pendingInputContext) {
      console.log("[claude-session] sendResponse called but no pending input");
      return;
    }

    const resolve = this.pendingInputResolve;
    const context = this.pendingInputContext;
    this.pendingInputResolve = null;
    this.pendingInputContext = null;

    if (context.type === "question") {
      // Build answers for AskUserQuestion
      const questions = (context.toolInput.questions as Array<Record<string, unknown>>) || [];
      const answers: Record<string, string> = {};
      if (questions.length > 0) {
        // Map first question to the user's response text
        const questionText = (questions[0].question as string) || "";
        answers[questionText] = text;
      }
      resolve({
        behavior: "allow" as const,
        updatedInput: { questions, answers },
      });
    } else if (context.type === "permission") {
      const isAllowed = text.toLowerCase().includes("allow");
      if (isAllowed && context.toolName) {
        // Grant this tool for the rest of the session
        this.grantedTools.add(context.toolName);
        resolve({ behavior: "allow" as const, updatedInput: context.toolInput });
      } else {
        resolve({ behavior: "deny" as const, message: "Permission denied by user" });
      }
    }
  }

  /**
   * Interrupt the current session. The session is killed — caller should
   * resume with a new session if needed (e.g. for steering).
   */
  interrupt(): void {
    this.kill();
  }

  kill(): void {
    this.killed = true;

    // Resolve any pending canUseTool promise to unblock the SDK
    if (this.pendingInputResolve) {
      this.pendingInputResolve({ behavior: "deny", message: "Session killed" });
      this.pendingInputResolve = null;
      this.pendingInputContext = null;
    }

    // Use SDK's interrupt() for cleaner shutdown, fall back to manual abort
    if (this.queryInstance) {
      this.queryInstance.interrupt().catch(() => {
        /* already closed */
      });
      this.queryInstance = null;
    } else {
      this.abortController.abort();
    }
  }

  /** Get tracked user message UUIDs (for rewindFiles) */
  get userMessages(): string[] {
    return [...this.userMessageUuids];
  }

  /**
   * Rewind files to their state at the given user message UUID.
   * Requires enableFileCheckpointing and an active query instance.
   */
  async rewindFiles(
    userMessageId: string,
    options?: { dryRun?: boolean },
  ): Promise<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }> {
    if (!this.queryInstance) {
      return { canRewind: false, error: "No active session" };
    }
    if (this.options.phase !== "dev") {
      return { canRewind: false, error: "File checkpointing is only available in dev phase" };
    }
    try {
      return await this.queryInstance.rewindFiles(userMessageId, options);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { canRewind: false, error: msg };
    }
  }

  get tokenUsage(): { inputTokens: number; outputTokens: number } {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens + this._currentMsgOutputTokens,
    };
  }

  get isRunning(): boolean {
    return this.queryInstance !== null && !this.killed;
  }

  // ---------------------------------------------------------------------------
  // Message iteration loop (replaces PTY onData + handleStdout + handleMessage)
  // ---------------------------------------------------------------------------

  private async iterateMessages(): Promise<void> {
    try {
      for await (const msg of this.queryInstance!) {
        if (this.killed) break;

        this.emit("raw-message", {
          timestamp: new Date().toISOString(),
          json: msg as Record<string, unknown>,
        });
        this.handleSDKMessage(msg);
      }

      if (!this.killed) {
        this.emit("close", 0);
      }
    } catch (err: unknown) {
      if (this.killed) return;
      const errorMsg = err instanceof Error ? err.message : String(err);
      // Ignore abort errors (expected when session is killed/interrupted)
      if (errorMsg.includes("abort") || errorMsg.includes("AbortError")) {
        this.emit("close", 0);
        return;
      }
      this.emit("error", errorMsg);
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "error",
        content: errorMsg,
      } satisfies OutputEntry);
      this.emit("close", 1);
    }
  }

  // ---------------------------------------------------------------------------
  // SDK message handling
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSDKMessage(msg: any): void {
    const type = msg.type as string;

    switch (type) {
      case "system":
        this.handleSystemMessage(msg);
        break;
      case "assistant":
        this.handleAssistantMessage(msg);
        break;
      case "user":
        this.handleUserMessage(msg);
        break;
      case "result":
        this.handleResultMessage(msg);
        break;
      case "rate_limit_event":
        this.handleRateLimitEvent(msg);
        break;
      case "tool_progress":
        this.handleToolProgress(msg);
        break;
      case "tool_use_summary":
        this.handleToolUseSummary(msg);
        break;
      case "prompt_suggestion":
        this.handlePromptSuggestion(msg);
        break;
      case "auth_status":
        this.handleAuthStatus(msg);
        break;
      default:
        // console.log(`[claude-session] Unhandled message type: ${type}`, JSON.stringify(msg).slice(0, 200));
        break;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleSystemMessage(msg: any): void {
    if (msg.subtype === "init" && msg.session_id) {
      this.sessionId = msg.session_id as string;
      this.emit("session-id", this.sessionId);

      // Extract skills from the SDK init message
      const sdkSkills = this.parseInitSkills(msg);
      if (sdkSkills.length > 0) {
        this.emit("skills", sdkSkills);
      }
    }

    const content = this.formatSystemMessage(msg);
    if (content) {
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "system",
        content,
      } satisfies OutputEntry);
    }
  }

  /**
   * Parse skills from the SDK system init message.
   * The init message may include a `skills` array with name/description/source info.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseInitSkills(msg: any): Skill[] {
    const raw = msg.skills;
    if (!Array.isArray(raw)) return [];

    const skills: Skill[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const name = (entry.name as string) || "";
      if (!name) continue;

      // Determine source: SDK may use 'user'/'global' for global and 'project' for project-level
      let source: Skill["source"] = "global";
      const rawSource = (entry.source as string) || "";
      if (rawSource === "project" || rawSource === "local") {
        source = "project";
      }

      skills.push({
        name,
        description: (entry.description as string) || "",
        source,
        filePath: (entry.file_path as string) || (entry.filePath as string) || "",
      });
    }
    return skills;
  }

  /**
   * Handle partial and complete assistant messages.
   * With includePartialMessages, each yield is a snapshot of accumulated content.
   * We compute deltas for text/thinking and handle tool_use blocks.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAssistantMessage(msg: any): void {
    const message = msg.message;
    if (!message) return;

    const content = message.content;
    if (!Array.isArray(content)) return;

    // Track token usage
    const usage = message.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    if (usage) {
      const inputTotal =
        (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      if (inputTotal > this._inputTokens) {
        this._inputTokens = inputTotal;
      }
      if (usage.output_tokens && usage.output_tokens > this._currentMsgOutputTokens) {
        this._currentMsgOutputTokens = usage.output_tokens;
      }
    }

    // When new blocks appear, finalize previous tool blocks
    if (content.length > this.prevContentSnapshot.length) {
      for (let j = 0; j < this.prevContentSnapshot.length; j++) {
        if (this.prevContentSnapshot[j]?.type === "tool_use") {
          this.finalizeToolBlock(j);
        }
      }
    }

    const now = new Date().toISOString();

    for (let i = 0; i < content.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const block = content[i] as any;
      const prev = this.prevContentSnapshot[i];

      if (block.type === "text") {
        const prevLen = prev?.type === "text" ? prev.textLength : 0;
        const text = (block.text as string) || "";
        if (text.length > prevLen) {
          const delta = text.substring(prevLen);
          this.assistantTextBuffer += delta;
          this.emit("output", {
            timestamp: now,
            type: "text",
            content: delta,
          } satisfies OutputEntry);
        }
        this.prevContentSnapshot[i] = { type: "text", textLength: text.length };
      } else if (block.type === "thinking") {
        const prevLen = prev?.type === "thinking" ? prev.textLength : 0;
        const thinking = (block.thinking as string) || "";
        if (thinking.length > prevLen) {
          const delta = thinking.substring(prevLen);
          this.emit("output", {
            timestamp: now,
            type: "thinking",
            content: delta,
          } satisfies OutputEntry);
        }
        this.prevContentSnapshot[i] = { type: "thinking", textLength: thinking.length };
      } else if (block.type === "tool_use") {
        if (!prev || prev.type !== "tool_use") {
          // New tool block
          const name = block.name as string;
          if (!ClaudeSession.INTERNAL_TOOLS.has(name)) {
            this.emit("output", {
              timestamp: now,
              type: "tool-use",
              content: "",
              toolName: name,
            } satisfies OutputEntry);
          }
          this.pendingToolBlocks.set(i, {
            name,
            id: block.id as string | undefined,
            input: (block.input as Record<string, unknown>) || {},
            emittedStart: true,
          });
        } else {
          // Update pending tool input with latest partial
          const pending = this.pendingToolBlocks.get(i);
          if (pending) {
            pending.input = (block.input as Record<string, unknown>) || {};
          }
        }
        this.prevContentSnapshot[i] = { type: "tool_use", textLength: 0, name: block.name as string };
      }
    }
  }

  /**
   * Finalize a tool block — emit full input and trigger plan detection.
   * Called when a new block appears after it, or when a non-assistant message arrives.
   */
  private finalizeToolBlock(index: number): void {
    const pending = this.pendingToolBlocks.get(index);
    if (!pending) return;
    this.pendingToolBlocks.delete(index);

    const { name, input } = pending;

    // Emit tool input (if not internal tool)
    if (!ClaudeSession.INTERNAL_TOOLS.has(name)) {
      const inputStr = JSON.stringify(input);
      if (inputStr !== "{}") {
        this.emit("output", {
          timestamp: new Date().toISOString(),
          type: "tool-use",
          content: inputStr,
        } satisfies OutputEntry);
      }
    }

    // Emit tool-call event for step history tracking
    this.emit("tool-call", { name, input });

    // Plan detection: Write to .claude/plans/
    if (name === "Write" && (input.file_path as string)?.includes(".claude/plans/") && input.content) {
      this.planEmitted = true;
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "plan",
        content: input.content as string,
      } satisfies OutputEntry);
      this.emit("plan-text", input.content as string);
    }

    // Plan detection: Edit to .claude/plans/
    if (name === "Edit" && (input.file_path as string)?.includes(".claude/plans/")) {
      const filePath = path.isAbsolute(input.file_path as string)
        ? (input.file_path as string)
        : path.join(this.options.projectPath, input.file_path as string);
      this.readPlanFile(filePath);
    }
  }

  private finalizeAllToolBlocks(): void {
    for (const index of this.pendingToolBlocks.keys()) {
      this.finalizeToolBlock(index);
    }
    // Reset content snapshot for next assistant turn
    this.prevContentSnapshot = [];
    // Flush output tokens from completed message turn
    this._outputTokens += this._currentMsgOutputTokens;
    this._currentMsgOutputTokens = 0;
  }

  private readPlanFile(filePath: string): void {
    try {
      const planContent = fs.readFileSync(filePath, "utf-8");
      if (planContent.trim()) {
        this.planEmitted = true;
        this.emit("output", {
          timestamp: new Date().toISOString(),
          type: "plan",
          content: planContent,
        } satisfies OutputEntry);
        this.emit("plan-text", planContent);
      }
    } catch (err) {
      console.log("[claude-session] Failed to read plan file:", filePath, err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleUserMessage(msg: any): void {
    // Finalize all pending tool blocks (tool results mean tools completed)
    this.finalizeAllToolBlocks();

    // Track user message UUIDs for rewindFiles()
    const uuid = msg.uuid as string | undefined;
    if (uuid && !msg.parent_tool_use_id) {
      this.userMessageUuids.push(uuid);
      this.emit("user-message-uuid", uuid);
    }

    // Extract tool results for display
    const message = msg.message;
    const content = message?.content ?? msg.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if ((block as Record<string, unknown>).type === "tool_result") {
          const resultContent = (block as Record<string, unknown>).content;
          if (!resultContent) continue;

          let text: string;
          if (typeof resultContent === "string") {
            text = resultContent;
          } else if (Array.isArray(resultContent)) {
            text = (resultContent as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text" && b.text)
              .map((b) => b.text as string)
              .join("\n");
            if (!text) text = JSON.stringify(resultContent);
          } else {
            text = JSON.stringify(resultContent);
          }

          if (text) {
            this.emit("output", {
              timestamp: new Date().toISOString(),
              type: "tool-result",
              content: text,
            } satisfies OutputEntry);
          }
        }
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleResultMessage(msg: any): void {
    this.finalizeAllToolBlocks();

    const subtype = msg.subtype as string;
    const result = (msg.result as string) || "";

    // Capture session ID from result
    if (msg.session_id) {
      this.sessionId = msg.session_id as string;
    }

    // Use authoritative token usage from the result message if available
    const resultUsage = msg.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        }
      | undefined;
    if (resultUsage) {
      const inputTotal =
        (resultUsage.input_tokens || 0) +
        (resultUsage.cache_read_input_tokens || 0) +
        (resultUsage.cache_creation_input_tokens || 0);
      this._inputTokens = inputTotal;
      this._outputTokens = resultUsage.output_tokens || 0;
      this._currentMsgOutputTokens = 0;
    }

    // Emit cost and stats for external tracking
    if (msg.total_cost_usd != null || msg.num_turns != null) {
      this.emit("result-stats", {
        totalCostUsd: msg.total_cost_usd as number | undefined,
        numTurns: msg.num_turns as number | undefined,
        durationMs: msg.duration_ms as number | undefined,
        durationApiMs: msg.duration_api_ms as number | undefined,
      });
    }

    if (subtype === "success") {
      if (result && !this.planEmitted) {
        const trimmedResult = result.trim();
        if (!trimmedResult.startsWith("{") && !trimmedResult.startsWith("[")) {
          this.planEmitted = true;
          this.emit("output", {
            timestamp: new Date().toISOString(),
            type: "plan",
            content: result,
          } satisfies OutputEntry);
          this.emit("plan-text", result);
        }
      }
      // Fallback: use accumulated assistant text as plan
      if (!this.planEmitted && this.assistantTextBuffer.trim()) {
        this.planEmitted = true;
        this.emit("output", {
          timestamp: new Date().toISOString(),
          type: "plan",
          content: this.assistantTextBuffer.trim(),
        } satisfies OutputEntry);
        this.emit("plan-text", this.assistantTextBuffer.trim());
      }
      // Dev phase: emit summary
      if (this.options.phase === "dev") {
        const summary = result?.trim() || this.assistantTextBuffer.trim();
        if (summary) {
          this.emit("summary-text", summary);
        }
      }
      this.emit("plan-complete");
    } else if (subtype?.startsWith("error")) {
      if (result) {
        this.emit("output", {
          timestamp: new Date().toISOString(),
          type: "error",
          content: result,
        } satisfies OutputEntry);
      }
      this.emit("error", result || `Session ended with: ${subtype}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Additional SDK message type handlers
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleRateLimitEvent(msg: any): void {
    const message = (msg.message as string) || (msg.reason as string) || "Rate limit reached";
    const retryAfter = msg.retry_after_ms as number | undefined;
    const parts = [message];
    if (retryAfter) {
      parts.push(`(retry in ${(retryAfter / 1000).toFixed(1)}s)`);
    }
    this.emit("output", {
      timestamp: new Date().toISOString(),
      type: "rate-limit",
      content: parts.join(" "),
    } satisfies OutputEntry);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleToolProgress(msg: any): void {
    const toolName = (msg.tool_name as string) || (msg.name as string) || "";
    const elapsed = msg.elapsed_ms as number | undefined;
    const description = (msg.description as string) || (msg.message as string) || "";
    const parts: string[] = [];
    if (toolName) parts.push(`[${toolName}]`);
    if (description) parts.push(description);
    if (elapsed != null) parts.push(`(${(elapsed / 1000).toFixed(1)}s)`);

    if (parts.length > 0) {
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "progress",
        content: parts.join(" "),
        toolName: toolName || undefined,
      } satisfies OutputEntry);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleToolUseSummary(msg: any): void {
    const summary = (msg.summary as string) || (msg.message as string) || "";
    const toolName = (msg.tool_name as string) || (msg.name as string) || "";
    if (summary) {
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "system",
        content: toolName ? `[${toolName}] ${summary}` : summary,
      } satisfies OutputEntry);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handlePromptSuggestion(msg: any): void {
    const suggestions: string[] = [];
    if (Array.isArray(msg.suggestions)) {
      for (const s of msg.suggestions) {
        if (typeof s === "string") suggestions.push(s);
        else if (s?.prompt) suggestions.push(s.prompt as string);
      }
    } else if (msg.prompt) {
      suggestions.push(msg.prompt as string);
    }

    if (suggestions.length > 0) {
      this.emit("prompt-suggestions", suggestions);
      this.emit("output", {
        timestamp: new Date().toISOString(),
        type: "system",
        content: `Suggested follow-ups: ${suggestions.join(" | ")}`,
        suggestions,
      } satisfies OutputEntry);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleAuthStatus(msg: any): void {
    const status = (msg.status as string) || "unknown";
    const message = (msg.message as string) || (msg.reason as string) || "";
    const content = message ? `Auth ${status}: ${message}` : `Auth status: ${status}`;

    // Treat auth failures as errors
    const isError = status === "expired" || status === "failed" || status === "invalid";
    this.emit("output", {
      timestamp: new Date().toISOString(),
      type: isError ? "error" : "system",
      content,
    } satisfies OutputEntry);

    if (isError) {
      this.emit("error", content);
    }
  }

  // ---------------------------------------------------------------------------
  // System message formatting (preserved from original)
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatSystemMessage(msg: any): string {
    const subtype = msg.subtype as string | undefined;

    switch (subtype) {
      case "init":
        return `Session started (${msg.session_id})`;

      case "task_started": {
        const description = msg.description as string | undefined;
        const taskType = msg.task_type as string | undefined;
        const label = taskType === "local_agent" ? "Subagent" : taskType || "Task";
        return description ? `${label} started: ${description}` : `${label} started`;
      }

      case "task_progress": {
        const description = msg.description as string | undefined;
        const toolName = msg.last_tool_name as string | undefined;
        if (description) {
          return toolName ? `[${toolName}] ${description}` : description;
        }
        return "";
      }

      case "task_notification": {
        const status = (msg.status as string) || "unknown";
        const summary = (msg.summary as string) || "";
        const msgUsage = msg.usage as { total_tokens?: number; tool_uses?: number; duration_ms?: number } | undefined;
        const parts = [summary ? `Task ${status}: ${summary}` : `Task ${status}`];
        if (msgUsage) {
          const details: string[] = [];
          if (msgUsage.tool_uses != null) details.push(`${msgUsage.tool_uses} tool uses`);
          if (msgUsage.duration_ms != null) details.push(`${(msgUsage.duration_ms / 1000).toFixed(1)}s`);
          if (msgUsage.total_tokens != null) details.push(`${msgUsage.total_tokens.toLocaleString()} tokens`);
          if (details.length > 0) parts.push(`(${details.join(", ")})`);
        }
        return parts.join(" ");
      }

      case "task_completed": {
        const description = msg.description as string | undefined;
        return description ? `Task completed: ${description}` : "Task completed";
      }

      case "api_request":
        return "";

      default: {
        if (msg.message && typeof msg.message === "string") {
          return msg.message;
        }
        return this.extractReadableContent(msg);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractReadableContent(msg: any): string {
    const readableKeys = ["description", "summary", "message", "status", "error", "reason", "text", "name", "title"];
    const suppressKeys = new Set([
      "type",
      "subtype",
      "task_id",
      "tool_use_id",
      "uuid",
      "session_id",
      "prompt",
      "content",
      "usage",
      "task_type",
    ]);

    const parts: string[] = [];
    for (const key of readableKeys) {
      const val = msg[key];
      if (val && typeof val === "string") {
        parts.push(val);
      }
    }
    if (parts.length > 0) return parts.join(" — ");

    const remaining: string[] = [];
    for (const [key, val] of Object.entries(msg)) {
      if (suppressKeys.has(key)) continue;
      if (val == null || typeof val === "object") continue;
      remaining.push(`${key}: ${String(val)}`);
    }
    return remaining.length > 0 ? remaining.join(", ") : "";
  }

  // ---------------------------------------------------------------------------
  // Question emission (preserved from original)
  // ---------------------------------------------------------------------------

  private emitQuestion(input: Record<string, unknown>): void {
    if (Array.isArray(input.questions) && (input.questions as Array<unknown>).length > 0) {
      const q = (input.questions as Array<Record<string, unknown>>)[0];
      const questionText = (q.question as string) || (q.text as string) || "";
      const header = q.header as string | undefined;
      const multiSelect = q.multiSelect as boolean | undefined;

      let options: QuestionOption[] | undefined;
      if (Array.isArray(q.options)) {
        options = (q.options as Array<Record<string, unknown>>).map((opt) => {
          if (typeof opt === "string") return { label: opt };
          return {
            label: (opt.label as string) || String(opt),
            description: opt.description as string | undefined,
          };
        });
      }

      this.emit("needs-input", {
        questionId: uuidv4(),
        text: questionText,
        header,
        options,
        multiSelect,
        timestamp: new Date().toISOString(),
      } satisfies PendingQuestion);
    } else {
      const questionText = (input.question as string) || (input.text as string) || JSON.stringify(input);
      let options: QuestionOption[] | undefined;
      if (Array.isArray(input.options)) {
        options = (input.options as Array<unknown>).map((opt) => {
          if (typeof opt === "string") return { label: opt };
          const o = opt as Record<string, unknown>;
          return {
            label: (o.label as string) || String(opt),
            description: o.description as string | undefined,
          };
        });
      }

      this.emit("needs-input", {
        questionId: uuidv4(),
        text: questionText,
        options,
        timestamp: new Date().toISOString(),
      } satisfies PendingQuestion);
    }
  }
}
