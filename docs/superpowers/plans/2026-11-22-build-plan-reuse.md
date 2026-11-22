# Build Plan Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Under `plan-at-specify: on`, `/build`'s Spec Step 2 reuses the plan specify already wrote and reviewed (the record's `Plan:` line) when it still checks valid, skipping Spec Step 3 and Common Step 1.6, and re-plans as today when it does not.

**Architecture:** A new lazily read sub-file, `plugin/skills/build/plan-reuse.md`, holds the probe, the checks and the logging; `build/SKILL.md` gains one pointer paragraph at the end of Spec Step 2 that fires only on the routes that would otherwise proceed to Spec Step 3, so the existing-plan (resume) branch is untouched. The checks reuse shipped CLIs only: `plan-store.js check`/`read` (#6052) and `plan-audit.js`. A `node --test` conformance suite pins the prose and runs the probe fence and a real `plan-store.js` write→materialize→check round trip.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test`; existing `plugin/bin/plan-store.js`, `plugin/bin/plan-audit.js`, `plugin/bin/lib/issues/plan-line.js`, `plugin/bin/lib/issues/materialize-format.js`.

**Spec:** `.claude-tweaks/pipelines/2026-11-22T204253-spec-6060/work/6060-spec.md` (worktree copy).

Scope keywords: plans as today, build-reuse record

`plugin/bin/materialize.js` and `plugin/skills/flow/materialize.md` (spec Current State / Key Files) are not modified: `materialize-format.js`'s `composeFile` copies the record body verbatim, so the `Plan:` line already survives into `work/{n}-spec.md` (probed at plan time) and Deliverable 4 is Task 1's regression test only.

Waived AC4.1: `npm test` passing is proven by `/build`'s Common Step 5 verification run and CI, not by a task's test.

## Global Constraints

- Spec Gotcha, verbatim: "Spec Step 2's resume branch already re-decides Common Steps 1.5 and 1.6; the new check sits before it and must not change it." This plan places the pointer on the two routes that proceed to Spec Step 3 (no plan, stale plan) — the resume branch's text is not edited, and a resumed build whose reused plan is committed reaches that branch, never this check (AC5.1).
- Spec Gotcha, verbatim: "`plugin/skills/build/SKILL.md` is 49,340 B against the 52,500 B rail: put the new check in a lazily read sub-file and leave a pointer in `SKILL.md`." Measured at plan time: `SKILL.md` 49,337 B, `plan-review.md` 28,064 B, rail `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). The SKILL.md pointer plus the Common Step 1.6 clause must stay ≤ 1,200 B combined (leaves ≥ 1,900 B headroom); `plan-reuse.md` is a new file well under the rail.
- AC1.1: with `plan-at-specify` resolving anything but `on` (the installed 6.176.0 resolver prints an empty line for this key; the branch's resolver prints `off` — both measured), or no `Plan:` line, nothing new is logged and the build is unchanged.
- Log texts are fixed by the spec and pinned by the test: commit subject `Add the plan reviewed at specify ({commit})`; SKIP condition `plan reviewed at specify ({commit})` for Spec Step 3 and for Common Step 1.6; failure `plan-reuse failed: {reason}` with `{reason}` one of `ref`, `hash`, `base`, `files` (plan-store.js's `failed` values), `plan-audit`, `malformed Plan line`, `premise`. `{commit}` is the plan commit from the `Plan:` line (40 or 64 hex, already validated by `parsePlanLine`).
- Every SKIP follows the degrade-trace form `condition: … → fallback: …` (`_shared/auto-decision-log.md`).
- A record-body string (the `Plan:` line, a `Settled at planning:` line) never goes on a command line: the line reaches `plan-store.js check` through `--line-file`, and a log quoting record text uses `log-decision.js --text-file`.
- Worktree session: every Bash fence is one plain command (`_shared/scratch-worktree.md` §7); the plugin root is substituted as a literal path, never `"${CLAUDE_PLUGIN_ROOT}"` as `node`'s script operand.
- Commit subjects: `{Verb} {what} — {detail}`, imperative, no conventional-commit prefix (CLAUDE.md Versioning).
- Governing skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` (it governs every `node --test` suite that pins `plugin/skills/**/*.md`), quoted verbatim:
  - "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself. Write the assertion as a predicate that returns the facts whose pattern no longer matches (`missingFactsOf(patterns)`), and assert it returns `[]` on the live region. Then, per pattern, strip only that pattern's match from the live text and assert the same predicate returns exactly `[fact]`."
  - "Keep the patterns non-global"
  - "A clause pinned to its row or paragraph owes a move-out control, not only a deletion."
- Governing skill `.claude/skills/skill-prose-conformance-tests/executable-snippet-pins.md`, quoted verbatim:
  - "`docs/skill-authoring.md`'s \"Executable snippets in skill prose\" names two forms and **prefers extract-and-run**: the test pulls the fence out of the doc with an anchored regex and executes exactly that string, so the doc is the only source of the executed text and the two cannot drift"
  - "**Anchor the extraction on structure, not on a sentence.**"
  - "**Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`.**" … "Skip the zsh case with a visible reason when zsh is not on PATH, never silently"
  - "**A `node -e` fence that spawns a plugin CLI runs against a stub CLI, with the plugin root passed through the environment.**" (the probe fence requires a plugin module, so it takes the `PLUGIN_ROOT=… node -e "…process.env.PLUGIN_ROOT…"` form)
  - "**Run the fence with a hostile placeholder value, not only a benign one.**"
  - "Put that suite [`tests/skill-fence-guard-shapes.test.js`] in the targeted set for any change that adds or edits a fence"
- `.claude/skills/prose-code-twin-pin/SKILL.md` does not apply: the reason list mirrors `CHECK_ORDER` values but the test imports `CHECK_ORDER` from `plugin/bin/lib/plan-store/check.js` rather than restating it (Task 1 Step 1).

## Review Focus

1. A materialized spec with CRLF line endings (a GitHub web-UI edit) — the probe must still find and parse the `Plan:` line (`parsePlanLine` strips a trailing `\r`). Pinned in Task 1's probe test.
2. A `Plan:` line quoted below the first `##` heading (an example in Current State) — not the record's line; the probe reports `absent`. Pinned in Task 1's probe test.
3. A spec path holding a `'` and a space — the fence passes paths as arguments, never in script text. Pinned in Task 1's probe test (hostile path).
4. A `Plan:` line naming another record's ref (`refs/claude-tweaks/plans/{m}`, m ≠ n) — reading another record's plan is wrong; the procedure fails it as `ref`. Pinned as a fact in Task 1.
5. A stored plan whose spec hash still matches after materialization — the build checks the materialized `work/{n}-spec.md`, not the specify-time body; the header and `# {n}: {title}` line sit before `## Overview`, outside the hash. Probed at plan time (`specHash(composeFile(body)) === specHash(body)`: true) and pinned by Task 1's round-trip test.

---

### Task 1: plan-reuse.md — probe, checks, logging — and its tests

**Role:** integration
**Review risk:** high (decision logic: branching on the check verdicts)

**Files:**
- Create: `plugin/skills/build/plan-reuse.md`
- Create: `tests/build-plan-reuse-conformance.test.js`
- Modify: `docs/plugin-structure.md` (the `| build |` row: add `plan-reuse.md` to the file list and one description clause)

**Interfaces:**
- Consumes: `plugin/bin/plan-store.js` (`check --line-file <f> --spec-file <f> --base <sha>` → one JSON line `{valid, failed}`, exit 0 valid / 1 invalid / 2 malformed; `read --record <n> --commit <sha> --out <dir>` → `{path}`), `plugin/bin/plan-audit.js {plan} --spec {spec} --repo-root {dir}` (exit 0 iff every check ok), `parsePlanLine(line)` → `{ok, record, ref, commit, specHash}` or `{ok:false, reason}` (`plugin/bin/lib/issues/plan-line.js`), `composeFile({header, n, title, body})` / `composeHeader({...})` (`plugin/bin/lib/issues/materialize-format.js`), `CHECK_ORDER` (`plugin/bin/lib/plan-store/check.js`), `originWithTwoClones`, `cleanGitEnv` (`tests/helpers/git-fixtures.js`), `runCliSync` (`tests/helpers/run-cli.js`), `missingFactsOf`, `assertEachPatternGoesRed`, `sectionOf` (`tests/helpers/conformance-asserts.js`), `readText` (`tests/helpers/read-skill.js`).
- Produces: `plan-reuse.md` with these `##` headings, in order: `## Probe`, `## Checks`, `## All checks valid`, `## A check failed`, `## Resumed build`. The probe fence is the first ` ```bash ` fence under `## Probe`. Task 2's SKILL.md pointer names this file and `## A check failed`'s re-plan.

- [ ] **Step 1: Write the failing test** — `tests/build-plan-reuse-conformance.test.js` (new). Header comment: `// #6060: /build reuses a plan reviewed at specify. Pins build/plan-reuse.md, runs its probe fence, and round-trips plan-store.js write → materialize → check.` Tests (names carry the AC ids):

  - `test('AC1.1: the probe reports absent for a spec with no Plan: line, or one only below the first ## heading', …)` — extract the probe fence (first ` ```bash ` fence after the `## Probe` heading; throw `probe fence extraction is out of sync` when absent), substitute `{spec}` and `{line-file}` with temp paths, run under `bash --noprofile --norc -c` with `PLUGIN_ROOT` = `path.join(ROOT,'plugin').split(path.sep).join('/')` in the spawn env (the fence's `${CLAUDE_PLUGIN_ROOT}` literal replaced the same way the test replaces placeholders). Fixtures built with `composeFile`/`composeHeader`: (a) no `Plan:` line → stdout `{"plan":"absent"}`, line file not created; (b) a valid line only inside `## Current State` → `{"plan":"absent"}`.
  - `test('AC2.1: the probe writes the Plan: line to the line file and prints its record and commit', …)` — fixture body with `composePlanLine({record: 7, commit: 'a'.repeat(40), specHash: 'b'.repeat(64)})` as the last metadata line → stdout `{"plan":"present","ok":true,"record":7,"commit":"aaaa…"}`; line file content equals the line + `\n`. Same fixture with CRLF line endings → same stdout (Review Focus 1). Same fixture at a spec path `o'brien spec/6060-spec.md` → same stdout (Review Focus 3).
  - `test('AC3.1: a Plan: line that does not parse is reported present but not ok', …)` — `Plan:garbage` → `{"plan":"present","ok":false,"reason":"shape"}`; `Plan: refs/claude-tweaks/plans/7 nothex spec-sha256:…` → `reason":"bad-commit"`.
  - `test('the probe fence runs the same under zsh -f', …)` — fixture (AC2.1's) under `zsh -f -c`; `t.skip('zsh not on PATH')` when `spawnSync('zsh',['--version'])` errors.
  - `test('go-red: dropping the heading bound makes a quoted Plan: line read as the record line', …)` — doctor the extracted fence, replacing `lines.slice(0,end===-1?lines.length:end)` with `lines`, assert the doctored string differs, run fixture (b) → `plan":"present"`.
  - `test('AC2.1/AC3.1: a stored plan checks valid against the materialized spec, and an edited spec fails hash', …)` — `originWithTwoClones` fixture as in `tests/bin-lib/plan-store/cli.test.js` (`setup()`): `plan-store.js write --record 7 --plan-file p/{BASENAME} --base HEAD --spec-file spec.md` in `fx.work`; write `work/7-spec.md` = `composeFile({header: composeHeader({record: 7, origin: 'human', ceremony: 'standard', grants: {}}), n: 7, title: 'T', body: SPEC + line})` (line inserted as the last metadata line); run the probe fence on it → `ok:true`; `plan-store.js check --line-file {line-file} --spec-file work/7-spec.md --base HEAD` in `fx.work` → `{"valid":true,"failed":null}` exit 0. Then change the Overview sentence in `work/7-spec.md` → `{"valid":false,"failed":"hash"}` exit 1. Also assert `composeFile(...)` output contains the line (Deliverable 4: materialize keeps the line — probed at plan time, `materialize-format.js` `composeFile` copies the body verbatim, so this is the regression test).
  - `test('AC2.2/AC3.1: plan-reuse.md states every check, log line and failure reason', …)` — `missingFactsOf(FACTS)(text)` deepEquals `[]` over the whole file; then `assertEachPatternGoesRed(text, FACTS, missingFactsOf(FACTS))`. `FACTS` (each pattern non-global, matching exactly once):
    - `/--values plan-at-specify/` — 'gate names the policy read'
    - `/prints `on`/` — 'gate fires only on on'
    - `/plan-store\.js" check --line-file "\{line-file\}" --spec-file "\{spec\}" --base \{base\}/` — 'check invocation'
    - `/git merge-base HEAD origin\/\{integration-branch\}/` — 'base resolution'
    - `/plan-store\.js" read --record \{n\} --commit \{commit\} --out/` — 'read invocation'
    - `/plan-audit\.js" "\{read-path\}" --spec "\{spec\}" --repo-root/` — 'audit invocation'
    - `/Add the plan reviewed at specify \(\{commit\}\)/` — 'commit subject'
    - `/--step "Spec Step 3" --text "condition: plan reviewed at specify \(\{commit\}\)/` — 'Spec Step 3 SKIP'
    - `/--step "Common Step 1\.6 \(plan review\)" --text "condition: plan reviewed at specify \(\{commit\}\)/` — 'Common Step 1.6 SKIP'
    - `/--status AUTO[^\n]*--step "Spec Step 2 \(plan reuse\)"/` — 'reuse AUTO line'
    - `/condition: plan-reuse failed: \{reason\}/` — 'failure SKIP'
    - `/names another record/` — 'record mismatch fails ref' (Review Focus 4)
    - `/`Settled at planning:`[^\n]*`Decided by the user at planning:`/` — 'planning-decision lines feed the re-plan'
    - `/planning decision departed:/` — 'departure log'
    - `/ASSUMPTION — verify at build:/` — 'premise probes still run'
    - `/logs nothing/` — 'absent line logs nothing (AC1.1)'
    - `/Common Step 1\.5 runs as today/` — 'plan audit still runs'
  - `test('AC3.1: every failure reason is named in ## A check failed', …)` — over `sectionOf(text, '## A check failed')` only (these words also appear in `## Probe` and `## Checks`, so a whole-file pattern would match twice): `REASON_FACTS` = `/`malformed Plan line`/` 'malformed reason', `/`plan-audit`/` 'plan-audit reason', `/`premise`/` 'premise reason'; `missingFactsOf` → `[]`, then `assertEachPatternGoesRed` on the section. Then for each `c` of the imported `CHECK_ORDER` (`['ref','hash','base','files']`), assert `` section.includes(`\`${c}\``) ``.
  - `test('AC5.1: plan-reuse.md says a resumed build takes the existing-plan branch and never re-runs this check', …)` — `sectionOf(text, '## Resumed build')` matches `/existing-plan branch/` and `/never runs again/`; move-out control: move that sentence into `## Probe`, assert the section check throws with its own message.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-plan-reuse-conformance.test.js`
Expected: FAIL (`plugin/skills/build/plan-reuse.md` does not exist; `readText` throws ENOENT)

- [ ] **Step 3: Write `plugin/skills/build/plan-reuse.md`**

  Title `# Spec Step 2 — Reuse a Plan Reviewed at Specify (#6060)`. Opening paragraph: read only from `build/SKILL.md`'s "Before Spec Step 3" pointer, once `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify` prints `on`; `{spec}` is the worktree's `work/{n}-spec.md` (never `"$PIPELINE_RUN_DIR"/work/…`, `[IL-127]`), `{n}` the record.

  `## Probe` — resolve `{line-file}` with `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value plan-reuse-line-{n}.txt`, then this fence, verbatim (run once at plan time against the real #6060 spec: printed `{"plan":"absent"}`):

  ```bash
  PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e 'const fs=require("fs");const {parsePlanLine}=require(process.env.PLUGIN_ROOT+"/bin/lib/issues/plan-line.js");const lines=fs.readFileSync(process.argv[1],"utf8").split(/\r?\n/);const end=lines.findIndex((l)=>/^## /.test(l));const hit=lines.slice(0,end===-1?lines.length:end).find((l)=>l.startsWith("Plan:"));if(hit===undefined){console.log(JSON.stringify({plan:"absent"}));process.exit(0)}fs.writeFileSync(process.argv[2],hit+"\n");const p=parsePlanLine(hit);console.log(JSON.stringify(p.ok?{plan:"present",ok:true,record:p.record,commit:p.commit}:{plan:"present",ok:false,reason:p.reason}))' "{spec}" "{line-file}"
  ```

  Outcomes: `{"plan":"absent"}` → return to Spec Step 3 as written; this file logs nothing (AC1.1). `ok: false` → failed `malformed Plan line`. `ok: true` but `record` ≠ `{n}` (the line names another record's plan) → failed `ref`. Any other output or a non-zero exit → failed `malformed Plan line`.

  `## Checks` — in order, the first failure wins, each its own plain call from the worktree:
  1. Resolve `{integration-branch}` per `_shared/integration-branch.md`; `git merge-base HEAD origin/{integration-branch}` prints `{base}`, the base the worktree was branched from (no fetch: Common Step 1's catch-up already merged it). Run once at plan time: printed `639b48d5…`. A failed call → failed `base`.
  2. `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" check --line-file "{line-file}" --spec-file "{spec}" --base {base}` — `{"valid": true}` (exit 0) passes; otherwise the reason is the JSON line's `failed` value (`ref`, `hash`, `base` or `files`); no JSON line → `ref`.
  3. Resolve `{read-dir}` with `session-tmp-resolve.js --value plan-reuse-{n}`; `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-store.js" read --record {n} --commit {commit} --out "{read-dir}"` prints `{path}`, `{read-path}`. Non-zero → `ref`.
  4. `node "${CLAUDE_PLUGIN_ROOT}/bin/plan-audit.js" "{read-path}" --spec "{spec}" --repo-root "{worktree}"` — exit 0 passes; anything else → `plan-audit`.
  5. Probe every `## Gotchas` bullet carrying `ASSUMPTION — verify at build:` exactly as Spec Step 3 does, logging each outcome as Spec Step 3 says; any reversed one → `premise` (the reused plan would build on a disproven claim, which Spec Step 3 never allows).

  `## All checks valid` — `cp "{read-path}" "docs/superpowers/plans/{basename}"` (`{basename}` = `{read-path}`'s basename), `git add` that path, `git commit -m "Add the plan reviewed at specify ({commit})"`. Then, with a run dir, three `log-decision.js` calls (`--section "/build"`): `--status AUTO --step "Spec Step 2 (plan reuse)" --text "reused the plan reviewed at specify ({commit}), committed as {sha}" --reversibility high`; `--status SKIP --step "Spec Step 3" --text "condition: plan reviewed at specify ({commit}) → fallback: stored plan reused, no new plan written" --reversibility n/a`; `--status SKIP --step "Common Step 1.6 (plan review)" --text "condition: plan reviewed at specify ({commit}) → fallback: no plan review" --reversibility n/a`. Standalone (no run dir): list the three in the Step 7 handoff. Continue at Spec Step 2.5; skip Spec Step 3; Common Step 1.5 runs as today on the committed plan; skip Common Step 1.6; Common Step 1.7 onward as written.

  `## A check failed` — log `--status SKIP --step "Spec Step 2 (plan reuse)" --text "condition: plan-reuse failed: {reason} → fallback: new plan written at Spec Step 3" --reversibility n/a`, `{reason}` one of `ref`, `hash`, `base`, `files`, `plan-audit`, `malformed Plan line`, `premise`. Remove nothing from the worktree (nothing was written there). Spec Step 3 then runs as written, and its `/superpowers:writing-plans` context names every `Settled at planning:` and `Decided by the user at planning:` line in the spec's `## Planning Decisions` as a decided input. A new plan that departs from one logs it: write `planning decision departed: {line} → {plan behavior}` with the Write tool to the path `session-tmp-resolve.js --value plan-reuse-departure-{n}-{k}.md` prints, then `log-decision.js --status AUTO --section "/build" --step "Spec Step 3" --text-file "{text-file}" --reversibility high`.

  `## Resumed build` — a resumed build finds the committed plan in Spec Step 2's plan search and takes the existing-plan branch; this file never runs again for it, and that branch re-decides Common Step 1.6 under its own rule (a reuse SKIP is not a completed review, so the review runs), unchanged.

- [ ] **Step 4: Add `plan-reuse.md` to `docs/plugin-structure.md`'s `| build |` row** — append `, plan-reuse.md` after `stash-guard.md` in the file list, and in the description column add: `plan-reuse.md holds Spec Step 2's reuse of a plan reviewed at specify under policy \`plan-at-specify: on\` — the \`Plan:\` line probe, \`plan-store.js check\`/\`read\` and \`plan-audit.js\`, the commit and skip logging, and the re-plan with \`## Planning Decisions\` lines as decided inputs on any failed check — read only through SKILL.md's pointer (#6060);` (`tests/build-dispatch-subfile-table-completeness.test.js` fails without the list entry).

- [ ] **Step 5: Run tests to verify they pass**

  Run: `node --test tests/build-plan-reuse-conformance.test.js tests/build-dispatch-subfile-table-completeness.test.js tests/skill-fence-guard-shapes.test.js`
  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add plugin/skills/build/plan-reuse.md tests/build-plan-reuse-conformance.test.js docs/plugin-structure.md
  git commit -m "Add build/plan-reuse.md — reuse a plan reviewed at specify when it still checks valid"
  ```

### Task 2: SKILL.md pointer, Common Step 1.6 and plan-review.md skip text, graph and policy rows

**Role:** integration
**Review risk:** high (decision logic: the policy gate and the Common Step 1.6 skip condition)

**Files:**
- Modify: `plugin/skills/build/SKILL.md` (Spec Step 2: new `#### Before Spec Step 3: a plan reviewed at specify (#6060)` paragraph after `#### If no plan exists:`'s body, before `### Spec Step 2.5`; Common Step 1.6 stub: one clause)
- Modify: `plugin/skills/build/plan-review.md` (`## Skip logging`)
- Modify: `docs/skill-graph.md:666` (the `/specify` → `/build` row)
- Modify: `plugin/skills/_shared/policy-schema.md:255` (the `plan-at-specify` row)
- Modify: `tests/bin-lib/issues/plan-line-body-parsers.test.js:2-5` (header comment only)
- Modify: `plugin/skills/help/context-flow.md:71` (the `/build` row's Reads column)
- Test: `tests/build-plan-reuse-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's `plugin/skills/build/plan-reuse.md` (its name and `## A check failed`).
- Produces: nothing later tasks read.

- [ ] **Step 1: Append the failing tests** to `tests/build-plan-reuse-conformance.test.js`:
  - `test('AC2.1/AC5.1: SKILL.md points at plan-reuse.md only on the routes to Spec Step 3', …)` — `POINTER_FACTS` over the pointer paragraph (from its `#### Before Spec Step 3` heading to `### Spec Step 2.5`): `/plan-reuse\.md/` 'names the sub-file', `/--values plan-at-specify/` 'policy read', `/prints `on`/` 'on only', `/Spec Step 3 and Common Step 1\.6/` 'what reuse skips', `/logs nothing/` 'AC1.1 silence', `/existing-plan branch/` 'resume never reaches it'. `missingFactsOf` → `[]`, then `assertEachPatternGoesRed`.
  - `test('AC5.1: the pointer sits after the existing-plan branch and before Spec Step 2.5, and the resume branch is unchanged', …)` — indices: `#### If a plan exists:` < `#### If no plan exists:` < `#### Before Spec Step 3: a plan reviewed at specify (#6060)` < `### Spec Step 2.5`; the resume bullet `If the plan is still valid and work remains, resume at Common Step 1.5, not Common Step 2 (#3666)` is present byte-for-byte. Permutation control: move the pointer block above `#### If a plan exists:` in memory, assert the ordering check throws with its own message.
  - `test('AC2.2: the Common Step 1.6 stub and plan-review.md name the reuse skip', …)` — the Common Step 1.6 section (`### Common Step 1.6: Plan Review (Spec Mode only)` to the next `### `) matches `/Spec Step 2 reused a plan reviewed at specify/`; `plan-review.md`'s `## Skip logging` section matches `/plan reviewed at specify \(\{commit\}\)/`. Move-out control for each: move the clause into a different section, assert the section check throws with its own message.
  - `test('AC1.1: the SKILL.md additions keep build/SKILL.md under the Read rail', …)` — `Buffer.byteLength(skill) <= RAIL_BYTES` (import from `plugin/bin/lib/skill-audit/budgets.js`).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/build-plan-reuse-conformance.test.js`
Expected: FAIL after Step 1 (the pointer heading is absent from SKILL.md)

- [ ] **Step 3: Edit `plugin/skills/build/SKILL.md`**
  - After `#### If no plan exists:`'s `Proceed to Spec Step 3.` line, insert `#### Before Spec Step 3: a plan reviewed at specify (#6060)` and one paragraph: when either branch above proceeds to Spec Step 3, first run `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values plan-at-specify`; only when it prints `on`, read `plan-reuse.md` in this skill's directory and follow it — a stored plan that still checks valid is committed into the worktree and Spec Step 3 and Common Step 1.6 are skipped, a failed check re-plans at Spec Step 3. Any other output, or a spec with no `Plan:` line, changes nothing and logs nothing. A resumed build whose reused plan is committed takes the existing-plan branch above and never reaches this check.
  - Common Step 1.6 stub: after its `**Skip this step when**` sentence's two conditions, add `, or Spec Step 2 reused a plan reviewed at specify (\`plan-reuse.md\` logs that skip)`.
  - Measure: `wc -c plugin/skills/build/SKILL.md` ≤ 50,537 (49,337 + 1,200).

- [ ] **Step 4: Edit `plugin/skills/build/plan-review.md`'s `## Skip logging`** — the opening sentence gains `, or \`plan-reuse.md\` reused a plan reviewed at specify` after the resume clause, and the fence's `--text` alternatives gain `| plan reviewed at specify ({commit})` before `}` (the condition text `plan-reuse.md` writes).

- [ ] **Step 5: Edit the three cross-references**
  - `docs/skill-graph.md:666`: replace `A build of a record carrying a \`Plan:\` line still plans as today until the build-reuse record (#6060) lands.` with `Under \`plan-at-specify: on\`, \`build/plan-reuse.md\` reuses the plan a record's \`Plan:\` line names when \`plan-store.js check\` and \`plan-audit.js\` pass, skipping \`/build\`'s Spec Step 3 and Common Step 1.6, and re-plans with \`## Planning Decisions\` lines as decided inputs otherwise (#6060).`
  - `plugin/skills/_shared/policy-schema.md:255`: consumer column `\`specify/shaping-mode.md\`, \`specify/planning.md\`` becomes `\`specify/shaping-mode.md\`, \`specify/planning.md\`, \`build/SKILL.md\`, \`build/plan-reuse.md\``; description gains ` A build of a record carrying a \`Plan:\` line reuses that plan when it still checks valid (\`build/plan-reuse.md\`, #6060).` before `Unset or invalid`.
  - `plugin/skills/help/context-flow.md:71`: the `/build` row's Reads cell `` `specs/NN-*.md`, `docs/plans/*.md` `` becomes `` `specs/NN-*.md`, `docs/plans/*.md`; under `plan-at-specify: on`, the plan a record's `Plan:` line names (`refs/claude-tweaks/plans/{n}`, via `plan-store.js read`, #6060) ``.
  - `tests/bin-lib/issues/plan-line-body-parsers.test.js` header: replace `so a build of such a record still plans as today until #6060 lands.` with `so a parser that is not plan-aware reads such a record unchanged; build/plan-reuse.md is the build-side reader (#6060).`

- [ ] **Step 6: Run tests to verify they pass**

  Run: `node --test tests/build-plan-reuse-conformance.test.js tests/build-plan-review-conformance.test.js tests/build-resume-common-steps.test.js tests/policy-schema.test.js tests/bin-lib/issues/plan-line-body-parsers.test.js`
  Expected: PASS

- [ ] **Step 7: Commit**

  ```bash
  git add plugin/skills/build/SKILL.md plugin/skills/build/plan-review.md docs/skill-graph.md plugin/skills/_shared/policy-schema.md plugin/skills/help/context-flow.md tests/bin-lib/issues/plan-line-body-parsers.test.js tests/build-plan-reuse-conformance.test.js
  git commit -m "Point build's Spec Step 2 at plan-reuse.md — skip Spec Step 3 and plan review for a valid specify-time plan"
  ```

### Verification (folded into Common Step 5)

AC4.1 (`npm test` passes) is proven by `/build`'s Common Step 5 verification run and CI, not by a task.
