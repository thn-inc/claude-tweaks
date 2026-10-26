# Phase Procedure Bundles, Mechanics CLIs, and a Context Cap — Implementation Plan (#4027)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut what dispatched pipeline agents read mid-run. Each phase's shared procedure gets composed once from a single registry. The four pure-mechanics steps (claim, materialize, PR-early lifecycle, manifesto) run as CLI calls whose prose is read only when the CLI fails. A per-agent context cap hands the next phase to a fresh agent through a handoff file.

**Architecture:** A phase registry (`plugin/bin/lib/compose-context/phases.js`) names each phase's bundles. `compose-context.js --phase` composes them, and the composed-bytes rail scanner measures them. Two new CLIs, `pr-early-open.js` and `manifesto-write.js`, plus a `--steps` skip-guard on `claim-targets.js`, replace hand-run procedures. The flow and build prose then points at the CLIs and reads the procedure files only on a non-zero exit. A `context-gauge.js` CLI measures the running agent's own context from its transcript. `/flow` checks it at every phase boundary: a dispatched call reports `OUTCOME: handoff` and the dispatcher continues the remaining steps in a fresh call, while a top-level run hands the remaining steps to a fresh `Agent`.

**Tech Stack:** Node 18+ CommonJS, no external dependencies, `node --test`. Markdown skill prose under `plugin/skills/`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T162129-record-4027/work/4027-spec.md` (record #4027).

**Premise reversal (logged to decisions.md at Spec Step 3):** Deliverable 1 says each bundle is "inlined in its prompt". A probe on Claude Code 2.1.302 (scratchpad probe plugin) showed two blockers. A 32.9 KB `SubagentStart` `additionalContext` was persisted to a file, and the subagent saw only a 2 KB preview. A dispatcher that writes a bundle into a `Task()` prompt pays output tokens equal to the bundle's size. So this plan does something else: each dispatch composes the phase's bundles with one `--phase` call, and the child loads each always-needed bundle with one whole-file Read before its first step. Each section still arrives once, with no piecewise `sed`/`grep` reads. `RAIL_BYTES` (52,500 B, `plugin/bin/lib/skill-audit/budgets.js`) caps each bundle, so a phase may own more than one bundle.

## Global Constraints

- Node 18+; zero runtime dependencies; tests use `node:test` + `node:assert/strict` and run under `npm test`.
- Every new `plugin/bin/*.js` CLI follows the `gh-api-module-pattern` skill's CLI wrapper contract (its `cli-wrapper-contract.md`): `run(argv, deps)` seam, `require.main === module` guard, `process.exitCode` (never `process.exit()` after a write), exit `0` ok / `2` malformed invocation / `1` internal or filesystem failure, plus any documented domain codes.
- Every `execFileSync`/`spawnSync` call passes `windowsHide: true`; every `git`/`gh` value argument comes after its `--end-of-options`/`--` separator where the tool supports one. The `bin-source-scan-conformance` suites (`tests/path-guard-conformance.test.js`, `tests/windows-hide-conformance.test.js`, and siblings under `tests/` matching `*conformance*`) must stay green.
- `--run` values are anchored strictly (cli-wrapper-contract.md: strict is the default): stage-item's `resolveTarget` with an injectable `mainRoot` — a missing dir, a dir outside every checkout, and a worktree-local shadow all exit 2 ([IL-127]). (Amended during execution; Task 4/5 rulings.)
- `decisions.md` lines are written only through `bin/lib/log-decision/append.js`'s `formatEntry`/`appendEntry`; `run-state.json` only through `bin/lib/hooks/context.js`'s `writeRunState`; `config.yml` levers only through `bin/lib/set-config/write.js`.
- Shipped code under `plugin/**` hardcodes no repo-specific literal (no `main`, no `origin` default other than the documented remote, no `thn-inc`) — resolve the integration branch via `resolve-policy.js`'s `integration-branch` key.
- Commit subjects: `{Verb} {what} — {detail}`, body `refs #4027`, trailer `Claude-Session: https://claude.ai/code/session_01BnAahExvB2qMQJHFbCiiXm`. Never `closes`/`fixes`.
- Any `plugin/skills/**/*.md` edit keeps the file under `RAIL_BYTES` (52,500 B) — `plugin/skills/flow/SKILL.md` is at 48,428 B and `plugin/skills/build/SKILL.md` at 49,812 B before this plan, so prose added there must be offset by prose removed in the same task.
- Moved-prose pin discipline: before editing any `plugin/skills/**/*.md` sentence, `git grep -n -F` two or three distinctive phrases of it over `tests plugin`; every test hit is updated in the same task.

## Review Focus

1. A minted run dir whose `decisions.md` already holds Step 2.8 claim lines: `manifesto-write.js` must keep those lines below the new snapshot header, never overwrite them (`checkBookkeepingStampsGate` reads them).
2. A branch that already has an OPEN PR, or a CLOSED one from a prior attempt: `pr-early-open.js` must reuse or reopen, never open a duplicate.
3. No findable transcript, or an unreadable one: `context-gauge.js` fails open (`over: false` with a `reason`) and never stops a run.
4. An unknown `--phase` name, or `--phase` combined with positional sources: exit 2 and write nothing.
5. A registered phase bundle that grows past `RAIL_BYTES`: the composed-bytes rail gate must see it (the scanner expands `--phase` call lines), so it fails CI rather than shipping an unreadable bundle.

---

### Task 1: Phase registry and `compose-context.js --phase`

**Files:**
- Create: `plugin/bin/lib/compose-context/phases.js`
- Modify: `plugin/bin/lib/compose-context/index.js` (export `composePhase`)
- Modify: `plugin/bin/compose-context.js` (parse `--phase`)
- Modify: `plugin/bin/lib/skill-audit/context-cost.js` (`parseComposeCallLine` expands `--phase`)
- Test: `tests/bin-lib/compose-context/phases.test.js` (create), `tests/bin-lib/compose-context/cli.test.js`, `tests/bin-lib/skill-audit/context-cost.test.js`

**Interfaces:**
- Produces: `PHASES` — a frozen object `{ [phase]: { bundles: [{ step, sources: [pluginRelativePath...], load: 'always' | 'on-demand' }] } }` with exactly these entries:
  - `first-call`: `[{ step: 'claims', sources: ['skills/_shared/issue-claims.md'], load: 'on-demand' }]`
  - `second-call`: `[{ step: 'claims', sources: ['skills/_shared/issue-claims.md'], load: 'on-demand' }, { step: 'merge', sources: ['skills/_shared/pr-first-merge.md', 'skills/_shared/pr-checklist-refresh.md'], load: 'always' }]`
  - `review-lens`: `[{ step: 'review-dispatch', sources: ['skills/_shared/subagent-dispatch-core.md', 'skills/_shared/run-dir-resolution.md'], load: 'always' }]`
- Produces: `phaseBundles(phase: string, pluginRoot: string) -> [{ step, load, sources: [{ label, file }] }] | null` (null for an unknown phase; `file` is absolute under `pluginRoot`).
- Produces: `composePhase({ runDir, phase, pluginRoot, repoRoot }, deps) -> { phase, bundles: [{ step, load, path, bytes, sources, unresolved }] }` — composes every bundle with the existing `composeContext`, reading **all** sources of all bundles before writing any (a failing source leaves no bundle written).
- CLI: `compose-context.js --run <dir> --phase <name>` — mutually exclusive with positional sources and `--step`; prints one JSON line (the `composePhase` result); unknown phase → exit 2, usage names the known phases. The plugin root is `path.resolve(__dirname, '..')` for the CLI.

- [ ] **Step 1: Write failing tests**
  - `phases.test.js`: `PHASES` has exactly the three keys above; every bundle's `step` matches the CLI's `STEP_RE`; every source path exists under `plugin/` (`fs.existsSync(path.join(PLUGIN, src))`); `phaseBundles('nope', PLUGIN) === null`; every bundle's `load` is `'always'` or `'on-demand'`.
  - `cli.test.js`: `run(['--run', dir, '--phase', 'second-call'], deps)` returns 0, stdout JSON has `phase: 'second-call'` and `bundles.map(b => b.step)` deep-equals `['claims', 'merge']`, and `{dir}/context/merge.md` exists; `--phase nope` → 2 with nothing written under `{dir}/context`; `--phase second-call --step x` → 2; `--phase second-call some.md` → 2.
  - `context-cost.test.js`: `parseComposeCallLine('node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --phase review-lens', PLUGIN)` returns `{ phase: 'review-lens', bundles: [{ step: 'review-dispatch', sources: [...] }] }`; an unknown phase on such a line returns `{ unparsed: true, reason: 'unknown phase nope' }`; `findComposeCallSites` emits one row per bundle of a `--phase` line, each with its `step`.
- [ ] **Step 2: Run them — expect FAIL** (`node --test tests/bin-lib/compose-context/ tests/bin-lib/skill-audit/context-cost.test.js`: `Cannot find module '…/phases'` / unknown argument `--phase`).
- [ ] **Step 3: Implement** `phases.js`, `composePhase`, the CLI branch, and the scanner expansion. In `parseComposeCallLine`, treat `--phase <name>` as an alternative to `--step <name> <sources…>`: the line's sources come from `phaseBundles(name, repoRoot)`, and `findComposeCallSites` pushes one row per bundle (`step` = the bundle's step). An unknown name returns an unparsed row. A `--phase` line needs no sources on the line, so the placeholder test (which inspects only sources) cannot null it out. A `{plugin-root}`-prefixed `--phase` line in prose is still measured, which is intended: it is the registry's own bundles that get measured.
- [ ] **Step 4: Run the Step 1 tests plus `node --test tests/bin-lib/skill-audit/` — expect PASS**, and `node -e 'const {composedRailViolations}=require("./plugin/bin/lib/skill-audit/rail.js");console.log(JSON.stringify(composedRailViolations("plugin")))'` prints `[]`.
- [ ] **Step 5: Commit** — `Add compose-context phase registry — one source of truth for each phase's bundles`.

### Task 2: Dispatch sites compose by phase and load bundles once, whole

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (Context pack item 5 and the "Before substituting `{context-pack}`" paragraph)
- Modify: `plugin/skills/review/step3-lens-dispatch.md:23` (compose line)
- Modify: `plugin/skills/_shared/subagent-output-contract.md:33` (the "Cite the run's composed bundle" bullet)
- Test: `tests/dispatch-prompt-bundle-citations.test.js` and every other test the Moved-prose pin grep finds

**Interfaces:**
- Consumes: Task 1's `--phase` CLI and `PHASES`.

- [ ] **Step 1: Pin grep** — `git grep -n -F 'compose both before either dispatch' -- tests plugin`, `git grep -n -F -- '--step claims' -- tests plugin`, `git grep -n -F -- '--step review-dispatch' -- tests plugin`, `git grep -n -F 'Cite the run' -- tests plugin`; list every hit in the task report.
- [ ] **Step 2: Write failing assertions** in `tests/dispatch-prompt-bundle-citations.test.js`:
  - `task-prompt.md` contains the literal line `` `node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --phase first-call` `` and `` `node "{plugin-root}/bin/compose-context.js" --run "{minted-run-dir}" --phase second-call` ``, and no longer contains `--step claims` or `--step merge`.
  - The second-call template text instructs: `Read {minted-run-dir}/context/merge.md once, whole, with one Read call, before your first step` (exact phrase pinned), plus the clause `never re-read it or open its source files piecewise (sed, grep, cat)`; `claims.md` stays an on-demand citation with its fallback in both templates.
  - `step3-lens-dispatch.md` composes with `--phase review-lens`.
  - `subagent-output-contract.md`'s bullet names `bin/lib/compose-context/phases.js` as the one home of which bundles a phase gets, and states that a bundle registered `load: 'always'` is read once, whole, before the child's first step.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Edit the prose.** Context pack item 5 lists `claims` as on-demand in both calls (cited with its fallback, as today) and `merge` as read-once-up-front for the second call. The read-once instruction belongs only in the second-call template (dispatcher-voice rule: it is addressed to the dispatched agent and inlined there). Keep every existing `{minted-run-dir}/context/claims.md` / `merge.md` citation unchanged — the bundle step names are unchanged by design. Update each pinned test the Step 1 grep found.
- [ ] **Step 5: Run** `node --test tests/dispatch-prompt-bundle-citations.test.js` plus each pinned test file — expect PASS; `wc -c` each edited file stays under 52,500.
- [ ] **Step 6: Commit** — `Compose dispatch and lens bundles by phase — each always-needed bundle is read once, whole`.

### Task 3: `claim-targets.js --steps` skip-guard

**Files:**
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (argument parsing + early return)
- Modify: `plugin/bin/claim-targets.js` (usage header comment)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Produces: `--steps <comma-list>`, an optional flag. When it is present and contains neither `build` nor `test`, the CLI exits 0 without reading or writing any claim, and prints `{"claimed":[],"alreadyOwned":[],"skipped":[],"skipGuard":"no-build-or-test"}`. When it contains either, behavior is unchanged. An empty `--steps` value exits 2.

- [ ] **Step 1: Failing tests**: `--steps review,polish,wrap-up` → exit 0, stdout JSON `skipGuard === 'no-build-or-test'`, and the injected `ghApi`/`gitRunner` fakes recorded zero calls; `--steps build,test` → the normal claim path runs (fake runner called); `--steps ''` → exit 2.
- [ ] **Step 2: Run — expect FAIL** (`unknown argument: --steps` or equivalent).
- [ ] **Step 3: Implement** the flag in the lib's argument parser; skip before any store read.
- [ ] **Step 4: Run** `node --test tests/bin-lib/claim-targets/` — expect PASS.
- [ ] **Step 5: Commit** — `Add claim-targets --steps skip-guard — a no-build/test step list claims nothing`.

### Task 4: `pr-early-open.js` — the PR-early run lifecycle as one call

**Files:**
- Create: `plugin/bin/lib/flow/pr-early-open.js`
- Create: `plugin/bin/pr-early-open.js`
- Test: `tests/bin-lib/flow/pr-early-open.test.js`

**Interfaces:**
- Consumes: `composePrEarlyBody` (`bin/lib/flow/pr-body.js`), `formatEntry`/`appendEntry` (`bin/lib/log-decision/append.js`), `writeRunState`/`readRunState` (`bin/lib/hooks/context.js`), `GH_TIMEOUT_MS` (`bin/lib/shared-primitives`).
- Produces: `openPrEarly({ runDir, worktree, branch, repo, base, target, fixes, title, summary, nextStep = 'build' }, deps) -> Promise<{ outcome: 'reused' | 'reopened' | 'opened' | 'push-failed' | 'create-failed', number?, url?, reason? }>`; `deps` = `{ gh(args) -> stdout, git(args, { cwd }) -> stdout, sleep(ms), now(), appendDecision(line), recordPr({ number, url }) }`.
- CLI: `pr-early-open.js --run <dir> --target "#N[,#M]" --fixes N[,M] --title <text> --summary-file <path> [--worktree <path>] [--next-step build]`. It resolves `branch` with `git -C <worktree> branch --show-current`, `repo` with `gh repo view --json nameWithOwner`, and `base` with `resolve-policy`'s `integration-branch`. Exits: `0` with a PR recorded (`reused`/`reopened`/`opened`); `3` for a logged degrade (`push-failed`/`create-failed`, where the run proceeds local-only); `2` for a malformed invocation or `gh` absent (stderr names the MCP path, `_shared/pr-early-run-lifecycle.md`'s `gh` absent row); `1` for an internal error. Stdout is one JSON line, the `openPrEarly` result.
- A recorded `run-state.json.pr` is re-verified with `gh pr view <n> --json state` first. If it is still OPEN, the result is `reused` with no new log line. Otherwise the CLI falls through to the list check.

Decision lines (exact `--text` bodies, section `/build`, status `AUTO`, written in this order, matching `_shared/pr-early-run-lifecycle.md` Steps 1–3 word for word so `checkBookkeepingStampsGate` matches them):
`PR-early run lifecycle: reusing open PR #{n} for {branch}` (rev `high`) · `PR-early run lifecycle: reopened PR #{n} for {branch} (retry)` (rev `high`) · `PR-early run lifecycle: no existing PR for {branch}; creating` (rev `n/a`) · `PR-early run lifecycle: pushed {branch} to origin` (rev `high`) · `PR-early run lifecycle: push of {branch} to origin FAILED ({reason}); run proceeds local-only, no PR opened` (rev `n/a`) · `PR-early run lifecycle: opened PR #{n} for {branch}` (rev `high`) · `PR-early run lifecycle: gh pr create for {branch} FAILED ({reason}); run proceeds local-only, no PR opened` (rev `n/a`).

- [ ] **Step 1: Failing tests** (fake `gh`/`git`, `sleep` a no-op recorder):
  - `gh pr list` returns `[]` → logs the no-existing line *before* the push call (assert call order), then push, compose, `gh pr create --draft --base <base> --head <branch> --title <title> --body-file <tmp>`, `recordPr({number, url})`, outcome `opened`; the composed body's first line is `<!-- claude-tweaks-run: {basename(runDir)} -->`.
  - list returns `[{number: 7, state: 'OPEN'}]` → no push-before-log violation, no `pr create` call, outcome `reused`, `recordPr` called with 7.
  - list returns `[{number: 7, state: 'CLOSED'}]` → `gh pr reopen 7` called, outcome `reopened`.
  - push throws a `503` error once then succeeds → `sleep(15000)` called once, outcome `opened`; push throws an auth error → no retry, outcome `push-failed`, the FAILED line logged, CLI exit 3.
  - create fails twice → outcome `create-failed`, FAILED line contains the literal token `FAILED`, exit 3.
  - `run-state.json` already has `pr: {number: 9}` and `gh pr view 9` says OPEN → outcome `reused`, `gh pr list` never called.
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/pr-early-open.test.js` — expect FAIL (module missing).
- [ ] **Step 3: Implement.** The body is written to a session temp file (`bin/lib/session-tmp` / `sessionTmpPath`, same keying as `pr-early-body-{run-id}.md`), and the first line is re-read and checked before `gh pr create`, failing closed on a mismatch.
- [ ] **Step 4: Run — expect PASS**; also `node --test tests/*conformance*.test.js`.
- [ ] **Step 5: Commit** — `Add pr-early-open CLI — the draft-PR run lifecycle as one call with its mandatory log lines`.

### Task 5: `manifesto-write.js` — compute and write the levers in one call

**Files:**
- Create: `plugin/bin/lib/flow/manifesto-write.js`
- Create: `plugin/bin/manifesto-write.js`
- Test: `tests/bin-lib/flow/manifesto-write.test.js`

**Interfaces:**
- Consumes: `LEVER_KEYS` and the policy resolution `gatherPreflight` uses (`bin/lib/flow/preflight.js` — reuse its `deps.resolvePolicy` shape, never re-parse policy.yml), `MANIFESTO_LEVERS`/`validateLever`/`setConfigLever` (`bin/lib/set-config/write.js`), `appendEntry`/`formatEntry`.
- Produces: `computeLevers({ mode, modeSource, records: [{ n, ceremony, ceremonySource: 'label' | 'judged' }], resolved }) -> [{ key, value, source }]` (all 13 levers in canonical order: mode, scope-creep, overlap, design-intent, leftover-default, auto-fix-threshold, review-auto-apply-ceiling, tidy-aggressiveness, ceremony-profile, model-stance, merge-verification, design-critique, merge-authorization). Rules pinned by tests:
  - `review-auto-apply-ceiling`: when the resolved entry's source is `default` and the resolved `autonomy` value is `unattended`, the value is `medium`; otherwise it is the resolved value.
  - `ceremony-profile`: `fast-lane` only when every record's ceremony is `fast-lane`, else `standard`; source `header`.
  - `merge-authorization`: always `ask` (never read from policy).
- Produces: `writeManifesto({ runDir, records, levers, now }, deps) -> { configPath, table }`. It refuses (throws `AdoptedRunError`) when `config.yml` already exists. Otherwise it writes the 13 levers with `setConfigLever`, validating all of them before writing any, then appends `spec: {lowest n}` and `created: {basename timestamp}`. It writes `decisions.md` with the `# Auto-Decision Log — pipeline {run-id}` + `Pipeline config snapshot:` header, placing any existing lines (Step 2.8 claim lines) below the header and keeping them verbatim. It creates `staged/`. Then it appends, in order: one `Manifesto ceremony-check: #{n} carries no ceremony:* label -> CEREMONY: {v}` line per `judged` record, and `Manifesto: levers written to {absolute configPath}`.
- CLI: `manifesto-write.js --run <dir> --mode <auto|confirm|hybrid> --mode-source <arg|dispatch|policy|default> --ceremony <n>=<fast-lane|standard>[:judged][,...]`. On success it prints the FYI table as markdown (`### Pipeline Config (auto)` heading, `| Lever | Value | Source |` rows, closing line `→ proceeding (no approval needed) · run with \`confirm\` to review/override`), exit 0. Exit `3` means `config.yml` already present (case-1 adoption: read `preflight.levers` instead). Exit `2` means malformed input. Exit `1` means a filesystem failure. `--mode interactive` exits 2, since no Manifesto runs in interactive mode.

- [ ] **Step 1: Failing tests:** the ceiling rule (unattended+default → `medium`; unattended+policy `low` → `low`; attended+default → `low`); the ceremony fold (`[fast-lane, standard]` → `standard`, `[fast-lane, fast-lane]` → `fast-lane`); a run dir whose `decisions.md` holds `## /flow\n- AUTO 17:24:24 — Step 2.8: claimed #4027 (bin/claim-targets.js, transport: git). Reversibility: high.` keeps that line byte-for-byte below the new header; an existing `config.yml` → `AdoptedRunError` and the CLI exits 3 with nothing changed; a `judged` record produces the ceremony line and a `label` record produces none; the levers line names the absolute `config.yml` path.
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/manifesto-write.test.js` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — expect PASS**, plus `node --test tests/bin-lib/set-config/ tests/bin-lib/flow/`.
- [ ] **Step 5: Commit** — `Add manifesto-write CLI — compute, write and log the 13 levers in one call`.

### Task 6: Prose cut-over — the mechanics read their procedure files only on failure

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (Step 2.8, Step 3, Step 4 item 2)
- Modify: `plugin/skills/build/SKILL.md` (Spec Step 1's draft-PR sentence)
- Modify: `plugin/skills/build/worktree-setup.md` (Step 6)
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md` (Callers table: the CLI is the gh-present entry point; the file is its spec and the gh-absent/failure procedure)
- Modify: `plugin/skills/flow/manifesto.md` (`auto` FYI path: run `manifesto-write.js`)
- Modify: `plugin/skills/flow/claim-targets.md` (lead with the one CLI call including `--steps`)
- Test: every test the pin grep finds; add `tests/flow-mechanics-cli-cutover.test.js`

**Interfaces:**
- Consumes: Tasks 3–5 CLIs and `materialize.js` (unchanged).

- [ ] **Step 1: Pin grep** over `tests plugin` for: `read \`claim-targets.md\``, `read \`manifesto.md\``, `Read \`manifesto.md\` only after Step 2.8`, `build/worktree-setup.md\` Step 6`, `push-then-create`, `compose, write, and commit the materialized file now`. List hits.
- [ ] **Step 2: Failing test** `tests/flow-mechanics-cli-cutover.test.js` asserting:
  - flow Step 2.8 names `bin/claim-targets.js` with `--steps` and says to read `claim-targets.md` only on a non-zero exit;
  - flow Step 3 names `bin/manifesto-write.js` for `auto` case 2/5 and says to read `manifesto.md` only for `confirm`/`hybrid`, a case-1/3 adoption, or a non-zero exit;
  - flow Step 4 item 2 names `bin/materialize.js` and says to read `materialize.md` only on a non-zero exit or a `premise`/`drift`/`template` envelope field that is non-null;
  - build Spec Step 1 and `build/worktree-setup.md` Step 6 name `bin/pr-early-open.js` and say to read `_shared/pr-early-run-lifecycle.md` only on exit 2 (`gh` absent → its MCP path) or exit 1;
  - `flow/SKILL.md` and `build/SKILL.md` each stay under `RAIL_BYTES` (import it from `plugin/bin/lib/skill-audit/budgets.js`, never a literal); the task report states both files' before/after `wc -c` (48,428 / 49,812 before) and the after value must be lower.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Edit the prose.** Each call site becomes: one CLI line with literal flags, one sentence per exit-code branch, and a pointer to the procedure file for the failure branches. Delete the restated mechanics, which stay in the cited files. Keep the `[IL-131]` non-skippable sentence for the draft-PR call, attached to the CLI. Update each pinned test.
- [ ] **Step 5: Run** the new test, each pinned test, and `node --test tests/bin-lib/skill-audit/` — expect PASS.
- [ ] **Step 6: Commit** — `Point flow and build at the mechanics CLIs — procedure files are read only on a failing exit`.

### Task 7: `context-gauge.js` — measure this agent's context and write a handoff

**Files:**
- Create: `plugin/bin/lib/timing/context-gauge.js`
- Create: `plugin/bin/context-gauge.js`
- Test: `tests/bin-lib/timing/context-gauge.test.js` (fixtures under `tests/fixtures/context-gauge/`)

**Interfaces:**
- Consumes: `locateTranscripts`, `subagentsDirFor`, `readUsage` (`bin/lib/timing/transcript.js`).
- Produces: `CONTEXT_CAP_TOKENS = 200000`, with a comment citing #4027's measured curve: 5.0 s per turn under 100k context and 12.1 s above 300k, so 200k is the midpoint cap.
- Produces: `findAgentTranscript({ runId, sessionId, cwd, configDir, fsImpl }) -> { path, kind: 'subagent' | 'main' } | null`. It takes the newest `agent-*.jsonl` in the session's `subagents/` directory whose first user message contains `runId`. Failing that, it falls back to the session's main transcript. It returns `null` when neither is found.
- Produces: `gauge({ transcript }) -> Promise<{ contextTokens }>`, the `contextTokens` of the last `turnStart` row.
- CLI: `context-gauge.js --run <dir> [--transcript <path>] [--cap <n>] [--next-steps <list>]`. It prints one JSON line `{ contextTokens, cap, over, transcript, handoff, reason }` and always exits 0, apart from `2` for a malformed invocation. The fail-open path (transcript missing or unreadable) prints `over: false` with `reason` set. When `over` is true and `--next-steps` is given, it writes `{run}/handoff.json` = `{ nextSteps: [...], contextTokens, cap, writtenAt, resume: 'PIPELINE_RUN_DIR="{run}" /claude-tweaks:flow "{target}" {next-steps} auto' }`. `{target}` comes from the run's `work/{n}-spec.md` names, or from its `spec-{N}/` subdirectories for a multi-spec run.

- [ ] **Step 1: Failing tests:** a fixture subagents dir with two `agent-*.jsonl`, only the newer containing the run id → that one is chosen; the last turn's `input_tokens+cache_read+cache_creation` = 250000 → `over: true` and `handoff.json` written with `nextSteps: ['test']`; 150000 → `over: false`, no file; no transcript → `over: false`, `reason` names the miss, exit 0. **Real-input probe:** the test reads one real-shaped fixture copied (trimmed to 3 turns, prompt text redacted) from an archived dispatched-call transcript and asserts `contextTokens` equals the hand-computed sum.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `node --test tests/bin-lib/timing/` — expect PASS.
- [ ] **Step 5: Commit** — `Add context-gauge CLI — measure the running agent's context and write a handoff past the cap`.

### Task 8: `/flow` phase-boundary cap check and handoff

**Files:**
- Modify: `plugin/skills/flow/SKILL.md` (Step 4: one new numbered item between "Check the gate" and "Pass context forward")
- Create: `plugin/skills/flow/context-handoff.md` (the handoff procedure + the nested-`Agent` template for a non-dispatched run)
- Modify: `plugin/skills/flow/steps-and-gates.md` ("Partial step lists": a handed-off run renders the partial note naming `handoff.json`)
- Test: `tests/flow-context-handoff-conformance.test.js` (create)

**Interfaces:**
- Consumes: Task 7's CLI.
- Produces (contract for Task 9): a dispatched call (`run-state.json` `dispatched: true`) that crosses the cap at a boundary stops before the next step and reports `OUTCOME: handoff` plus one line `NEXT_STEPS: {comma-joined remaining steps}`, with `STATUS: DONE`. A non-dispatched run instead hands the remaining steps to one fresh `Agent` using `context-handoff.md`'s template. The child is told to `Read {run}/handoff.json` first, and the parent relays the child's report.

- [ ] **Step 1: Failing test** asserting: flow Step 4 names `bin/context-gauge.js` with `--next-steps`, runs it only when at least one step remains, and points at `context-handoff.md`; `context-handoff.md` contains the `OUTCOME: handoff` and `NEXT_STEPS:` literals, the fail-open sentence (`over: false` means continue in this agent), and a fenced template that inlines the async-wait / `INTERIM_STATUS` rule; `flow/SKILL.md` stays under 52,500 bytes.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Write the prose** (Step 4 gets one short item; detail lives in `context-handoff.md`).
- [ ] **Step 4: Run** the test and `node --test tests/bin-lib/skill-audit/` — expect PASS.
- [ ] **Step 5: Commit** — `Hand the next phase to a fresh agent when /flow crosses the context cap`.

### Task 9: Dispatcher continues a handed-off call

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md` (both templates' OUTCOME vocab gain `handoff`; one line documenting `NEXT_STEPS:`; a "Continuation call" paragraph: same template, step list replaced by `NEXT_STEPS`, same `{minted-run-dir}`)
- Modify: `plugin/skills/dispatch/two-call-gate.md` (new section: on `OUTCOME: handoff`, dispatch the continuation, at most 3 per call, then gate on the last continuation's report as that call's report; a fourth handoff → `build-test-blocked`/`blocked`)
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (treat `handoff` as non-terminal: no artifact check, return `{ continue: true, nextSteps }`)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`, `tests/dispatch-rederive-from-artifacts-conformance.test.js`, plus pin-grep hits

**Interfaces:**
- Consumes: Task 8's `OUTCOME: handoff` / `NEXT_STEPS:` contract.

- [ ] **Step 1: Pin grep** for `build-test-ok | build-test-failed` and `merged | armed | pending-review` over `tests plugin`.
- [ ] **Step 2: Failing tests:** `first-call-artifact-check` given a report with `OUTCOME: handoff` and `NEXT_STEPS: test` returns `continue: true, nextSteps: ['test']`, without ever running the stamp check; given `NEXT_STEPS` missing, it fails closed (`continue: false`, reason `handoff without NEXT_STEPS`); the two templates' OUTCOME lines contain `handoff`; `two-call-gate.md` names the 3-continuation bound.
- [ ] **Step 3: Run — expect FAIL.**
- [ ] **Step 4: Implement + edit prose**; update pinned tests.
- [ ] **Step 5: Run** the dispatch test files — expect PASS.
- [ ] **Step 6: Commit** — `Continue a handed-off dispatch call in a fresh agent — bounded at three continuations`.

### Task 10: Docs

**Files:**
- Modify: `docs/plugin-structure.md` (CLI table: `pr-early-open.js`, `manifesto-write.js`, `context-gauge.js`; `compose-context.js --phase`)
- Modify: `docs/hooks.md` only if a hook reads `handoff.json` (none does — verify with `git grep -n handoff.json -- plugin/bin/lib/hooks`, expect no hit, and leave the file untouched)

- [ ] **Step 1:** Add the rows; run `node --test tests/` filtered to the docs suites (`git grep -l plugin-structure.md -- tests`) — expect PASS.
- [ ] **Step 2: Commit** — `Document the phase registry and the three new CLIs`.

## Acceptance-criterion coverage

- AC1.1 (skill-file reads −80% over 10 runs), AC2.1 (median procedureBytes ≤ 120 KB), AC3.1 (dispatch-agent context p50 ≤ 150k): these are fleet measurements over runs that happen after ship. `tools/efficiency-report.js` reports `procedureBytes` and the `procedure` turn class per run. This build cannot evidence them, so the run logs a `deferred-closure` decision and the PR carries `Refs #4027`, not `Fixes`.
- AC4.1 (conformance suites + pipeline smoke test pass, no added skips): the test phase's full `npm test` run through `/claude-tweaks:test`.
