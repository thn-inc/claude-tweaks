# Review Routing Line Composer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/claude-tweaks:review` Step 3 Routing log lines from being hand-typed: `log-decision.js` refuses a `--text` that repeats its own `--step`, and a new `review-routing-line.js` CLI composes and appends the three routing shapes so `/claude-tweaks:release` Step 3's `review: blocking` token match always sees a staged high or critical finding.

**Architecture:** One pure composer module (`plugin/bin/lib/log-decision/review-routing.js`) turns `{route, severity, category, at, stagePath, commit}` into `{status, text}` or `{error}`. A thin CLI (`plugin/bin/review-routing-line.js`) validates flags, calls the composer, then delegates the write to `plugin/bin/log-decision.js`'s exported `run(argv, deps)` with `--step "Step 3 Routing" --section "/review" --reversibility high`, so anchoring, locking and the new step-prefix refusal are inherited, not re-implemented. `review/step3-routing.md` replaces its three hand templates with the CLI's command lines.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172259-spec-4488-4484/spec-4488/work/4488-spec.md` (worktree copy)

## Global Constraints

- AC1: `node plugin/bin/log-decision.js --run <dir> --status AUTO --step "Step 3 Routing" --text "Step 3 Routing: x"` exits 2 and writes nothing.
- AC2: A high finding routed through the composer produces a line containing the literal `high-severity finding`.
- AC3: Each new test fails with its change reverted. (Plan-review clarification, decided by the user: an over-refusal guard test — one that pins the refusal does *not* fire — passes on the base by design and is proven red against an over-broad mutant instead.)
- The refusal names both values (exit 2) and covers `--text`, `--text-file`, and `--entries` text.
- CLI wrapper contract (`.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, verbatim): "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes." / "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe." / "*Sanctioned-writer* (`plugin/bin/log-decision.js`, …): 0 written (the written path echoed to stdout), 2 malformed invocation, 3 the run dir is missing or not anchored under the main checkout, or the target file is unwritable — **no 1 at all**." / "A value-taking flag given as the last argv element reads `undefined`, and a `!== null` presence check treats that as supplied. … Validate the value inside `parseArgs` … — `typeof v !== 'string' || !v.trim() || v.startsWith('--')` returns a usage error — and pin both the trailing bare flag and the empty-string value with their own test cases."
- `review-routing-line.js` takes the Sanctioned-writer vocabulary (0/2/3) because it delegates to `log-decision.js`; its own validation failures are exit 2.
- No call site in `plugin/`, `tests/` or `docs/` passes a `--text` beginning with its `--step` value + `:` today (scratch scan over `--step "…" … --text "…"` and `step: '…', text: '…'` pairs: `no hits`; control run against a fixture holding the AC1 command: 1 hit). The refusal therefore breaks no shipped caller.

## Review Focus

1. A `--text` that merely *contains* the step later, or starts with the step but no colon (`Step 3 Routing applied …`) — must still be accepted (Task 1 test).
2. No `--step` at all with text `Step 3 Routing: x` — accepted, nothing to repeat (Task 1 test).
3. Leading whitespace before the repeated prefix (`"  Step 3 Routing: x"`) — `formatEntry` trims, so the refusal must see the trimmed text (Task 1 test).
4. A severity/route mismatch (high via `auto`, critical via `staged`, non-critical via `kept-prompt`) — refused, because the routing table never produces it and a wrong pairing is exactly the mis-ordered-token class #4488 exists to stop (Task 2 tests).
5. A trailing bare value flag (`--category` last) — exit 2, not a crash (Task 2 test).

---

### Task 1: log-decision.js refuses a --text that repeats --step

**Files:**
- Modify: `plugin/bin/log-decision.js` (single-entry branch in `run`, and `entryProblem`; header comment's exit-2 line)
- Modify: `docs/plugin-structure.md:191` (the `log-decision.js` command line — add "; a text beginning with its own `--step` value followed by `:` is refused, exit 2")
- Test: `tests/bin-lib/log-decision/cli.test.js`

**Interfaces:**
- Produces: `run(argv, deps)` unchanged signature; new exit-2 path. Stderr message contains both the `--step` value and the `--text` value, e.g. `log-decision.js: --text repeats --step: --step "Step 3 Routing", --text "Step 3 Routing: x" — the step prefix is written for you; drop it from the text`.
- Helper (module-private): `repeatsStep(step, text) -> boolean` — true iff `step` is a non-empty string and `String(text).trim().startsWith(step + ':')`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/log-decision/cli.test.js`, reusing its `fixture()`/`deps()`):
  - `AC1.1: --text repeating --step exits 2 and writes nothing` — argv `['--run', runDir, '--status', 'AUTO', '--step', 'Step 3 Routing', '--text', 'Step 3 Routing: x']` → `code === 2`, `decisions.md` does not exist, stderr includes `Step 3 Routing` and `Step 3 Routing: x`.
  - `--text-file holding a repeated step prefix exits 2` — same with the text in a temp file.
  - `--text with leading whitespace before the repeated prefix exits 2` — text `'  Step 3 Routing: x'`.
  - `--entries element repeating its step exits 2, names entries[1], writes nothing` — array `[{status:'AUTO', step:'a', text:'ok'}, {status:'STAGED', step:'Step 3 Routing', text:'Step 3 Routing: y'}]` → code 2, stderr matches `/entries\[1\]/` and includes both values, no `decisions.md`.
  - `a text mentioning the step without the colon prefix is accepted` — text `'Step 3 Routing applied x'` with `--step 'Step 3 Routing'` → code 0.
  - `a step-shaped text with no --step is accepted` — text `'Step 3 Routing: x'`, no `--step` → code 0, line `- AUTO 09:05:07 — log-decision: Step 3 Routing: x. Reversibility: n/a.`.

- [ ] **Step 2: Run to verify the refusal tests fail**
  Run: `node --test tests/bin-lib/log-decision/cli.test.js`
  Expected: FAIL — the four refusal tests get exit 0 (the two acceptance tests already pass).

- [ ] **Step 3: Implement** — in `run`'s single-entry branch, after `o.text` is resolved and the empty-text check, `if (repeatsStep(o.step, o.text)) return usageError(...)`; in `entryProblem`, after the text checks, return the same message shape when `repeatsStep(el.step, el.text)`. Update the file's header comment exit-2 clause to name the refusal.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/log-decision/cli.test.js`
  Expected: PASS, all tests.

- [ ] **Step 5: Go-red proof** — (a) temporarily make `repeatsStep` return `false`, re-run Step 4's command, confirm the four refusal tests fail, restore; (b) temporarily make `repeatsStep` the over-broad `Boolean(step) && String(text).includes(step)`, re-run, confirm the two acceptance tests fail (AC3.1 per the plan-review clarification), restore. Record both outcomes in the task report.

- [ ] **Step 6: Commit** — `git add plugin/bin/log-decision.js tests/bin-lib/log-decision/cli.test.js docs/plugin-structure.md` then commit `Refuse a log-decision --text that repeats --step — exit 2 naming both values (#4488)`.

### Task 2: review-routing-line composer + CLI

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/log-decision/review-routing.js`
- Create: `plugin/bin/review-routing-line.js`
- Modify: `docs/plugin-structure.md` (one new command line directly after line 191's `log-decision.js` line; and append `review-routing.js — the Step 3 Routing line composer (#4488), consumed by plugin/bin/review-routing-line.js` to line 36's `plugin/bin/lib/log-decision/` entry)
- Test: `tests/bin-lib/log-decision/review-routing.test.js`

**Interfaces:**
- Consumes: Task 1's `run(argv, deps)` from `plugin/bin/log-decision.js`.
- Produces:
  - `composeRoutingLine({ route, severity, category, at, stagePath, commit }) -> { status, text, reversibility } | { error }` and `ROUTES = ['auto','staged','kept-prompt']`, `SEVERITIES = ['low','medium','high','critical']`, `ROUTING_STEP = 'Step 3 Routing'` from `review-routing.js`.
  - CLI: `node plugin/bin/review-routing-line.js --run <run-dir> --route auto|staged|kept-prompt --severity low|medium|high|critical --category <text> --at <file:line> [--stage-path staged/review-{n}.patch] [--commit <sha>] [--spec <n>] [--lever "<k>=<v> (<source>)"]`; exports `run(argv, deps)` with the same `deps` shape as `log-decision.js` (`now, cwd, mainRoot, stdout, stderr`). Exit 0 appended (line echoed), 2 malformed/invalid combination, 3 from `log-decision.js` (run dir missing / not anchored).

Composer rules (exact text; `formatEntry` adds the trailing `.` and `Reversibility: {reversibility}.`):

| route | status | allowed severity | required | refused if given | text | reversibility |
|---|---|---|---|---|---|---|
| `auto` | `AUTO` | low, medium | `--commit` | `--stage-path` | `applied {severity}-severity {category} fix at {at}` | `high (commit {commit})` |
| `staged` | `STAGED` | low, medium, high | `--stage-path` matching `^staged/review-\d+\.patch$` | `--commit` | `{severity}-severity finding {category} at {at}. Stage path: {stagePath}` | `high` |
| `kept-prompt` | `KEPT-PROMPT` | critical only | — | `--stage-path`, `--commit` | `critical finding {category} at {at}. Surfaced inline` | `high` |

Every other route/severity pairing is `{ error }` naming both (the ceiling table in `review/step3-routing.md` never produces it). A flag in the "refused if given" column is `{ error }` naming the flag and route — never silently dropped. `--severity` is matched case-insensitively and normalised to lowercase (the routing tables write `High`/`Critical`), so `High` composes `high-severity finding`; anything else outside the four values is `{ error }` naming the lowercase set. `category`, `at`, `commit` must be non-empty single-line strings. The AUTO line renders `… fix at src/a.js:3. Reversibility: high (commit abc1234).` (plan-review clarification, decided by the user: the commit stays in the reversibility field as log-decision's qualifier).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/log-decision/review-routing.test.js` (copy `fixture()`/`deps()` from `cli.test.js`):
  - `AC2.1: a high finding routed staged produces the literal "high-severity finding"` — run with `--route staged --severity high --category security --at src/a.js:12 --stage-path staged/review-3.patch` → code 0; the appended line equals `- STAGED 09:05:07 — Step 3 Routing: high-severity finding security at src/a.js:12. Stage path: staged/review-3.patch. Reversibility: high.` under a `## /review` heading.
  - `release Step 3 classifies composed lines as the release gate's table says` — read `plugin/skills/release/SKILL.md`, take the table row starting `` | `review: blocking` | `` and collect every `` literal token `X` `` into `BLOCKING`; take the `review: findings` row's backticked tokens (`medium-severity finding`, `applied low-severity`) into `FINDINGS`; assert `BLOCKING` deep-equals `['critical finding','high-severity finding']` (so a reworded gate fails here, not silently). Define `classify(lines)` exactly per that table (blocking if any line includes a BLOCKING token; findings if any includes `Step 3 Routing:`; else clean). Compose via the real CLI: STAGED high → `review: blocking`; KEPT-PROMPT critical → `review: blocking`; STAGED medium → `review: findings`; AUTO low → `review: findings`.
  - `no composed line doubles the step prefix` — each of the four lines above does not include `Step 3 Routing: Step 3 Routing`.
  - `--severity High is normalised` — `--route staged --severity High …` → code 0, line contains `high-severity finding`.
  - `the AUTO line carries the commit in the reversibility qualifier` — `--route auto --severity low --category Convention --at src/a.js:3 --commit abc1234` → line equals `- AUTO 09:05:07 — Step 3 Routing: applied low-severity Convention fix at src/a.js:3. Reversibility: high (commit abc1234).`
  - Refusals, each exit 2 with nothing written: `--route kept-prompt --severity high`; `--route staged --severity critical`; `--route auto --severity high`; `--route auto` without `--commit`; `--route staged` without `--stage-path`; `--stage-path staged/review-x.patch`; `--severity severe`; `--route auto … --stage-path staged/review-3.patch` (inapplicable flag); `--route staged … --commit abc1234` (inapplicable flag); `--category` as the last argv element (trailing bare flag); `--category ''`.
  - `a shadow run dir is refused with exit 3` — `--run` the fixture's worktree-local shadow → code 3, shadow `decisions.md` absent.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/log-decision/review-routing.test.js`
  Expected: FAIL with `Cannot find module '../../../plugin/bin/review-routing-line'`.

- [ ] **Step 3: Implement** `review-routing.js` (pure, per the table) and `review-routing-line.js` (`parseArgs` with the trailing-flag guard, `--help` → USAGE exit 0, compose, then `return require('./log-decision').run(['--run', run, '--status', status, '--step', ROUTING_STEP, '--section', '/review', '--reversibility', reversibility, '--text', text, ...spec/lever], deps)`; `require.main === module` → `process.exitCode = run(process.argv.slice(2), realDeps)`). Header comment states the 0/2/3 vocabulary and that the write is `log-decision.js`'s.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/bin-lib/log-decision/review-routing.test.js tests/bin-lib/log-decision/cli.test.js tests/bin-lib/exit-code-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Go-red proof** — swap the STAGED template to `{severity}-severity {category} finding at {at}` (the #4481 mis-order), re-run, confirm AC2.1 and the classify test fail; restore.

- [ ] **Step 6: Commit** — add the four files; commit `Add review-routing-line.js — compose Step 3 Routing log lines so the release gate's tokens are never hand-typed (#4488)`.

### Task 3: step3-routing.md cites the composer

**Files:**
- Modify: `plugin/skills/review/step3-routing.md:57-59` (the AUTO/STAGED/KEPT-PROMPT `Log:` templates) and `:40` + `:61` (the two `--lever` paragraphs: "pass `--lever …` to `review-routing-line.js`")
- Test: `tests/review-routing-line-prose-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's CLI and flag names.

Each of the three bullets ends with `Log: `node "${CLAUDE_PLUGIN_ROOT}/bin/review-routing-line.js" --run "$PIPELINE_RUN_DIR" --route {auto|staged|kept-prompt} --severity {severity} --category '{category}' --at '{file:line}' …`` (auto adds `--commit {hash}`, staged adds `--stage-path staged/review-{n}.patch`, kept-prompt uses `--severity critical`), followed by one sentence: it writes the `## /review` entry itself; never hand-type the line or pass `Step 3 Routing:` in a `--text`. Size: file is 31,631 B against the 52,500 B rail — headroom ~20.9 KB, the edit is net ≈ +300 B.

- [ ] **Step 1: Write the failing test** — for each route, extract the `review-routing-line.js` command from step3-routing.md's bullet (regex on the backticked `node … review-routing-line.js …` span), substitute placeholders (`{severity}`→`high`/`low`/`critical` by route, `{category}`→`security`, `{file:line}`→`src/a.js:12`, `{hash}`→`abc1234`, `{n}`→`3`, `"$PIPELINE_RUN_DIR"`→fixture run dir), split into argv, call Task 2's `run`, assert exit 0 and that the appended line contains the route's release token (`high-severity finding` / `critical finding` / `applied low-severity`). Plus `step3-routing.md carries no hand-typed Step 3 Routing template` — the file does not match `/Log: `(AUTO|STAGED|KEPT-PROMPT) \{time\} — Step 3 Routing:/`.
  Pre-check (absence-grep control): `git show HEAD:plugin/skills/review/step3-routing.md | grep -c -E 'Log: `(AUTO|STAGED|KEPT-PROMPT) \{time\} — Step 3 Routing:'` prints `3` on the base, so the negative assertion can fail.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/review-routing-line-prose-conformance.test.js`
  Expected: FAIL — no `review-routing-line.js` command found in the bullets; the hand templates still present.

- [ ] **Step 3: Edit step3-routing.md** per the Interfaces block above.

- [ ] **Step 4: Run to verify it passes**
  Run: `node --test tests/review-routing-line-prose-conformance.test.js tests/step3-routing-prose-exempt-conformance.test.js`
  Expected: PASS.

- [ ] **Step 5: Commit** — `git add plugin/skills/review/step3-routing.md tests/review-routing-line-prose-conformance.test.js`; commit `Cite review-routing-line.js in Step 3 Routing — no hand-typed routing templates (#4488)`.

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1 | Task 1 |
| Deliverable 2 (composer; `step3-routing.md` cites it) | Tasks 2, 3 |
| Deliverable 3 (composed STAGED/KEPT-PROMPT → `review: blocking`) | Task 2 classify test |
| AC2.1 | Task 2 |
| AC3.1 (each new test fails reverted) | Go-red steps in Tasks 1, 2; Task 3's absence-grep control |
