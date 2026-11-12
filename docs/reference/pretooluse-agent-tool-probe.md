# PreToolUse on the `Agent`/`Task` tool

Record #4589 (render `/claude-tweaks:dispatch` Task prompts with a CLI, and deny a dispatched prompt that is not byte-identical to the rendered file), Decision 3: "Before relying on it, the plan verifies that PreToolUse fires for `Agent` calls with `tool_input.prompt`, and whether older Claude Code versions name the tool `Task`." This file is the measured answer. The gate's later tasks rest on the facts below.

- **Claude Code version:** `claude --version` printed `2.1.322 (Claude Code)`; every probe's stream-json `init` line reported `"claude_code_version":"2.1.322"` and model `claude-opus-5-5`.
- **Date measured:** 2026-11-12
- **Surface:** headless `claude -p`, `--permission-mode bypassPermissions`, a throwaway scratch plugin loaded with `--plugin-dir`. Interactive mode was not probed.

## Setup

A scratch plugin outside the repo:

- `.claude-plugin/plugin.json`: `{"name":"probe","version":"0.0.0"}`
- `hooks/hooks.json`: two `PreToolUse` entries, matcher `Agent` and matcher `Task`, each running `node "${CLAUDE_PLUGIN_ROOT}/log.js"`.
- `log.js`: appends one JSON line `{ stdin: <raw stdin JSON>, envSession: process.env.CLAUDE_CODE_SESSION_ID || null }` to `events.jsonl` beside it. When `tool_input.prompt` contains `PROBE-DENY` it prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"probe deny"}}`. It always exits 0.

Each probe was this command, run with the scratch plugin directory as the cwd and the prompt on stdin:

```
claude -p --plugin-dir <scratch> --permission-mode bypassPermissions --output-format stream-json --verbose --include-hook-events --max-budget-usd 3
```

The probes were spawned from inside a Claude Code session, so the spawner removed `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_PID` and `CLAUDE_CODE_SESSION_ATTENDED` from the child's environment. Each probe therefore ran as a fresh top-level session, not as a child that could inherit the parent's session id. The user-level plugins installed on the machine were loaded as usual; no other hook ran on `PreToolUse:Agent`.

The four prompts:

- **(a)** "Run `printenv CLAUDE_CODE_SESSION_ID` and print it. Then use the Agent tool, subagent_type general-purpose, prompt exactly `Reply OK. PROBE-ALLOW`. Then print the agent's reply."
- **(b)** "Run `printenv CLAUDE_CODE_SESSION_ID` and print it. Then use the Agent tool, subagent_type general-purpose, prompt exactly `Reply OK. PROBE-DENY`. Then print what happened."
- **(c)** "Use the Agent tool to launch a general-purpose agent whose task is: use the Agent tool yourself to launch a general-purpose agent with prompt `Reply OK. PROBE-NESTED`; report its reply."
- **(d)** `nl.txt` in the scratch plugin directory, written with the Write tool, held `Reply OK. PROBE-NL` followed by exactly one `\n` (`od -c` ends `N   L  \n`, 19 bytes). Prompt: "Run `cat <scratch>/nl.txt` and pass its output unchanged as the Agent tool prompt (general-purpose)".

## Captured hook stdin

One line per `PreToolUse` event, as `log.js` wrote it (paths shortened to `<scratch>` and `<projects>`; nothing else edited).

(a):

```
{"stdin":{"session_id":"f100125e-98ca-45a7-9c9d-a8d084b7ce09","transcript_path":"<projects>/f100125e-98ca-45a7-9c9d-a8d084b7ce09.jsonl","cwd":"<scratch>","prompt_id":"4a8159bc-5474-4134-b258-18fbdeb333a8","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Probe agent reply","prompt":"Reply OK. PROBE-ALLOW","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_01Ra9VjaqMbE7jbse4qp6H8C"},"envSession":"f100125e-98ca-45a7-9c9d-a8d084b7ce09"}
```

(b):

```
{"stdin":{"session_id":"c0248917-0279-4d2e-9cc5-82470e66b5d2","transcript_path":"<projects>/c0248917-0279-4d2e-9cc5-82470e66b5d2.jsonl","cwd":"<scratch>","prompt_id":"4f6af1a4-fafb-47ba-918a-fabc33fd2bad","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Probe agent spawn","prompt":"Reply OK. PROBE-DENY","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_013SNuCdbRUPpLuR4D4autfG"},"envSession":"c0248917-0279-4d2e-9cc5-82470e66b5d2"}
```

(c), the outer call from the main thread and then the nested call from the subagent:

```
{"stdin":{"session_id":"52cfe769-af66-416c-9317-8f353a1cb340","transcript_path":"<projects>/52cfe769-af66-416c-9317-8f353a1cb340.jsonl","cwd":"<scratch>","prompt_id":"aceb5387-929d-483e-9835-3dd86018d54d","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Nested agent probe","prompt":"Use the Agent tool yourself to launch a general-purpose agent (subagent_type \"general-purpose\") with exactly this prompt: `Reply OK. PROBE-NESTED`. Wait for its result, then report back its reply verbatim. If the Agent tool is unavailable to you or the launch fails, say so explicitly and include the exact error message.","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_01N7TseBEMqgaSGRkDXaK2Pu"},"envSession":"52cfe769-af66-416c-9317-8f353a1cb340"}
{"stdin":{"session_id":"52cfe769-af66-416c-9317-8f353a1cb340","transcript_path":"<projects>/52cfe769-af66-416c-9317-8f353a1cb340.jsonl","cwd":"<scratch>","prompt_id":"aceb5387-929d-483e-9835-3dd86018d54d","permission_mode":"bypassPermissions","agent_id":"aabcc582ea8c99f49","agent_type":"general-purpose","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Nested probe agent","prompt":"Reply OK. PROBE-NESTED","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_018c9MXuWhKwasnK3cntAHUQ"},"envSession":"52cfe769-af66-416c-9317-8f353a1cb340"}
```

(d):

```
{"stdin":{"session_id":"593062af-7eb1-42b5-a9d9-e0500cd3a32e","transcript_path":"<projects>/593062af-7eb1-42b5-a9d9-e0500cd3a32e.jsonl","cwd":"<scratch>","prompt_id":"d7ac514a-a398-46ab-bebb-221116176b47","permission_mode":"bypassPermissions","effort":{"level":"medium"},"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Probe prompt passthrough","prompt":"Reply OK. PROBE-NL","subagent_type":"general-purpose","run_in_background":false},"tool_use_id":"toolu_01XHzbD9WZTaWNZQB3QXdVDL"},"envSession":"593062af-7eb1-42b5-a9d9-e0500cd3a32e"}
```

Each `Agent` call produced exactly one event. The `Task` matcher never fired.

## Findings

- **Tool name:** every event carried `"tool_name":"Agent"`, and the stream-json hook lines are named `"hook_name":"PreToolUse:Agent"`.
- **`tool_input.prompt` is the exact prompt string:** (a) `"prompt":"Reply OK. PROBE-ALLOW"` in the hook stdin matches the model's tool call `{"description":"Probe agent reply","subagent_type":"general-purpose","prompt":"Reply OK. PROBE-ALLOW","run_in_background":false}`. The same holds for (b), both (c) calls and (d). The key order in `tool_input` differs from the model's call; the values do not.
- **`session_id` equals the session's `CLAUDE_CODE_SESSION_ID`:** in (a) the model's Bash call `printenv CLAUDE_CODE_SESSION_ID` returned `"f100125e-98ca-45a7-9c9d-a8d084b7ce09"`, the hook stdin has `"session_id":"f100125e-98ca-45a7-9c9d-a8d084b7ce09"`, and the hook process's own env has `"envSession":"f100125e-98ca-45a7-9c9d-a8d084b7ce09"`. In (b) all three are `c0248917-0279-4d2e-9cc5-82470e66b5d2`. This is the value `record-worktree --dispatch` stamps as `dispatchSessionId`, so the bound-run match can compare the two directly.
- **`agent_id` tells a main-thread call from a subagent's call:** on the main-thread calls in (a), (b), (d) and (c)'s outer call the stdin keys are `["session_id","transcript_path","cwd","prompt_id","permission_mode","effort","hook_event_name","tool_name","tool_input","tool_use_id"]`, with no `agent_id`. (c)'s nested call adds `"agent_id":"aabcc582ea8c99f49","agent_type":"general-purpose"` and keeps the same `"session_id":"52cfe769-af66-416c-9317-8f353a1cb340"`. The `agent_id` is the id of the calling subagent, not of the agent being launched: the outer tool result reads `agentId: aabcc582ea8c99f49` (the middle agent), and the inner one reads `agentId: ad5e80c2321bff2c2`.
- **A deny blocks the launch and the model sees the reason (b):** the hook response was `"stdout":"{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"probe deny\"}}"`, `"exit_code":0`. The tool result was `is_error=true` with content `"PreToolUse:Agent hook error: probe deny"`. The (b) stream has zero lines carrying a `"parent_tool_use_id":"toolu_…"` (the (a) stream, where the agent ran, has one), so no subagent started. The model's reply: "A PreToolUse hook blocked it before the subagent started. … it returned: `PreToolUse:Agent hook error: probe deny` … No subagent ran". The deny applied under `--permission-mode bypassPermissions`.
- **Trailing newline (d), recorded, not gated on:** `JSON.stringify(tool_input.prompt.slice(-3))` is `"\"-NL\""` and the prompt is 18 characters, so `tool_input.prompt` does **not** end with the `\n`. The newline was gone before the model chose the prompt: the Bash tool result for `cat` was already `"Reply OK. PROBE-NL"`. So this measures the cat-then-pass path end to end; it does not show whether the harness would strip a trailing newline the model did put into the `Agent` call. The rendering CLI writes no trailing whitespace either way.

## Older Claude Code versions: `Task` or `Agent`

`~/.claude/cache/changelog.md` (present on this machine; no npm `@anthropic-ai/claude-code` package is installed globally) has no line recording a `Task` → `Agent` rename. The searches for `renamed` near `Task`/`Agent`, `Task → Agent` and `Task -> Agent` matched nothing relevant. The two names overlap in the changelog's own wording, so they cannot date the rename. The first entry that says "Agent tool" is under `## 2.1.69` ("Fixed teammates accidentally spawning nested teammates via the Agent tool's `name` parameter"). Later entries still say "Task tool", for example under `## 2.1.72` ("Fixed worktree isolation issues: Task tool resume not restoring cwd, …") and `## 2.1.212` ("Deprecated the Task tool's `mode` parameter (now ignored); …").

Result: **not found locally — both matchers registered.** On 2.1.322 only the `Agent` matcher fires, so registering both costs nothing and covers a CLI that still reports `tool_name` `Task`.

## Not measured

- **Not measured:** interactive mode and the `default`/`acceptEdits`/`auto` permission modes. Only `bypassPermissions` was probed.
- **Not measured:** a background (`run_in_background: true`) `Agent` call, an `isolation: "worktree"` call, and a team/`name` launch.
- **Not measured:** any Claude Code version other than 2.1.322. Nothing here shows a CLI that emits `tool_name` `Task`.
- **Not measured:** whether the harness strips a trailing newline that the model itself puts into `tool_input.prompt` (see (d)).
- Re-run these probes after a Claude Code upgrade that touches hooks or the Agent tool.
