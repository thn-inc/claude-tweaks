# Dispatch Prompt CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `/dispatch`'s Task prompts (first call, second call, handoff continuation, and a resume's first call) with one CLI call that reads `task-prompt.md` as its only template source, so no placeholder is ever substituted by hand, and a render failure blocks the group instead of falling back to hand substitution.

**Architecture:** A pure lib module (`plugin/bin/lib/dispatch/task-prompt.js`) extracts the two fenced templates and the Context pack numbered list from `task-prompt.md`'s text and substitutes a closed set of dispatcher placeholders, failing loud on any left over. A thin CLI (`plugin/bin/dispatch-prompt.js`, `run(argv, deps)` seam) resolves the values (plugin root, policy values via `resolve-policy.js`, model profile via `resolve-profile.js`, `Selected at`, an optional `dispatch-resume.js` verdict) and writes the prompt to `--out` with a JSON envelope on stdout. `SKILL.md` Step 5, `task-prompt.md`, `two-call-gate.md` and `resume.md` point the dispatching session at the CLI and route a non-zero exit to the terminal path.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T073216-record-4589/work/4589-spec.md` (record #4589). Supersedes the prior attempt's plan (PR #4604, closed): the 2026-10-31 Decisions remove its hand-copy fallback, and #4588 (merged since) added a resume first-call shape this plan now renders too.

Scope keywords: {context-pack}, Context pack, resume-context

**Scope sweep (Check B hits outside the Files lists, ruled):** `plugin/skills/dispatch/express-prompt.md` — out of scope by Decision 2 (#4735). `plugin/skills/flow/multispec-parallel-waves.md` copies Context pack items 1, 6, 7 verbatim into its own template — none of which this plan edits; same drift class, left as a follow-up captured in Common Step 4. `plugin/skills/_shared/subagent-output-contract.md` cites the Context pack as the bundle-citation shape — unchanged. `docs/journeys/*` — Common Step 6 owns journey updates. `CHANGELOG.md` — release-please history, never hand-edited. `plugin/bin/lib/dispatch/resume-eligibility.js` and `tests/bin-lib/dispatch/resume-eligibility.test.js` — produce and pin the `context` this plan renders; read-only, unchanged. `docs/journeys/resume-a-stalled-dispatched-build-4588.md` — Common Step 6. `docs/superpowers/plans/2026-10-30-dispatch-resume-stalled-build.md` — a shipped plan, history, unchanged. `tests/fixtures/dispatch-resume/record-4589-decisions.md` — a decisions.md fixture that merely names this record, unchanged. The remaining test hits (`tests/claim-mcp-projection-conformance.test.js`, `tests/dispatch-express-routing-prose.test.js`, `tests/dispatch-model-profile-conformance.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`, `tests/dispatch-resume-prose.test.js`, `tests/flow-context-handoff-conformance.test.js`) read the edited prose and are re-run in Task 1 Step 4 / Task 3 Step 4.

## Global Constraints

- The fenced blocks in `plugin/skills/dispatch/task-prompt.md` stay the single source the CLI reads (Deliverable 2); `task-prompt.md` keeps exactly two ``` fenced blocks (pinned by `tests/foreground-execution-instruction.test.js`, `tests/dispatch-handoff-continuation-conformance.test.js`), and neither carries `RESUME_PR` or `resume-context` (pinned by `tests/dispatch-resume-prose.test.js`).
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Sizes at this branch's base: `plugin/skills/dispatch/SKILL.md` 51,407 B (1,093 B headroom) — its Step 5 edit must be net ≤ +200 B; `plugin/skills/dispatch/task-prompt.md` 50,447 B (2,053 B headroom) — net ≤ +600 B across all its edits; `plugin/skills/dispatch/two-call-gate.md` 22,751 B; `plugin/skills/dispatch/resume.md` well under. Measure with `wc -c` after each edit.
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md`, quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract" and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." and "A run-directory argument gets one of four boundary guards; pick before writing the check." — this CLI takes shape **(4)**, the composer's: `plugin/bin/lib/run-dir-guard.js`'s `anchoredOrOutsideMessage`, refused with exit **2**, exactly as `plugin/bin/compose-context.js` does.
- Exit codes (mirroring `compose-context.js`'s header): 0 rendered; 1 failure (template unreadable or unparseable, a resolver subprocess failed, a placeholder left unsubstituted, `--resume-verdict` unreadable, `--out` unwritable); 2 malformed invocation or a refused `--run`. On exit 1/2 nothing is written to `--out`.
- Decision 1 (spec): a non-zero `dispatch-prompt.js` exit blocks the group through `two-call-gate.md`'s terminal path; there is **no** hand-substitution fallback anywhere in the prose.
- Decision 2 (spec): `express-prompt.md` is out of scope (#4735); no `--call express`.
- Source-scan suites over `plugin/bin/`: no `fs.existsSync` / `fs.realpathSync` tokens (`tests/path-guard-conformance.test.js`) — use `fs.statSync`/`fs.readFileSync` inside try/catch; every `execFileSync` passes `windowsHide: true` (`tests/windows-hide-spawn-conformance.test.js`); flags looked up with `Object.hasOwn`.
- Substitution uses `split(token).join(value)`, never `String.prototype.replace` with a string replacement (a run-dir path containing `$&` or `$'` would be rewritten).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4589` — never `closes`/`fixes`.

## Review Focus

- A run-dir path containing spaces or `$` sequences (`Code Workspaces`, `$&`) must appear byte-for-byte in the prompt — Task 1 test `renders a $& path literally`.
- A bundle (`--issues 4589,4590`) must fill the bundle invocation line (`"#4589,#4590"`) and leave the singleton line's `#{issue}` pattern for the agent; a singleton the reverse — Task 1 tests `singleton` / `bundle`.
- A continuation (`--next-steps test` on the first call) replaces both invocation step lists and keeps "Stop after the test gate" verbatim — Task 1 test `continuation`.
- `--headless` with `--resume-verdict`, `--resume-verdict` on a second call or a bundle, or a verdict whose `issue` differs from `--issues`, are malformed invocations — Task 2 tests.
- A refused `--run` (missing dir, worktree-local shadow) or a failing resolver writes nothing to `--out` — Task 2 tests.

---

### Task 1: Pure renderer `plugin/bin/lib/dispatch/task-prompt.js`

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/dispatch/task-prompt.js`
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 3 only: add the `{policy-values}` placeholder)
- Test: `tests/bin-lib/dispatch/task-prompt.test.js`

**Interfaces:**
- Produces:
  - `DISPATCHER_PLACEHOLDERS` — frozen array, exactly: `'{issue list}'`, `'{comma-joined issue numbers}'`, `'{minted-run-dir}'`, `'{run-id}'`, `'{plugin-root}'`, `'{context-pack}'`, `'{policy-values}'`, `'{ISO}'`. (`{issue}`, `{n1}`, `{n2}` are excluded: the non-applicable invocation line keeps them as the agent-facing pattern. Every other `{…}` token — `{WORD}`, `{n}`, `{gate}`, `{text-file}`, `{run-dir}`… — is agent-facing.)
  - `extractTemplates(text: string) => { first: string, second: string }` — the first ``` fenced block after the `## First call` heading and after the `## Second call` heading (fence lines excluded, inner lines joined with `\n`, no trailing newline). Throws `Error('task-prompt.md: …')` naming the missing heading or fence.
  - `extractContextPack(text: string) => string` — within the `## Context pack` section, the lines from the first `/^1\. /` line up to (excluding) the line starting `Substitute this whole block`, trailing blank lines trimmed (the region `tests/dispatch-prompt-bundle-citations.test.js`'s `contextPackNumberedRegion` governs). Throws when either anchor is missing.
  - `profileOf(template: string) => string` — lowercased `X` of the template's single `[Use: X]`; throws unless exactly one.
  - `findUnsubstituted(prompt: string) => string[]` — the `DISPATCHER_PLACEHOLDERS` entries still present, in list order.
  - `renderResumeContext(verdict) => string` — `verdict` is `dispatch-resume.js`'s eligible JSON (`{ prUrl, priorRunId, context: { lastPhase: {section, step}|null, openDefects: string[] } }`); returns exactly `Resuming stalled run {priorRunId} on PR {prUrl}; last logged phase: {section} {step}; open defects: {each joined with '; '}`, with `none recorded` for a null `lastPhase` and for an empty `openDefects` (`task-prompt.md`'s Resume paragraph). Throws when `prUrl` or `priorRunId` is not a non-empty string.
  - `renderTaskPrompt(text: string, opts) => string` — `opts`: `{ call: 'first'|'second', issues: number[], runDir: string, pluginRoot: string, policyValues: string, selectedAt: string, headless?: boolean, nextSteps?: string[]|null, resume?: object|null, effortLine?: string|null }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/task-prompt.test.js`, reading the live file via `tests/helpers/read-skill`'s `readText(path.join(__dirname,'..','..','..','plugin','skills','dispatch','task-prompt.md'))`. Shared fixture `OPTS = { call:'first', issues:[4589], runDir:'/tmp/x y/.claude-tweaks/pipelines/2026-11-01T073216-record-4589', pluginRoot:'/p/root', policyValues:'autonomy=unattended, integration-model=pr-first', selectedAt:'2026-11-01T07:31:40.082Z', effortLine:'[Effort: high — apply high-level reasoning depth to this task.]' }`. Factor the positive assertions of the first two tests into one helper `assertRendered(out, template, pack)` that later controls reuse:
  - `AC1.1: the live first and second templates render with no dispatcher placeholder left` — for `call` first and second: `findUnsubstituted(out)` deep-equals `[]`; `out` includes `OPTS.runDir`, `'/p/root/bin/verify-run-bookends.js'` (first only), `'Selected at: 2026-11-01T07:31:40.082Z'`, `'autonomy=unattended, integration-model=pr-first'`, `'2026-11-01T073216-record-4589'` (item 4's `{run-id}`), and ends with `OPTS.effortLine`.
  - `Deliverable 3: the rendered prompt contains every fixed line of its template and of the Context pack` — for each line of `extractTemplates(text)[call]` and of `extractContextPack(text)` that contains no `DISPATCHER_PLACEHOLDERS` entry and no `{issue}`/`{n1}`: `out.includes(line)`.
  - `singleton fills #{issue} only` — `out` includes `` /claude-tweaks:flow #4589 build,test auto` `` and still includes `"#{n1},#{n2},..."`.
  - `bundle fills the bundle line only` — `issues:[4589,4590]`: `out` includes `"#4589,#4590" build,test auto` and `GROUP: 4589,4590`, and still includes `#{issue}`.
  - `continuation replaces both step lists and keeps the stop sentence` — `nextSteps:['test']`: `out.split('build,test auto').length === 1`, `out.split('test auto').length - 1 === 2`, `out.includes('Stop after the test gate -- do not proceed to review, polish, or wrap-up;')`; second call with `nextSteps:['polish','wrap-up']`: `out.split('polish,wrap-up auto').length - 1 === 2` and no `review,polish,wrap-up auto`.
  - `headless inserts the marker on both first-call invocation lines` — `headless:true`: `out.split('" DISPATCH_HEADLESS=1 /claude-tweaks:flow').length - 1 === 2`; `call:'second', headless:true` throws `/first call only/`.
  - `resume prefixes RESUME_PR and appends the resume context` — `resume: { prUrl:'https://github.com/o/r/pull/9', priorRunId:'2026-10-30T101632-record-4589', context:{ lastPhase:{section:'/build', step:'Common Step 1.6'}, openDefects:['plan review: 2 questions', 'x'] } }`: `out.split('" RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow').length - 1 === 2`; `out` includes `Resuming stalled run 2026-10-30T101632-record-4589 on PR https://github.com/o/r/pull/9; last logged phase: /build Common Step 1.6; open defects: plan review: 2 questions; x`; that line sits after the template's last line (`out.indexOf(resumeLine) > out.indexOf('contract § Model Selection')`) and before `OPTS.effortLine`. `renderResumeContext({ prUrl:'u', priorRunId:'r', context:{ lastPhase:null, openDefects:[] } })` equals `Resuming stalled run r on PR u; last logged phase: none recorded; open defects: none recorded`. `call:'second'` with `resume` throws `/first call only/`; `headless:true` with `resume` throws `/resume/`.
  - `renders a $& path literally` — `runDir:'/tmp/a$&b/.claude-tweaks/pipelines/r1'`: `out.includes('/tmp/a$&b/.claude-tweaks/pipelines/r1')`.
  - `AC4.1: an unsubstituted placeholder fails the render` — `selectedAt: undefined` throws `/unsubstituted.*\{ISO\}/`; and `findUnsubstituted('x {minted-run-dir} y')` deep-equals `['{minted-run-dir}']`.
  - `AC4.1 go-red control: the Deliverable 3 helper fails on a prompt with a placeholder put back` — `assert.throws(() => assertRendered(out.split(OPTS.runDir).join('{minted-run-dir}'), …))`.
  - `AC3.1: editing a sentence in a fenced block changes the output with no code change` — `doctored = text.replace('Never run \`git stash\` in any form', 'Never run EDITED-SENTENCE')` (assert `doctored !== text` first); rendering `doctored` includes `'Never run EDITED-SENTENCE'` and rendering `text` does not.
  - `a template that lost a value placeholder fails loud` — `text.replace('{policy-values}', 'none')` throws `/\{policy-values\}/` (the renderer asserts each of `{policy-values}`, `{ISO}`, `{context-pack}` occurs before substituting).
  - `profileOf reads each template's [Use:] line` — `'capable'` for first, `'standard'` for second; a string with no `[Use:` throws.
  - `structure drift throws` — `extractTemplates(text.replace('## Second call', '## Gone'))` throws `/Second call/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/dispatch/task-prompt'`

- [ ] **Step 3: Edit `task-prompt.md` item 3, then implement `plugin/bin/lib/dispatch/task-prompt.js`**

Item 3: change `3. **Resolved policy values** — one call, before either dispatch:` to ``3. **Resolved policy values** — `{policy-values}`, from one call before either dispatch:`` (rest of the item unchanged).

`renderTaskPrompt` order: (1) template = `extractTemplates(text)[call]`; (2) `nextSteps` → replace the call's step-list token followed by ` auto` (`build,test auto` / `review,polish,wrap-up auto`) with `${nextSteps.join(',')} auto`, requiring exactly 2 hits; (3) `headless` and `resume` are first-call only (`throw new Error('--headless/--resume apply to the first call only')`) and mutually exclusive (`throw new Error('resume is human-typed: no DISPATCH_HEADLESS')`); `headless` replaces `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow` with `PIPELINE_RUN_DIR="{minted-run-dir}" DISPATCH_HEADLESS=1 /claude-tweaks:flow`, `resume` with `PIPELINE_RUN_DIR="{minted-run-dir}" RESUME_PR="{prUrl}" /claude-tweaks:flow` — the URL inserted with split/join after placeholders are filled, or as a literal in this step since it carries no `{`; each requires 2 hits; (4) targets: one issue → `#{issue}` → `#N`; two or more → `"#{n1},#{n2},..."` → `"#a,#b"` — require ≥ 1 hit; (5) the `{context-pack}` line → the Context pack region; (6) assert `{policy-values}` and `{ISO}` occur, then substitute every `DISPATCHER_PLACEHOLDERS` entry with split/join (`{issue list}` → `issues.map(n => '#' + n).join(', ')`, `{comma-joined issue numbers}` → `issues.join(',')`, `{run-id}` → `path.basename(runDir)`, `{ISO}` → `selectedAt`, a `undefined`/`null` value is skipped so step 7 reports it); (7) `findUnsubstituted` non-empty → `throw new Error('unsubstituted placeholder(s): …')`; (8) append `\n\n${renderResumeContext(resume)}` when `resume`, then `\n\n${effortLine}` when given. Header comment names #4589, the source file, and the closed placeholder set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js tests/dispatch-prompt-bundle-citations.test.js tests/claim-mcp-projection-conformance.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS; `wc -c plugin/skills/dispatch/task-prompt.md` ≤ 50,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/dispatch/task-prompt.js tests/bin-lib/dispatch/task-prompt.test.js plugin/skills/dispatch/task-prompt.md
git commit -m "Add dispatch task-prompt renderer — fills task-prompt.md's templates from a closed placeholder set, refs #4589"
```

### Task 2: CLI `plugin/bin/dispatch-prompt.js`

**Role:** integration

**Files:**
- Create: `plugin/bin/dispatch-prompt.js`
- Test: `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `renderTaskPrompt`, `extractTemplates`, `profileOf`; `FIRST_CALL_STEPS`/`SECOND_CALL_STEPS` from `plugin/bin/lib/dispatch/first-call-artifact-check.js`; `anchoredOrOutsideMessage` from `plugin/bin/lib/run-dir-guard.js`; `sessionTmpRoot` from `plugin/bin/lib/session-tmp.js`.
- Produces: `run(argv: string[], deps) => 0|1|2`, `parseArgs(argv)`. Usage: `dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M...] --out <file> [--next-steps s1,s2] [--headless] [--resume-verdict <file>] [--selected-at <ISO|unknown>] [--help]`. `--out` is required (the prompt is never printed to stdout, so the envelope line stays parseable). `deps`: `{ cwd(), isDirectory(p), anchoredOrOutsideMessage, readFile(p), writeFile(p, s), resolvePolicyValues(cwd) => string /* 'k=v, …' */, resolveProfile(name, { unattended, cwd }) => {model, effort, source, effortLine}, selectedAt() => string, stdout(s), stderr(s) }`. Stdout on exit 0: one JSON line `{ out, bytes, call, issues, continuation: boolean, resume: boolean, profile: { name, model, effort, source }, selectedAt }`.

- [ ] **Step 1: Write the failing tests** (fake `deps`; a real `fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'))` run dir, which is outside any checkout and so accepted):
  - `AC1.1: one call renders the first-call prompt to --out and reports the profile` — exit 0; the written file has no `findUnsubstituted` hit; stdout parses to `{ call:'first', issues:[4589], continuation:false, resume:false, profile:{ name:'capable', model:'opus', … } }`; `resolveProfile` was called with `'capable'`.
  - `second call resolves the standard profile` — `resolveProfile` called with `'standard'`.
  - `--next-steps renders a continuation and validates the steps` — `--call first --next-steps test` exit 0, `continuation:true`; `--next-steps review` on the first call → exit 2; `--next-steps test,test` → exit 2.
  - `--headless passes unattended and is refused on the second call` — first: `resolveProfile` saw `{ unattended: true }`; `--call second --headless` → exit 2, `writeFile` never called.
  - `--resume-verdict renders a resume first call` — `readFile` returns `{"eligible":true,"issue":4589,"prUrl":"https://github.com/o/r/pull/9","priorRunId":"r0","context":{"lastPhase":null,"openDefects":[]}}` for the verdict path: exit 0, `resume:true`, the written prompt includes `RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow #4589` and `Resuming stalled run r0`. Exit 2, `writeFile` never called, for each of: `--call second`, `--issues 4589,4590`, `--headless`, a verdict with `issue: 4590`, a verdict with `eligible: false`. A verdict that is not JSON → exit 1.
  - `malformed invocations exit 2` — missing `--call`, `--call third`, missing `--out`, `--issues 0`, `--issues 12,abc`, `--issues 5,5`, unknown flag, value-taking flag last in argv, `--selected-at nope`.
  - `a refused --run exits 2 and writes nothing` — a non-existent dir; and `anchoredOrOutsideMessage` faked to return a message → exit 2, `writeFile` never called.
  - `a failing resolver or unreadable template exits 1 and writes nothing` — `resolvePolicyValues` throws → 1; `resolveProfile` throws → 1; `readFile` throws for the template → 1; `writeFile` throws → 1 with the path on stderr.
  - `AC3.1 at the CLI: an injected template edit reaches the output` — `readFile` returns the live text with one fenced sentence edited; the written prompt carries the edit.
  - `--selected-at overrides the session file` — `--selected-at unknown` → prompt includes `Selected at: unknown` and `deps.selectedAt` not called.
  - `--help exits 0 before any probe` — no deps other than `stdout` called.
  - `real binary smoke` — `execFileSync(process.execPath, [CLI, '--help'], { windowsHide: true })` exits 0 and prints `usage: dispatch-prompt.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/dispatch-prompt'`

- [ ] **Step 3: Implement `plugin/bin/dispatch-prompt.js`**

Header comment: purpose (#4589), usage, the exit-code contract from Global Constraints (citing `compose-context.js`'s shape-4 guard), and that a non-zero exit is never followed by hand substitution (`two-call-gate.md`). `PLUGIN_ROOT = path.resolve(__dirname, '..')` is both the template location (`skills/dispatch/task-prompt.md`) and the `{plugin-root}` value. Real deps: `resolvePolicyValues` runs `execFileSync(process.execPath, [path.join(PLUGIN_ROOT,'bin','resolve-policy.js'), '--values', 'autonomy,integration-model,merge-verification,risk-floor,size-floor'], { cwd, encoding:'utf8', windowsHide:true })` and zips the five output lines into `key=value` joined by `', '` (an empty line → `key=(unset)`); `resolveProfile` runs `resolve-profile.js {name}` (+ `--unattended` when set) the same way and `JSON.parse`s stdout; `selectedAt` returns `fs.statSync(path.join(sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID), 'dispatch-groups.json')).mtime.toISOString()` or `'unknown'` on a null root or any throw. Validate `--next-steps` against `FIRST_CALL_STEPS` / `SECOND_CALL_STEPS` by `--call`, rejecting duplicates. `--resume-verdict`: `JSON.parse(deps.readFile(p))` (throw → 1); `eligible !== true` or `issue !== issues[0]` or more than one issue → 2. Every deps call is wrapped in try/catch → its exit code. `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 4: Run tests to verify they pass, plus the bin source scans**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Live probe** — `node plugin/bin/dispatch-prompt.js --call first --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-01T073216-record-4589" --issues 4589 --out "{scratchpad}/p1.md"` and the same with `--call second` exit 0; each written file reads as a complete prompt against its template (check by eye; quote both envelope lines in the commit body).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/dispatch-prompt.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js
git commit -m "Add dispatch-prompt.js — one CLI call renders each dispatch Task prompt, refs #4589"
```

### Task 3: Point Step 5, `task-prompt.md`, `two-call-gate.md` and `resume.md` at the CLI; document it

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md:261-263` (Step 5's two template paragraphs)
- Modify: `plugin/skills/dispatch/task-prompt.md:3` (opening paragraph), `:111-126` (model-log paragraph), `:136` (Resume paragraph), `:523` (Continuation call section)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (§2, one new paragraph after the opening paragraph)
- Modify: `plugin/skills/dispatch/resume.md` (Step 7 paragraph)
- Modify: `docs/plugin-structure.md` (line 68's `plugin/bin/lib/dispatch/` row gains `task-prompt.js`; a CLI command line after line 219's `dispatch-resume.js` line)
- Modify: `docs/skill-graph.md` (one `/dispatch` row after line 238's `bin/compose-context.js --phase` row)
- Test: `tests/dispatch-prompt-cli-prose.test.js`
- Test (re-run, unchanged unless red): `tests/dispatch-resume-prose.test.js`, `tests/dispatch-model-profile-conformance.test.js`, `tests/dispatch-handoff-continuation-conformance.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`, `tests/foreground-execution-instruction.test.js`, `tests/dispatch-worktree-anchoring.test.js`, `tests/claim-mcp-projection-conformance.test.js`, `tests/flow-context-handoff-conformance.test.js`, `tests/dispatch-express-routing-prose.test.js`, `tests/skill-graph-table-structure.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Consumes: Task 2's usage line and envelope fields `out`, `profile.model`, `profile.source`.

- [ ] **Step 1: Write the failing prose test** `tests/dispatch-prompt-cli-prose.test.js` (`readText` from `tests/helpers/read-skill`), with the AC1.1 assertions factored into `assertStep5(text)` so the control runs the same code:
  - `AC1.1: Step 5 renders each Task prompt with dispatch-prompt.js and forbids hand substitution` — `assertStep5` on SKILL.md's Step 5 region (from `### Step 5` to `### Step 6`): includes `bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues`, `--out`, `profile.model`, and `never paraphrase, summarize or fill it by hand`.
  - `AC2.1: a non-zero exit blocks the group through the terminal path` — two-call-gate.md §2 (from `## 2.` to `## 5.`) includes `` `dispatch-prompt.js` exits non-zero ``, `never dispatched`, `section 5`, `section 6`; SKILL.md's Step 5 region includes `` `two-call-gate.md`'s terminal path ``.
  - `AC2.1: no hand-substitution fallback survives ("never filled by hand")` — none of SKILL.md, task-prompt.md, two-call-gate.md, resume.md matches `/copy (that call's|each) fenced block by hand|fill(ed)? (it|the template) by hand instead/i`; control: the same regex matches the prior attempt's sentence `on a non-zero exit, copy that call's fenced block by hand per task-prompt.md instead`.
  - `task-prompt.md names the CLI as the renderer of its fenced blocks` — the first paragraph includes `dispatch-prompt.js` and `the only template source`; the Continuation call section includes `--next-steps`; the Resume paragraph includes `--resume-verdict`.
  - `resume.md Step 7 renders the first call with --resume-verdict` — Step 7's paragraph includes `dispatch-prompt.js` and `--resume-verdict`.
  - `the CLI file named in prose exists` — `plugin/bin/dispatch-prompt.js` is a file.
  - Go-red control: `assert.throws(() => assertStep5(step5.split('dispatch-prompt.js').join('x.js')))`.
  - `Waived AC1.2: express-lane prompt out of scope by Decision 2 (#4735)` — one comment line in the file header, no test.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js`
Expected: FAIL (`dispatch-prompt.js` absent from SKILL.md)

- [ ] **Step 3: Edit the prose**
  - SKILL.md line 261 → one paragraph: render each call's prompt with `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues {n}[,{m}...] --out "{file}" [--headless] [--next-steps {NEXT_STEPS}] [--resume-verdict {file}]` (`{file}` from `session-tmp-resolve.js --value dispatch-prompt-{call}.md`; the flags as `task-prompt.md` decides them), print the written file with one plain `cat "{file}"`, and pass that text unchanged as the `Task()` prompt with the envelope's `profile.model` as its `model` — never paraphrase, summarize or fill it by hand (`_shared/subagent-output-contract.md`'s input discipline). A non-zero exit takes `two-call-gate.md`'s terminal path (§2). Keep "the exact wording is load-bearing for the four-value status line and output format contracts downstream skills parse".
  - SKILL.md line 263 → the CLI resolves `task-prompt.md`'s "Context pack" (#1542) itself; read that section for why, and for the `compose-context.js --phase` line still run before each call. Net SKILL.md growth ≤ +200 B.
  - task-prompt.md line 3: keep "**each of this file's two templates must be inlined verbatim into its own `Task()` tool call**" and "Never inline both into one call."; replace the last sentence with: each call's prompt is rendered by `bin/dispatch-prompt.js` (SKILL.md Step 5) — these fenced blocks and the Context pack's numbered items are its only template source, so an edited sentence here reaches every rendered prompt with no code change; nothing is substituted by hand, and a render failure blocks the group (`two-call-gate.md` §2).
  - task-prompt.md model-log paragraph: "keep the resolved `model` and `source`" → keep the `model` and `source` of `dispatch-prompt.js`'s envelope `profile` (the same `resolve-profile.js capable` JSON). Every string pinned by `tests/dispatch-model-profile-conformance.test.js` stays.
  - task-prompt.md Resume paragraph: append "`dispatch-prompt.js --resume-verdict {file}` (the file holding Step 2's `dispatch-resume.js` JSON line) does both." — every pinned clause (`tests/dispatch-resume-prose.test.js` lines 379-386) stays.
  - task-prompt.md Continuation call section: append "Render it with `dispatch-prompt.js --next-steps {NEXT_STEPS}`." — every existing sentence stays (pinned by `tests/dispatch-handoff-continuation-conformance.test.js`).
  - two-call-gate.md §2, after its first paragraph: **A prompt that does not render (#4589).** When `dispatch-prompt.js` exits non-zero for a call, that call is never dispatched and its template is never filled by hand: log `Prompt render failed: exit {code}: {stderr}` via `log-decision.js --status REFUSED --text-file "{text-file}"` (`_shared/auto-decision-log.md`'s Text from git or a user paragraph), then treat it as that call returning no parseable report — a first call or its continuation goes to section 5, a second call or its continuation to section 6.
  - resume.md Step 7: replace "add `RESUME_PR="{prUrl}" ` immediately before `/claude-tweaks:flow` and substitute `{resume-context}` from the CLI's `context`" with "render the first call with `dispatch-prompt.js --resume-verdict {file}` (Step 2's JSON line, written with the Write tool), which adds `RESUME_PR="{prUrl}" ` immediately before `/claude-tweaks:flow` and appends `{resume-context}` from the CLI's `context`". The `RESUME_PR="{prUrl}" ` literal and the "`SKILL.md` Step 5's gate between the calls and terminal-path teardown (`two-call-gate.md`)" citation stay (pinned by `tests/dispatch-resume-prose.test.js`).
  - `docs/plugin-structure.md` line 68: append `task-prompt.js` (#4589 — extracts `task-prompt.md`'s two fenced templates and Context pack and fills the dispatcher placeholders; consumed by `plugin/bin/dispatch-prompt.js`) to the row's list; after line 219 add `node plugin/bin/dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M] --out <file> [--next-steps …] [--headless] [--resume-verdict <file>] [--selected-at <ISO|unknown>]   # Dispatch-prompt CLI (#4589) — …; exit 0 rendered, 1 failure, 2 malformed or refused --run (tests in tests/bin-lib/dispatch/dispatch-prompt-cli.test.js)` in the neighbouring lines' shape.
  - `docs/skill-graph.md` after line 238: `| \`bin/dispatch-prompt.js\` (\`bin/lib/dispatch/task-prompt.js\`) | Step 5 renders each Task prompt — first, second, a continuation, a resume's first call — from \`task-prompt.md\`'s fenced blocks and Context pack, its only template source; a non-zero exit blocks the group through \`two-call-gate.md\` §2. |`
  - Run `wc -c plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/task-prompt.md` — both < 52,500 and within the Global Constraints net budgets.

- [ ] **Step 4: Run the prose tests that read these files**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/dispatch-resume-prose.test.js tests/dispatch-model-profile-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/foreground-execution-instruction.test.js tests/dispatch-worktree-anchoring.test.js tests/claim-mcp-projection-conformance.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/skill-graph-table-structure.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/dispatch/task-prompt.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/task-prompt.md plugin/skills/dispatch/two-call-gate.md plugin/skills/dispatch/resume.md docs/plugin-structure.md docs/skill-graph.md tests/dispatch-prompt-cli-prose.test.js
git commit -m "Point dispatch Step 5 at dispatch-prompt.js — prompts rendered, not hand-substituted, refs #4589"
```

### Task 4: Scope-sweep read-back (no code)

**Role:** transcription

Check B's hits outside Tasks 1-3, each ruled in the Scope sweep paragraph above. This task re-reads them against the finished branch so a ruling made at plan time is confirmed, not assumed. No file here changes unless the read-back finds a stale sentence about the dispatch prompt templates; such a sentence is fixed in place in this task.

**Files:** (each `Modify:` below is read back and edited only if Step 1 finds a stale sentence; `CHANGELOG.md` is release-please history and is never edited)
- Modify: `CHANGELOG.md`
- Modify: `docs/journeys/clear-the-two-call-gate-for-a-dispatched-group-2775.md`
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md`
- Modify: `docs/journeys/resume-a-stalled-dispatched-build-4588.md`
- Modify: `docs/superpowers/plans/2026-10-30-dispatch-resume-stalled-build.md`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Modify: `plugin/skills/_shared/subagent-output-contract.md`
- Modify: `plugin/skills/dispatch/express-prompt.md`
- Modify: `plugin/skills/flow/multispec-parallel-waves.md`
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`
- Test: `tests/claim-mcp-projection-conformance.test.js`
- Test: `tests/dispatch-express-routing-prose.test.js`
- Test: `tests/dispatch-model-profile-conformance.test.js`
- Test: `tests/dispatch-prompt-bundle-citations.test.js`
- Test: `tests/dispatch-resume-prose.test.js`
- Test: `tests/fixtures/dispatch-resume/record-4589-decisions.md`
- Test: `tests/flow-context-handoff-conformance.test.js`

- [ ] **Step 1: Read back** — for each Modify file, grep it for `{context-pack}`, `Context pack`, `resume-context` and `substitut`; a sentence that now contradicts Task 3's prose (one telling the dispatching session to fill `task-prompt.md`'s templates by hand) is edited to cite `dispatch-prompt.js`. `express-prompt.md` and `multispec-parallel-waves.md` keep their own hand-filled templates (out of scope; #4735 covers the express prompt, and a `/claude-tweaks:capture` follow-up is filed in Common Step 4 for `multispec-parallel-waves.md`).

- [ ] **Step 2: Run the listed tests**

Run: `node --test tests/bin-lib/dispatch/resume-eligibility.test.js tests/claim-mcp-projection-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/dispatch-model-profile-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/dispatch-resume-prose.test.js tests/flow-context-handoff-conformance.test.js`
Expected: PASS

- [ ] **Step 3: Commit** only when Step 1 edited a file: `git add {edited paths}` then `git commit -m "Align {file} with dispatch-prompt.js — refs #4589"`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI, context pack resolution, template fill, writes to a file) | 1, 2 |
| Deliverable 2 (Step 5 points at CLI; fenced blocks stay the source) | 3 (+1's item-3 edit) |
| Deliverable 3 (fixed sentences + no unsubstituted placeholder) | 1 Step 1 |
| AC1.1 (each of first/second/continuation prompts with one CLI call, no manual substitution) | 1, 2, 3 tests named `AC1.1` |
| AC1.2 (express out of scope) | Waived AC1.2: Decision 2, #4735 |
| AC2.1 (non-zero exit takes the terminal path; never filled by hand) | 3 tests named `AC2.1` |
| AC3.1 (fenced-block edit changes output with no code change) | 1 and 2 tests named `AC3.1` |
| AC4.1 (test fails when a placeholder is left unsubstituted) | 1 tests named `AC4.1` |
