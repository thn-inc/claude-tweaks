# Dispatch Prompt CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `/dispatch`'s Task prompts (first call, second call, handoff continuation, a resume's first call) with one CLI call that reads `task-prompt.md` as its only template source, block the group on a render failure, and deny at PreToolUse any dispatch `Task()`/`Agent()` prompt that is not byte-for-byte a rendered one.

**Architecture:** A pure lib module (`plugin/bin/lib/dispatch/task-prompt.js`) extracts the two fenced templates and the Context pack numbered list from `task-prompt.md`, substitutes a closed set of dispatcher placeholders (failing loud on any left over), and owns the prompt marker line and digest. A thin CLI (`plugin/bin/dispatch-prompt.js`, `run(argv, deps)` seam) resolves the values, writes the prompt to `--out`, and appends `{sha256, call, out}` to the run dir's `dispatch-prompts.jsonl`. A new PreToolUse gate (`plugin/bin/lib/hooks/dispatch-prompt-gate.js`, wired into `pre-tool-use.js` for tool names `Agent` and `Task`) denies a marker-bearing prompt whose digest is not in that registry, and a marker-less dispatch-shaped prompt from the run's bound dispatch session's main thread. Prose (`SKILL.md` Step 5, `task-prompt.md`, `two-call-gate.md`, `resume.md`) points the dispatching session at the CLI.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T181353-record-4589/work/4589-spec.md` (record #4589). Supersedes the plan of the prior attempt (PR #4808, closed), which predated Decision 3 and assumed 2,053 B of `task-prompt.md` headroom that no longer exists.

Scope keywords: {context-pack}, Context pack, resume-context

**Scope sweep (Check B hits outside the Files lists, ruled):** `plugin/skills/dispatch/express-prompt.md` — out of scope by Decision 2 (#4735); it carries no `PIPELINE_RUN_DIR="…" /claude-tweaks:flow` line, so Task 3's marker-less rule cannot deny it. `plugin/skills/flow/multispec-parallel-waves.md` copies Context pack items 1, 6, 7 into its own template, dispatched from inside a dispatched call (`agent_id` present), so Task 3 never denies it; same drift class as this record, filed as a follow-up in Common Step 4. `plugin/skills/_shared/subagent-output-contract.md` cites the Context pack as the bundle-citation shape — unchanged. `docs/journeys/*` — Common Step 6. `CHANGELOG.md` — release-please history. `plugin/bin/lib/dispatch/resume-eligibility.js` / its test — produce the `context` Task 1 renders; read-only. `tests/fixtures/dispatch-resume/record-4589-decisions.md` — merely names this record. Every other hit is a test that reads edited prose, re-run in Task 4 Step 4.

## Global Constraints

- The fenced blocks in `plugin/skills/dispatch/task-prompt.md` stay the single source the CLI reads (Deliverable 2); `task-prompt.md` keeps exactly two ``` fenced blocks (pinned by `tests/foreground-execution-instruction.test.js`, `tests/dispatch-handoff-continuation-conformance.test.js`), and neither carries `RESUME_PR` or `resume-context` (pinned by `tests/dispatch-resume-prose.test.js`).
- Byte rail: `RAIL_BYTES` = 52,500 (`plugin/bin/lib/skill-audit/budgets.js`). Sizes at this branch's base (`afac7a84d`): `plugin/skills/dispatch/task-prompt.md` **52,473 B (27 B headroom)** — its edits across Tasks 1 and 4 must leave it **≤ 52,300 B**, net negative: the remedy is cutting the dispatcher-facing hand-substitution instructions the CLI now owns (named in Task 4), never moving agent-facing template text; `plugin/skills/dispatch/SKILL.md` 51,407 B — net ≤ +400 B; `two-call-gate.md` 22,751 B; `resume.md` 10,846 B. Measure with `wc -c` after each edit.
- Governing skill `gh-api-module-pattern` / `cli-wrapper-contract.md`, quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract" and "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." and "A run-directory argument gets one of four boundary guards; pick before writing the check." — this CLI takes shape **(4)**, the composer's: `plugin/bin/lib/run-dir-guard.js`'s `anchoredOrOutsideMessage`, refused with exit **2**, exactly as `plugin/bin/compose-context.js` does.
- Governing skill `pre-tool-use-gate-exemptions`, quoted (Task 3): "**A deny on a call that skill prose prescribes fails OPEN on every unprovable answer, and the same change sweeps every prose route into that call.**" … "State the direction in the gate's header comment and give each fail-open condition its own test" … "A tool no existing PreToolUse matcher routes also needs its own `plugin/hooks/hooks.json` entry, pinned by a `tests/hooks-dispatcher.test.js` matcher case." … "**Choose the run a deny reads before writing its first condition**" … "A containment check calls `shared-primitives.js`'s `isPathContained(candidate, root, { orEqual })` — never a retyped `startsWith(root + path.sep)`" … "Comparing `fs.realpathSync` output against a root or an exclusion … Resolve both sides through `plugin/bin/lib/path-guard`'s `canonicalRealpath()` / `resolveLeaf()`" … "A new gate returning a non-deny `hookSpecificOutput` … silently turns off the rewrite" (the gate returns `{}` or `denyResult(...)` only) … "**Every new exemption needs a regression test proven to go red on revert.**"
- `docs/hooks.md`, quoted: "Every such path — including a PreToolUse deny — exits 0 … A deny is communicated entirely via `hookSpecificOutput.permissionDecision: 'deny'` … New modules must pass the garbage-stdin invariant test in `tests/hooks-dispatcher.test.js`."
- Exit codes (mirroring `compose-context.js`): 0 rendered; 1 failure (template unreadable/unparseable, resolver failed, placeholder left, `--resume-verdict` unreadable, `--out` or registry unwritable); 2 malformed invocation or refused `--run`. On exit 1/2 nothing is written to `--out` and nothing is appended to the registry.
- Decision 1: a non-zero `dispatch-prompt.js` exit blocks the group through `two-call-gate.md`'s terminal path; **no** hand-substitution fallback anywhere in prose. Decision 2: no `--call express`. Decision 3: a denied call is resent from the rendered file unchanged, never edited by hand.
- Source-scan suites over `plugin/bin/`: no `fs.existsSync` / `fs.realpathSync` tokens (`tests/path-guard-conformance.test.js`); every `execFileSync` passes `windowsHide: true`; flags looked up with `Object.hasOwn`; containment through `isPathContained`.
- Substitution uses `split(token).join(value)`, never `String.prototype.replace` with a string replacement (a path containing `$&` would be rewritten).
- Commit messages: `{Verb} {what} — {detail}`, ending `refs #4589` — never `closes`/`fixes`.

## Review Focus

- A run-dir path containing spaces or `$` sequences must appear byte-for-byte in the prompt — Task 1 test `renders a $& path literally`.
- The dispatching model passes the file text with a trailing newline stripped or added — the digest normalizes trailing whitespace only (`promptDigest`), Task 1 test `digest ignores trailing whitespace only`; any interior change still mismatches.
- A dispatched call's own nested Agent calls (SDD implementers, review lenses, `/flow`'s context-handoff continuation) share the dispatch session id — the marker-less rule must not deny them: Task 3 test `AC5.1: a marker-less prompt carrying agent_id is allowed`.
- A human-typed resume (`PIPELINE_RUN_DIR="…" /claude-tweaks:flow "{target}" wrap-up`) is a Skill/slash call, not an Agent prompt — never reaches the gate; Task 3's routes test enumerates every such skill site.
- The gate cannot resolve the run (unanchored path, unreadable registry, git failure) — allow; Task 3 one test per fail-open condition.

---

### Task 0: Live probe — PreToolUse on `Agent`/`Task`

**Role:** judgment

**Files:**
- Create: `docs/reference/pretooluse-agent-tool-probe.md`

Decision 3: "Before relying on it, the plan verifies that PreToolUse fires for `Agent` calls with `tool_input.prompt`, and whether older Claude Code versions name the tool `Task`." Nothing in Tasks 1-5 starts until this records a positive result for the installed CLI (2.1.302).

- [ ] **Step 1: Build a scratch plugin** under the session scratchpad (never the repo): `.claude-plugin/plugin.json` (`{"name":"probe","version":"0.0.0"}`), `hooks/hooks.json` with two PreToolUse entries, matchers `Agent` and `Task`, each `node "${CLAUDE_PLUGIN_ROOT}/log.js"`; `log.js` appends the raw stdin JSON as one line to `{scratch}/events.jsonl` and, when `tool_input.prompt` contains `PROBE-DENY`, prints `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"probe deny"}}`; exit 0 always.
- [ ] **Step 2: Run three headless probes** from the scratchpad with `claude -p --plugin-dir {scratch} --permission-mode bypassPermissions` (one plain command per call): (a) "Use the Agent tool, subagent_type general-purpose, prompt exactly `Reply OK. PROBE-ALLOW`. Then print the agent's reply."; (b) the same with `PROBE-DENY`, then "print what happened"; (c) "Use the Agent tool to launch a general-purpose agent whose task is: use the Agent tool yourself to launch a general-purpose agent with prompt `Reply OK. PROBE-NESTED`; report its reply."
- [ ] **Step 3: Record** in the reference doc, quoting the captured JSON keys (never paraphrased): the `tool_name` value; whether `tool_input.prompt` is the exact prompt string; `session_id` present; `agent_id` absent on (a)/(b) and present on (c)'s nested call with the same `session_id`; (b) the agent did not start and the model saw the reason. For older versions: search the local Claude Code changelog (`~/.claude/cache/changelog.md`, else the npm package's `CHANGELOG.md`) for the `Task` → `Agent` rename and record the version and quoted line, or "not found locally — both matchers registered". Header: date, CLI version, commands run.
- [ ] **Step 4: Gate.** If (a) shows no event, or `tool_input.prompt` is absent, or (b) did not block the launch: STOP and report `NEEDS_CONTEXT` with the reference doc — Task 3's design rests on these facts. If (c)'s nested call carries no `agent_id`, STOP likewise (the main-thread discriminator in Task 3 rests on it).
- [ ] **Step 5: Commit** `git add docs/reference/pretooluse-agent-tool-probe.md` then `git commit -m "Record PreToolUse Agent-tool probe — tool name, prompt field and agent_id measured on 2.1.302, refs #4589"`.

### Task 1: Pure renderer `plugin/bin/lib/dispatch/task-prompt.js`

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/dispatch/task-prompt.js`
- Modify: `plugin/skills/dispatch/task-prompt.md` (item 3 only: add the `{policy-values}` placeholder)
- Test: `tests/bin-lib/dispatch/task-prompt.test.js`

**Interfaces:**
- Produces:
  - `DISPATCHER_PLACEHOLDERS` — frozen array, exactly: `'{issue list}'`, `'{comma-joined issue numbers}'`, `'{minted-run-dir}'`, `'{run-id}'`, `'{plugin-root}'`, `'{context-pack}'`, `'{policy-values}'`, `'{ISO}'`. (`{issue}`, `{n1}`, `{n2}` excluded: the non-applicable invocation line keeps them for the agent. Every other `{…}` token is agent-facing.)
  - `extractTemplates(text) => { first, second }` — the first ``` fenced block after the `## First call` heading / after `## Second call` (fence lines excluded, joined with `\n`, no trailing newline). Throws `Error('task-prompt.md: …')` naming the missing heading or fence.
  - `extractContextPack(text) => string` — within `## Context pack`, from the first `/^1\. /` line up to (excluding) the line starting `Substitute this whole block` — **that anchor sentence must survive Task 4's edits** (pinned by `tests/dispatch-prompt-bundle-citations.test.js`'s `contextPackNumberedRegion`); trailing blank lines trimmed. Throws when either anchor is missing.
  - `profileOf(template) => string` — lowercased `X` of the single `[Use: X]`; throws unless exactly one.
  - `findUnsubstituted(prompt) => string[]` — `DISPATCHER_PLACEHOLDERS` entries still present, in list order.
  - `renderResumeContext(verdict) => string` — `verdict`: `{ prUrl, priorRunId, context: { lastPhase: {section, step}|null, openDefects: string[] } }`; returns `Resuming stalled run {priorRunId} on PR {prUrl}; last logged phase: {section} {step}; open defects: {each joined with '; '}`, `none recorded` for null/empty. Throws unless `prUrl` and `priorRunId` are non-empty strings.
  - `MARKER_RE` — `/^\[dispatch-prompt: (\S+) (first|second)\]$/m`; `markerLine(runId, call) => string` — `[dispatch-prompt: {runId} {call}]`.
  - `promptDigest(text) => string` — lowercase hex sha256 (`crypto.createHash`) of `text.replace(/\s+$/, '')`.
  - `REGISTRY_FILE` — `'dispatch-prompts.jsonl'`.
  - `renderTaskPrompt(text, opts) => string` — `opts`: `{ call: 'first'|'second', issues: number[], runDir, pluginRoot, policyValues, selectedAt, headless?, nextSteps?: string[]|null, resume?: object|null, effortLine?: string|null }`. Output begins with `markerLine(path.basename(runDir), call)` + `\n\n`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/dispatch/task-prompt.test.js`, reading the live file via `tests/helpers/read-skill`'s `readText(...)`. Fixture `OPTS = { call:'first', issues:[4589], runDir:'/tmp/x y/.claude-tweaks/pipelines/2026-11-01T181353-record-4589', pluginRoot:'/p/root', policyValues:'autonomy=unattended, integration-model=pr-first', selectedAt:'2026-11-01T18:13:14.928Z', effortLine:'[Effort: high — apply high-level reasoning depth to this task.]' }`. Factor the first two tests' positive assertions into `assertRendered(out, template, pack)`:
  - `AC1.1: the live first and second templates render with no dispatcher placeholder left` — for first and second: `findUnsubstituted(out)` deep-equals `[]`; `out` includes `OPTS.runDir`, `'/p/root/bin/verify-run-bookends.js'` (first only), `'Selected at: 2026-11-01T18:13:14.928Z'`, `OPTS.policyValues`, `'2026-11-01T181353-record-4589'`; starts with `'[dispatch-prompt: 2026-11-01T181353-record-4589 ' + call + ']\n\n'`; ends with `OPTS.effortLine`.
  - `Deliverable 3: the rendered prompt contains every fixed line of its template and of the Context pack` — every line of `extractTemplates(text)[call]` and `extractContextPack(text)` containing no `DISPATCHER_PLACEHOLDERS` entry and no `{issue}`/`{n1}`: `out.includes(line)`.
  - `singleton fills #{issue} only` — `out` includes `` /claude-tweaks:flow #4589 build,test auto` `` and still includes `"#{n1},#{n2},..."`.
  - `bundle fills the bundle line only` — `issues:[4589,4590]`: includes `"#4589,#4590" build,test auto` and `GROUP: 4589,4590`, still includes `#{issue}`.
  - `continuation replaces both step lists and keeps the stop sentence` — `nextSteps:['test']`: `out.split('build,test auto').length === 1`, `out.split('test auto').length - 1 === 2`, includes `Stop after the test gate -- do not proceed to review, polish, or wrap-up;`; second with `['polish','wrap-up']`: `out.split('polish,wrap-up auto').length - 1 === 2`, no `review,polish,wrap-up auto`.
  - `headless inserts the marker on both first-call invocation lines` — `out.split('" DISPATCH_HEADLESS=1 /claude-tweaks:flow').length - 1 === 2`; `call:'second', headless:true` throws `/first call only/`.
  - `resume prefixes RESUME_PR and appends the resume context` — verdict `{ prUrl:'https://github.com/o/r/pull/9', priorRunId:'2026-10-30T101632-record-4589', context:{ lastPhase:{section:'/build', step:'Common Step 1.6'}, openDefects:['plan review: 2 questions','x'] } }`: two `" RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow` hits; the resume line sits after `contract § Model Selection` and before `OPTS.effortLine`; `renderResumeContext` with null/empty yields `…; last logged phase: none recorded; open defects: none recorded`; `call:'second'` + resume throws `/first call only/`; `headless` + resume throws `/resume/`.
  - `renders a $& path literally` — `runDir:'/tmp/a$&b/.claude-tweaks/pipelines/r1'`: `out.includes('/tmp/a$&b/.claude-tweaks/pipelines/r1')`.
  - `AC4.1: an unsubstituted placeholder fails the render` — `selectedAt: undefined` throws `/unsubstituted.*\{ISO\}/`; `findUnsubstituted('x {minted-run-dir} y')` deep-equals `['{minted-run-dir}']`.
  - `AC4.1 go-red control` — `assert.throws(() => assertRendered(out.split(OPTS.runDir).join('{minted-run-dir}'), …))`.
  - `AC3.1: editing a sentence in a fenced block changes the output with no code change` — `doctored = text.replace('Never run \`git stash\`', 'Never run EDITED-SENTENCE')` (assert `doctored !== text`); render of `doctored` includes `Never run EDITED-SENTENCE`, render of `text` does not.
  - `a template that lost a value placeholder fails loud` — `text.replace('{policy-values}', 'none')` throws `/\{policy-values\}/`.
  - `profileOf reads each template's [Use:] line` — `'capable'` / `'standard'`; no `[Use:` throws.
  - `structure drift throws` — `extractTemplates(text.replace('## Second call', '## Gone'))` throws `/Second call/`.
  - `marker and digest` — `MARKER_RE.exec(out)` captures the run id and call; `markerLine('r1','second') === '[dispatch-prompt: r1 second]'`.
  - `digest ignores trailing whitespace only` — `promptDigest('a\nb') === promptDigest('a\nb\n\n ')`; `promptDigest('a\nb') !== promptDigest('a \nb')`; matches `/^[0-9a-f]{64}$/`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/dispatch/task-prompt'`

- [ ] **Step 3: Edit `task-prompt.md` item 3, then implement the module**

Item 3: replace `3. **Resolved policy values** — one call, before either dispatch:` with ``3. **Resolved policy values** — `{policy-values}`, from`` (rest unchanged; net ≈ +4 B — Task 4 recovers it).

`renderTaskPrompt` order: (1) template = `extractTemplates(text)[call]`; (2) `nextSteps` → replace the call's step-list token + ` auto` (`build,test auto` / `review,polish,wrap-up auto`) with `${nextSteps.join(',')} auto`, requiring exactly 2 hits; (3) `headless`/`resume` first-call only (`'--headless/--resume apply to the first call only'`), mutually exclusive (`'resume is human-typed: no DISPATCH_HEADLESS'`); `headless` turns `PIPELINE_RUN_DIR="{minted-run-dir}" /claude-tweaks:flow` into `… DISPATCH_HEADLESS=1 /claude-tweaks:flow`, `resume` into `… RESUME_PR="{prUrl}" /claude-tweaks:flow`, each requiring 2 hits; (4) one issue → `#{issue}` → `#N`; two or more → `"#{n1},#{n2},..."` → `"#a,#b"` — ≥ 1 hit; (5) the `{context-pack}` line → the Context pack region; (6) assert `{policy-values}`, `{ISO}` occur, then substitute every `DISPATCHER_PLACEHOLDERS` entry with split/join (`{issue list}` → `issues.map(n => '#' + n).join(', ')`, `{comma-joined issue numbers}` → `issues.join(',')`, `{run-id}` → `path.basename(runDir)`, `{ISO}` → `selectedAt`; an `undefined`/`null` value is skipped so step 7 reports it); (7) `findUnsubstituted` non-empty → `throw new Error('unsubstituted placeholder(s): …')`; (8) prepend `markerLine(...) + '\n\n'`; append `\n\n${renderResumeContext(resume)}` when `resume`, then `\n\n${effortLine}` when given. Header comment names #4589, the source file, the closed placeholder set, and that `MARKER_RE`/`promptDigest`/`REGISTRY_FILE` are shared with `bin/lib/hooks/dispatch-prompt-gate.js`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/dispatch/task-prompt.test.js tests/dispatch-prompt-bundle-citations.test.js tests/claim-mcp-projection-conformance.test.js tests/dispatch-resume-prose.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/dispatch/task-prompt.js tests/bin-lib/dispatch/task-prompt.test.js plugin/skills/dispatch/task-prompt.md` then `git commit -m "Add dispatch task-prompt renderer — fills task-prompt.md's templates from a closed placeholder set, refs #4589"`.

### Task 2: CLI `plugin/bin/dispatch-prompt.js`

**Role:** integration

**Files:**
- Create: `plugin/bin/dispatch-prompt.js`
- Test: `tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `renderTaskPrompt`, `extractTemplates`, `profileOf`, `promptDigest`, `REGISTRY_FILE`; `FIRST_CALL_STEPS`/`SECOND_CALL_STEPS` from `plugin/bin/lib/dispatch/first-call-artifact-check.js`; `anchoredOrOutsideMessage` from `plugin/bin/lib/run-dir-guard.js`; `sessionTmpRoot` from `plugin/bin/lib/session-tmp.js`.
- Produces: `run(argv, deps) => 0|1|2`, `parseArgs(argv)`. Usage: `dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M...] --out <file> [--next-steps s1,s2] [--headless] [--resume-verdict <file>] [--selected-at <ISO|unknown>] [--help]`. `--out` required (prompt never on stdout). `deps`: `{ cwd(), isDirectory(p), anchoredOrOutsideMessage, readFile(p), writeFile(p, s), appendFile(p, s), resolvePolicyValues(cwd) => string, resolveProfile(name, { unattended, cwd }) => {model, effort, source, effortLine}, selectedAt() => string, now() => string, stdout(s), stderr(s) }`. On exit 0: `writeFile(out, prompt)`, then `appendFile(path.join(run, REGISTRY_FILE), JSON.stringify({ sha256: promptDigest(prompt), call, out, issues, at: now() }) + '\n')`; stdout one JSON line `{ out, bytes, call, issues, continuation, resume, profile: { name, model, effort, source }, selectedAt, sha256 }`. A registry append failure after the write → exit 1 (the prompt was never recorded, so the gate would deny it).

- [ ] **Step 1: Write the failing tests** (fake `deps`; a real `fs.mkdtempSync(path.join(os.tmpdir(), 'dp-'))` run dir, outside any checkout so accepted):
  - `AC1.1: one call renders the first-call prompt to --out, records its digest, and reports the profile` — exit 0; the written file has no `findUnsubstituted` hit; the appended registry line parses to `{ sha256: promptDigest(written), call:'first', out, issues:[4589] }`; stdout `{ call:'first', continuation:false, resume:false, profile:{ name:'capable', … }, sha256 }`; `resolveProfile` called with `'capable'`.
  - `second call resolves the standard profile` — `resolveProfile` called with `'standard'`.
  - `AC1.1: --next-steps renders a continuation and validates the steps` — `--call first --next-steps test` exit 0, `continuation:true`; `--next-steps review` on first → 2; `--next-steps test,test` → 2.
  - `--headless passes unattended and is refused on the second call` — first: `resolveProfile` saw `{ unattended: true }`; `--call second --headless` → 2, no write, no append.
  - `--resume-verdict renders a resume first call` — verdict `{"eligible":true,"issue":4589,"prUrl":"https://github.com/o/r/pull/9","priorRunId":"r0","context":{"lastPhase":null,"openDefects":[]}}`: exit 0, `resume:true`, prompt includes `RESUME_PR="https://github.com/o/r/pull/9" /claude-tweaks:flow #4589` and `Resuming stalled run r0`. Exit 2, no write, no append, for: `--call second`, `--issues 4589,4590`, `--headless`, `issue: 4590`, `eligible: false`. Non-JSON verdict → 1.
  - `malformed invocations exit 2` — missing `--call`, `--call third`, missing `--out`, `--issues 0`, `--issues 12,abc`, `--issues 5,5`, unknown flag, value flag last, `--selected-at nope`.
  - `a refused --run exits 2 and writes nothing` — non-existent dir; `anchoredOrOutsideMessage` faked to a message → 2, no write, no append.
  - `a failing resolver or unreadable template exits 1 and writes nothing` — `resolvePolicyValues` throws → 1; `resolveProfile` throws → 1; template `readFile` throws → 1; `writeFile` throws → 1 with the path on stderr, no append.
  - `a failed registry append exits 1` — `appendFile` throws → 1, stderr names the registry path.
  - `AC3.1 at the CLI: an injected template edit reaches the output` — `readFile` returns the live text with one fenced sentence edited; the written prompt carries the edit.
  - `--selected-at overrides the session file` — `--selected-at unknown` → `Selected at: unknown`, `deps.selectedAt` not called.
  - `--help exits 0 before any probe`; `real binary smoke` — `execFileSync(process.execPath, [CLI, '--help'], { windowsHide: true })` prints `usage: dispatch-prompt.js`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/dispatch-prompt'`

- [ ] **Step 3: Implement `plugin/bin/dispatch-prompt.js`**

Header: purpose (#4589), usage, exit codes, the shape-4 guard citing `compose-context.js`, that a non-zero exit is never followed by hand substitution (`two-call-gate.md` §2), and that the registry feeds `bin/lib/hooks/dispatch-prompt-gate.js`. `PLUGIN_ROOT = path.resolve(__dirname, '..')` is the template location (`skills/dispatch/task-prompt.md`) and the `{plugin-root}` value. Real deps: `resolvePolicyValues` runs `execFileSync(process.execPath, [path.join(PLUGIN_ROOT,'bin','resolve-policy.js'), '--values', 'autonomy,integration-model,merge-verification,risk-floor,size-floor'], { cwd, encoding:'utf8', windowsHide:true })` and zips the five lines into `key=value` joined by `', '` (empty line → `key=(unset)`); `resolveProfile` runs `resolve-profile.js {name}` (+ `--unattended`) and `JSON.parse`s; `selectedAt` returns `fs.statSync(path.join(sessionTmpRoot(process.env.CLAUDE_CODE_SESSION_ID), 'dispatch-groups.json')).mtime.toISOString()` or `'unknown'` on a null root or any throw; `appendFile` is `fs.appendFileSync`. Validate `--next-steps` against `FIRST_CALL_STEPS`/`SECOND_CALL_STEPS`, rejecting duplicates. `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`

- [ ] **Step 4: Run tests plus the bin source scans**

Run: `node --test tests/bin-lib/dispatch/dispatch-prompt-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Live probe** — against a scratch copy of a run dir (`mkdir` under the session scratchpad; never this run's real directory), `node plugin/bin/dispatch-prompt.js --call first --run "{scratch run dir}" --issues 4589 --out "{scratchpad}/p1.md"` and the same with `--call second`: both exit 0; each file reads as a complete prompt against its template; the registry holds two lines. Quote both envelope lines in the commit body.

- [ ] **Step 6: Commit** `git add plugin/bin/dispatch-prompt.js tests/bin-lib/dispatch/dispatch-prompt-cli.test.js` then `git commit -m "Add dispatch-prompt.js — one CLI call renders each dispatch Task prompt and records its digest, refs #4589"`.

### Task 3: PreToolUse prompt-fidelity gate

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/hooks/dispatch-prompt-gate.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`runInner`'s first line: one early return for tool names `Agent`/`Task`, like the AskUserQuestion line; export the gate)
- Modify: `plugin/hooks/hooks.json` (two PreToolUse entries, matchers `Agent` and `Task`, the same `pre-tool-use` command, no `if`)
- Modify: `docs/hooks.md` (one bullet, block tier, after the Review Console ask gate's mention in the Tiered posture bullet's neighbourhood — a new bullet, not an edit of that one)
- Test: `tests/hooks-dispatch-prompt-gate.test.js`
- Test: `tests/hooks-dispatcher.test.js` (one matcher case for `Agent` and `Task`)

**Interfaces:**
- Consumes: Task 1's `MARKER_RE`, `promptDigest`, `REGISTRY_FILE` (required lazily inside a try — a load fault allows); `isDispatchTaskCallForRun(runDir, sessionId)` from `plugin/bin/lib/dispatch/task-call.js` (the existing discriminator — never retyped); `wtDetect.mainCheckoutRoot`, `path-guard`'s `canonicalRealpath`, `shared-primitives.js`'s `isPathContained`; `ctxLib.appendEvent`. The deny outcome comes from `pre-tool-use.js`'s `denyResult` **passed in as an argument** by `runInner` (`checkDispatchPromptGate(ctx, deps, denyResult)`) — the gate module never requires `pre-tool-use.js` (no require cycle).
- Produces: `checkDispatchPromptGate(ctx, deps = {}, deny) => {} | deny(reason)`; `deps`: `{ fsImpl, mainCheckoutRoot, isDispatchTaskCallForRun, loadTaskPrompt }` test seams (`loadTaskPrompt` defaults to `() => require('../dispatch/task-prompt')`).

Run read by this gate: **neither `ctx.runDir` nor `ctx.ownedRun`** — the run is the one the prompt names (`PIPELINE_RUN_DIR="X"`), anchored (below), because the dispatching session's cwd is the main checkout and its own `ctx.ownedRun` is not the group's run. State this in the header comment.

Direction (header comment, verbatim intent): fails OPEN on every unprovable answer; denies only:
- **(A) mismatch** — the prompt carries a `MARKER_RE` line naming run id `R`; some `PIPELINE_RUN_DIR="X"` in the prompt has `path.basename(X) === R` and `X` is anchored; reading `X/dispatch-prompts.jsonl` succeeds (or fails with `ENOENT`: no prompt was ever rendered for this run); and no parsed line's `sha256` equals `promptDigest(tool_input.prompt)`. Deny reason: `claude-tweaks: this dispatch Task prompt for run {R} is not byte-for-byte a prompt bin/dispatch-prompt.js rendered (#4589). Resend the rendered file unchanged — cat "{out}" and pass its text as the prompt; never edit or re-type it by hand.` — `{out}` = the latest registry line's `out` for the marker's call, else `the file dispatch-prompt.js --out wrote`.
- **(B) missing marker** — no `MARKER_RE` line; `tool_input.agent_id`-free input (`ctx.input.agent_id` absent or empty: a main-thread call); the prompt matches `/PIPELINE_RUN_DIR="([^"]+)"(?: [A-Z_]+="[^"]*"| [A-Z_]+=\S+)* \/claude-tweaks:flow\b/`; the captured `X` is anchored; `isDispatchTaskCallForRun(X, ctx.input.session_id)` is true. Deny reason: `claude-tweaks: this is a /claude-tweaks:dispatch Task prompt for run {basename X}, but it carries no dispatch-prompt.js marker (#4589). Render it with node "{pluginRoot}/bin/dispatch-prompt.js" (dispatch SKILL.md Step 5) and pass the written file unchanged — never fill task-prompt.md by hand.`
- **Anchored** = `X` absolute; `canonicalRealpath(X)` resolves to a directory; `mainCheckoutRoot(ctx.cwd)` resolves (not null, not indeterminate); `isPathContained(canonicalRealpath(X), path.join(canonicalRealpath(main), '.claude-tweaks', 'pipelines'))` and the real dir's parent is exactly that pipelines dir.
- Each deny appends `appendEvent(X, 'gate-denial', { tool: tool_name, gate: 'dispatch-prompt-fidelity', reason: 'mismatch'|'missing-marker' })` (attribution omitted: the prompt names the run).

- [ ] **Step 1: Write the failing tests** in `tests/hooks-dispatch-prompt-gate.test.js` — fixtures: a temp main checkout (`git init`) with `.claude-tweaks/pipelines/R/` holding `run-state.json` `{ dispatched: true, dispatchSessionId: 'S' }`, a rendered prompt from Task 1's `renderTaskPrompt` against the live template, and its registry line:
  - `AC5.1: the rendered prompt is allowed` — `{}`; same with one trailing `\n` added (digest normalization).
  - `AC5.1: a prompt that differs from the rendered file is denied before the agent starts` — one interior word changed → `permissionDecision: 'deny'`, reason includes `byte-for-byte` and the registry's `out` path; a `gate-denial` event with `reason: 'mismatch'` lands in `R/events.jsonl`; both `tool_name: 'Agent'` and `'Task'`.
  - `AC5.1: a marker-bearing prompt with no registry is denied` — `ENOENT` registry → deny.
  - `AC5.1: a marker-less dispatch prompt from the bound session's main thread is denied` — the rendered prompt with the marker line removed, `session_id: 'S'`, no `agent_id` → deny, reason includes `no dispatch-prompt.js marker`; event `reason: 'missing-marker'`.
  - `AC5.1: a marker-less prompt carrying agent_id is allowed` — same with `agent_id: 'a1'` → `{}`.
  - Fail-open, one test each, all `{}`: tool name other than `Agent`/`Task`; `tool_input.prompt` not a string; marker-less from session `'T'` ≠ `dispatchSessionId`; marker-less with `run-state.json` missing `dispatched`; marker-less prompt with no `/claude-tweaks:flow` after the assignment (e.g. `PIPELINE_RUN_DIR="X" CLAIM_RUN_ID="r" /claude-tweaks:wrap-up …`); `X` relative; `X` outside the main checkout's `.claude-tweaks/pipelines/`; `X` a worktree-local shadow `{worktree}/.claude-tweaks/pipelines/R`; `mainCheckoutRoot` returning `null` and `{ indeterminate: true }`; marker run id with no matching `PIPELINE_RUN_DIR`; registry read throwing `EACCES`; a malformed registry line skipped while a later valid line matches (allowed); `deps.loadTaskPrompt` throwing.
  - `routes: every skill line that runs /claude-tweaks:flow with a PIPELINE_RUN_DIR prefix is ruled` — `git grep -n -E 'PIPELINE_RUN_DIR="[^"]*"[^\x60]{0,80}/claude-tweaks:flow' -- plugin/skills` (via `execFileSync('git', [...], { windowsHide: true })`) yields exactly the expected set of `path` values, each ruled in a comment: `dispatch/task-prompt.md` (rendered by the CLI, carries the marker), `dispatch/SKILL.md` (Step 5's illustrative lines; the dispatched text is the rendered file), and every other hit a human-typed resume/re-entry command run as a slash command, never an Agent prompt (`_shared/auto-mode-contract.md`, `_shared/pr-early-run-lifecycle.md`, `build/execution-mode-policy.md`, `dispatch/resume-confirmation.md`, `dispatch/settle-parked.md`, `flow/SKILL.md`, `flow/claim-targets.md`, `flow/multi-spec.md`, `flow/multispec-review-console.md`, `flow/steps-and-gates.md`, `flow/summary-template.md`, `tidy/step-6-auto.md`, `wrap-up/resume-halted-run.md`) — re-derive this list at build time and read each hit before ruling it; a hit that tells a dispatch session's main thread to pass it as an Agent prompt is rerouted to the CLI in Task 4 instead.
  - In `tests/hooks-dispatcher.test.js`: `AC5.1: hooks.json registers PreToolUse matchers for Agent and Task (unfiltered, literal tool-name match)` — mirroring the AskUserQuestion case; and one end-to-end spawn of `hooks.js pre-tool-use` with an `Agent` payload carrying a mismatched marker prompt against the temp fixture → stdout `permissionDecision: 'deny'`, exit 0.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/hooks-dispatch-prompt-gate.test.js tests/hooks-dispatcher.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/lib/hooks/dispatch-prompt-gate'` and the matcher case red.

- [ ] **Step 3: Implement** the module, the `runInner` early return (`if (ctx.input && (ctx.input.tool_name === 'Agent' || ctx.input.tool_name === 'Task')) return checkDispatchPromptGate(ctx, deps, denyResult);` — no other gate applies to these tools), the two `hooks.json` entries, and the `docs/hooks.md` bullet: **Dispatch-prompt fidelity gate (block tier, #4589)** — what (A) and (B) deny, that the run is the one the prompt names (anchored), every fail-open condition by name, the `agent_id` main-thread scoping and its residual (a dispatching session that is itself a Task subagent, `dispatch/sequential-execution.md`'s #447 shape, is not checked for a missing marker; a marker-bearing prompt still is), and a pointer to `docs/reference/pretooluse-agent-tool-probe.md`.

- [ ] **Step 4: Prove discrimination and run the suites** — revert only `dispatch-prompt-gate.js`'s digest comparison (`git checkout` of that file's prior content is impossible for a new file, so temporarily make the comparison `true`), confirm the mismatch tests and only those go red, restore; do the same for the `agent_id` check (the agent_id-allowed test goes red) and the anchoring check (the outside/shadow tests go red). Then run: `node --test tests/hooks-dispatch-prompt-gate.test.js tests/hooks-dispatcher.test.js tests/hooks-pre-tool-use.test.js tests/hooks-gate-coverage.test.js tests/path-guard-conformance.test.js tests/path-containment-conformance.test.js tests/payload-boundary.test.js tests/claude-plugin-root-require-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit** `git add plugin/bin/lib/hooks/dispatch-prompt-gate.js plugin/bin/lib/hooks/pre-tool-use.js plugin/hooks/hooks.json docs/hooks.md tests/hooks-dispatch-prompt-gate.test.js tests/hooks-dispatcher.test.js` then `git commit -m "Deny dispatch Task prompts that differ from the rendered file — PreToolUse gate on Agent/Task, refs #4589"`.

### Task 4: Point Step 5, `task-prompt.md`, `two-call-gate.md` and `resume.md` at the CLI; document it

**Role:** integration

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md` (Step 5's two template paragraphs, ~lines 261-263)
- Modify: `plugin/skills/dispatch/task-prompt.md` (line 3; lines 99-103 "Substitute this whole block" paragraph — keep its first sentence's leading words `Substitute this whole block` as Task 1's anchor; line 141 "Before substituting this template" paragraph; line 145 Resume paragraph; model-log paragraph lines 120-135; Continuation call section)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (§2, one new paragraph after its first)
- Modify: `plugin/skills/dispatch/resume.md` (Step 7 paragraph)
- Modify: `docs/plugin-structure.md` (`plugin/bin/lib/dispatch/` row gains `task-prompt.js`; `plugin/bin/lib/hooks/` row gains `dispatch-prompt-gate.js`; a CLI command line after the `dispatch-resume.js` line)
- Modify: `docs/skill-graph.md` (one `/dispatch` row after the `bin/compose-context.js --phase` row)
- Test: `tests/dispatch-prompt-cli-prose.test.js`
- Test (re-run, re-pointed only if red): `tests/dispatch-resume-prose.test.js`, `tests/dispatch-model-profile-conformance.test.js`, `tests/dispatch-handoff-continuation-conformance.test.js`, `tests/dispatch-prompt-bundle-citations.test.js`, `tests/foreground-execution-instruction.test.js`, `tests/dispatch-worktree-anchoring.test.js`, `tests/claim-mcp-projection-conformance.test.js`, `tests/flow-context-handoff-conformance.test.js`, `tests/dispatch-express-routing-prose.test.js`, `tests/skill-graph-table-structure.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`, plus every hit of Step 0's grep

**Interfaces:**
- Consumes: Task 2's usage line and envelope fields `out`, `profile.model`, `profile.source`; Task 3's deny reasons.

- [ ] **Step 0: Moved-prose pin survey** — for each paragraph this task rewrites, run `git grep -n -F '{phrase}' -- tests plugin` on two or three distinctive phrases per paragraph; for every hit outside the edited file, grep `tests/` for that file's basename. List each pinned phrase; the rewrite keeps every pinned phrase verbatim or re-points its test in this task's commit.

- [ ] **Step 1: Write the failing prose test** `tests/dispatch-prompt-cli-prose.test.js` (`readText` from `tests/helpers/read-skill`), AC1.1 assertions factored into `assertStep5(text)`:
  - `AC1.1: Step 5 renders each Task prompt with dispatch-prompt.js and forbids hand substitution` — SKILL.md's Step 5 region (`### Step 5` to `### Step 6`) includes `bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues`, `--out`, `profile.model`, `never paraphrase, summarize or fill it by hand`, and `resend it unchanged`.
  - `AC2.1: a non-zero exit blocks the group through the terminal path` — two-call-gate.md §2 (`## 2.` to `## 5.`) includes `` `dispatch-prompt.js` exits non-zero ``, `never dispatched`, `section 5`, `section 6`; Step 5 region includes `` `two-call-gate.md`'s terminal path ``.
  - `AC2.1: no hand-substitution fallback survives` — none of SKILL.md, task-prompt.md, two-call-gate.md, resume.md matches `/copy (that call's|each) fenced block by hand|fill(ed)? (it|the template) by hand instead|Copy each fenced block below exactly/i`; control: the regex matches `on a non-zero exit, copy that call's fenced block by hand per task-prompt.md instead` and today's line-3 sentence `Copy each fenced block below exactly, substituting`.
  - `task-prompt.md names the CLI as the renderer of its fenced blocks` — first paragraph includes `dispatch-prompt.js` and `the only template source`; Continuation call section includes `--next-steps`; Resume paragraph includes `--resume-verdict`.
  - `resume.md Step 7 renders the first call with --resume-verdict` — includes `dispatch-prompt.js` and `--resume-verdict`.
  - `the CLI file named in prose exists` — `plugin/bin/dispatch-prompt.js` is a file.
  - `rail: task-prompt.md stays at or under 52,300 bytes` — `Buffer.byteLength(text) <= 52300`.
  - Go-red control: `assert.throws(() => assertStep5(step5.split('dispatch-prompt.js').join('x.js')))`.
  - Header comment: `Waived AC1.2: express-lane prompt out of scope by Decision 2 (#4735).`

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js`
Expected: FAIL (`dispatch-prompt.js` absent from SKILL.md)

- [ ] **Step 3: Edit the prose**
  - SKILL.md Step 5, one paragraph: render each call's prompt with `node "${CLAUDE_PLUGIN_ROOT}/bin/dispatch-prompt.js" --call first|second --run "{minted-run-dir}" --issues {n}[,{m}...] --out "{file}" [--headless] [--next-steps {NEXT_STEPS}] [--resume-verdict {file}]` (`{file}` from `session-tmp-resolve.js --value dispatch-prompt-{run-id}-{call}.md`; flags as `task-prompt.md` decides them), print the file with one plain `cat "{file}"`, and pass that text unchanged as the `Task()` prompt with the envelope's `profile.model` as its `model` — never paraphrase, summarize or fill it by hand (`_shared/subagent-output-contract.md`'s input discipline); a PreToolUse gate denies any other text, and a denied call is resent unchanged from the same file. A non-zero exit takes `two-call-gate.md`'s terminal path (§2). Keep "the exact wording is load-bearing for the four-value status line and output format contracts downstream skills parse". Second paragraph: the CLI resolves `task-prompt.md`'s Context pack (#1542) itself; the `compose-context.js --phase` line still runs before each call. Net SKILL.md ≤ +400 B.
  - task-prompt.md line 3: keep "**Each of this file's two templates must be inlined verbatim into its own `Task()` tool call**" and "Never inline both into one call."; replace "Copy each fenced block below exactly, substituting … as SKILL.md's Step 5 directs." with: each call's prompt is rendered by `bin/dispatch-prompt.js` (SKILL.md Step 5) — these fenced blocks and the Context pack's numbered items are its only template source, so an edited sentence here reaches every rendered prompt with no code change; nothing is substituted by hand, and a render failure blocks the group (`two-call-gate.md` §2).
  - task-prompt.md "Substitute this whole block" paragraph: keep its leading words and the clause that the pack is environment facts only (never a prior call's conclusions, the two-call gate's independence); drop the hand-substitution mechanics the CLI now performs.
  - task-prompt.md "Before substituting this template" paragraph: keep the headless discriminator (Routine bare drain / `next` → headless; any human-typed form → not), stated as the decision behind `--headless`; drop the substitution mechanics (`no {headless-marker} placeholder, no trailing space`, "stays outside the fenced block because…") unless Step 0 found them pinned.
  - task-prompt.md Resume paragraph: keep every clause `tests/dispatch-resume-prose.test.js` pins; replace the hand-append mechanics with "`dispatch-prompt.js --resume-verdict {file}` (Step 2's `dispatch-resume.js` JSON line) adds `RESUME_PR` and appends `{resume-context}`."
  - task-prompt.md model-log paragraph: "keep the resolved `model` and `source`" → the `model` and `source` of `dispatch-prompt.js`'s envelope `profile`; every string pinned by `tests/dispatch-model-profile-conformance.test.js` stays.
  - task-prompt.md Continuation call section: append "Render it with `dispatch-prompt.js --next-steps {NEXT_STEPS}`."; every existing sentence stays.
  - two-call-gate.md §2, after its first paragraph: **A prompt that does not render (#4589).** When `dispatch-prompt.js` exits non-zero for a call, that call is never dispatched and its template is never filled by hand: log `Prompt render failed: exit {code}: {stderr}` via `log-decision.js --status REFUSED --text-file "{text-file}"` (`_shared/auto-decision-log.md`'s Text from git or a user paragraph), then treat it as that call returning no parseable report — a first call or its continuation goes to section 5, a second call or its continuation to section 6.
  - resume.md Step 7: replace the hand mechanics with "render the first call with `dispatch-prompt.js --resume-verdict {file}` (Step 2's JSON line, written with the Write tool), which adds `RESUME_PR="{prUrl}" ` immediately before `/claude-tweaks:flow` and appends `{resume-context}` from the CLI's `context`"; the `RESUME_PR="{prUrl}" ` literal and the `two-call-gate.md` citation stay.
  - `docs/plugin-structure.md`: `task-prompt.js` (#4589 — extracts `task-prompt.md`'s two fenced templates and Context pack, fills the dispatcher placeholders, owns the prompt marker and digest) in the dispatch lib row; `dispatch-prompt-gate.js` (#4589 — PreToolUse deny on an `Agent`/`Task` dispatch prompt that is not a rendered one) in the hooks lib row; after the `dispatch-resume.js` line: `node plugin/bin/dispatch-prompt.js --call first|second --run <run-dir> --issues N[,M] --out <file> [--next-steps …] [--headless] [--resume-verdict <file>] [--selected-at <ISO|unknown>]   # Dispatch-prompt CLI (#4589) — renders a dispatch Task prompt and records its digest in the run dir's dispatch-prompts.jsonl; exit 0 rendered, 1 failure, 2 malformed or refused --run (tests in tests/bin-lib/dispatch/dispatch-prompt-cli.test.js)`.
  - `docs/skill-graph.md`: `| \`bin/dispatch-prompt.js\` (\`bin/lib/dispatch/task-prompt.js\`) | Step 5 renders each Task prompt — first, second, a continuation, a resume's first call — from \`task-prompt.md\`'s fenced blocks and Context pack, its only template source; a non-zero exit blocks the group through \`two-call-gate.md\` §2; \`bin/lib/hooks/dispatch-prompt-gate.js\` denies a dispatched prompt that is not a rendered one. |`
  - `wc -c plugin/skills/dispatch/SKILL.md plugin/skills/dispatch/task-prompt.md` — task-prompt.md ≤ 52,300; SKILL.md ≤ 51,807.

- [ ] **Step 4: Run the prose tests that read these files**

Run: `node --test tests/dispatch-prompt-cli-prose.test.js tests/dispatch-resume-prose.test.js tests/dispatch-model-profile-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/foreground-execution-instruction.test.js tests/dispatch-worktree-anchoring.test.js tests/claim-mcp-projection-conformance.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/skill-graph-table-structure.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/bin-lib/dispatch/task-prompt.test.js tests/hooks-dispatch-prompt-gate.test.js` plus every Step 0 hit
Expected: PASS

- [ ] **Step 5: Commit** `git add` the modified files listed above plus `tests/dispatch-prompt-cli-prose.test.js` and any re-pointed test, then `git commit -m "Point dispatch Step 5 at dispatch-prompt.js — prompts rendered, not hand-substituted, refs #4589"`.

### Task 5: Scope-sweep read-back (no code)

**Role:** transcription

Re-reads Check B's out-of-Files hits against the finished branch so the plan-time rulings are confirmed, not assumed. A file changes only if Step 1 finds a sentence telling the dispatching session to fill `task-prompt.md`'s templates by hand.

**Files:** (read back; edited only on a stale sentence; `CHANGELOG.md` never edited)
- Modify: `CHANGELOG.md`
- Modify: `docs/journeys/clear-the-two-call-gate-for-a-dispatched-group-2775.md`
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md`
- Modify: `docs/journeys/resume-a-stalled-dispatched-build-4588.md`
- Modify: `docs/superpowers/plans/2026-10-30-dispatch-resume-stalled-build.md`
- Modify: `plugin/bin/lib/dispatch/resume-eligibility.js`
- Modify: `plugin/skills/_shared/subagent-output-contract.md`
- Modify: `plugin/skills/dispatch/express-prompt.md`
- Modify: `plugin/skills/flow/multispec-parallel-waves.md`
- Modify: `docs/superpowers/plans/2026-10-31-write-capable-child-progress-probe.md` (a shipped plan — history, never edited)
- Test: `tests/bin-lib/dispatch/resume-eligibility.test.js`
- Test: `tests/fixtures/dispatch-resume/record-4589-decisions.md`
- Test: `tests/claim-mcp-projection-conformance.test.js`
- Test: `tests/dispatch-express-routing-prose.test.js`
- Test: `tests/dispatch-model-profile-conformance.test.js`
- Test: `tests/dispatch-prompt-bundle-citations.test.js`
- Test: `tests/dispatch-resume-prose.test.js`
- Test: `tests/flow-context-handoff-conformance.test.js`

- [ ] **Step 1: Read back** — grep each file for `{context-pack}`, `Context pack`, `resume-context`, `substitut`; a sentence contradicting Task 4's prose is edited to cite `dispatch-prompt.js`. `express-prompt.md` and `multispec-parallel-waves.md` keep their own templates (#4735; a `/claude-tweaks:capture` follow-up for `multispec-parallel-waves.md` is filed in Common Step 4).
- [ ] **Step 2: Run** `node --test tests/bin-lib/dispatch/resume-eligibility.test.js tests/claim-mcp-projection-conformance.test.js tests/dispatch-express-routing-prose.test.js tests/dispatch-model-profile-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js tests/dispatch-resume-prose.test.js tests/flow-context-handoff-conformance.test.js` — Expected: PASS.
- [ ] **Step 3: Commit** only when Step 1 edited a file: `git add {edited paths}` then `git commit -m "Align {file} with dispatch-prompt.js — refs #4589"`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI, context pack resolution, template fill, writes to a file) | 1, 2 |
| Deliverable 2 (Step 5 points at CLI; fenced blocks stay the source) | 4 (+1's item-3 edit) |
| Deliverable 3 (fixed sentences + no unsubstituted placeholder) | 1 Step 1 |
| AC1.1 (first/second/continuation prompts with one CLI call, no manual substitution) | 1, 2, 4 tests named `AC1.1` |
| AC1.2 (express out of scope) | Waived AC1.2: Decision 2, #4735 |
| AC2.1 (non-zero exit takes the terminal path; never filled by hand) | 4 tests named `AC2.1` |
| AC3.1 (fenced-block edit changes output with no code change) | 1, 2 tests named `AC3.1` |
| AC4.1 (test fails when a placeholder is left unsubstituted) | 1 tests named `AC4.1` |
| AC5.1 (differing or marker-less prompt denied before the agent starts) | 0 (premise), 3 tests named `AC5.1` |
| Decision 3 probe (PreToolUse fires for `Agent` with `tool_input.prompt`; `Task` naming) | 0 |
