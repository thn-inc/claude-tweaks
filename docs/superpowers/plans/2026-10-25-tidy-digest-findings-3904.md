# Tidy Digest Findings (#3904) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/tidy`'s Action Vocabulary table `Archive` and `Backfill` rows (plus matching Step 7.5 verification lines), pinned by a conformance test; record dispositions for the other two digest findings.

**Architecture:** Prose-only change to `plugin/skills/tidy/SKILL.md` (two table rows, two checklist lines) whose Execution cells point at the existing recipes rather than restating `step-6-auto.md`'s routing tiers, plus one new `node --test` suite. Deliverables 2–4 are controller-side dispositions, not implementer tasks (see "Non-code dispositions").

**Tech Stack:** Markdown skill prose; `node --test` (built-in), `tests/helpers/read-skill.js`'s `readText`.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T155055-record-3904/work/3904-spec.md` (record #3904)

## Global Constraints

- Do not restate the routing tiers `step-6-auto.md` owns (spec Deliverable 1): no `Auto-apply` / `Stage` / `conservative` / `moderate` / `aggressive` tier wording in the new SKILL.md rows — point at `step-6-auto.md`'s two **Archive** and two **Backfill** rows instead.
- `plugin/skills/tidy/step-6-auto.md` is read, not changed.
- Item 2 must not pre-empt #3467's open decision: `plugin/bin/lib/pr-checks/classify.js` and `github-pr-scan.md`'s item 1 `FAILURE` set stay byte-unchanged.
- Size: `tidy/SKILL.md` is 36,875 B at the merge base against the 52,500 B `RAIL_BYTES` rail (`plugin/bin/lib/skill-audit/budgets.js`); the two rows + two lines add ~1.3 KB, leaving ~14 KB headroom. No per-file byte pin exists (decision 0024).
- Commit style: `{Verb} {what} — {detail}`, body cites `refs #3904` (never `closes`/`fixes`), ends with `Claude-Session: https://claude.ai/code/session_01Ke7fwCcDQwHvJbgHopG1ZL`.

## Review Focus

- A row that names the recipe but drops the `remedy: record` no-op case — a reader could then archive a run whose worktree a live session still holds, or create a tag for a CHANGELOG-only heading. Pinned in Task 1 (`AC1.1` row assertions name `remedy: record`).
- Tier wording leaking into the rows (duplicating `step-6-auto.md`, which then drifts). Pinned in Task 1 (tier-word negative assertion + go-red control).
- A verification line placed outside Step 7.5's fenced checklist (e.g. appended after the `FAILED` line's fence close). Pinned in Task 1 (assertions run against the fenced block only).
- The rows' recipe pointers going stale (Section B renamed, `release.js` moved). Pinned in Task 1 (asserts the cited path exists on disk).
- Removing one of the two rows while the other remains — each go-red control mutates one row independently.

## Non-code dispositions (controller, not implementer)

- **Deliverable 2 (item 2):** #3467 is still undecided (three `backlog refine` needs-decision comments, each resolved `keep`, latest 2026-10-24; no policy chosen) → keep-deferred, pending #3467; behavior unchanged. Recorded in `decisions.md` and the PR. `Waived AC2.1: keep-deferred branch of the criterion — no test, by the criterion's own wording.`
- **Deliverable 3 (item 3):** won't-fix ruling, staged at the Review Console (`staged/`), never applied silently. Measured: 21 open PRs, one `pr-checks.js --pr` call 1.37 s wall → ~29 s today, ~137 s at the 100-PR cap. Reasons: GitHub's REST guidance asks for serial, not concurrent, requests per client (secondary rate limits), and item 1 already runs concurrently with the scope's other items; skipping the call when the rollup "already shows the head-SHA runs" is not decidable from the rollup — the rollup omitting unregistered head-sha runs is exactly the gap #3469 closed. `Waived AC3.1: a disposition, not code — the staged ruling is the artifact.`
- **Deliverable 4:** already satisfied — all three #1426 digest lines end `→ #3904` (verified via `gh issue view 1426`). `Waived AC4.1: pre-satisfied on the live issue; nothing to build.`

---

### Task 1: Archive and Backfill in tidy's Action Vocabulary + Step 7.5

**Files:**
- Modify: `plugin/skills/tidy/SKILL.md` — Action Vocabulary table (insert two rows directly after the `| **Fill Release Note** |` row, line ~133) and Step 7.5's fenced `### Verification` checklist (insert two lines directly before `- [ ] FAILED:`, line ~203)
- Test: `tests/tidy-action-vocabulary-archive-backfill.test.js` (create)

**Interfaces:**
- Consumes: nothing from other tasks. Recipe sources (read-only): `plugin/skills/tidy/step-6-auto.md` lines 48–51 (two **Archive**, two **Backfill** routing rows); `plugin/skills/tidy/scan-procedures.md` lines 93 and 95 (collection of `kind: pipeline-run` → Archive, `kind: release` → Backfill); `plugin/skills/wrap-up/cleanup-procedures.md` item 8 / Section B (archive to `.claude-tweaks/pipelines/archive/{run-id}/`, never delete); `plugin/bin/lib/residue/probes/release.js` (heading grammar `## v{version} — {summary}`).
- Produces: nothing other tasks use.

- [ ] **Step 1: Write the failing test** `tests/tidy-action-vocabulary-archive-backfill.test.js`

Read `plugin/skills/tidy/SKILL.md` with `readText` (`tests/helpers/read-skill`). Two slicers: `vocabTable(text)` — from `## Action Vocabulary` to the next `\n### ` heading; `verificationBlock(text)` — from the line `### Verification` inside Step 7.5's fence to the closing ` ``` ` line after it. One assertion function `assertArchiveBackfill(text)` that both the positive tests and every go-red control call:

```js
function rowFor(text, action) {
  return vocabTable(text).split('\n').find((l) => l.startsWith(`| **${action}** |`));
}
function assertArchiveBackfill(text) {
  const archive = rowFor(text, 'Archive');
  assert.ok(archive, 'Action Vocabulary has an Archive row');
  for (const s of ['kind: pipeline-run', 'wrap-up/cleanup-procedures.md` Section B', '.claude-tweaks/pipelines/archive/', 'remedy: record', "step-6-auto.md`'s two **Archive** rows"]) {
    assert.ok(archive.includes(s), `Archive row names ${s}`);
  }
  const backfill = rowFor(text, 'Backfill');
  assert.ok(backfill, 'Action Vocabulary has a Backfill row');
  for (const s of ['kind: release', 'bin/lib/residue/probes/release.js', '## v{version} — {summary}', 'remedy: record', "step-6-auto.md`'s two **Backfill** rows"]) {
    assert.ok(backfill.includes(s), `Backfill row names ${s}`);
  }
  for (const row of [archive, backfill]) {
    assert.doesNotMatch(row, /Auto-apply|\bconservative\b|\bmoderate\b|\baggressive\b/, 'row does not restate step-6-auto.md routing tiers');
  }
  const verify = verificationBlock(text);
  assert.match(verify, /^- \[x\] Archived: /m, 'Step 7.5 has an Archived verification line');
  assert.match(verify, /^- \[x\] Backfilled: /m, 'Step 7.5 has a Backfilled verification line');
}
```

Tests (names carry the AC clause ids):
- `AC1.1: tidy/SKILL.md's Action Vocabulary has Archive and Backfill rows, and Step 7.5 a verification line for each` — `assertArchiveBackfill(SKILL)`.
- `AC1.1: the recipes the rows cite exist` — `fs.existsSync` true for `plugin/skills/wrap-up/cleanup-procedures.md` and `plugin/bin/lib/residue/probes/release.js`; `step-6-auto.md` has lines starting `| **Archive** (` and `| **Backfill** (` (2 each).
- Go-red controls, each `assert.throws(() => assertArchiveBackfill(mutated), /<message>/)` after first asserting `mutated !== SKILL`: (a) delete the Archive row line → `/Archive row/`; (b) delete the Backfill row line → `/Backfill row/`; (c) append ` Auto-apply` to the Archive row → `/routing tiers/`; (d) delete the `- [x] Backfilled:` line → `/Backfilled verification line/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/tidy-action-vocabulary-archive-backfill.test.js`
Expected: FAIL — `Action Vocabulary has an Archive row` (the go-red controls also fail, since `mutated === SKILL` when the rows are absent).

- [ ] **Step 3: Add the rows and lines to `plugin/skills/tidy/SKILL.md`**

Exact copy (the spec fixes recipe content; pointers, not tiers). Table rows, after the `Fill Release Note` row:

```
| **Archive** | A clean, un-archived pipeline run directory — `bin/residue.js`'s `kind: pipeline-run` finding, collected by `scan-procedures.md` Step 4.5 | Move it to `.claude-tweaks/pipelines/archive/{run-id}/` per `wrap-up/cleanup-procedures.md` Section B — a move, never a delete. A `remedy: record` finding (the run's worktree is still locked by a live session, #1328) is surfaced and never moved. Routing per `step-6-auto.md`'s two **Archive** rows | No — moved under `archive/`, not deleted |
| **Backfill** | A `v*` tag and `CHANGELOG.md` disagree — `bin/residue.js`'s `kind: release` finding, collected by `scan-procedures.md` Step 4.5 | Add the missing `## v{version} — {summary}` heading in the grammar `bin/lib/residue/probes/release.js` reads, then re-run Step 4.5's `bin/residue.js` invocation to confirm the finding cleared. A `remedy: record` finding (a heading with no local or remote tag, #2882) is surfaced and never acted on — no tag is created or pushed. Routing per `step-6-auto.md`'s two **Backfill** rows | No — one CHANGELOG heading added |
```

Step 7.5 lines, before `- [ ] FAILED:`:

```
- [x] Archived: run {run-id} — directory now under `.claude-tweaks/pipelines/archive/{run-id}/` and gone from `.claude-tweaks/pipelines/` (`remedy: record`: surfaced, nothing moved)
- [x] Backfilled: v{version} — `CHANGELOG.md` carries `## v{version} — {summary}` and a re-run of `bin/residue.js` no longer reports the `kind: release` finding (`remedy: record`: surfaced, no tag created)
```

Also update the Backend probe paragraph? No — both actions are backend-independent (git/local files), like `Capture`; leave it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/tidy-action-vocabulary-archive-backfill.test.js tests/materiality-floor-conformance.test.js tests/sweep-backstop.test.js tests/tidy-report-rules.test.js tests/tidy-residue-markers.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/SKILL.md tests/tidy-action-vocabulary-archive-backfill.test.js
git commit -m "Add Archive and Backfill to tidy's Action Vocabulary — Step 7.5 verify lines, pinned (refs #3904)"
```

AC1.2 ("the skill-prose conformance suites still pass") and AC5.1 (`npm test` passes) are covered by Common Step 5's full-suite verification, not a task test.

## Waivers

Waived AC1.2: covered by Common Step 5's full `npm test` run, which includes every skill-prose conformance suite.
Waived AC2.1: keep-deferred branch of the criterion — #3467 undecided; recorded in decisions.md and the PR, no test by the criterion's own wording.
Waived AC3.1: a disposition, not code — the won't-fix ruling staged at the Review Console is the artifact.
Waived AC4.1: pre-satisfied on the live issue #1426; nothing to build.
Waived AC5.1: Common Step 5's full-suite verification.
