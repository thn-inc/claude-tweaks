# Tidy Housekeeping PR Check-Wait Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy's Step 7.5 `pr-first` housekeeping PR never merges before its own checks are green on a repo with no required checks (unless `merge-verification` resolves `off`), and its composed body is screened for closing keywords before `gh pr create`; a failed screen opens no PR and merges nothing.

**Architecture:** Two changes. (1) `plugin/bin/closing-links.js` gains a third mode, `--mode screen --body-file <path>`. It runs the existing pure `neutralizeClosingPhrases` (from `bin/lib/flow/closing-links.js`, the screen build runs already apply to their PR summaries) over a not-yet-posted body file, needs no run dir and no `gh`, and rewrites the file in place when a phrase was neutralized. (2) `plugin/skills/tidy/step-7-5-worktree-always.md`'s arm step stops calling the `--auto` fence blind. It runs `_shared/pr-first-merge.md` Step 2.5 (the merge-verification gate: lever resolution, state read, classification, per-value table, 15-minute bounded watch) first and obeys the resolved lever unchanged (plan-review Q1, Reading B — under `off`, Step 3 runs as written, as at every other merge site). Two tidy substitutions only: the Red path's park and every `pending-review` report become "leave unarmed + report", because a housekeeping PR links no record to park. Step 2.5 already holds the "`--auto` on an unprotected repo is an immediate merge" mechanism, so tidy cites it rather than restating it. A screen exit other than 0 stops before `gh pr create` with no local-merge fall-through (plan-review Q2, Reading A).

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T082500-record-4467/work/4467-spec.md`

**Scope keywords:** closing-links.js, Creation-time caller, tidy-housekeeping-pr

## Global Constraints

- AC (as amended by plan-review Q1): "On a repo without required checks, tidy never merges its housekeeping PR before the PR's own checks complete green, unless `merge-verification` resolves `off`."
- Plan-review Q2 (verbatim intent): if `closing-links.js --mode screen` exits non-zero on the housekeeping PR body, do not run `gh pr create`, do not take the local-merge fall-through, and do not merge anywhere. Leave the already-pushed branch with no PR. Log the reason to `decisions.md` and report `PR NOT opened — closing-keyword screen failed ({reason}); branch {branch} pushed`. The local-merge fall-through stays only for push or `gh pr create` failures.
- Key files named by the spec: `plugin/skills/tidy/step-7-5-worktree-always.md` (arm step and PR body) and `plugin/skills/_shared/pr-first-merge.md` (arm and watch fences).
- `tests/closing-links-prose-conformance.test.js` pins exactly **two** `bin/compose-subject.js"` fences in `pr-first-merge.md`'s `## Step 3:` section. Do not add a composer fence there.
- `tests/sweep-backstop.test.js` pins step-7-5 phrases (`skip §5-6's merge-back`, `never \`--draft\` here`, `Stamp \`<!-- tidy-housekeeping-pr -->\` in the body at creation`, `fall through to the \`local-merge\` branch above and merge back locally instead`, etc.). Keep every pinned phrase byte-identical.
- Skill-graph rule (CLAUDE.md): a new edge goes in `docs/skill-graph.md` once.
- Commits: `{Verb} {what} — {detail}` style, `refs #4467`, never `closes`/`fixes`.

## Review Focus

1. A body whose summary says "closed #12 (stale)" (tidy's own commit-summary vocabulary). `closed` is a GitHub closing keyword, so the screen must neutralize it (`closed issue #12`). Test in Task 1.
2. A body file holding no closing phrase. The screen must not rewrite the file (bytes identical, CRLF included) and must report `clean`. Test in Task 1.
3. `--mode screen` with `--run` or `--settle-ms`, or `pre-merge` with `--body-file`, is a malformed invocation (exit 2), never silently ignored. Test in Task 1.
4. An unreadable `--body-file`, or one that cannot be written, exits 2 with a stderr line and no stdout. Tidy must then open no PR and take no local-merge fall-through (Q2). Test in Task 1; the prose stop is in Task 2 and pinned by its conformance test.
5. A green rollup at the first state read on an unprotected repo. Step 2.5's table routes that to Step 3 as written (an immediate merge of an already-green PR is correct), so the tidy prose must not forbid it; nor may it override `off` (Q1). Task 2's conformance test pins that tidy cites Step 2.5's table rather than restating a "never merge" rule.

---

### Task 1: `closing-links.js --mode screen --body-file <path>`

**Role:** integration

**Files:**
- Modify: `plugin/bin/closing-links.js` (header comment, `USAGE`, `MODES`, `parseArgs`, `run`)
- Modify: `docs/plugin-structure.md` (the `closing-links.js` command-reference entry: add the screen mode in one sentence)
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`

**Interfaces:**
- Produces: CLI `node plugin/bin/closing-links.js --mode screen --body-file <path>`. Exit 0 prints one JSON line, `{"action":"clean","neutralized":[]}` or `{"action":"neutralized","neutralized":[{"number":N,"phrase":"..."}]}`. `neutralized` comes from `neutralizeClosingPhrases(text)` with `targets` unset (every phrase) and no owner/repo scope (over-neutralizing is the safe direction). The file is rewritten only when the text changed. Exit 2 on a malformed invocation, an unreadable `--body-file`, or a failed write; each prints `closing-links.js: {message}` on stderr and nothing on stdout.
- `parseArgs` gains `bodyFile` (default `null`) in its returned object. `MODES` becomes `['pre-merge', 'post-merge', 'screen']`.
- New deps seams on `realDeps`: `readFile: (p) => fs.readFileSync(p, 'utf8')`, `writeFile: (p, s) => fs.writeFileSync(p, s)`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/flow/closing-links-cli.test.js`. Reuse the file's existing `run` import and temp-dir pattern; call `run(argv, deps)` capturing stdout/stderr.
  - `screen neutralizes every closing phrase in a body file and rewrites it`: body `'Tidy: closed #12 (stale), resolves owner/repo#7\r\nsee #9\r\n'` → exit 0; file now equals `'Tidy: closed issue #12 (stale), resolves issue owner/repo#7\r\nsee #9\r\n'`; stdout JSON `action === 'neutralized'`; `neutralized.map(n => n.number)` deep-equals `[12, 7]`.
  - `screen leaves a clean body byte-identical and reports clean`: body `'no keywords here, see #3\n'` → exit 0, JSON `{action:'clean', neutralized:[]}`, and `writeFile` is never called (a `writeFile` override that throws).
  - `screen invocation errors exit 2`: each of `['--mode','screen']` (no body file), `['--mode','screen','--body-file','f','--run','r']`, `['--mode','screen','--body-file','f','--settle-ms','0']`, `['--run','r','--mode','pre-merge','--body-file','f']`, a `--body-file` whose `readFile` throws, and one whose `writeFile` throws on a phrase-bearing body → exit 2, stdout empty, stderr starts with `closing-links.js: `.
  - Update the existing `parseArgs` shape deepEqual to include `bodyFile: null`, and add `assert.equal(parseArgs(['--mode','screen','--body-file','b']).bodyFile, 'b')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js`
Expected: FAIL (`--mode must be one of pre-merge, post-merge: screen` / `unknown argument: --body-file`)

- [ ] **Step 3: Implement the screen mode in `plugin/bin/closing-links.js`.** In `parseArgs`, map `--body-file` to `bodyFile`. In `run`, after `--help`: when `o.mode === 'screen'`, reject `--run`, an explicitly given `--settle-ms` (track it with a `settleMsGiven` flag, not by comparing to the default), and a missing `--body-file` as usage errors. Then read, neutralize, write-if-changed and print, all before the existing `--run` requirement. For `pre-merge`/`post-merge`, reject `--body-file` as a usage error. Update the header comment and `USAGE` with the screen line ("screen: neutralizes every closing-keyword phrase in a not-yet-posted PR body file (a PR that should close no record); no run dir, no gh"). Update `docs/plugin-structure.md`'s `closing-links.js` entry to match, in one added sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/bin-lib/flow/closing-links.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/closing-links.js tests/bin-lib/flow/closing-links-cli.test.js docs/plugin-structure.md
git commit -m "Add closing-links.js screen mode — neutralize closing keywords in an unposted PR body, refs #4467"
```

### Task 2: Tidy Step 7.5 — screen the body, gate the arm on Step 2.5

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (the `pr-first` bullet: body screen before create, screen-failure stop, arm routing)
- Modify: `plugin/skills/_shared/pr-first-merge.md` (the `**Creation-time caller:**` line under `## Step 3:`)
- Modify: `docs/skill-graph.md` (`## tidy` table: one new `_shared/pr-first-merge.md` row)
- Create: `tests/tidy-housekeeping-pr-check-wait-conformance.test.js`

**Covers:** AC1.1 — On a repo without required checks, tidy never merges its housekeeping PR before the PR's own checks complete green. (Amended at plan review, Q1: "…unless `merge-verification` resolves `off`.")

**Size constraint:** `pr-first-merge.md` is composed into the `merge` bundle; the Creation-time-caller edit must be near byte-neutral (net growth at most +200 bytes; measure `wc -c` before and after, and the `rail:` tests must pass).

**Interfaces:**
- Consumes: Task 1's `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --mode screen --body-file "{body-path}"` and its exit codes.

- [ ] **Step 1: Write the failing conformance test (AC1.1)** `tests/tidy-housekeeping-pr-check-wait-conformance.test.js`. It reads the live prose via `require('./helpers/read-skill').readText` (same pattern as `tests/closing-links-prose-conformance.test.js`) and defines assert functions that each get a go-red control:
  - `assertScreenBeforeCreate(step75)`: contains `bin/closing-links.js" --mode screen --body-file`, and that index precedes the literal ``before `gh pr create` `` in the same new sentence.
  - `assertScreenFailureStops(step75)`: contains `PR NOT opened — closing-keyword screen failed` and the screen-failure sentence states the local-merge fall-through is not taken (pin the exact wording written, e.g. `never the \`local-merge\` fall-through`).
  - `assertArmCitesStep25(step75)`: the arm paragraph (from `**Arm before \`ExitWorktree\`**` to the next blank line) contains ``_shared/pr-first-merge.md` Step 2.5`` before ``Step 3's``, contains `leave unarmed` and `no record to park`, and does **not** contain `never an immediate merge (checks pending)`.
  - `assertCreationCallerCitesStep25(prFirst)`: the `**Creation-time caller:**` line contains `Step 2.5`.
  - Go-red controls: slice each added block out of the live text and `assert.throws` on each assert.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/tidy-housekeeping-pr-check-wait-conformance.test.js`
Expected: FAIL (the screen invocation and the Step 2.5 citation are absent)

- [ ] **Step 3: Edit the prose.**
  - In step-7-5's `pr-first` bullet, right after the `Stamp \`<!-- tidy-housekeeping-pr -->\`` sentence (keep it byte-identical), add: before `gh pr create`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/closing-links.js" --mode screen --body-file "{body-path}"` as its own Bash call — the screen build runs apply to their PR summaries (`neutralizeClosingPhrases`), since a housekeeping PR closes no record and a phrase such as "closed #12" in its summary would link and close one. Any non-zero exit: run no `gh pr create`, never the `local-merge` fall-through, merge nothing; the branch stays pushed with no PR; log the reason to `decisions.md` and report `PR NOT opened — closing-keyword screen failed ({reason}); branch {branch} pushed`. Narrow the existing "If the push or both create attempts fail" sentence only if needed to keep it true (it already names only push/create failures — leave the pinned phrase byte-identical).
  - Replace the arm sentence "Arm now runs only `_shared/pr-first-merge.md` Step 3's initial compose + `gh pr merge --auto` fences, not its degrade chain — failure leaves it unarmed, reported: never an immediate merge (checks pending), never ready-and-comment (already open)." with: Arm now first runs `_shared/pr-first-merge.md` Step 2.5 (merge-verification gate) against the PR — its lever resolution (from this run's dir), state and head-run reads, classification, and per-value table, bounded watch included, obeying the resolved value as every merge site does (`off` → Step 3 as written). On a repo with no required checks `--auto` with checks pending is an immediate merge (Step 2.5's "Why `--auto` alone is not a wait"), so the table routes that case to the watch, not the arm. Then run Step 3's compose + merge fences only where the table routes to Step 3. Two substitutions, because a housekeeping PR has no record to park: Step 2.5's Red path and its `pending-review` reports, and Step 3's degrade chain, all leave unarmed + report the reason (`check-failed:{names}`, `checks-pending-timeout`, `checks-read-failed`, `pr-not-open`, `moving-target`, or the arm failure). Never ready-and-comment (already open).
  - Extend the logged outcome list `(armed/staged/skipped/arm-unsupported/arm-failed)` with `merged` (Step 2.5 routed to Step 3 and it merged) and `unarmed-checks` (any Step 2.5 stop), and add the report line `PR #{n} opened and merged after its checks passed`.
  - `pr-first-merge.md` Creation-time caller line: reword to say tidy's Step 7.5 runs Step 2.5 first, then this step's compose + merge fences as Step 2.5 routes, with the Red path and this degrade chain replaced by leave-unarmed + report.
  - `docs/skill-graph.md` `## tidy` table: add one row, `` `_shared/pr-first-merge.md` `` — Step 7.5's creation-time arm runs Step 2.5's merge-verification gate before Step 3's fences, so an unprotected repo's housekeeping PR waits on its checks (#4467); Step 7.5 also screens its body with `bin/closing-links.js --mode screen` before `gh pr create`, and a failed screen opens no PR.

- [ ] **Step 4: Run the new and the pinning suites**

Run: `node --test tests/tidy-housekeeping-pr-check-wait-conformance.test.js tests/sweep-backstop.test.js tests/closing-links-prose-conformance.test.js tests/pr-first-merge.test.js tests/merge-verification-gate-conformance.test.js tests/worktree-forge-api-carve-out.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/_shared/pr-first-merge.md docs/skill-graph.md tests/tidy-housekeeping-pr-check-wait-conformance.test.js
git commit -m "Gate tidy's housekeeping-PR arm on the merge-verification gate — screen its body for closing keywords, refs #4467"
```
