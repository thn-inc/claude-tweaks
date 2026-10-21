# wrap-up Section D reads the detached flag as the "fourth field" of ephemeral-server.txt (#3657) Implementation Plan

**Goal:** Every reader of `ephemeral-server.txt` takes the detach flag from the trailing `detached:` token and the worktree root from everything between the port and that token — never by whitespace position — so a worktree root containing spaces no longer makes Section D skip the process-group kill.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T204101-record-3657/work/3657-spec.md` (materialized from GitHub issue #3657)

---

### Task 1: Parse the server record by trailing token in Section D and the dispatch prompt templates, and pin it

**Files:**
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md` (Section D, step 2 and its POSIX bullet)
- Modify: `plugin/skills/dispatch/task-prompt.md` (the first call's "Ephemeral dev server (only if" paragraph and the second call's "Ephemeral dev server liveness" paragraph)
- Test: `tests/ephemeral-server-handoff-conformance.test.js` (append a `#3657` block)

Audit result (done at plan time, `grep -rn "ephemeral-server" plugin`): the readers are Section D (`cleanup-procedures-execution.md`, positional — "When the fourth field reads `detached:yes`"), `review/step3-routing.md` (already token-based since #3021), `dispatch/task-prompt.md`'s second-call liveness re-check (reads pid/port but states no parse rule, and the template is self-contained — an agent sees only its prompt), and `wrap-up/standalone-fast-path.md` / `flow/multispec-review-console.md` / `flow/multispec-parallel-waves.md` (all delegate to Section D steps 2-4 and parse nothing themselves — no change). The writer side, `dispatch/task-prompt.md`'s first-call paragraph, calls the flag "a fourth field" — positional wording to correct; `_shared/dev-url-detection.md` item 4 already describes the line shape without a position and is not changed.

- [ ] **Step 1: Failing test** — append to `tests/ephemeral-server-handoff-conformance.test.js` a `// #3657` block, reusing the file's existing `sectionD`, `fencedBlocks`, `readText` helpers:
  - `assertTrailingTokenSectionD(body)`: Section D contains the sentence stating the record is parsed by token, not whitespace position — pid and port are its first two fields, the detach flag is the trailing `detached:` token, and the worktree root is everything between the port and that trailing token, since the path may contain spaces; the POSIX bullet's group-kill condition reads `When the trailing \`detached:\` token reads \`detached:yes\``; and the body matches neither `/fourth field/` nor `/third field/`.
  - `assertTrailingTokenTaskPrompt(text)`: neither fenced block matches `/fourth field|third field/`; the first block says to end the recorded line with a trailing `detached:yes`/`detached:no` token; the second block's "Ephemeral dev server liveness" paragraph states the worktree root is everything between the port and the trailing `detached:` token.
  - A live-corpus sweep: every `plugin/skills/**/*.md` file whose text contains `ephemeral-server.txt` matches neither `/\bfourth field\b/i` nor `/\bthird field\b/i`.
  - Go-red controls: re-inserting `When the fourth field reads \`detached:yes\`` into Section D makes `assertTrailingTokenSectionD` throw; replacing the first block's trailing-token wording with `append a fourth field to the recorded line` makes `assertTrailingTokenTaskPrompt` throw; a synthetic corpus entry containing `fourth field` makes the sweep predicate throw.
  Run `node --test tests/ephemeral-server-handoff-conformance.test.js` — the new live tests FAIL (the go-red controls may pass already).
- [ ] **Step 2: Implement** —
  - Section D step 2: right after "Read the server record (`{pid} {port} {worktree-root} detached:{yes|no}`)." insert one sentence: parse it by token, not by whitespace position — the pid and port are its first two fields, the detach flag is the trailing `detached:` token (the line's last token), and the worktree root is everything between the port and that trailing token, since a worktree root may contain spaces (e.g. `~/Code Workspaces/...`) and a positional fourth field would then be a path fragment. Keep the existing unparseable-record sentence and its pinned wording (`fewer than four fields, a pid or port that is not a positive integer, or no trailing \`detached:\` token`) byte-identical.
  - Section D POSIX bullet: `When the fourth field reads \`detached:yes\`` → `When the trailing \`detached:\` token reads \`detached:yes\``. Leave `never do this when the field reads \`detached:no\`` and the win32 bullet's `regardless of what the \`detached:\` field reads` untouched (both are pinned and neither is positional).
  - `task-prompt.md` first-call paragraph: `and append a fourth field to the recorded\nline (\`detached:yes\`/\`detached:no\`)` → wording that ends the recorded line with a trailing `detached:yes`/`detached:no` token. Keep the `printf` example byte-identical.
  - `task-prompt.md` second-call liveness paragraph: after `verify the recorded pid answers on the recorded port` (keep that phrase; a test pins it across a line wrap), add a parenthetical: read the record by token, not whitespace position — pid and port are its first two fields and the worktree root is everything between the port and the trailing `detached:` token, since the path may contain spaces. When rewriting the record on a restart, keep the same `{pid} {port} {worktree-root} detached:{yes|no}` shape. The paragraph must not cite any `_shared/` path and must stay one paragraph (no blank line inside it).
  - Keep `task-prompt.md` hard-wrapped at its existing ~100-column width, and add no new ``` fences.
- [ ] **Step 3: Run** `node --test tests/ephemeral-server-handoff-conformance.test.js tests/review-fix-ephemeral-server-conformance.test.js tests/multispec-ephemeral-server-record-conformance.test.js tests/dispatch-prompt-bundle-citations.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Parse ephemeral-server.txt by trailing detached: token — Section D and dispatch templates no longer read the flag positionally`, body `refs #3657`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (Section D trailing token) → Step 2 bullets 1-2; Deliverable 2 (audit every reader, fix the same way) → the audit result above plus Step 2 bullets 3-4; Deliverable 3 (conformance test) → Step 1. AC "spaced root + detached:yes kills the group" → Section D's parse sentence + POSIX bullet, pinned by `assertTrailingTokenSectionD`; AC "no reader parses by whitespace position" → the live-corpus sweep plus `assertTrailingTokenTaskPrompt`; AC "`npm test` passes in full" → Common Step 5.
- **Placeholders:** none.
