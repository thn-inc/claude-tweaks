# Route SDD's final-review capture through write-run-artifact.js (#3496) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A worktree-isolated session following `plugin/skills/build/dispatch.md` verbatim persists `sdd-final-review.md` into the main-checkout run directory through the sanctioned writer, instead of an Edit/Write the harness refuses.

**Architecture:** Allowlist `sdd-final-review.md` in `plugin/bin/lib/run-artifact/write.js`'s `ARTIFACT_NAMES` (the fail-closed gate `plugin/bin/write-run-artifact.js` already enforces), then rewrite only the #3386 sentence span in `dispatch.md` to the same resolve-scratch → Write → persist shape #3044 gave the AC-forwarding sample in the same paragraph.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T195822-record-3496/work/3496-spec.md` (materialized from GitHub issue #3496)

## Global Constraints

- Artifact name, exact: `sdd-final-review.md`. Allowlist order: `['sdd-dispatch-sample.txt', 'sdd-final-review.md']`.
- Resolve command, exact (no `eval`): `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_FINAL_REVIEW=sdd-final-review-{run-id}.md` — verified live: prints `SDD_FINAL_REVIEW="<abs path>"`.
- Persist command, exact: `node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-final-review.md --file "{review-path}"` — verified live pre-change: exits 2 naming the allowlist (`--name must be one of: sdd-dispatch-sample.txt`), the gap Task 1 closes. `{review-path}` instead of the spec's `{sample-path}` placeholder: this file is a review, not a sample; the placeholder name is the only departure.
- `dispatch.md` is 24,837 B against `RAIL_BYTES` 52,500 B; this plan adds ~600 B — headroom ~27 KB.
- Edit only the `**Persist SDD's final whole-branch review before Finish (#3386):**` span of `dispatch.md` line 14 (up to `**Standing AC-forwarding verification (#496).**`). Every other span of that line is byte-pinned by other suites.
- Commit messages: `{Verb} {what} — {detail} (refs #3496)`; never `closes`/`fixes`.

## Review Focus

- A session that sets a shell variable in one Bash call and reads it in the next — the prose must say to substitute the printed literal path (pinned by Task 2's live probe running each command in a fresh `/bin/sh`).
- The writer exits non-zero (refused, missing run dir) — Finish must not block; the existing `SKIP … absent` line records it (pinned by Task 2's prose assertion).
- `tests/build-ac-forwarding-verification.test.js`'s live probe counts exactly two `write-run-artifact.js` commands from the `#496` mark onward — the new commands must stay *before* that mark (pinned by running that suite in Task 2 Step 4).
- A traversal-shaped name (`../sdd-final-review.md`) must still be refused after widening the allowlist (Task 1 test).
- A worktree-local shadow run dir must still be refused for the new name (covered by the existing anchoring tests; the CLI test in Task 1 exercises the new name end to end).

Scope keywords: sdd-final-review, ARTIFACT_NAMES

---

### Task 1: Allowlist `sdd-final-review.md` in the run-artifact writer

**Files:**
- Modify: `plugin/bin/lib/run-artifact/write.js:20`
- Modify: `plugin/bin/write-run-artifact.js:7-9` (header comment: list both names)
- Modify: `docs/plugin-structure.md:41` (`ARTIFACT_NAMES = sdd-dispatch-sample.txt, sdd-final-review.md`)
- Test: `tests/bin-lib/run-artifact/write.test.js`
- Test: `tests/bin-lib/run-artifact/cli.test.js`

**Interfaces:**
- Produces: `ARTIFACT_NAMES` containing `'sdd-final-review.md'`; `isArtifactName('sdd-final-review.md') === true`. Task 2's live probe depends on this.

- [ ] **Step 1: Write the failing tests**

In `write.test.js`, add `test('#3496: sdd-final-review.md is allowlisted; traversal forms of it are not', …)` asserting `isArtifactName('sdd-final-review.md') === true`, `isArtifactName('../sdd-final-review.md') === false`, `isArtifactName('staged/sdd-final-review.md') === false`, and that `writeArtifact({ runDir, name: 'sdd-final-review.md', content })` round-trips byte-identically to `path.join(runDir, 'sdd-final-review.md')`.

In `cli.test.js`, add `test('#3496: a worktree-isolated session writes sdd-final-review.md into the anchored run dir', …)` reusing `fixture`/`fakeDeps`: `run(['--run', singleDir, '--name', 'sdd-final-review.md', '--file', src], deps)` returns `0`, the file under `singleDir` equals `'AC sample\nline two\n'`, and nothing lands in `shadow`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/run-artifact/write.test.js tests/bin-lib/run-artifact/cli.test.js`
Expected: FAIL — the two new tests fail (`isArtifactName` false; CLI exits 2).

- [ ] **Step 3: Implement** — add `'sdd-final-review.md'` to `ARTIFACT_NAMES`; update the two comment/doc lines named in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/run-artifact/write.test.js tests/bin-lib/run-artifact/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/run-artifact/write.js plugin/bin/write-run-artifact.js docs/plugin-structure.md tests/bin-lib/run-artifact/write.test.js tests/bin-lib/run-artifact/cli.test.js
git commit -m "Allowlist sdd-final-review.md in write-run-artifact — SDD final review can be persisted from a worktree (refs #3496)"
```

### Task 2: Rewrite dispatch.md's #3386 capture sentence onto the sanctioned writer

**Files:**
- Modify: `plugin/skills/build/dispatch.md:14` (the `**Persist SDD's final whole-branch review before Finish (#3386):**` span only)
- Modify: `docs/journeys/write-the-ac-forwarding-sample-from-a-worktree-3044.md` (line 35: both names are allowlisted; line 55: the final-review write now goes through the writer too, #3496)
- Test: `tests/build-sdd-final-review-capture.test.js`

**Interfaces:**
- Consumes: Task 1's allowlisted `sdd-final-review.md`.

- [ ] **Step 1: Update the pins and add the live probe (failing)**

In `tests/build-sdd-final-review-capture.test.js`:
- Add constants `RESOLVE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" SDD_FINAL_REVIEW=sdd-final-review-{run-id}.md'` and `WRITE_CMD = 'node "${CLAUDE_PLUGIN_ROOT}/bin/write-run-artifact.js" --run "$PIPELINE_RUN_DIR" --name sdd-final-review.md --file "{review-path}"'`, and a `SECTION` = the slice of `DISPATCH` from `**Persist SDD's final whole-branch review before Finish (#3386):**` to `**Standing AC-forwarding verification (#496).**`.
- Replace the AC1 regex at lines 19-22 with `test('AC1.1: the capture resolves a session-scratch path and persists through the sanctioned writer, never a direct run-dir Write', …)` asserting `SECTION` includes `RESOLVE_CMD`, includes `WRITE_CMD`, includes `` `{run-id}` is `basename "$PIPELINE_RUN_DIR"` ``, includes `never an Edit/Write straight to the run directory`, does not include `eval "$(node`, and still matches `/before deleting the plan's workspace/`.
- Add `test('AC1.1: the dispatch.md capture commands run from a worktree cwd and land sdd-final-review.md in the run dir', { skip: win32 })` modelled on `tests/build-ac-forwarding-verification.test.js:60-108`: extract the `write-run-artifact.js` command(s) from `SECTION` (exactly 1), run `RESOLVE_CMD` (run-id substituted) in `/bin/sh` from a fake worktree cwd, parse `SDD_FINAL_REVIEW="<path>"`, `fs.writeFileSync` a review body there, run the extracted command with `{review-path}` replaced by the literal, then assert `path.join(runDir, 'sdd-final-review.md')` exists and equals the body.
- Add `test('AC2.1: the captured/absent decisions line keys on the file the writer echoes, and a writer failure never blocks Finish', …)` asserting `SECTION` matches `/A non-zero exit from the writer never blocks Finish/` and still carries the existing `AUTO … — SDD final review captured to sdd-final-review.md` / `SKIP … — SDD final review dispatched but sdd-final-review.md absent` literals (lines 41-45 keep their assertions).
- Keep `assertFourItems`, the AC2/standalone test, `nothing blocks on its absence`, and the doctored control unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/build-sdd-final-review-capture.test.js`
Expected: FAIL — the AC1.1 prose test (no `RESOLVE_CMD` in section), the live probe (0 commands extracted), and the AC2.1 test.

- [ ] **Step 3: Rewrite the span** — replace `it must write \`$PIPELINE_RUN_DIR/sdd-final-review.md\` (the absolute run-directory path, never a worktree-relative one) containing:` with: resolve a session-scoped scratch path with `RESOLVE_CMD` (`{run-id}` is `basename "$PIPELINE_RUN_DIR"`; no `eval` — it prints `SDD_FINAL_REVIEW="<path>"`), write the review to that printed literal path with the Write tool, and persist it with `WRITE_CMD`, where `{review-path}` is that same printed literal path substituted in (a shell variable set in an earlier Bash call does not survive into a later one) — never an Edit/Write straight to the run directory, which a worktree-isolated session's harness refuses (`_shared/pipeline-run-dir.md`'s tool-level pinning note); the writer lands it at `$PIPELINE_RUN_DIR/sdd-final-review.md`. The review contains: …(four items unchanged)… After `nothing blocks on its absence.` add: `A non-zero exit from the writer never blocks Finish — the SKIP line below then records the absent file.` Leave the "Write nothing for a standalone…" and "When SDD returns…" sentences unchanged. Then update the two journey lines.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/build-sdd-final-review-capture.test.js tests/build-ac-forwarding-verification.test.js tests/bin-lib/run-artifact/write.test.js tests/bin-lib/run-artifact/cli.test.js`
Expected: PASS, 0 failures (the #496 suite confirms its two-command count is undisturbed).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/dispatch.md tests/build-sdd-final-review-capture.test.js docs/journeys/write-the-ac-forwarding-sample-from-a-worktree-3044.md
git commit -m "Route dispatch.md's SDD final-review capture through write-run-artifact.js — no harness refusal from a worktree (refs #3496)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 → Task 1. Deliverable 2 → Task 2 Step 3. Deliverable 3 → Task 2 Step 1. AC1.1 → Task 2's AC1.1 prose + live-probe tests (and Task 1's CLI test). AC2.1 → Task 2's AC2.1 test plus the live probe proving the file the log line checks is the file the writer writes.
- **Moved-prose pins:** `git grep -F` over `tests plugin docs` for the span's phrases hits only `tests/build-sdd-final-review-capture.test.js` (lines 18, 21, 38, 43, 48); line 21 is the only one whose text changes.
- **Placeholders:** none.
