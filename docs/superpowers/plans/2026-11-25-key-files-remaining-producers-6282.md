# Key Files from the remaining record-proposal producers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Execution:** batched
**Batch:** send every task to one implementer as a single brief; review the combined diff once.

**Goal:** Every remaining staged-record-proposal producer instructs passing `keyFiles: [{ path, change }]` to `specShapedBody`, so records filed from ledger rulings, SDD rulings, residue sweeps, visual reviews, reflections and CLAUDE.md budget checks carry a `### Key Files` section.

**Architecture:** Prose-only change to six skill files, pinned by the existing `AC6.1` loop in `tests/build-micro-plan-conformance.test.js`. `ledger-format.md` holds one shared Key Files path rule that its four branches (and the SDD ruling compositions) cite; the other producers state the rule in their own text.

**Tech Stack:** Markdown skill prose; `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T095255-record-5463/spec-6282/work/6282-spec.md` (record #6282)

## Global Constraints

- Never touch `plugin/skills/review/step3-routing.md` (owned by #5512, already landed — its path is already in the AC6.1 list).
- No change to `specShapedBody` (`plugin/bin/lib/issues/record-payload.js`), the bundler, or grouping.
- The literal `keyFiles: [{ path, change }]` must appear on one line (never wrapped across a line break) — the test regex and `grep -F` match single lines.
- Path rule ("the Key Files path rule"): repo-relative file paths only, taken from explicit file tokens the source names (never guessed from prose), a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, no directories, out-of-repo files dropped, `keyFiles` omitted when the source names no file.
- `plugin/skills/_shared/ledger-format.md` is 45,152 B; stay under the 47,250 B headroom flag (add under ~1,500 B). Keep wrapped files (`review-console-appendix.md`, `residue-sweep.md`) wrapped at their existing ~100-column width.
- Governing project skills: none under `.claude/skills/` names these prose files' compositions (checked: `run-directory-fact-packs`, `parse-signal-discipline/fix-shape-late-items.md`, `shared-contract-extraction` mention `ledger-format.md`/`keyFiles` only for code-side readers and validators, not producer prose).

## Review Focus

1. `claudeMdBudgetTargets[].path` is **absolute** (`listClaudeMd` in `plugin/bin/lib/harness-health/scope.js` returns `path.join(root, 'CLAUDE.md')`), and `specShapedBody` throws on an absolute path — the curation instruction must say to make it repo-relative. (Task 2 Step 3's text.)
2. A finding anchor like `src/x.js:10-20` or `x.md#section` passed unstripped becomes a Key File no other record shares — every producer's text names the strip (AC3).
3. A visual-review finding naming only a route/URL must pass no `keyFiles` (no guessing a source file).
4. A directory entry throws in `specShapedBody` — every rule says "no directories".
5. A wrapped line splitting `keyFiles: [{ path, change }]` silently fails the per-branch `grep -cF` count (AC2).

---

### Task 1: ledger-format.md, review-console-appendix.md, residue-sweep.md

**Role:** transcription

**Files:**
- Modify: `plugin/skills/_shared/ledger-format.md:271-275`
- Modify: `plugin/skills/wrap-up/review-console-appendix.md:107,124`
- Modify: `plugin/skills/wrap-up/residue-sweep.md:175-176`
- Test: `tests/build-micro-plan-conformance.test.js:127`

- [ ] **Step 1: Extend the AC6.1 producer list (covers AC1.1, AC1.2, AC4.1)**

In the `for (const rel of [...])` array at line 127, append (keep existing four entries):
`'plugin/skills/_shared/ledger-format.md', 'plugin/skills/wrap-up/review-console-appendix.md', 'plugin/skills/wrap-up/residue-sweep.md', 'plugin/skills/visual-review/browser-review.md', 'plugin/skills/reflect/full-mode.md', 'plugin/skills/wrap-up/claude-md-curation.md'`

- [ ] **Step 2: Run to verify the six new cases fail**

Run: `node --test tests/build-micro-plan-conformance.test.js`
Expected: FAIL — six `AC6.1:` cases fail on `/keyFiles: \[\{ path, change \}\]/`; the four existing pass.

- [ ] **Step 3: Edit `ledger-format.md` (AC2.1, AC3.1)**

- Line 271 (`Defer`): after the `currentState = the ledger item's evidence and affected files;` clause insert:
  `` `keyFiles: [{ path, change }]` = the ledger item's affected files, per the Key Files path rule: repo-relative file paths only, taken from explicit file tokens the item names (never guessed from prose), a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, no directories, out-of-repo files dropped, and `keyFiles` omitted when the item names no file — so build's micro-plan gate and dispatch's file-overlap grouping can read the record; ``
- Line 272 (`Keep`): `same composition,` → `` same composition (`keyFiles: [{ path, change }]` included, Defer's Key Files path rule), ``
- Line 273 (direct create): `composing via \`specShapedBody\` exactly as the branches above` → append `` (`keyFiles: [{ path, change }]` included, Defer's Key Files path rule) ``
- Line 275 (`Acknowledge`): after `` `acceptanceCriteria` = the observable outcome `` insert `` ; `keyFiles: [{ path, change }]` = the files the ops action names, Defer's Key Files path rule ``

- [ ] **Step 4: Edit `review-console-appendix.md` (AC2.2, AC3.1)**

- `file-record` composition (line ~107, `Current State = the ruling and the finding it deferred;`): add after it, rewrapped to the file's width with the literal on one line:
  `` `keyFiles: [{ path, change }]` = the files the ruling's finding names, per `_shared/ledger-format.md`'s Key Files path rule (repo-relative file paths, a `:{digits}`/`:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, omitted when the finding names no file); ``
- `reverse` composition (line ~124, `Current State = the ruling and the finding it ruled on;`): same clause with "the files the ruling's finding names".

- [ ] **Step 5: Edit `residue-sweep.md` (AC1, AC3.1 — rule stated in this file)**

At line 175-176, after `` the #621 mapping above supplying its `Defer-reason:`, `` insert (rewrapped):
`` with `keyFiles: [{ path, change }]` = the residue item's files — repo-relative file paths taken from explicit file tokens the item names, a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, no directories, out-of-repo files dropped, omitted when the item names no file — ``

- [ ] **Step 6: Verify counts**

Run: `grep -cF 'keyFiles: [{ path, change }]' plugin/skills/_shared/ledger-format.md` → ≥ 4
Run: `grep -cF 'keyFiles: [{ path, change }]' plugin/skills/wrap-up/review-console-appendix.md` → ≥ 2
Run: `wc -c plugin/skills/_shared/ledger-format.md` → < 47250

- [ ] **Step 7: Commit**

`git add` the four files; commit `Pass keyFiles from ledger, SDD-ruling and residue record proposals — refs #6282`

### Task 2: browser-review.md, full-mode.md, claude-md-curation.md

**Role:** transcription

**Files:**
- Modify: `plugin/skills/visual-review/browser-review.md:247`
- Modify: `plugin/skills/reflect/full-mode.md:397`
- Modify: `plugin/skills/wrap-up/claude-md-curation.md:21-25`

- [ ] **Step 1: Edit `browser-review.md` Defer (AC1, AC3.1)**

After `` footer `_Filed by \`visual review\` via specShapedBody._` `` insert:
`` , and `keyFiles: [{ path, change }]` = the source files the finding maps to — repo-relative file paths taken from explicit file tokens (never guessed from a route), a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, no directories, out-of-repo files dropped, omitted when the finding names only a route or URL or no file ``

- [ ] **Step 2: Edit `full-mode.md` Defer (AC1, AC3.1)**

Inside the compose parenthesis, after `` footer `_Filed by \`reflect\` via specShapedBody._` `` insert:
`` ; `keyFiles: [{ path, change }]` = the files the insight names — repo-relative file paths, a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, no directories, out-of-repo files dropped, omitted when the insight names no file ``

- [ ] **Step 3: Edit `claude-md-curation.md` (AC1, AC3.1)**

Add a bullet after the `premiseCheck` bullet:
`` - `keyFiles: [{ path, change }]`: one entry per over-budget target's `path` from `claudeMdBudgetTargets`, made repo-relative (the fact carries an absolute path, which `specShapedBody` rejects) — a trailing `:{digits}` or `:{digits}-{digits}` line suffix and a `#symbol` suffix stripped, out-of-repo files dropped, `keyFiles` omitted when no target remains. ``

- [ ] **Step 4: Run the suite file (AC4.1)**

Run: `node --test tests/build-micro-plan-conformance.test.js`
Expected: PASS, with 10 `AC6.1:` cases (four existing + six new).

- [ ] **Step 5: Revert proof per file (AC5.1)**

For each of the six producer files, never mutating the worktree: extract `git archive HEAD` into a fresh scratch directory, overwrite `{scratch}/{file}` with `git show 0c4c186ecf:{file}` (the pre-change base), run `node --test {scratch}/tests/build-micro-plan-conformance.test.js`, and quote the failing `AC6.1: {file}` line. Six runs, one failure each.

- [ ] **Step 6: AC6 check**

Run: `git diff --name-only 12ec198a4932cc4c334e8d6cbec8ea37c732a25b...HEAD -- plugin/skills/review/step3-routing.md` → empty.

- [ ] **Step 7: Commit**

`git add` the three files; commit `Pass keyFiles from visual-review, reflect and CLAUDE.md-budget record proposals — refs #6282`

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverables 1-3 | Task 1 |
| Deliverables 4-6 | Task 2 |
| Deliverable 7 (test list) | Task 1 Step 1 |
| AC1.1, AC1.2 | Task 1 Step 1 / Task 2 Step 4 |
| AC2.1, AC2.2 | Task 1 Step 6 |
| AC3.1 | each edit step's text |
| AC4.1 | Task 2 Step 4 |
| AC5.1 | Task 2 Step 5 |
| AC6.1 | Task 2 Step 6 |
