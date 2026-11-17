# Review Lens Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in second dispatch path for `/claude-tweaks:review` Step 3's lens fan-out: a plugin workflow script that starts both reviewers of every lens from one brief per lens, behind the policy key `review-lens-dispatch` (default `task`).

**Architecture:** The key (`plugin/bin/lib/policy-schema.js`) selects the path; the script (`plugin/workflows/review-lens-fanout.js`) only fans briefs out and returns reply texts; `review-coordination.js settle-lens-replies` (#5598, already on main) pairs them. Skill prose (`step3-workflow-dispatch.md`, read only under `workflow`) holds the session's procedure and the five fallback conditions; the Task path is untouched. Tasks 6–8 start real workflows or file a record and are **main-thread** tasks: a dispatched implementer has no Workflow tool (`docs/reference/workflow-tool-probe.md`, rows `init-task-agent`, `agent-nested`).

**Tech Stack:** Node 18+ CommonJS for tests (`node --test`), a plain-JavaScript ES-module-shaped workflow script (no `require`, no imports), Markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T001249-record-5599/work/5599-spec.md` (record #5599). Probe facts: `docs/reference/workflow-tool-probe.md` (CLI 2.1.325 = installed CLI, so no row needs re-running).

Scope keywords: review-lens-dispatch, review-lens-fanout, step3-workflow-dispatch

## Global Constraints

- Policy key `review-lens-dispatch`: enum `task` | `workflow`, default `task`, tier `advanced`, not a Manifesto lever; an invalid value resolves to `task`.
- Script `meta.name` is `review-lens-fanout`; the session starts it as `claude-tweaks:review-lens-fanout`.
- Script `args`: `{ lenses: [{ lens, brief, model, reviewers }] }`, `reviewers` 1 or 2. Return: `{ started: true, lenses: [{ lens, reviewers }], reviewers: [{ lens, side, text, failed }] }` or `{ started: false, reason }`.
- Agent labels are exactly `lens {lens} A` and `lens {lens} B` (read by `plugin/bin/lib/timing/derive.js`'s `ROLE_PATTERNS`).
- The script holds no prompt text, no lens rule, no model name, no severity word, no `CALIBRATION`, no `require(`, no `import`, no `Date.now`, no `Math.random`, no `schema` option.
- `step3-lens-dispatch.md` gains one pointer paragraph of at most 600 bytes and nothing else; `code-mode-steps.md` is unchanged; no Task-path sentence changes.
- `CLAUDE.md` stays ≤ 24,576 bytes and ≤ 150 lines; adding the new site name means cutting at least as many bytes from the same paragraph's parentheticals that restate `subagent-output-contract.md`.
- No permission rule, no `allowed-tools` line, no settings change, no `Workflow` matcher in `plugin/hooks/hooks.json`.
- Fallback `SKIP` line text: `SKIP … Step 3 lens dispatch (workflow fallback): condition: {condition} → fallback: Task lens dispatch. Reversibility: n/a.`, written through `log-decision.js --text-file`.
- Lens 3h is never sent through the script.

## Premises carried from the probe document (logged in decisions.md)

- **Reversed:** a workflow agent's prompt is *not* the brief alone. The harness wraps the script's string in a `[Workflow harness — computed task]` frame, indents every line by two spaces, and in an interactive session first relays the triggering user request (`agent-prompt-frame`). The contract section (Task 3) states this instead of "the agent's whole prompt is the brief".
- The run file `<session>/workflows/<runId>.json` holds the returned value under `result`; no tool-result field names it; it is three directories above the tool result's `transcriptDir`, then `workflows/<runId>.json` (`size-return`). The completion notification's `<output-file>` also holds the whole value.
- The tool result arrives at launch (`status: async_launched`) and carries no returned value; the value arrives in a later `<task-notification>` (`delivery`).
- A workflow agent runs in the session's cwd and permission mode; `SubagentStop` fires for it with `agent_type: workflow-subagent`; in a session with an active claude-tweaks run that hook re-prompts a reply lacking a trailing status line (`agent-cwd`, `agent-permission-mode`, `agent-stop-hook`, `agent-verbatim`). Lens briefs already require the status line.
- A headless `dontAsk` session needs `--allowedTools "Workflow(claude-tweaks:review-lens-fanout)"`, and kills a workflow still running 10 minutes after its last turn unless `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0` (`start-name`, `long-run`, `long-run-nowait`).
- Spec size facts drifted: `step3-lens-dispatch.md` is 48,415 B now (spec said 49,090 before #5595; #5595 freed ~675 B, not ≥ 1,500 B), `CLAUDE.md` 24,376 B / 150 lines, `policy-schema.md` 49,198 B. Rail: 52,500 B.

## Review Focus

1. **Two reviewers of one lens share one brief, so they share its `SCRATCH:` path and lens 3f's scratch-checkout `{id}`.** On the Task path each agent gets its own (`3b-a`, `3b-b`); identical `git worktree add` paths would collide. The sub-file tells the session to write the SCRATCH line as a `mktemp -d` instruction (each reviewer makes its own unique dir) and to use that dir's basename as 3f's `{id}`. Pinned by Task 4's conformance test.
2. **A lens token `settle-lens-replies` refuses** (`3b x`, empty string): the script must refuse it up front, or the run succeeds and the settle call exits 2. Task 2 test `refuses a lens that is not one plain token`.
3. **An agent that returns a non-string** (an object, a number): `failed: true`, `text: null`. Task 2 test `a non-string reply is failed`.
4. **`args` passed as a JSON string** instead of an object (a model mis-calling the tool): `started: false`, never a parse-and-continue. Task 2 test `refuses args given as a string`.
5. **The run file is missing or holds `status: killed`, `result: null`** (a killed or abandoned run): fallback condition 4, never a settle of stale data. Task 4's conformance test pins that the sub-file names the derivation from `transcriptDir` and the absent/`result`-less case.

---

### Task 1: Policy key `review-lens-dispatch`

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js` (one `POLICY_KEYS` row, after `design-ceremony`'s row at line 74, with the comment above it)
- Modify: `plugin/skills/_shared/policy-schema.md` (one table row)
- Modify: `tests/policy-schema.test.js:45-46` (count pin 110 → 111, `// Last bump: 110 -> 111, #5599`; plus the AC1 test)
- Modify: `docs/plugin-structure.md` (only if it lists policy keys by name — grep `design-ceremony` there first; add the key beside it where a key list exists)

**Interfaces:**
- Produces: `resolve-policy.js --values review-lens-dispatch` → `task` (unset, invalid) or `workflow`; `resolve-policy.js --run <dir> --values review-lens-dispatch` honours a run-config value (neither `policyOnly` nor `policySourceExcluded`).

Read `.claude/skills/policy-key-addition/SKILL.md` first; its Sites 1–4 and "Decide who may set it" apply.

- [ ] **Step 1: Write the failing test** in `tests/policy-schema.test.js`: `test('review-lens-dispatch resolves task by default and for an invalid value, workflow when set (#5599)')` — run `plugin/bin/resolve-policy.js --values review-lens-dispatch` in three temp project dirs (no `.claude-tweaks/policy.yml`; `review-lens-dispatch: sideways`; `review-lens-dispatch: workflow`) and assert stdout trimmed is `task`, `task`, `workflow`. Reuse the file's existing temp-project / CLI-run helper if it has one; otherwise `execFileSync(process.execPath, [script, '--values', 'review-lens-dispatch'], { cwd })`. Also bump the count assertion to 111 with the `Last bump` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/policy-schema.test.js`
Expected: FAIL (count is 110, and the key resolves to an empty value)

- [ ] **Step 3: Add the row.** `{ key: 'review-lens-dispatch', type: 'enum', values: ['task', 'workflow'], default: 'task', summary: "…", category: 'pipeline-behavior', tier: 'advanced' }`. The comment above the row says: who may set it (neither flag: Step 3 resolves it with `--run`, so a run config may set it for one review); `Removal condition:` — the `task` value and the key are removed, and `workflow` becomes the only primary path, one minor release after the default flips to `workflow`; the flip is its own record, filed when the parked measurement record (#5599 Deliverable 7) passes; the Task dispatch stays as the fallback for a host without the Workflow tool. Doc row in `policy-schema.md`: starts `` | `review-lens-dispatch` | ``, states `task` for unset and malformed, `workflow` opts `/claude-tweaks:review` Step 3 into `step3-workflow-dispatch.md`, the removal condition in one clause; its summary text must differ from the JS `summary`. Measure `wc -c plugin/skills/_shared/policy-schema.md` after the edit and record the headroom to 52,500 in the commit message (expected ≈ 2,900 B left; no section move needed).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/policy-key-naming.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/skills/_shared/policy-schema.md tests/policy-schema.test.js
git commit -m "Add the review-lens-dispatch policy key — opt-in workflow lens dispatch, default task (#5599)"
```

### Task 2: The workflow script and its stubbed-contract tests

**Review risk:** high

**Files:**
- Create: `plugin/workflows/review-lens-fanout.js`
- Create: `tests/helpers/workflow-script.js`
- Create: `tests/review-lens-fanout-workflow.test.js`
- Modify: `docs/plugin-structure.md` (Structure tree: a `plugin/workflows/` line and a line for the script, beside `plugin/agents/{name}.md`)

**Interfaces:**
- Produces: `loadWorkflowScript(absPath) -> { meta: object, run: ({ agent, parallel, phase, log, args }) => Promise<any> }` in `tests/helpers/workflow-script.js` — reads the file, drops the leading `export` keyword from `export const meta`, and runs the text as the body of an async function whose parameters are the five globals (`Object.getPrototypeOf(async function () {}).constructor`); `meta` is that body's `meta` (return it alongside the script's own return by evaluating the meta literal separately, e.g. a second function over the text up to the end of the `meta` object).
- Produces: the script contract in Global Constraints. Refusal `reason` strings (exact): `args must be an object`, `lenses must be a non-empty array`, `lens must be one plain token of letters, digits, _ or -`, `lens {lens} is named twice`, `lens {lens} has no brief`, `lens {lens} has no model`, `lens {lens} reviewers must be 1 or 2`. `brief` and `model` must be non-blank strings. The lens token rule is `settle-lens-replies`' `LENS_SEGMENT_RE` (`[A-Za-z0-9_-]+`; read `FINDING_LENS_CLASS` in `plugin/bin/lib/coordination.js` and use the same class).
- Consumes: `review-coordination.js settle-lens-replies <file> --ctx-id <id>` (#5598) for the round-trip test.

Read `.claude/skills/bin-source-scan-conformance/SKILL.md` (go-red self-tests for a matcher) and `.claude/skills/windows-checkout-test-parity/SKILL.md` before writing the tests.

- [ ] **Step 1: Write the failing tests** in `tests/review-lens-fanout-workflow.test.js`, all through `loadWorkflowScript` with stubbed globals (`parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)))`, `phase`/`log` no-ops):
  - `meta names review-lens-fanout, a one-line description, and whenToUse naming /claude-tweaks:review and args` — `meta.name === 'review-lens-fanout'`, `!/\n/.test(meta.description)`, `meta.whenToUse` includes `/claude-tweaks:review` and `args`.
  - `two lenses with two reviewers each start four agents with the brief, model and label (AC2)` — lenses `3b` (brief `B3b`, model `sonnet`) and `3a` (brief `B3a`, model `haiku`); record each `agent(prompt, opts)` call; assert 4 calls, `prompt === brief` (strictEqual) for its lens, `opts.model` equals the lens model, `!('schema' in opts)`, labels exactly `{'lens 3b A','lens 3b B','lens 3a A','lens 3a B'}`; the return deep-equals `{ started: true, lenses: [{lens:'3b',reviewers:2},{lens:'3a',reviewers:2}], reviewers: [...] }` with each reviewer `{ lens, side, text: <the stub's reply>, failed: false }`.
  - `one reviewer per lens starts side A only` — `reviewers: 1` → one call, label `lens 3b A`, one `reviewers` entry side `A`.
  - One test per refusal (AC3), each asserting `started: false`, the exact `reason`, and zero `agent` calls: no `args` (`undefined`); `args` a string (`'{"lenses":[]}'`); `lenses: []`; `lenses` missing; a lens named twice; a lens with no `brief`; a lens with a blank `brief`; a lens with no `model`; `reviewers: 3`; `reviewers: 0`; lens `'3b x'`; lens `''`.
  - `null, blank and throwing replies are failed and leave the others alone (AC4)` — lenses `3a`,`3b` (2 each); stub returns `null` for `lens 3a A`, `'   \n'` for `lens 3a B`, throws for `lens 3b A`, a real reply for `lens 3b B`; first three `{ failed: true, text: null }`, the fourth `{ failed: false, text: <reply> }`.
  - `a non-string reply is failed` — stub returns `{ x: 1 }` → `failed: true, text: null`.
  - `the returned value round-trips through settle-lens-replies unchanged (AC5)` — two lenses, each stub reply a real lens reply (`| Severity | Path:Line | Finding | Evidence |` table with one identical row for both sides, then `STATUS: DONE` as the last line); write the script's return bare to a temp file and, separately, wrapped as `{ status: 'completed', result: <return> }` (the run file's shape); run `review-coordination.js settle-lens-replies <file> --ctx-id t5599` for each (via `tests/helpers/run-cli.js` if it fits, else `execFileSync`, with `CLAUDE_CODE_SESSION_ID` set to a test value in env); assert exit 0 and that the parsed stdout has both lenses in `settled`, each with one `confirmed` finding, and `needsSession: []`.
  - `the script holds no prompt text, lens rule, model name or banned API (AC6)` — one function `bannedTokens(text) -> string[]` scanning the script's raw text for: each severity word as a quoted string literal (`/['"`](critical|high|medium|low|info)['"`]/i`), `CALIBRATION`, `\b(haiku|sonnet|opus|fable)\b` (case-insensitive), `require(`, `/^\s*import\s/m`, `Date.now`, `Math.random`, `/\bschema\s*:/`. Assert `bannedTokens(scriptText)` is `[]`.
  - `the banned-token scan goes red on each token it names` — for each of the nine patterns, append a line containing an offending sample (`const s = 'high'`, `// CALIBRATION`, `model: 'sonnet'`, `require('fs')`, `import fs from 'fs'`, `Date.now()`, `Math.random()`, `{ schema: {} }`) to the script text and assert `bannedTokens` of the result is non-empty — the same function the positive test calls.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/review-lens-fanout-workflow.test.js`
Expected: FAIL (cannot find `plugin/workflows/review-lens-fanout.js` / `tests/helpers/workflow-script.js`)

- [ ] **Step 3: Write `tests/helpers/workflow-script.js` and `plugin/workflows/review-lens-fanout.js`.** The script opens `export const meta = { name: 'review-lens-fanout', description: '<one line>', whenToUse: 'Started only by /claude-tweaks:review Step 3 with args {lenses: [{lens, brief, model, reviewers}]}; never by hand.', phases: [{ title: 'Lens reviewers' }] }` (a pure literal). Then a header comment that states: the contract above; that every `agent` call is wrapped on its own; that the stubbed tests in `tests/review-lens-fanout-workflow.test.js` cover the script's contract only and the two real runs quoted in PR #5819 (AC13) are the only evidence about the real tool. Body: validate `args` in the order of the reason list, before any `agent` call; `phase('Lens reviewers')`; build one thunk per (lens, side) in `lenses` order, sides `A` then `B`; one `parallel(...)` over all thunks; each thunk `try { const text = await agent(brief, { label, model, phase: 'Lens reviewers' }); return typeof text === 'string' && text.trim() !== '' ? { lens, side, text, failed: false } : { lens, side, text: null, failed: true } } catch { return { lens, side, text: null, failed: true } }`; map a `null` slot from `parallel` to `failed: true` as well; return `{ started: true, lenses: <echo>, reviewers }`. The reply text is returned unmodified (no trim). No comment may contain a banned token (the scan reads comments too).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/review-lens-fanout-workflow.test.js tests/payload-boundary.test.js`
Expected: PASS

- [ ] **Step 5: Run the suites that walk plugin JS** — `git grep -l -E "readdirSync|walk" -- tests | xargs git grep -l -E "'plugin'|PLUGIN_ROOT|pluginRoot"` lists them; run each with `node --test` and confirm none chokes on the new ES-module-shaped `.js` file (an `export` line under `plugin/` that some scan `require`s or `node --check`s as CommonJS). A failure there is fixed in the scanning suite only if the suite's intent is plugin/bin code; otherwise report it.
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/workflows/review-lens-fanout.js tests/helpers/workflow-script.js tests/review-lens-fanout-workflow.test.js docs/plugin-structure.md
git commit -m "Add the review-lens-fanout workflow script — one brief per lens, both reviewers, replies returned for settle-lens-replies (#5599)"
```

### Task 3: The Subagent Contract under a workflow

**Files:**
- Modify: `plugin/skills/_shared/subagent-output-contract.md` (new section `## Workflow-dispatched agents`, placed after `## Exemption: third-party agents` and before `## Re-prompt on violation`)
- Modify: `CLAUDE.md:100` (the Subagent Contract paragraph's `/review` entry)
- Modify: `tests/subagent-contract-clauses.test.js`

**Interfaces:**
- Produces: the section heading text `## Workflow-dispatched agents` and its seven row labels, exactly: `Input discipline`, `Status line`, `Output template`, `Model profile`, `Working-directory, read-only, foreground and shell rules`, `Re-prompt on violation`, `Failed, empty or unparseable`.

Read `.claude/skills/shared-contract-extraction/SKILL.md` and `.claude/skills/skill-prose-conformance-tests/SKILL.md` first.

- [ ] **Step 1: Write the failing tests** in `tests/subagent-contract-clauses.test.js`: one function `assertWorkflowSection(text)` that finds the section with the file's existing `sectionRegion(text, '## Workflow-dispatched agents')`, asserts it is non-empty, and asserts each of the seven row labels appears as a table row's first cell (`/^\| {label} \|/m`), and that the section names `plugin/workflows/review-lens-fanout.js` and the harness frame (`computed task`). Tests: `the contract states how each rule is kept under a workflow (#5599)` calls it on the live file; `the workflow section check fails when a row is removed` removes each row line in turn from the live text and asserts `assertWorkflowSection` throws (the same function). Plus `CLAUDE.md names the workflow lens dispatch site (#5599)`: the paragraph starting `Skills that dispatch parallel Task agents` contains `review-lens-fanout`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/subagent-contract-clauses.test.js`
Expected: FAIL (section missing; CLAUDE.md lacks `review-lens-fanout`)

- [ ] **Step 3: Write the section.** One intro sentence (a `/claude-tweaks:review` lens fan-out may run through `plugin/workflows/review-lens-fanout.js` when `review-lens-dispatch` resolves `workflow`; the Task dispatch stays the fallback), then the spec's Deliverable 5 table verbatim, except two rows the spec's `## Plan Review Clarifications` rewrites. The `Re-prompt on violation` row reads: the session cannot re-prompt a workflow agent; inside a claude-tweaks run the plugin's own `SubagentStop` hook re-prompts one whose reply has no status line (`agent-verbatim`, `init-interactive`); a reply with a misplaced status line is used and `settle-lens-replies` lists it under `violations`, which the session names in the review summary; a reply with no status line, or one that does not parse, is not used and that reviewer is dispatched again once through the Task path. The `Input discipline` row reads: the brief is the only text the script passes, and both reviewers of a lens get one string, so "byte-identical prompts" is a property of the script; the harness wraps that string in a `[Workflow harness — computed task]` frame, indents every line, and in an interactive session first relays the request that started the run (`docs/reference/workflow-tool-probe.md`, `agent-prompt-frame`), so the brief must not rely on column-zero lines. Then one sentence: a gate rule written for `Agent` and `Task` calls (the PreToolUse dispatch-prompt gate) does not see a workflow agent's prompt; the plugin's PreToolUse hook does fire for a workflow agent's own tool calls. Then `CLAUDE.md`: change `/review` in the roster to `/review` (plus its opt-in `plugin/workflows/review-lens-fanout.js` path)` — ≤ 60 bytes added — and cut at least as many bytes from the same paragraph's parentheticals that restate `subagent-output-contract.md` (candidate: `— resolved per the contract's Model Selection section`). Before cutting, `git grep -n -F '<the cut text>' -- tests plugin docs` and keep the cut only if no test pins it; name the cut in the commit message.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/subagent-contract-clauses.test.js tests/claude-md-budget.test.js`
Then: `wc -c CLAUDE.md && wc -l CLAUDE.md` — Expected: ≤ 24,576 and ≤ 150
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/subagent-output-contract.md CLAUDE.md tests/subagent-contract-clauses.test.js
git commit -m "State the Subagent Contract under a workflow, name the lens workflow dispatch site (#5599)"
```

### Task 4: Step 3 prose — the workflow sub-file and the pointer

**Review risk:** high

**Files:**
- Create: `plugin/skills/review/step3-workflow-dispatch.md`
- Modify: `plugin/skills/review/step3-lens-dispatch.md` (one new blockquote paragraph inserted immediately after the `> **Model profile (per lens):**` paragraph, line 111; nothing else)
- Create: `tests/review-lens-workflow-dispatch-conformance.test.js`
- Modify: `docs/plugin-structure.md` (the review skill's sub-file table: one row for `step3-workflow-dispatch.md`, in the shape `rowWithContinuations` reads)

**Interfaces:**
- Consumes: Task 1's key; Task 2's script name and `args`/return shape; `settle-lens-replies` (#5598): `{settled, needsSession: [{lens, reason: 'single-reviewer'|'reviewer-unusable', reviewers: [{side, state, statusWord, text?, findingsPath?}]}], violations, overflow, skipped}`, exit 2 on unreadable input.
- Produces: the pointer anchor `**Workflow dispatch (opt-in, #5599).**` and the sub-file's five fallback condition labels, exactly: `no Workflow tool`, `refused or failed before a reviewer starts`, `started: false`, `ended with no result`, `result unreadable`.

Read `.claude/skills/skill-prose-conformance-tests/SKILL.md` first. Byte headroom: `step3-lens-dispatch.md` 48,415 + ≤ 600 → ≥ 3,485 B under the rail.

- [ ] **Step 1: Write the failing test** `tests/review-lens-workflow-dispatch-conformance.test.js`, with `checkPointer(text)` and `checkSubFile(text)` functions each positive test and its go-red control share:
  - `checkPointer(lensDispatchText)`: finds the paragraph starting `> **Workflow dispatch (opt-in, #5599).**` (to the next blank line), asserts it exists, `Buffer.byteLength(paragraph) <= 600`, it names `claude-tweaks:review-lens-fanout`, `step3-workflow-dispatch.md`, `review-lens-dispatch`, and the word `workflow` in a "read … only when … resolves `workflow`" sentence (`/only when[^.]*`workflow`/`).
  - `checkSubFile(subText)`: each of the five condition labels appears; the `SKIP` line text `Step 3 lens dispatch (workflow fallback): condition:` and `→ fallback: Task lens dispatch. Reversibility: n/a.` appear; `log-decision.js` with `--text-file` appears; `settle-lens-replies` with `--only confirmed` and `--only unconfirmed` appear, `--only confirmed` first; `needsSession`, `single-reviewer` and `reviewer-unusable` appear; `30 minutes` appears; `partner-died` appears; `transcriptDir` and `workflows/{runId}.json` appear (Review Focus 5); `mktemp -d` appears (Review Focus 1); `3h` appears with `never` in the same sentence.
  - Positive tests call both on the live files; go-red controls remove, one at a time, the pointer paragraph, each condition label, and the SKIP line from the live text and assert the matching check throws.
  - `the Task path is unchanged around the pointer (AC8)`: `step3-lens-dispatch.md` with the pointer paragraph removed equals `git show origin/main:plugin/skills/review/step3-lens-dispatch.md` is **not** a committed test (it breaks after merge) — instead this is Step 5's verification command.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-lens-workflow-dispatch-conformance.test.js`
Expected: FAIL (no pointer paragraph; sub-file missing)

- [ ] **Step 3: Write the pointer and the sub-file.** Pointer (≤ 600 B): resolve `review-lens-dispatch` once with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values review-lens-dispatch` (add `--run "$PIPELINE_RUN_DIR"` when a run directory exists); when it prints `workflow`, read `step3-workflow-dispatch.md` in this skill's directory and dispatch the agent lenses through the workflow `claude-tweaks:review-lens-fanout` as it says; read it only when the key resolves `workflow`; otherwise this file's Task dispatch applies unchanged. Sub-file sections, in order:
  1. **When this applies** — key resolved `workflow`; lens 3h is never sent through the script (one agent, its own procedure, `ux-analysis.md`); used at any diff size.
  2. **Availability** — the session has the tool when `Workflow` is among its tools or `ToolSearch` `select:Workflow` returns it; a continuation agent, a dispatched reviewer and a pipeline-driver worker do not, and take the fallback. A review resumed in a new session never resumes a workflow run: it treats the run as ended with no result.
  3. **Compose** — each in-scope lens's brief exactly as `step3-lens-dispatch.md` composes a Task brief (scope lines, `SHELL DISCIPLINE:`, `READ-ONLY REVIEW:`, `Path:Line` rules, byte-identical Calibration/Output block, the `effortLine` at `xhigh`/`max` per `step3-tier-variants.md`), with one difference: both reviewers get one string, so the `SCRATCH:` line tells the agent to make its own directory with one plain `mktemp -d {ctx-dir}/agent-scratch/{lens}-XXXXXX` call and use it as its scratch path, and lens 3f's scratch-checkout `{id}` is that directory's basename. `model` per lens: `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" {fast|standard}` → its `model` field (3a, 3f fast; 3b–3e, 3g standard). `reviewers`: 2 at `medium`+, 1 at `low`.
  4. **Start** — one `Workflow` call, `name: claude-tweaks:review-lens-fanout`, `args: { lenses: [...] }` as an object. The tool result arrives at launch with `transcriptDir` and `runId`; wait for the completion notification, never poll, for at most 30 minutes; at 30 minutes with no notification, read the run file once — `status: completed` with a `result` is settled, anything else is condition `ended with no result`, and a result arriving later is never read. The run file is three directories above `transcriptDir`, then `workflows/{runId}.json`; pass that path, never retype a reply, and never read another run's file.
  5. **Fallback** — the five conditions, each with what the session observes (spec Deliverable 4, verbatim in substance): `no Workflow tool`; `refused or failed before a reviewer starts` (an error or permission denial as the call's result); `started: false` (the run file's `result.started`); `ended with no result` (no error, but the run file is absent or holds no `result`, e.g. `status: killed`); `result unreadable` (`settle-lens-replies` exits 2). On any: write the `SKIP` line through a `--text-file` written with `Write`: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/review" --status SKIP --step "Step 3 lens dispatch (workflow fallback)" --text-file {file} --reversibility n/a`, the file holding `condition: {label}{: tool message when there is one} → fallback: Task lens dispatch`; the sub-file also quotes the resulting line in full as Deliverable 4 gives it, `SKIP … Step 3 lens dispatch (workflow fallback): condition: {condition} → fallback: Task lens dispatch. Reversibility: n/a.`; then run every lens through `step3-lens-dispatch.md`'s Task dispatch. Standalone (no run dir): the same sentence in the review report. Once the fallback is taken, a result that arrives later is never read. In the last two conditions reviewers may already have run, so that review pays twice. With the key at `task` no line is written.
  6. **Settle** — `node "${CLAUDE_PLUGIN_ROOT}/bin/review-coordination.js" settle-lens-replies "{run-file}" --ctx-id "{ctx-id}" --run "$PIPELINE_RUN_DIR" --only confirmed`; then the absence-claim ground-truth check, the lens 3f vacuity check, and at `medium` the cross-lens corroboration pass, exactly as `step3-lens-dispatch.md` orders them for the Task path (#5595's order); then the same call with `--only unconfirmed` (adding `--hold` as the Task path does). Standalone: drop `--run`/`--only`/`--hold`. Name every `violations` entry in the review summary.
  7. **needsSession** — `single-reviewer`: apply `step3-tier-variants.md`'s single-read rule to the `findingsPath` the verb wrote; nothing is dispatched again and no `SKIP` line is written. `reviewer-unusable`: dispatch only the unusable reviewers again through the Task path, once, log one `SKIP` line (same command shape) naming them — `condition: reviewer-unusable {lens}/{side}[, …] → fallback: Task dispatch of those reviewers` — then run the per-pair steps (`categorise-reproduction`) with the usable reviewer's `findingsPath` and the new reviewer's findings file. When both sides are unusable, both are dispatched again as one Task pair and paired with `categorise-reproduction`. When that Task re-dispatch itself fails (a session limit, no `Agent` tool, a timeout), `step3-tier-variants.md`'s partner-died single-read rule applies to the lens. A reply with no status line or one that does not parse is unusable this way; a misplaced status line is used and listed under `violations`.
  8. **Then** continue Step 3 where the Task path is after pairing: the post-fan-out untracked-file sweep, and Steps 3.5 to 3.7.

- [ ] **Step 4: Run tests to verify they pass, and that no existing Step 3 test needed an edit (AC10)**

Run: `node --test tests/review-lens-workflow-dispatch-conformance.test.js` then `git grep -l -E "step3-lens-dispatch|step3-tier-variants" -- tests | xargs node --test`
Expected: PASS, with `git diff origin/main --stat -- tests` listing no file from that grep

- [ ] **Step 5: Verify AC8 and the auth proof**

Run: `git diff origin/main -- plugin/skills/review/step3-lens-dispatch.md plugin/skills/review/code-mode-steps.md plugin/skills/review/step3-tier-variants.md`
Expected: only added lines, all inside the one pointer paragraph; `code-mode-steps.md` and `step3-tier-variants.md` show no diff.

Proof(auth): this change grants nothing — `git diff origin/main --stat -- .claude/settings.json .claude/settings.local.json plugin/hooks/hooks.json` prints nothing and `git diff origin/main -- 'plugin/**/*.md' | grep -n 'allowed-tools'` prints nothing; no permission rule is added, and a session whose `Workflow` call is refused takes fallback condition `refused or failed before a reviewer starts` (sub-file section 5).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/review/step3-workflow-dispatch.md plugin/skills/review/step3-lens-dispatch.md tests/review-lens-workflow-dispatch-conformance.test.js docs/plugin-structure.md
git commit -m "Add review Step 3's opt-in workflow lens dispatch and its five fallbacks (#5599)"
```

### Task 5 (main-thread): Real-tool runs (AC13)

**Files:** none committed. Scratch under the session scratchpad. Output quoted into PR #5819's body.

**Interfaces:**
- Consumes: Task 2's script, Task 1's key (not needed for a direct start).

A dispatched implementer has no Workflow tool, so the controller runs this task. If the child session cannot start a workflow, stop with NEEDS_CONTEXT.

- [ ] **Step 1: One-lens run.** Launch a headless child exactly as `docs/reference/workflow-tool-probe.md`'s "The launcher" section does (remove the same eight `CLAUDE*` env vars; empty scratch cwd; `--output-format stream-json --verbose`), with `--plugin-dir <worktree>/plugin --model haiku --allowedTools "Workflow(claude-tweaks:review-lens-fanout)"`, prompt: call the `Workflow` tool with name `claude-tweaks:review-lens-fanout` and args `{ "lenses": [{ "lens": "3a", "brief": "Reply with exactly: No findings.\nSTATUS: DONE", "model": "haiku", "reviewers": 2 }] }` as an object; when it completes, print the returned value verbatim.
Expected: the `init` event's `skills` lists `claude-tweaks:review-lens-fanout`; the returned value has `started: true` and two `reviewers` entries.

- [ ] **Step 2: Seven-lens run.** Same launch plus `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0`; args seven lenses (`3a`–`3g`), `reviewers: 2`, `model: haiku`, each brief exactly 8,773 bytes: fixed filler text (`Context line {n}: this paragraph is filler for a size probe and asks for no action.` repeated) ending in the real Calibration + OUTPUT FORMAT block from `step3-lens-dispatch.md`, preceded by a one-line task (`There is no diff to review; reply per the output format below.`).
Expected: `started: true`, 14 reviewers returned; record the saved run file's size (`wc -c <session>/workflows/<runId>.json`).

- [ ] **Step 3: Record** the `started` values, reviewer counts, the run file size and the child's `init` `skills` line in the ledger as `ops` rows (fixed) for the PR body.

### Task 6 (main-thread): Replay at build (Deliverable 6, AC11)

**Files:** scratch harness under the session scratchpad (not committed). PR body gets the table and the diff of one rewritten brief.

- [ ] **Step 1: Select.** `node tools/review-replay.js baseline --runs "<main checkout>/.claude-tweaks/pipelines"` → pick ≥ 5 archived reviews at `medium`+ with ≥ 30 lens pairs in total whose `lensAgents` transcripts exist (`agent-{id}.jsonl` under the account's `projects/*/` directories) and whose reviewed head is fetchable. Record the selection.
- [ ] **Step 2: Archive side.** For each selected review and lens pair: the confirmed count is `categoriseReproduction` (from `plugin/bin/lib/coordination.js`) over the two archived reviewers' findings, parsed from each transcript's last assistant text by `plugin/bin/lib/lens-reply.js`'s `parseLensReply`. Tokens per reviewer from the archived transcripts, de-duplicated by `message.id` (one usage per turn).
- [ ] **Step 3: Rewrite briefs.** Each lens's brief = side A's archived transcript's first user row. Rewrite only its dead paths: the context bundle → a bundle rebuilt with `build-review-context.js build --base {base} --branch {head}` in a scratch `git worktree add --detach` checkout of the reviewed head; the worktree path → that checkout; the `SCRATCH:` line and lens 3f's scratch-checkout `{id}` → the same `mktemp -d` instruction the sub-file composes (spec `## Plan Review Clarifications`, third line). Keep one before/after pair for the PR diff.
- [ ] **Step 4: Run.** Three runs of the script with the rewritten briefs as `args` (`reviewers: 2`, each lens's archived `model`), started from this session with `Workflow({ scriptPath: <worktree>/plugin/workflows/review-lens-fanout.js, args })`. For each run, `settle-lens-replies <run file> --ctx-id replay-{n}` (no `--run`) → confirmed count per lens pair; tokens per reviewer from the run's `agent-*.jsonl`, de-duplicated by `message.id`.
- [ ] **Step 5: Gate.** Allowance = max(spread of the three runs' totals, 10% of the archive total). If the first workflow run's confirmed total is below the archive's by more than the allowance, stop and report the three numbers for a human decision (the build does not continue). Otherwise write the PR table: per review, archive confirmed, workflow run confirmed, the two rerun controls, tokens per reviewer (workflow vs archive).

### Task 7 (main-thread): The parked measurement record (Deliverable 7, AC12)

- [ ] **Step 1:** File via `/claude-tweaks:capture` a record labelled `parked`, spec-shaped body (Current State / Deliverables / Acceptance Criteria), `Defer-reason:` from `_shared/deferral-gate.md` (`awaiting-evidence` or the closest vocabulary entry), carrying every item of spec Deliverable 7 and the pass rule of Deliverable 8: the opt-in step; the two samples (≥ 20 workflow reviews with no fallback line, ≥ 20 Task reviews, same period, `medium`+, top-level sessions only); confirmed findings per lens pair and main-session tokens per lens pair from `step-yield.json`; total tokens per lens pair from `timing.json`'s `dispatches`; the fallback share by condition (dispatched/continuation reviews counted only there, said plainly if they are most reviews); medians with ranges and the replay's rerun spread; the 30-day under-20 rule; the two outcomes. Key Files: `plugin/bin/lib/policy-schema.js`, `.claude-tweaks/policy.yml`.
- [ ] **Step 2:** Link it from PR #5819's body.

## Self-review notes

- Spec coverage: D1 → Task 1; D2 → Task 2; D3/D4 → Task 4; D5 → Task 3; D6 → Task 6; D7 → Task 7; D8 → Task 1 (comment + doc row), Task 2/4 (plugin-structure entries); AC13 → Task 5; AC14 → `/claude-tweaks:build` Common Step 5 (full suite).
- Behavioral claims with their mechanism: run-file location and async delivery — probe rows `size-return`, `delivery`; settle accepting `result`-wrapped input — `settleInputProblem` in `plugin/bin/review-coordination.js:446-451`.
- Blocking-verification-downgrade check: AC13 and the replay touch the real tool; neither is downgraded to a doc read. If either cannot run, the build stops (NEEDS_CONTEXT / human decision), it does not substitute a citation.
