# Workflow Tool Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure what Claude Code's Workflow tool does for a plugin-shipped workflow and record it in `docs/reference/workflow-tool-probe.md`, one row per probe.

**Architecture:** A throwaway plugin (`wfprobe`) in the session scratch directory ships one workflow script, one skill and one `SubagentStop` hook. A scratch launcher starts `claude -p` child sessions against it, one empty working directory per child, and stores each child's stream with arrival times. Raw captures are copied to the run directory's `evidence/wfprobe/`; the document is written from those files; the scratch tree is then deleted.

**Tech Stack:** Claude Code CLI 2.1.325 (`claude -p`, `--plugin-dir`, `--output-format stream-json`), Node (scratch scripts only), `gh`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T003549-spec-5596/work/5596-spec.md`

## Global Constraints

- **Who runs what (spec Decision, 2026-11-16).** "A dispatched implementer agent has no Workflow tool, so the probes that start a workflow are run by the top-level session that builds this record, in its own thread." Tasks 1 and 3 are main-thread tasks: the building session runs them itself and dispatches no implementer for them. Task 2 is dispatched.
- **Stop rule (spec Deliverable 1).** If neither the name form nor the `scriptPath` form starts the workflow, the build writes no document and opens no further PR work: it posts one comment on #5596 with both commands, both failures verbatim and the CLI version, and ends BLOCKED.
- "Each probe workflow starts at most three agents."
- "The probe plugin lives in the session's scratch directory, never under `plugin/`: a file there would ship."
- "Give each child an empty scratch working directory and a prompt that asks for nothing but the probe."
- "Do not narrow a child with `--setting-sources project`."
- "`ultracode` does not fire from `claude -p`. No probe may depend on it."
- "Use the installed CLI." A newer release is run only with `npx -y @anthropic-ai/claude-code@{version}` from the scratch directory.
- Every child runs with this machine's user settings as they are. A start that needed an allow rule is recorded `yes-with: {rule}`, and the rule is passed only as a launch flag of that one child.
- Result vocabulary for every row: `yes`, `yes-with: {rule}`, `no`, `inconclusive: {why}` (only after one re-run), `not probed: {reason}`.
- Nothing under `plugin/`, `tests/` or `tools/` is in the PR's diff. `docs/plugin-structure.md` is not edited: it does not list the documents under `docs/reference/` (`grep -n "docs/reference" docs/plugin-structure.md` printed nothing on 2026-11-16).
- **Governing project skill, `transcript-payload-verification`** (it names `docs/reference/pretooluse-agent-tool-probe.md`, the document this one is modelled on). Quoted rules that apply:
  - "load a scratch plugin (`.claude-plugin/plugin.json`, plus `hooks/hooks.json` running a stdin logger through `${CLAUDE_PLUGIN_ROOT}`) with `claude -p --plugin-dir <scratch> --output-format stream-json --verbose --include-hook-events`."
  - "a probe spawned from inside a Claude Code session removes that session's variables (`CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID` and the rest the probe doc lists) from the child's environment, so it runs as a fresh top-level session rather than a child that could inherit the parent's session id."
  - "Resolve the config root; do not assume `~/.claude`. When `$CLAUDE_CONFIG_DIR` is set the store is `$CLAUDE_CONFIG_DIR/projects/`."
  - "A `claude -p` probe, the throwaway-hook recipe above included, measures headless only." Each row therefore names its launch mode, and no headless result is worded as holding for an interactive session.
  - "A hook's *input* payload is not in the transcript at all" — the `SubagentStop` payload is taken from the probe plugin's own hook log.
- **Governing project skill, `headless-worker-launch`** (it names `plugin/bin/lib/driver/roles.js`, which the driver-worker row launches from). Quoted rules that apply:
  - "Take the evidence from each launch's session transcript, found by the result's `session_id` … The worker's own summary is its account of what happened, not evidence."
  - "A case whose transcript holds no `tool_use` of the tool is not-called, never contained: re-run it once, and report it as unsettled if it is still not called."
  - "A live smoke or probe prompt that leaves the worker to phrase its own Bash commands | The model rewrites them … tell it to run each command exactly as written".
  - "Copying the probed facts into this skill or another document | They drift from the headers they came from" — the new document records Workflow-tool facts only and points at `roles.js` for the worker's rights.

Waived docs/plugin-structure.md: read once at plan time (the grep above); it does not list `docs/reference/` documents, so AC5 leaves it out of the diff.
Waived plugin/skills/specify/empirical-premise-check-deliverables.md: read at plan time; its probe-target, teardown and literal-capture rules are carried by Task 1 (scratch target, verbatim capture) and Task 3 (teardown).

`plugin/bin/lib/driver/roles.js` is read-only here: Task 1 Step 5 calls its `composeArgs` to build the driver-worker launch, and nothing edits it.

## Review Focus

- A child's model answers without calling the Workflow tool: that is "not called", never "cannot start". The row is decided from the stream's `tool_use`/`tool_result` lines; one re-run, then `inconclusive`.
- An agent's own report disagrees with its transcript (a tool it says it called has no `tool_use` line): the transcript decides the row, and the document quotes the transcript line.
- A child inherits the building session's variables and runs as a nested session: the launcher deletes them, and Task 1 Step 3 checks the child's `session_id` differs from the building session's.
- The config root is not `~/.claude`: every session-file path is built from `$CLAUDE_CONFIG_DIR` when set, and the document writes it as `<config>`.
- The Bash tool cuts `sleep 660` before ten minutes: the long-run row states the run's measured duration from the stream's arrival times, and a run under ten minutes is re-run once with the wording in Task 1 Step 6.

## Spec coverage map

| Clause | Covered by |
|---|---|
| AC1.1 | Task 2 Step 4 (row-per-probe check) |
| AC2.1 | Task 1 Step 3 (start gate) |
| AC3.1, AC3.2, AC3.3 | Task 1 Step 5; Task 2 Step 4 (initiator-row check) |
| AC4.1, AC4.2 | Task 2 Step 4 (version and "Depended on by" checks) |
| AC5.1 | Task 3 Step 5 (`git diff --stat`) |
| AC6.1 | Task 3 Steps 1 and 6 |
| AC7.1, AC7.2, AC7.3, AC7.4 | Task 3 Steps 3 and 6 |

---

### Task 1: Run the probes (main thread)

**Role:** judgment

**Files:**
- No repository file. Everything this task writes is under the scratch root `{S}` = `<session scratchpad>/wfprobe` or under `{E}` = `<run dir>/evidence/wfprobe` (the run dir in the main checkout, gitignored).

**Interfaces:**
- Produces: `{E}/` holding, per probe id, `{id}.stream.jsonl` (one line per child stdout line, prefixed `{ms since launch}\t`), `{id}.cmd.txt` (the exact argv, cwd and prompt), a copy of the child's `workflows/` and `subagents/workflows/` session files, `subagent-stop.jsonl`, the probe plugin's five files, `settings-before.txt`, and `results.md` — one block per probe row with: id, initiator, launch mode, command, CLI version, date, result, observed value, the evidence file and line that decides it.
- Probe ids, in run order: `start-name`, `start-path`, `layout`, `init-headless`, `init-skill-step`, `init-task-agent`, `init-driver-worker`, `init-restricted`, `init-interactive`, `init-routine`, `init-cloud`, `size-args`, `size-return`, `delivery`, `long-run`, `agent-skill`, `agent-mcp`, `agent-bash`, `agent-nested`, `agent-stop-hook`, `agent-verbatim`, `agent-cwd`, `agent-permission-mode`.

- [ ] **Step 1: Baseline.** Print `claude --version`, `printenv CLAUDE_CONFIG_DIR`, and `shasum` of each settings file that exists among `<config>/settings.json`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, and the repository's `.claude/settings.json` and `.claude/settings.local.json`; save the listing as `{E}/settings-before.txt`. This listing and Task 3 Step 2's are the risk proof:

Proof(auth): the probes edit no settings file and persist no allow rule — an allow rule a start needs is a launch flag of one child process and ends with it; this step and Task 3 Step 2 print `shasum` of every user, project and local settings file before and after, and the two listings must be byte-identical; every child is a `claude -p` process that has exited, and any Routine is deleted and its absence listed, before the PR says so.

- [ ] **Step 2: Build the probe kit in `{S}`.**
  - `{S}/plugin/.claude-plugin/plugin.json`: `{"name":"wfprobe","version":"0.0.0"}`.
  - `{S}/plugin/workflows/probe.js`: `meta.name` `probe`. It normalizes `args` (a JSON string is parsed, as `code-modernization`'s `harden-scan.js` does) and branches on `args.mode`; every `agent()` call passes `model: 'haiku'`:
    - `echo` — one agent ("Reply with exactly the word PONG and nothing else."); returns `{mode, argsLength: JSON.stringify(args).length, sum: args.a + args.b, said}`.
    - `size` — no agent; returns `{mode, argsLength, payloadLength: String(args.payload || '').length, blob: 'x'.repeat(args.returnBytes || 0)}`.
    - `long` — one agent told to run the single command `sleep 660` with the Bash tool exactly as written and reply with the one word `DONE`; returns `{mode, said}`.
    - `caps` — three agents: (a) call the Skill tool for `wfprobe:start-probe` without following it, then run `pwd` with Bash exactly as written, and report each call's result or error text; (b) call the MCP tool named in `args.mcpTool` (skipped when absent), then call the Agent tool (`general-purpose`, prompt `Reply OK`), and report each; (c) reply with a fixed 2,000-character string the script also holds (`probe00000`…`probe00199` joined). Returns `{mode, a, b, verbatimEqual: c === FIXED, replyLength: c.length}`.
  - `{S}/plugin/skills/start-probe/SKILL.md`: one step — call the Workflow tool with name `wfprobe:probe` and args `{"mode":"echo","a":20,"b":22}`, then print the returned value.
  - `{S}/plugin/hooks/hooks.json` + `{S}/plugin/log.js`: one `SubagentStop` entry running `node "${CLAUDE_PLUGIN_ROOT}/log.js"`, which appends its raw stdin as one line to `{S}/out/subagent-stop.jsonl` and exits 0.
  - `{S}/kit/run-child.js {id} [extra claude flags…]`: creates the empty `{S}/cwd/{id}`, reads the prompt from `{S}/kit/prompts/{id}.txt`, spawns `claude -p --plugin-dir {S}/plugin --model haiku --output-format stream-json --verbose --include-hook-events --max-budget-usd 2` plus the extra flags with that cwd and the prompt on stdin, deletes `CLAUDECODE`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_BRIDGE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_PID` and `CLAUDE_CODE_SESSION_ATTENDED` from the child's environment, writes `{S}/out/{id}.stream.jsonl` and `{S}/out/{id}.cmd.txt`, and kills the child at a ceiling (default 300 s; `--ceiling-s N` overrides).

- [ ] **Step 3: Start gate (Deliverable 1, AC2.1).** Run `start-name` (prompt: call the Workflow tool once with name `wfprobe:probe` and args `{"mode":"echo","a":20,"b":22}`, write no script, wait for it to finish, print the returned value verbatim, or print the exact error text). Pass: the stream holds a Workflow `tool_use` and a returned value with `sum` 42 and `argsLength` equal to the length of the args in that `tool_use`. Then `start-path`, the same prompt with `scriptPath` `{S}/plugin/workflows/probe.js` in place of the name. A call refused for permission is re-run once with `--allowedTools` naming the narrowest rule that admits it, and recorded `yes-with`. Check the child's `session_id` differs from this session's. **Neither form starts → the Stop rule in Global Constraints; no later step runs.**

- [ ] **Step 4: Layout (Deliverable 5).** From `start-name`'s `session_id`, list `<config>/projects/<slug>/<session>/workflows/` and `…/subagents/workflows/<runId>/`, print the keys of `<runId>.json`, and count lines carrying `"usage"` under `message` in one `agent-*.jsonl` beside the file's line count. Copy both directories into `{E}/start-name/`. This runs before the `delivery` row, which reads the run file.

- [ ] **Step 5: Initiators (Deliverable 2, AC3).** One row each:
  - `init-headless` — `start-name`'s result, with its permission mode (the init event's `permissionMode`).
  - `init-skill-step` — child prompt "Use the wfprobe:start-probe skill and do what it says." Labelled a headless stand-in.
  - `init-task-agent` — the building session dispatches one `haiku` agent whose prompt asks only for the names of the tools it has; `Workflow` absent from its list is `no`.
  - `init-driver-worker` — a child started with the argv `composeArgs({role: 'reviewer', schema, platform: process.platform})` returns from the worktree's `plugin/bin/lib/driver/roles.js`, plus `--verbose` so the init event is in the output (if the `json` output carries no init event, the one change is `--output-format stream-json`); answered by whether `Workflow` is in the init event's `tools`. A second launch swaps in `--tools Read,Write,Edit,Bash` (the implementer's list).
  - `init-restricted` — `start-name`'s prompt with `--restricted` added and nothing else; record the tool-list difference against `init-headless` and whether the start changed.
  - `init-interactive` — only if the building session is interactive and has the Workflow tool: it starts `{S}/plugin/workflows/probe.js` by `scriptPath` with the `echo` args. The name form is `not probed: the probe plugin is not loaded in the building session`. Otherwise the row reads `not probed: needs a person at a terminal`.
  - `init-routine` — one one-off Routine whose prompt asks only for the session's tool list; read its result; delete it; keep the listing that no longer shows it. If the building session cannot create one, `not probed: {reason}`.
  - `init-cloud` — the same question in a cloud session when the building session can start one; otherwise `not probed: {reason}`.

- [ ] **Step 6: Size and delivery (Deliverable 3).**
  - `size-args` — `{S}/cwd/size-args/payload.txt` holds 100,000 ASCII bytes; the child is told to pass the file's full content as `args.payload` with `mode: "size"`. Pass: `argsLength` returned by the script equals the byte length of the args in the stream's `tool_use` and is at least 100,000. Short of 100,000 → one re-run with `--model sonnet`; still short → `inconclusive: the model emitted {N} bytes`.
  - `size-return` — args `{"mode":"size","returnBytes":100000}`; record how many bytes of the value the tool result carries, each field of the tool result, which field (if any) names where the whole value is, and where the whole value is readable (`<runId>.json`'s `result`). "No field names the place" is a valid result.
  - `delivery` — from `start-name`'s stream arrival times: when the Workflow `tool_result` arrived against when the agent's lines and the returned value arrived.
  - `long-run` — args `{"mode":"long"}`, `--ceiling-s 1500`, run in the background. "Finished" is the returned value arriving in the child's stream; "cut" is the stream ending, or the tool result arriving, without it. The row quotes the last event and states the measured duration. A run that ends in under 600 s because the Bash tool cut the sleep is re-run once with the agent told to run `sleep 330` twice.

- [ ] **Step 7: What an agent can do (Deliverable 4).** One `caps` run (`args.mcpTool` set to a tool of an MCP server the child's init event lists; none listed → `agent-mcp` is `not probed: no MCP server in the child session`). Rows `agent-skill`, `agent-mcp`, `agent-bash`, `agent-nested` are decided from the agents' `agent-*.jsonl` `tool_use`/`tool_result` lines; `agent-stop-hook` from `subagent-stop.jsonl` (fired or not, `agent_type`, the transcript-path field); `agent-verbatim` from `verbatimEqual` and `replyLength`; `agent-cwd` from the `pwd` result against the child's cwd; `agent-permission-mode` from the hook payload's `permission_mode` against the child's init `permissionMode`.

- [ ] **Step 8: Persist the evidence.** Copy `{S}/out/`, `{S}/kit/prompts/`, the five plugin files and each child's session `workflows/` and `subagents/workflows/` directories to `{E}/`; write `{E}/results.md`. Log one `AC evidence` decision entry naming `{E}` and the count of rows by result.

### Task 2: Write `docs/reference/workflow-tool-probe.md`

**Role:** integration

**Files:**
- Create: `docs/reference/workflow-tool-probe.md`

**Interfaces:**
- Consumes: `{E}/results.md` and the raw files it points at (absolute paths given in the brief). The implementer runs no probe and starts no `claude` process.
- Produces: the document, in the shape of `docs/reference/pretooluse-agent-tool-probe.md`.

- [ ] **Step 1: Read `{E}/results.md`, every evidence line it cites, and `docs/reference/pretooluse-agent-tool-probe.md` for the house shape.**

- [ ] **Step 2: Confirm the document does not exist yet.**

Run: `test -f docs/reference/workflow-tool-probe.md`
Expected: FAIL (exit 1)

- [ ] **Step 3: Write the document.** Sections, in order:
  1. Title and one paragraph: what record #5596 asked, and that every result holds for the CLI version in its row only.
  2. **Scope and how to re-run** — CLI version, date, platform, launch modes measured; the probe plugin's five files verbatim; the launcher's command line and the variables it removes; one line per probe id giving the prompt file's text and the extra flags, so each probe can be run again.
  3. **Results** — one table row per probe id from Task 1's list: probe, initiator and launch mode, command, CLI version, date, result (the fixed vocabulary), observed value, what it means for #5597 and #5599.
  4. **Observed output** — one subsection per probe id that ran, holding the deciding lines verbatim in a fence (long values cut with `…`, paths shortened to `<scratch>` and `<config>`, nothing else edited).
  5. **Where a run's files are** — the layout confirmed or corrected, with the version beside it, and whether `agent-{id}.jsonl` carries `message.usage` rows.
  6. **Depended on by** — #5597 and #5599, the rows each reads, and the rule that those rows are re-run when the installed CLI's minor version differs from the row's.

- [ ] **Step 4: Check the document against the evidence.**

Run: `grep -c "^| " docs/reference/workflow-tool-probe.md` and, for each probe id in Task 1's list, `grep -c -F "{id}" docs/reference/workflow-tool-probe.md`
Expected: every id count is at least 1. AC1.1: each id has a results row with a result from the fixed vocabulary, an observed-value cell where the probe measures something, and a verbatim subsection when it ran. AC3.1: each initiator has its own row. AC3.2: `not probed` appears only on `init-cloud`, `init-routine`, `init-interactive`, and on `agent-mcp` under the spec's no-MCP-server reason. AC3.3: `init-headless`, `init-skill-step`, `init-task-agent`, `init-driver-worker` and `init-restricted` each read `yes`, `yes-with` or `no`. AC4.1: every row names its CLI version, and the first section says the results hold for that version only and how to re-run each probe. AC4.2: the "Depended on by" section names #5597 and #5599, the rows each reads, and the minor-version re-run rule. Every fenced line is present byte for byte in the evidence file it is attributed to (`grep -c -F` of three sampled lines per subsection against `{E}`).

- [ ] **Step 5: Commit.**

```bash
git add docs/reference/workflow-tool-probe.md
git commit -m "Record what the Workflow tool does for a plugin-shipped workflow — refs #5596"
```

### Task 3: Teardown, comments and PR statements (main thread)

**Role:** integration

**Files:**
- No repository file.

**Interfaces:**
- Consumes: the committed document and `{E}/`.

- [ ] **Step 1: Delete `{S}` whole (plugin, kit, every child cwd, `out/`), then run `ls` on `{S}/plugin` and `{S}/cwd`; keep the "No such file or directory" output. If a Routine was created, keep the listing that no longer shows it (AC6.1).**
- [ ] **Step 2: Re-run Step 1's `shasum` listing of Task 1 and `diff` it against `{E}/settings-before.txt`; the diff must be empty.**
- [ ] **Step 3: Read #5597 and #5599 (`gh issue view`). For each sentence a results row contradicts, post one comment on that record quoting the row (AC7.1, AC7.2, AC7.3). Keep the comment URLs, or note that there were none (AC7.4).**
- [ ] **Step 4: Log the `AC evidence` decision entries: teardown listings, the settings diff, the comment URLs.**
- [ ] **Step 5: `git diff --stat origin/main...HEAD` lists `docs/reference/workflow-tool-probe.md` and no path under `plugin/`, `tests/` or `tools/` (AC5.1).**
- [ ] **Step 6: Add to the PR body, below the fixes block and above the session link: the teardown statement with both `ls` outputs and the Routine listing or "no Routine was created" (AC6.1); the list of comments posted, or "none" (AC7.4); each choice made under the spec's decision rule.**
