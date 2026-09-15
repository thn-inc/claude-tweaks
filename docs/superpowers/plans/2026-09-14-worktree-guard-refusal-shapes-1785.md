# pre-tool-use worktree guard: refuses data-writing and read-only commands whose text contains the VCS name or a runtime-computed value (#1785) Implementation Plan

**Goal:** Document the eight reproduced Bash-guard false-positive shapes (six data-writing/loop/glob shapes from the Original request, plus #1867's two read-only shapes) and their workarounds in `scratch-worktree.md` §7 and `dispatch/task-prompt.md`, then file an upstream report against the Claude Code harness via `/claude-tweaks:feedback`.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T121614-record-1785/work/1785-spec.md` (materialized from GitHub issue #1785)

---

### Task 1: Document the eight refusal shapes and file the upstream report

**Files:**
- Modify: `plugin/skills/_shared/scratch-worktree.md`
- Modify: `plugin/skills/dispatch/task-prompt.md`
- Modify: `docs/incident-log.md` (only if an `[IL-nn]` entry already covers the harness guard; otherwise leave untouched)

- [ ] **Step 1: Baseline** — read `scratch-worktree.md` §7 in full (its existing 2026-08-25/2026-08-30 dated addenda, to match their exact shape), read `dispatch/task-prompt.md`'s worktree-shell constraint paragraph, and locate the `tests/` conformance suite that pins either file's prose (confirm it does not yet assert the six/eight shapes, so the addition is a real, verifiable change).
- [ ] **Step 2: Implement** —
  - Append a new dated addendum to `scratch-worktree.md` §7 listing all six shapes from the record's `## Original request` (quoted JSON containing `git`; a `for`/`while` loop variable; a glob argument; a `gh api` call inside `if RAW=$(...)`; `sed -i` on a variable path; `printf … > "$VAR/file"`) plus #1867's two read-only shapes (`cat "$P/…"`; `sed -n 'a,bp' "$P/…"`), each as a command-text / refusal-wording pass/refuse pair followed by the pass-through workaround (one plain command per call, `Write`/`Edit` instead of a heredoc, literal paths instead of variables, `node -e` composition), dated with today's date and the currently observed plugin/harness version.
  - Extend `dispatch/task-prompt.md`'s existing sentence that cites §7 to name the same six shapes in one sentence each, without restating the full section.
  - If an `[IL-nn]` entry already exists for the harness guard in `docs/incident-log.md`, add a one-line pointer to the new §7 addendum; otherwise leave the file untouched.
  - File one upstream report via `/claude-tweaks:feedback`, targeting the Claude Code harness, quoting the six + two shapes and the requested command-position matching rule (VCS name matched only in command position; quoted arguments and heredoc/printf bodies treated as data; `printf … > file` / `cat > file <<EOF` allow-listed). Record the filed report's reference for the record's closing comment.
- [ ] **Step 3: Run** the `tests/` conformance suite covering `scratch-worktree.md` / `task-prompt.md` (identified in Step 1) — PASS, without a byte-pin exemption. Also run `npm test` per the record's own Acceptance Criteria.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #1785`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item (§7 addendum, task-prompt.md sentence, upstream report, closing-comment correction) and every `## Acceptance Criteria` item (addendum names all shapes verbatim, task-prompt.md conformance passes without exemption, upstream report exists and is referenced, `npm test` passes) is covered by Task 1's Files/Steps above. The closing-comment correction (harness guard, not `pre-tool-use.js`) and the upstream-report reference are posted to the issue at wrap-up/close time, not as a file edit — noted here so nothing is silently dropped.
- **Placeholders:** none.
