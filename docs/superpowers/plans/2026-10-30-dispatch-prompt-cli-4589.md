# Dispatch Prompt CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `/dispatch`'s Task prompts (first call, second call, handoff continuation) with one CLI call that reads `task-prompt.md` as its only template source, so no placeholder is ever substituted by hand.

**Architecture:** A pure lib module (`plugin/bin/lib/dispatch/task-prompt.js`) extracts the two fenced templates and the Context pack numbered list from `task-prompt.md`'s text and substitutes a closed set of dispatcher placeholders, failing loud on any left over. A thin CLI (`plugin/bin/dispatch-prompt.js`, `run(argv, deps)` seam) resolves the values (plugin root, policy values via `resolve-policy.js`, model profile via `resolve-profile.js`, `Selected at`) and prints the prompt or writes it to `--out` with a JSON envelope. `SKILL.md` Step 5 and `task-prompt.md` point the dispatching session at the CLI.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T101632-record-4589/work/4589-spec.md` (record #4589)

Scope keywords: {context-pack}, Context pack

**Scope sweep (Check B hits outside the Files lists, each read and ruled):** `plugin/skills/dispatch/express-prompt.md` and `plugin/skills/flow/multispec-parallel-waves.md` substitute their own templates' `{context-pack}` from `task-prompt.md`'s Context pack by hand — the same drift class, but outside #4589's Deliverables (task-prompt.md's two templates); filed as a follow-up via `/claude-tweaks:capture` in Common Step 4, not folded in. `multispec-parallel-waves.md` copies items 1, 6, 7 verbatim — none of which this plan edits. `plugin/skills/_shared/subagent-output-contract.md` cites the Context pack as the reference bundle-citation shape — unchanged. `docs/journeys/clear-the-two-call-gate-for-a-dispatched-group-2775.md`, `docs/journeys/compose-a-per-run-context-bundle-1988.md` describe the CLI table row and item 5 / the `--phase` lines — all unchanged (Common Step 6 owns journey updates). `CHANGELOG.md` is release-please's history — never hand-edited. The tests among the hits are listed in Task 3's Files and run in its Step 4.

## Global Constraints

- The fenced blocks in `plugin/skills/dispatch/task-prompt.md` stay the single source the CLI reads (spec Deliverable 2); `task-prompt.md` keeps exactly two ``` fenced blocks (pinned by `tests/foreground-execution-instruction.test.js`, `tests/dispatch-handoff-continuation-conformance.test.js`).
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Merge-base sizes: `plugin/skills/dispatch/SKILL.md` 50,928 B (1,572 B headroom), `plugin/skills/dispatch/task-prompt.md` 49,154 B (3,346 B headroom). SKILL.md's Step 5 edit must be net ≤ +300 B; task-prompt.md's edits net ≤ +800 B. Measure with `wc -c` after each edit.
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md`, quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract" and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." and "A run-directory argument gets one of four boundary guards; pick before writing the check." — this CLI takes shape **(4)**, the composer's: `plugin/bin/lib/run-dir-guard.js`'s `anchoredOrOutsideMessage`, refused with exit **2**, exactly as `plugin/bin/compose-context.js` does (its callers' documented fallback is on any non-zero exit).
- Exit codes (mirroring `compose-context.js`'s header): 0 rendered; 1 failure (template unreadable or unparseable, a resolver subprocess failed, a placeholder left unsubstituted, `--out` unwritable); 2 malformed invocation or a refused `--run`. On exit 1/2 nothing is written to `--out`.
- Source-scan suites over `plugin/bin/`: no `fs.existsSync` / `fs.realpathSync` tokens (`tests/path-guard-conformance.test.js`) — use `fs.statSync`/`fs.readFileSync` inside try/catch; every `execFileSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); flags looked up with `Object.hasOwn`.
- Substitution uses `split(token).join(value)`, never `String.prototype.replace` with a string replacement (a run-dir path containing `$&` or `$'` would be rewritten).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4589` — never `closes`/`fixes`.

## Review Focus

- A run-dir path containing spaces or `$` sequences (`Code Workspaces`, `$&`) must appear byte-for-byte in the prompt — Task 1 test `renders a $& path literally`.
- A bundle (`--issues 4589,4590`) must fill the bundle invocation line (`"#4589,#4590"`) and leave the singleton line's `#{issue}` pattern for the agent; a singleton the reverse — Task 1 tests `singleton` / `bundle`.
- A continuation (`--next-steps test` on the first call) replaces both invocation step lists and keeps "Stop after the test gate" verbatim — Task 1 test `continuation`.
- `--headless` on a second call is a malformed invocation (the marker belongs to the first call only, `task-prompt.md`'s "Before substituting this template" paragraph) — Task 2 test.
- A refused `--run` (missing dir, worktree-local shadow) or a failing resolver writes nothing to `--out` — Task 2 tests.

---

### Task 1: Pure renderer `plugin/bin/lib/dispatch/task-prompt.js`

**Files:**
- Create: `plugin/bin/lib/dispatch/task-prompt.js`
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 3 only: add the `{policy-values}` placeholder)
- Test: `tests/bin-lib/dispatch/task-prompt.test.js`

**Interfaces:**
- Produces:
  - `DISPATCHER_PLACEHOLDERS` — frozen array, exactly: `'{issue list}'`, `'{comma-joined issue numbers}'`, `'{minted-run-dir}'`, `'{run-id}'`, `'{plugin-root}'`, `'{context-pack}'`, `'{policy-values}'`, `'{ISO}'`. (`{issue}`, `{n1}`, `{n2}` are deliberately excluded: the non-applicable invocation line keeps them as the agent-facing pattern. Every other `{…}` token — `{WORD}`, `{n}`, `{gate}`, `{text-file}`… — is agent-facing.)
  - `extractTemplates(text: string) => { first: string, second: string }` — the first ``` fenced block after the `## First call` heading and after the `## Second call` heading (fence lines excluded, inner text joined with `\n`, no trailing newline). Throws `Error('task-prompt.md: …')` naming the missing heading or fence.
  - `extractContextPack(text: string) => string` — within the `## Context pack` section, the lines from the first `/^1\. /` line up to (excluding) the line starting `Substitute this whole block`, trailing blank lines trimmed. (Same region `tests/dispatch-prompt-bundle-citations.test.js`'s `contextPackNumberedRegion` governs as "substituted verbatim".) Throws when either anchor is missing.
  - `profileOf(template: string) => string` — lowercased `X` of the template's single `[Use: X]`; throws unless exactly one.
  - `findUnsubstituted(prompt: string) => string[]` — the `DISPATCHER_PLACEHOLDERS` entries still present, in list order.
  - `renderTaskPrompt(text: string, opts) => string` — `opts`: `{ call: 'first'|'second', issues: number[], runDir: string, pluginRoot: string, policyValues: string, selectedAt: string, headless?: boolean, nextSteps?: string[]|null, effortLine?: string|null }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/task-prompt.test.js`, reading the live file via `tests/helpers/read-skill`'s `readText(path.join(__dirname,'..','..','..','plugin','skills','dispatch','task-prompt.md'))`. Shared fixture `OPTS = { call:'first', issues:[4589], runDir:'/tmp/x y/.claude-tweaks/pipelines/2026-10-30T101632-record-4589', pluginRoot:'/p/root', policyValues:'autonomy=unattended, integration-model=pr-first', selectedAt:'2026-10-30T09:03:42.695Z', effortLine:'[Effort: high — apply high-level reasoning depth to this task.]' }`:
  - `AC1.1: the live first and second templates render with no dispatcher placeholder left` — for `call` first and second: `findUnsubstituted(out)` deep-equals `[]`; `out` includes `OPTS.runDir`, `'/p/root/bin/verify-run-bookends.js'`, `'Selected at: 2026-10-30T09:03:42.695Z'`, `'autonomy=unattended, integration-model=pr-first'`, `'2026-10-30T101632-record-4589'` (the `{run-id}` in item 4's table), and ends with `OPTS.effortLine`.
  - `Deliverable 3: the rendered prompt contains every fixed line of its template and of the Context pack` — for each line of `extractTemplates(text)[call]` and of `extractContextPack(text)` that contains no `DISPATCHER_PLACEHOLDERS` entry and no `{issue}`/`{n1}`: `out.includes(line)`.
  - `singleton fills #{issue} only` — `out` includes `` /claude-tweaks:flow #4589 build,test auto` `` and still includes `"#{n1},#{n2},..."`.
  - `bundle fills the bundle line only` — `issues:[4589,4590]`: `out` includes `"#4589,#4590" build,test auto` and `GROUP: 4589,4590`, and still includes `#{issue}`.
  - `continuation replaces both step lists and keeps the stop sentence` — `nextSteps:['test']`: `out.split('build,test auto').length === 1`, `out.split('test auto').length - 1 === 2`, `out.includes('Stop after the test gate -- do not proceed to review, polish, or wrap-up;')`; second call with `nextSteps:['polish','wrap-up']`: `out.split('polish,wrap-up auto').length - 1 === 2` and no `review,polish,wrap-up auto`.
  - `headless inserts the marker on both first-call invocation lines` — `headless:true`: `out.split('" DISPATCH_HEADLESS=1 /claude-tweaks:flow').length - 1 === 2`; `call:'second', headless:true` throws `/first call only/`.
  - `renders a $& path literally` — `runDir:'/tmp/a$&b/.claude-tweaks/pipelines/r1'`: `out.includes('/tmp/a$&b/.claude-tweaks/pipelines/r1')`.
  - `AC3.1: an unsubstituted placeholder fails the render` — `selectedAt: undefined` throws `/unsubstituted.*\{ISO\}/`; and `findUnsubstituted('x {minted-run-dir} y')` deep-equals `['{minted-run-dir}']` (go-red control for the detector).
  - `AC2.1: editing a sentence in a fenced block changes the output with no code change` — `doctored = text.replace('Never run \`git stash\` or \`git stash pop\`', 'Never run EDITED-SENTENCE')` (assert `doctored !== text` first); rendering `doctored` includes `'Never run EDITED-SENTENCE'` and rendering `text` does not.
  - `a template that lost a value placeholder fails loud` — `text.replace('{policy-values}', 'none')` throws `/\{policy-values\}/` (the renderer asserts each of `{policy-values}`, `{ISO}`, `{context-pack}` occurs before substituting, so a dropped value never vanishes silently).
  - `profileOf reads each template's [Use:] line` — `'capable'` for first, `'standard'` for second; a string with no `[Use:` throws.
  - `structure drift throws` — `extractTemplates(text.replace('## Second call', '## Gone'))` throws `/Second call/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/dispatch/task-prompt'`

- [ ] **Step 3: Edit `task-prompt.md` item 3, then implement `plugin/bin/lib/dispatch/task-prompt.js`**

Item 3: change `3. **Resolved policy values** — one call, before either dispatch:` to `3. **Resolved policy values** — `{policy-values}`, from one call before either dispatch:` (rest of the item unchanged); `wc -c plugin/skills/dispatch/task-prompt.md` ≤ 49,200.

`renderTaskPrompt` order: (1) template = `extractTemplates(text)[call]`; (2) `nextSteps` → replace the call's step-list token followed by ` auto` (`build,test auto` / `review,polish,wrap-up auto`) with `${nextSteps.join(',')} auto`, requiring exactly 2 hits; (3) `headless` → first call only (else `throw new Error('--headless applies to the first call only')`), replace `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow` with `PIPELINE_RUN_DIR="{minted-run-dir}" DISPATCH_HEADLESS=1 /claude-tweaks:flow`, requiring 2 hits; (4) targets: one issue → `#{issue}` → `#N`; two or more → `"#{n1},#{n2},..."` → `"#a,#b"` — require ≥ 1 hit; (5) the `{context-pack}` line → the Context pack region; (6) assert `{policy-values}` and `{ISO}` occur, then substitute every `DISPATCHER_PLACEHOLDERS` entry with split/join (`{issue list}` → `issues.join(', ')`, `{comma-joined issue numbers}` → `issues.join(',')`, `{run-id}` → `path.basename(runDir)`, `{ISO}` → `selectedAt`, a `undefined`/`null` value is skipped so step 7 reports it); (7) `findUnsubstituted` non-empty → `throw new Error('unsubstituted placeholder(s): …')`; (8) append `\n\n${effortLine}` when given. Header comment names #4589, the source file, and the closed placeholder set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js tests/dispatch-prompt-bundle-citations.test.js tests/claim-mcp-projection-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/task-prompt.js tests/bin-lib/dispatch/task-prompt.test.js plugin/skills/dispatch/task-prompt.md
git commit -m "Add dispatch task-prompt renderer — fills task-prompt.md's templates from a closed placeholder set, refs #4589"
```

### Task 2: CLI `plugin/bin/dispatch-prompt.js`

**Files:**
- Create: `plugin/bin/dispatch-prompt.js`
- Test: `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `renderTaskPrompt`, `extractTemplates`, `profileOf`; `FIRST_CALL_STEPS`/`SECOND_CALL_STEPS` from `plugin/bin/lib/dispatch/first-call-artifact-check.js`; `anchoredOrOutsideMessage` from `plugin/bin/lib/run-dir-guard.js`; `sessionTmpRoot` from `plugin/bin/lib/session-tmp.js`.
- Produces: `run(argv: string[], deps) => 0|1|2`, `parseArgs(argv)`. Usage: `dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M...] [--next-steps s1,s2] [--headless] [--selected-at <ISO|unknown>] [--out <file>] [--help]`. `deps`: `{ cwd(), isDirectory(p), anchoredOrOutsideMessage, readFile(p), writeFile(p, s), resolvePolicyValues(cwd) => string /* 'k=v, …' */, resolveProfile(name, { unattended, cwd }) => {model, effort, source, effortLine}, selectedAt() => string, stdout(s), stderr(s) }`. Envelope with `--out` (one stdout JSON line): `{ out, bytes, call, issues, continuation: boolean, profile: { name, model, effort, source }, selectedAt }`. Without `--out`: the prompt on stdout, nothing else.

- [ ] **Step 1: Write the failing tests** (fake `deps`; a real `fs.mkdtempSync(os.tmpdir())` run dir, which is outside any checkout and so accepted):
  - `AC1.1: one call renders the first-call prompt to --out and reports the profile` — exit 0; the written file has no `findUnsubstituted` hit; stdout parses to `{ call:'first', issues:[4589], continuation:false, profile:{ name:'capable', model:'opus', … } }`; `resolveProfile` was called with `'capable'`.
  - `second call resolves the standard profile` — `resolveProfile` called with `'standard'`.
  - `--next-steps renders a continuation and validates the steps` — `--call first --next-steps test` exit 0, `continuation:true`; `--next-steps review` on the first call → exit 2; `--next-steps test,test` → exit 2.
  - `--headless passes unattended and is refused on the second call` — first: `resolveProfile` saw `{ unattended: true }`; `--call second --headless` → exit 2, `writeFile` never called.
  - `malformed invocations exit 2` — missing `--call`, `--call third`, `--issues 0`, `--issues 12,abc`, `--issues 5,5`, unknown flag, value-taking flag last in argv, `--selected-at nope`.
  - `a refused --run exits 2 and writes nothing` — a non-existent dir; and `anchoredOrOutsideMessage` faked to return a message → exit 2, `writeFile` never called.
  - `a failing resolver or unreadable template exits 1 and writes nothing` — `resolvePolicyValues` throws → 1; `readFile` throws → 1; `writeFile` throws → 1 with the path on stderr.
  - `AC2.1 at the CLI: an injected template edit reaches the output` — `readFile` returns the live text with one fenced sentence edited; the written prompt carries the edit.
  - `--selected-at overrides the session file` — `--selected-at unknown` → prompt includes `Selected at: unknown` and `deps.selectedAt` not called.
  - `--help exits 0 before any probe` — no deps other than `stdout` called.
  - `real binary smoke` — `execFileSync(process.execPath, [CLI, '--help'], { windowsHide: true })` exits 0 and prints `usage: dispatch-prompt.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/dispatch-prompt'`

- [ ] **Step 3: Implement `plugin/bin/dispatch-prompt.js`**

Header comment: purpose (#4589), usage, the exit-code contract from Global Constraints (citing `compose-context.js`'s shape-4 guard). `PLUGIN_ROOT = path.resolve(__dirname, '..')` is both the template location (`skills/dispatch/task-prompt.md`) and the `{plugin-root}` value. Real deps: `resolvePolicyValues` runs `execFileSync(process.execPath, [path.join(PLUGIN_ROOT,'bin','resolve-policy.js'), '--values', 'autonomy,integration-model,merge-verification,risk-floor,size-floor'], { cwd, encoding:'utf8', windowsHide:true })` and zips the five output lines into `key=value` joined by `', '` (an empty line → `key=(unset)`); `resolveProfile` runs `resolve-profile.js {name}` (+ `--unattended` when set) the same way and `JSON.parse`s stdout; `selectedAt` returns `fs.statSync(path.join(sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID), 'dispatch-groups.json')).mtime.toISOString()` or `'unknown'` on a null root or any throw. Validate `--next-steps` against `FIRST_CALL_STEPS` / `SECOND_CALL_STEPS` by `--call`, rejecting duplicates. Every deps call is wrapped in try/catch → its exit code. `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 4: Run tests to verify they pass, plus the bin source scans**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Live probe** — `node plugin/bin/dispatch-prompt.js --call first --run "<this run's main-checkout run dir>" --issues 4589 --out "<scratchpad>/p.md"` exits 0 and `<scratchpad>/p.md` reads as a complete first-call prompt (check by eye against the template; record the envelope line in the commit body).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/dispatch-prompt.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js
git commit -m "Add dispatch-prompt.js — one CLI call renders each dispatch Task prompt, refs #4589"
```

### Task 3: Point Step 5 and `task-prompt.md` at the CLI; document it

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md:260-262`
- Modify: `plugin/skills/dispatch/task-prompt.md:3`, `:111-113` (model-log paragraph), `:519` (Continuation call section)
- Modify: `docs/plugin-structure.md` (one CLI command line beside `compose-context.js`'s; `task-prompt.js` appended to the `plugin/bin/lib/dispatch/` row; the `dispatch` sub-file row's `task-prompt.md` clause gains "rendered by `bin/dispatch-prompt.js` since #4589")
- Modify: `docs/skill-graph.md` (one row in the `/dispatch` section beside the `bin/compose-context.js --phase` row: `bin/dispatch-prompt.js` (`bin/lib/dispatch/task-prompt.js`) — Step 5 renders both Task prompts and a continuation from `task-prompt.md`'s fenced blocks and Context pack; the fenced blocks are its only template source)
- Test: `tests/dispatch-prompt-cli-prose.test.js`
- Test (re-run, unchanged unless red): `tests/claim-mcp-projection-conformance.test.js`, `tests/dispatch-model-profile-conformance.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`, `tests/flow-context-handoff-conformance.test.js`, `tests/dispatch-express-routing-prose.test.js`

**Interfaces:**
- Consumes: Task 2's usage line and envelope field `profile.model`.

- [ ] **Step 1: Write the failing prose test** `tests/dispatch-prompt-cli-prose.test.js` (`readText` from `tests/helpers/read-skill`):
  - `AC1.1: Step 5 renders each Task prompt with dispatch-prompt.js and forbids hand substitution` — SKILL.md's Step 5 region (from `### Step 5` to `### Step 6`) includes `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues`, `--out`, `profile.model`, and `never paraphrase, summarize or hand-substitute`.
  - `task-prompt.md names the CLI as the renderer of its fenced blocks` — the first paragraph includes `dispatch-prompt.js` and `the only template source`; the Continuation call section includes `--next-steps`.
  - `the CLI file named in prose exists` — `plugin/bin/dispatch-prompt.js` is a file.
  - Go-red control: the first assertion run over a copy of SKILL.md with `dispatch-prompt.js` removed fails.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js`
Expected: FAIL (`dispatch-prompt.js` absent from SKILL.md)

- [ ] **Step 3: Edit the prose**
  - SKILL.md line 260 → one paragraph: each call's prompt is rendered by `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues {n}[,{m}...] [--headless] [--next-steps {NEXT_STEPS}] --out "{file}"` (`--headless` per `task-prompt.md`'s first-call decision; `--next-steps` on a Continuation call; `{file}` from `session-tmp-resolve.js --value dispatch-prompt-{call}.md`); pass the written file unchanged as the `Task()` prompt and the envelope's `profile.model` as its `model` — never paraphrase, summarize or hand-substitute it (`_shared/subagent-output-contract.md`'s input discipline); on a non-zero exit, copy that call's fenced block by hand per `task-prompt.md` instead and name the exit code and stderr line in this firing's report.
  - SKILL.md line 262 → the CLI resolves `task-prompt.md`'s "Context pack" section (#1542) itself; read that section for why, and for the `compose-context.js --phase` line still run before each call.
  - task-prompt.md line 3: keep "inlined verbatim into its own `Task()` tool call" and "Never inline both into one call."; replace the last sentence with: render each call with `dispatch-prompt.js` (SKILL.md Step 5) — these fenced blocks and the Context pack's numbered items are its only template source, so a sentence edited here reaches every rendered prompt with no code change; nothing is substituted by hand except on that CLI's failure fallback.
  - task-prompt.md model-log paragraph: "keep the resolved `model` and `source`" → keep the `model` and `source` of `dispatch-prompt.js`'s envelope `profile` (the same `resolve-profile.js capable` JSON). Leave every pinned string in `tests/dispatch-model-profile-conformance.test.js` intact.
  - task-prompt.md Continuation call section: append "Render it with `dispatch-prompt.js --next-steps {NEXT_STEPS}`." — every existing sentence stays (pinned by `tests/dispatch-handoff-continuation-conformance.test.js`).
  - `docs/plugin-structure.md` and `docs/skill-graph.md`: the entries above (match the neighbouring rows' column shape; `tests/skill-graph-table-structure.test.js` reads the graph).
  - Run `wc -c plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/task-prompt.md` — both < 52,500 and within the Global Constraints net budgets.

- [ ] **Step 4: Run the prose tests that read these files**

Run: `node --test tests/dispatch-express-routing-prose.test.js tests/skill-graph-table-structure.test.js tests/dispatch-prompt-cli-prose.test.js tests/dispatch-model-profile-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/foreground-execution-instruction.test.js tests/dispatch-worktree-anchoring.test.js tests/claim-mcp-projection-conformance.test.js tests/flow-context-handoff-conformance.test.js tests/bin-lib/dispatch/task-prompt.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/task-prompt.md docs/plugin-structure.md docs/skill-graph.md tests/dispatch-prompt-cli-prose.test.js
git commit -m "Point dispatch Step 5 at dispatch-prompt.js — prompts rendered, not hand-substituted, refs #4589"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI, context pack resolution, template fill, print or write) | 1, 2 |
| Deliverable 2 (Step 5 points at CLI; fenced blocks stay the source) | 3 (+1's item-3 edit) |
| Deliverable 3 (fixed sentences + no unsubstituted placeholder) | 1 Step 2 |
| AC1.1 | 1, 2, 3 tests named `AC1.1` |
| AC2.1 | 1 and 2 tests named `AC2.1` |
| AC3.1 | 1 test named `AC3.1` |
