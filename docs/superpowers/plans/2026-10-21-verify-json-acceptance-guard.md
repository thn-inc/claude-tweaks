# Verify-json Acceptance Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a skipped acceptance-labeling step detectable before a `pending-review` PR merges, by persisting `wrap-up-engine.js verify`'s results to `{run-dir}/verify.json` and reading that file at every merge site and in the Pipeline Summary.

**Architecture:** A small writer/reader module (`plugin/bin/lib/wrap-up/verify-results.js`) sits beside the existing `verify-expectations/write.js` seam (atomic write under a best-effort lock). The `verify` verb writes it into the directory it actually verified (the archived copy once Section B has run). `console-residue.js` gains an opt-in `--require-verify <base>` flag the Pipeline Summary passes, and two prose sites (`dispatch/close-out.md` step 3, `_shared/pr-first-merge.md` Step 1) name the file's `acceptance-labeling` row.

**Tech Stack:** Node 18+, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T063157-spec-3783/work/3783-spec.md`

**Scope keywords:** verify.json, require-verify

## Global Constraints

- `verify`'s printed table and exit code (3 on any `fail` row, or a run dir not found) never change because of the new write; a write failure prints one stderr warning only.
- `verify.json` is written to the directory `runVerify` ran against (`resolvedDir`), never to the original `--run-dir` path when that path is gone — Verify execution runs after Section B archives the run, and a write to the original path recreates the archived directory.
- No `verify.json` is written when `resolvedDir` is `null` (run dir not found at its original or archive path).
- `--require-verify` is opt-in; `console-residue.js`'s default `--run` output, `--ack`, `--ack-all`, and `hooks/session-residue.js` (SessionStart) are unchanged. Every archived run predates `verify.json`, so a default-on check would flood every SessionStart.
- `plugin/skills/_shared/pr-first-merge.md` composes with `_shared/pr-checklist-refresh.md` into the `merge` bundle, measured by plan-audit at 51,836 B (max over its three consumers) against `RAIL_BYTES` 52,500 — 664 B of headroom; the Step 1 addition stays at or under ~300 B.

Waived plugin/bin/lib/wrap-up/engine-verify.js: the spec's Key Files names it as the writer; the plan keeps `runVerify` pure and puts the write in the new `verify-results.js`, called from the CLI verb (`wrap-up-engine.js`), so the file needs no change.
- Landed means `result` is `pass` or `skip`; `fail`, `unknown`, or a missing `acceptance-labeling` row means labeling has not landed. **Plan judgment (logged at build):** this fails closed, a superset of the spec's "missing or `fail`" — labeling is an idempotent find-or-create, so an `unknown` re-run costs nothing.
- Commit style `{Verb} {what} — {detail}`, `Refs #3783`, trailer `Claude-Session: https://claude.ai/code/session_01Hc6XBLDvX8cJJ5KdVT1goS`.

## Review Focus

1. A re-run of `verify` after a fix: the stale `fail` row must be replaced, not merged — Task 1 pins overwrite.
2. The run dir is unwritable or locked: the table still prints and the exit code is unchanged — Task 2 pins it.
3. A multi-spec parent run dir: `verify` runs per `spec-{N}/`, so the parent itself never holds `verify.json` — Task 3's flag checks each `spec-*/` subdirectory when present, never the parent alone.
4. `close-out` reaches a PR whose body carries no valid `claude-tweaks-run:` marker: treat it as `verify.json` missing and run labeling — Task 4 pins the sentence.
5. `--require-verify` combined with `--ack`/`--ack-all`, or given without a value: usage error (exit 2), never a silent ignore — Task 3 pins it.

---

### Task 1: `verify-results.js` writer/reader

**Files:**
- Create: `plugin/bin/lib/wrap-up/verify-results.js`
- Test: `tests/bin-lib/wrap-up/verify-results.test.js`

**Interfaces:**
- Produces:
  - `FILE_NAME = 'verify.json'`, `VERSION = 1`
  - `writeVerifyResults({ runDir: string, rows: {check,result,detail}[], base: string, now?: () => number }) -> { file: string, data: object }` — writes `{ version: 1, base, writtenAt: ISO string, checks: rows }` via `writeFileAtomic` under `withLock(path.join(runDir, '.verify-results.lock'), …)`, replacing any prior file whole (no merge). Throws on an unwritable dir.
  - `readVerifyResults(runDir: string) -> object | null` — `null` when the file is absent, unparseable, not an object, `version !== 1`, or `checks` is not an array.
  - `acceptanceLanded(results: object | null) -> boolean` — `true` only when a `checks` entry with `check === 'acceptance-labeling'` has `result` `pass` or `skip`.

- [ ] **Step 1: Write the failing tests** — `writeVerifyResults` round-trips through `readVerifyResults` (`version` 1, `base`, `writtenAt` from injected `now`, `checks` deep-equal to `rows`); a second write with different rows replaces the first (`checks.length` and content equal the second call's, no leftover row); `readVerifyResults` returns `null` for missing file, `'{'`, `'[]'`, `{version:2,checks:[]}`, `{version:1}`; `acceptanceLanded` is `true` for `pass` and `skip`, `false` for `fail`, `unknown`, no such row, and `null`.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/bin-lib/wrap-up/verify-results.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** the module per the Interfaces block, mirroring `plugin/bin/lib/verify-expectations/write.js`'s imports and header-comment style.
- [ ] **Step 4: Run to verify it passes** — same command, Expected: PASS.
- [ ] **Step 5: Commit** — `git add plugin/bin/lib/wrap-up/verify-results.js tests/bin-lib/wrap-up/verify-results.test.js`; message `Add verify-results.js — persist wrap-up verify rows to verify.json`.

### Task 2: `verify` verb writes `verify.json`

**Files:**
- Modify: `plugin/bin/wrap-up-engine.js` (`runVerifyVerb`, ~line 526; header comment line ~8 naming the verb)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/wrap-up/` module-families row and the `wrap-up-engine.js … verify` command line — name `verify.json`)
- Test: `tests/bin-lib/wrap-up/verify-json-cli.test.js`

**Interfaces:**
- Consumes: `writeVerifyResults` (Task 1).

- [ ] **Step 1: Write the failing tests** — spawn `node plugin/bin/wrap-up-engine.js verify --run-dir <dir> --base HEAD` against a temp git repo (`git init`, one commit, run dir under `.claude-tweaks/pipelines/<run-id>/`), with a `gh`-absent PATH (a temp dir holding only symlinks to `node` and `git`, the existing gh-absent test convention). Assert:
  - `AC1.1: verify-json writes one entry per check`: `<dir>/verify.json` exists; `checks.map(c => c.check)` equals the table's check column in order and includes `acceptance-labeling`; each entry's `result` equals that row's result cell's first word; process exit code unchanged from a pre-change run of the same fixture (assert the observed code, 3 or 0, matches `runVerify`'s computed `exitCode` called in-process on the same fixture).
  - `verify-json lands in the archived copy`: original path absent, `.claude-tweaks/pipelines/archive/<run-id>/` present → the file is written under `archive/<run-id>/` and the original path still does not exist afterwards.
  - `verify-json not written when run dir not found`: neither path exists → no `verify.json` anywhere under `.claude-tweaks/pipelines/`, exit 3.
  - `verify-json write failure leaves the verdict alone`: run dir made read-only (`fs.chmodSync(dir, 0o555)`; skip on win32 / root) → stdout still carries the table, exit code unchanged, stderr contains `verify.json`.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/bin-lib/wrap-up/verify-json-cli.test.js` — Expected: FAIL (no `verify.json`).
- [ ] **Step 3: Implement** — after `renderVerifyTable` is written to stdout, when `resolvedDir !== null`, call `writeVerifyResults({ runDir: resolvedDir, rows, base: args.base })` in a try/catch that writes `wrap-up-engine.js verify: could not write verify.json in {resolvedDir}: {message}\n` to stderr. Keep `process.exitCode = exitCode` (no `process.exit`).
- [ ] **Step 4: Run to verify it passes**, then `node --test tests/bin-lib/wrap-up/*.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — the three files; message `Persist wrap-up verify results to verify.json — written to the verified (archived) run dir, never the stale original path`.

### Task 3: `console-residue.js --require-verify <base>` and the Pipeline Summary line

**Files:**
- Modify: `plugin/bin/console-residue.js` (`parseArgs`, `run`, header usage comment, `USAGE`)
- Modify: `plugin/skills/flow/summary-template.md` (the Needs-a-human residue paragraph line 7 and the template's `### Needs a human` placeholder line 33)
- Modify: `plugin/skills/flow/multispec-summary.md` (line 7 paragraph and line 25 placeholder)
- Modify: `docs/plugin-structure.md` (the `console-residue.js` command line ~155)
- Modify: `docs/journeys/review-what-an-unattended-console-left-open-3370.md` (line 29 quotes the summary's command — add the flag)
- Test: `tests/bin-lib/console/residue-cli.test.js` (append)

**Interfaces:**
- Produces: CLI flag `--require-verify <base>`; for the resolved `--run` target, the dirs checked are each `spec-*/` subdirectory when any exist, else the target itself. For each checked dir lacking a `readVerifyResults`-valid `verify.json`, append two lines after any residue lines:
  - `- {basename(target)}{/spec-N when per-spec}: verify.json missing — wrap-up's Verify execution never ran`
  - `  run: node "{pluginRoot}/bin/wrap-up-engine.js" verify --run-dir "{checked dir}" --base {base}`

- [ ] **Step 1: Write the failing tests** (appended, using the file's own `fixture()`/`harness()`):
  - `AC4.1: --require-verify prints the missing-verify line and paste-ready command when verify.json is absent` — exit 0, stdout contains `verify.json missing` and `wrap-up-engine.js" verify --run-dir "${f.runDir}" --base origin/main`.
  - `AC4.2: --require-verify prints nothing for verify when verify.json is present` — write a valid `verify.json` (via `writeVerifyResults`) → stdout lacks `verify.json missing`.
  - `--require-verify treats an unparseable verify.json as missing`.
  - `--require-verify checks each spec-*/ dir of a multi-spec parent, never the parent itself` — parent with `spec-1/verify.json` present and `spec-2/` without → exactly one missing line, naming `spec-2`.
  - `--run without --require-verify never mentions verify.json` — default output for the same absent-file fixture lacks `verify.json`.
  - `--require-verify usage errors` — no value, `--ack --run x --require-verify b`, `--ack-all --require-verify b` → each returns 2.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/bin-lib/console/residue-cli.test.js` — Expected: FAIL on the new tests only.
- [ ] **Step 3: Implement** the flag per the Interfaces block (`readVerifyResults` from Task 1's module). Then update both summary files: the command becomes `node "{pluginRoot}/bin/console-residue.js" --run "$PIPELINE_RUN_DIR" --require-verify {base}` (multi-spec: `"$MULTISPEC_PARENT_DIR"`), `{base}` being the base ref the summary's `{base}` ladder already resolves; the paragraph gains one clause: the flag adds a line when the run never wrote `verify.json` (wrap-up's Verify execution never ran). Keep the omit-on-empty and stderr-on-non-zero rules verbatim.
- [ ] **Step 4: Run to verify it passes** — `node --test tests/bin-lib/console/*.test.js tests/timing-prose-conformance.test.js tests/console-resolve-conformance.test.js` — Expected: PASS (fix any existing pin the summary edit trips by updating the pinned literal, never deleting the assertion). **Real-input probe:** `node plugin/bin/console-residue.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-21T042119-spec-3784" --require-verify fc3705b31` — a real archived run that predates `verify.json` — must print exactly one `verify.json missing` line plus its `run:` command, after that run's own residue lines (independent count: `ls` that dir shows no `verify.json` and no `spec-*/`).
- [ ] **Step 5: Commit** — message `Add console-residue --require-verify — the Pipeline Summary names the verify command when a run never wrote verify.json`.

### Task 4: Merge sites read `verify.json`'s `acceptance-labeling` row

**Files:**
- Modify: `plugin/skills/dispatch/close-out.md` (step 3's "Step 1 (Acceptance labeling) needs no separate run here…" sentence)
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 1, line 31-39)
- Modify: `docs/skill-graph.md` (the `_shared/pr-first-merge.md` row: one sentence that `close-out.md` step 3 now reaches Step 1 when `verify.json` is missing or its `acceptance-labeling` row has not landed)
- Test: `tests/verify-json-acceptance-guard-conformance.test.js`

- [ ] **Step 1: Write the failing conformance test** (test names carry `AC2.1:` for the close-out step-3 rule — verify.json absent ⇒ labeling runs before the merge — and `AC3.1:` for the pair of pins) — read each file live, slice the section (close-out: from `3. **Convert draft to ready` to `4. **Confirmation gate`; pr-first-merge: from `## Step 1:` to `## Step 1.5`), flatten whitespace, and assert:
  - close-out step 3 matches `/verify\.json/`, `/acceptance-labeling/`, `/claude-tweaks-run:/`, `/pr-first-merge\.md.{0,40}Step 1/`, `/before the confirmation gate/`, and `/no valid .{0,40}marker.{0,80}(missing|not landed)/i`; and no longer matches `/needs no separate run here/`.
  - pr-first-merge Step 1 matches `/verify\.json/` and `/acceptance-labeling/` and `/not landed/`.
  - Negative control: the same assertions applied to each section with the new sentence removed (string replace of the inserted text) fail — proves each assertion can go red.
- [ ] **Step 2: Run to verify it fails** — Run: `node --test tests/verify-json-acceptance-guard-conformance.test.js` — Expected: FAIL (both files still carry the old text). Also run it once against `origin/main`'s text (`git show origin/main:{path}` fed through the same section/assert helpers in a scratch script) and record the red output for AC5-style proof.
- [ ] **Step 3: Edit the prose.**
  - close-out step 3: replace the "needs no separate run here" sentence with the rule: resolve the run dir from the PR body's `claude-tweaks-run: {run-id}` marker (validated as `flow/claim-targets.md` validates it), read `verify.json` at `.claude-tweaks/pipelines/{run-id}/` then `archive/{run-id}/`; when the file is missing, no valid marker resolves, or its `acceptance-labeling` row has not landed (anything but `pass`/`skip`), run `_shared/pr-first-merge.md` Step 1 before the confirmation gate.
  - pr-first-merge Step 1: append one sentence (≤ 300 B): a missing `{run-dir}/verify.json`, or an `acceptance-labeling` row other than `pass`/`skip`, means labeling has not landed — whichever caller reached this merge.
- [ ] **Step 4: Run** `node --test tests/verify-json-acceptance-guard-conformance.test.js tests/pr-first-merge.test.js tests/wrap-up-merge-mode-conformance.test.js tests/bin-lib/skill-audit/*.test.js tests/skill-size-single-source.test.js`, then `node plugin/bin/compose-context.js --run <scratch run dir> --step merge plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/pr-checklist-refresh.md` and confirm `bytes` < 52,500 — Expected: PASS, bytes under the rail.
- [ ] **Step 5: Commit** — message `Guard pending-review merges on verify.json's acceptance-labeling row — close-out step 3 and pr-first-merge Step 1`.

### Task 5: Full suite

- [ ] **Step 1: Run the full-suite verification (AC5.1)** — `node plugin/bin/verify.js --cmd tests="npm test"` from the worktree root; Expected: `fail 0`. Fix and recommit anything red.
