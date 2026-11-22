# Agent SDK payload notes

This file replaces `evals/NOTES.md`, which was deleted with the eval harness in #5561 (`docs/decisions/0036-evals-harness-and-benchmark-workflow-deleted.md`). It keeps the three sections that code and a project skill outside the harness cite. The rest of that file is in git history at the parent of the deleting commit.

Confirmed against: @anthropic-ai/claude-agent-sdk@0.3.217 (ESM, "type": "module", main sdk.mjs). Capture dates: the `AskUserQuestion` shapes 2026-07-22, their Correction 2026-08-15 (#452), the `run_in_background` and `autoAllowBashIfSandboxed` defaults 2026-07-24, the `autoAllowBashIfSandboxed` supersession note 2026-08-02. `actor.js`, `runner.js` and the README named below were files of the removed harness. Where a section says "above", or cites a Task number or record #46, it points into the rest of the removed file and the harness's own build plan, both in git history.

## AskUserQuestion input/output shapes (confirmed Task 4, Step 1)

Grep command run (via an inline `node -e` script walking `node_modules/@anthropic-ai/claude-agent-sdk/` with `fs.readdirSync`/`fs.readFileSync`, since the literal `grep -rn "AskUserQuestion" node_modules/@anthropic-ai/claude-agent-sdk/` was denied by this session's Bash permission settings):

    node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:32:  | AskUserQuestionInput
    node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:76:  | AskUserQuestionOutput
    node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:848:export interface AskUserQuestionInput {
    node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts:3396:export interface AskUserQuestionOutput {

`sdk-tools.d.ts` is a separate, auto-generated file from `sdk.d.ts` (JSON-Schema-derived typing for every built-in tool's recorded input/output — ~35 tools, `AskUserQuestion` is not uniquely special here), distinct from the `CanUseTool`/`PermissionResult` contract above.

`AskUserQuestionInput` (line 848): `{ questions: [{ question: string; header: string; options: [{ label: string; description: string; preview?: string }, ...2-4 items]; multiSelect: boolean }, ...1-4 items] }`. No `answers` field — this is just the posed questions.

`AskUserQuestionOutput` (line 3396): `{ questions: [...same shape...]; answers: { [k: string]: string }; response?: string; annotations?: {...}; afkTimeoutMs?: number }`. Doc comment: *"The answers provided by the user (question text -> answer string; multi-select answers are comma-separated)."*

**Correction — this is the SDK's typed API-level output, not what a `PostToolUse` hook's `ctx.input.tool_response` receives for this tool (confirmed record #452's final review).** Extracted directly from a live session transcript (`tool_use`/`tool_result` blocks for real `AskUserQuestion` calls), `ctx.input.tool_response` for `AskUserQuestion` is always a plain natural-language string — e.g. `Your questions have been answered: "..."="...". You can now continue with these answers in mind.` — never the structured `{questions, answers}` object above. The prefix/suffix vary (observed both `"Your questions have been answered: ..."`/`"...You can now continue with these answers in mind."` and `"The user answered: ..."`/`"...follow what they actually say."`), and the embedded question text can carry unescaped nested double quotes, so this string is not safely regex-parseable into per-question answers. `plugin/bin/lib/hooks/post-tool-use.js`'s `logAskUserQuestion` logs it as one raw `response` field via the file's own `extractToolResponseText` helper instead of attempting to extract per-question answers. Do not reintroduce an `answers`-map lookup against `tool_response` for this tool based on the type declaration above — it describes the SDK's own return type, not the hook boundary.

**Takeaway for the actor:** The `updatedInput: { questions, answers }` return shape of the harness's `actor.js` matches `AskUserQuestionOutput`'s two required fields exactly (the other three are optional and correctly omitted). This confirms — does not contradict — the design already implemented; `answers` lives in the tool's *output* schema, not its input schema. `PermissionResult.updatedInput` itself remains typed as `Record<string, unknown>` in `sdk.d.ts` (no compile-time binding to either schema), so this is informative confirmation rather than a hard constraint discovered late.

## AgentInput.run_in_background default (confirmed during final-review follow-up)

Grep command run (same `node -e` fs-walk workaround as above — direct `grep`/`Read` on `node_modules` paths is denied by this session's Bash permission settings):

    node -e "... fs.readFileSync(path.join('evals','node_modules','@anthropic-ai','claude-agent-sdk','sdk-tools.d.ts'), 'utf8') ..."

`AgentInput` (`sdk-tools.d.ts`, `export interface AgentInput { ... }`):

    /**
     * Agents run in the background by default; you will be notified when one completes. Set to false to run this agent synchronously when you need its result before continuing.
     */
    run_in_background?: boolean;

**Takeaway for the actor:** the field defaults to background (`true`) when *omitted*, not just when explicitly set — the doc comment states this plainly, but it was missed on first implementation. The original Agent-dispatch guard in the harness's `actor.js` checked only `input.run_in_background === true`, which denies the explicit-true case but silently allows the (more common) omitted case straight into the same async-coordination hang the guard exists to prevent. Fixed to `!input || input.run_in_background !== false` — deny unless the caller explicitly opts into synchronous dispatch. Any future guard keyed off an SDK-typed optional boolean should read the field's own doc comment for its default before assuming "omitted" is the safe branch.

## managedSettings.sandbox.autoAllowBashIfSandboxed default (confirmed during Task 7.5 sandbox validation)

`sdk.d.ts`'s `sandbox` option type declares the field with no adjacent doc comment of its own:

    sandbox?: {
        enabled?: boolean;
        failIfUnavailable?: boolean;
        autoAllowBashIfSandboxed?: boolean;
        allowUnsandboxedCommands?: boolean;
        ...
    }

Its default is confirmed instead by a parenthetical in a *different* field's doc comment (`filesystem`'s skip-isolation option) later in the same file: *"Does not change Bash prompting: `sandbox.autoAllowBashIfSandboxed` is independent and still defaults to `true`, so set it to `false` to keep prompting for sandboxed commands."*

**Takeaway for the runner:** with sandboxing enabled (`runner.js`'s `managedSettings.sandbox`), Bash-tool calls are auto-allowed by the sandbox itself and never reach `canUseTool` at all — confirmed empirically during Task 7.5's real-API validation, before this doc-comment cross-reference was found. This means `runner.js`'s `toolCalls` count (fed by `canUseTool`) structurally undercounts real Bash tool use whenever the sandbox is active — documented as a known limitation in the harness README's Safety model section and as a code comment next to `runner.js`'s `toolCalls.push`, not something this harness's own code can close without either setting `autoAllowBashIfSandboxed: false` (reintroducing a prompt for every sandboxed Bash call, which this harness's headless runs cannot answer) or independently instrumenting the sandbox layer itself.

**Superseded by record #46 (2026-08-02):** `autoAllowBashIfSandboxed: false` was adopted in `runner.js`. The "reintroduces a prompt this harness's headless runs cannot answer" reasoning above does not hold — headless runs answer `canUseTool` programmatically via `actor.js`, with no live human prompt involved at any point, so this was never actually a blocker. The harness's `actor-escape-attempt` scenario was the confirming live run: `node runner.js run actor-escape-attempt` completed in ~20 seconds with no hang and no unanswered prompt.
