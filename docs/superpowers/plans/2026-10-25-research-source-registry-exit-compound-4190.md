# research source-registry: split the `; echo exit=$?` compound for worktree-isolated sessions (#4190) Implementation Plan

**Goal:** `plugin/skills/research/source-registry.md:36` instructs a `cmd > /tmp/rv-$$.out 2>&1; echo "exit=$?"` compound as one Bash call — rewrite it as separate plain calls, citing `_shared/scratch-worktree.md` §7, and pin the absence of the compound under `plugin/skills/` with a prose-conformance test.

**Spec:** `.claude-tweaks/pipelines/2026-10-25T104459-record-4190/work/4190-spec.md` (materialized from GitHub issue #4190)

**Scope note (scope-creep `add-to-plan`):** the record names only `source-registry.md`, but `plugin/skills/docs-health/judge-procedure.md:46` carries the identical compound (`cmd > /tmp/dh-$$.out 2>&1; echo "exit=$?"`) — and `source-registry.md` explicitly says it reuses that technique. The record's second Acceptance Criterion (an assertion that fails if the compound reappears under `plugin/skills/`) cannot pass while that site exists, so it is fixed in the same task.

**Design facts (verified at plan time):**
- Splitting the compound naively breaks `$$`: each Bash tool call is a fresh shell, so `$$` names a different file in the second call. The split form therefore takes its temp path from one `mktemp` call, pasted in literally — collision-free across the parallel question×source agents `source-registry.md`'s Dispatch section fans out, with no `/tmp/{prefix}-` literal (`tests/session-tmp-root-migration.test.js`'s shape).
- The exit status cannot be written to a file without the same compound, and `$?` in a fresh shell is always 0. The Bash tool itself reports a non-zero exit (`Exit code {n}` in its result; observed live this session) — that is the exit-status source.
- Two descriptive (non-instructional) mentions already exist and must stay: `plugin/skills/_shared/pr-run-comments.md:172` (an inline span starting with `;`, describing the refused form) and `plugin/skills/_shared/scratch-worktree.md`'s §7 table row (a catalogue of refused/passing shapes, by design). The test's matcher ignores a span that opens with `;`, and exempts `_shared/scratch-worktree.md` by exact path.
- `tests/research/skill-md.test.js:252-256` pins `/exit=/` in `source-registry.md` — that assertion is updated to pin the new split form instead (it guards the bounded-output capture; the capture survives, its spelling changes).

---

### Task 1: Rewrite both bounded-execution sites as plain calls and pin the compound's absence

**Files:**
- Modify: `plugin/skills/research/source-registry.md` (the `### Bounded execution (\`runtime\`)` section, lines 30-42)
- Modify: `plugin/skills/docs-health/judge-procedure.md` (line 46, the `**Bound the output:**` sentence only)
- Modify: `tests/research/skill-md.test.js` (the `source-registry.md runtime entry cites the bounded-output form` test, lines 252-256)
- Create: `tests/exit-echo-compound-conformance.test.js`

- [ ] **Step 1: Failing test** — create `tests/exit-echo-compound-conformance.test.js` (style: `tests/claude-plugin-root-require-conformance.test.js` — `'use strict'`, `node:test`, `readText` from `./helpers/read-skill`, a header comment naming #4190 and why). It exports nothing; it defines `findCompoundSites(text)` returning `[{ lineNumber, line }]` for every line matching `/[^\s`;][^`\n]*;\s*echo\s+["']?exit=\$\?/` (a command, then `;`, then an exit-status echo, all inside one span/line — a span that *opens* with `;`, like `(\`; echo exit=$?\`)`, is a description, not an instruction, and does not match). Tests:
  - go-red fixtures (synthetic strings): flags a fenced line `cmd > /tmp/x.out 2>&1; echo "exit=$?"`; flags an inline span `` `cmd > out 2>&1; echo "exit=$?"` ``; flags the unquoted `foo; echo exit=$?`; does NOT flag `` (`; echo exit=$?`) ``; does NOT flag prose `never chain an exit-status echo onto it`.
  - live sweep: every `plugin/skills/**/*.md` except the exempt set has zero sites; the failure message lists `relPath:line` for each offender and cites `_shared/scratch-worktree.md` §7.
  - exempt set is `{'_shared/scratch-worktree.md'}` (relative to `plugin/skills/`), with a comment: its §7 table catalogues refused and passing shapes verbatim. A separate test asserts the exempt file still exists and still contains at least one site (so a stale exemption is caught).
  - floor: assert the sweep scanned at least 200 `.md` files (current count is far above that), so a broken walker cannot pass vacuously.
- [ ] **Step 2: Run** `node --test tests/exit-echo-compound-conformance.test.js` — Expected: FAIL (live sweep flags `research/source-registry.md:36` and `docs-health/judge-procedure.md:46`).
- [ ] **Step 3: Implement** —
  - `source-registry.md`: replace lines 32-42 (from "Reuse the technique" through "describe the contradiction.") with: the same opening sentence ("Reuse the technique `skills/docs-health/judge-procedure.md` already established for executing command blocks — do not invent a second one."), then a sentence saying it is three plain Bash calls, never one `;`-chained compound — a worktree-isolated session refuses some chained shapes outright (`_shared/scratch-worktree.md` §7 — keep `scratch-worktree.md` and `§7` on the same line), and `cmd` is whatever the claim names, so its shape is not known in advance; then three separate ```bash fences: `mktemp`, `cmd > "{tmp-rv-out}" 2>&1`, `tail -20 "{tmp-rv-out}"`; then: `{tmp-rv-out}` is the literal path `mktemp` printed, pasted into both later calls — not `$$`, which names a different file in each fresh shell. The Bash tool reports the command's own non-zero exit as `Exit code {n}` on the second call; no such line means it exited 0. Then keep the existing "Inspect the exit status plus `tail -20` of the temp file. The check is whether ... describe the contradiction." text verbatim (rewrap only if needed). The `{tmp-rv-out}` placeholder must stay double-quoted inside the fences (`tests/session-tmp-placeholder-quoting-conformance.test.js`).
  - `docs-health/judge-procedure.md:46`: replace only the clause "redirect each command to a temp file (`cmd > /tmp/dh-$$.out 2>&1; echo "exit=$?"`) and inspect only the exit status plus `tail -20` of that file." with: "run each command alone, redirected to a temp file — `mktemp` first, then `cmd > "{tmp-dh-out}" 2>&1` with the literal path it printed (never `$$`, which differs per Bash call), then `tail -20 "{tmp-dh-out}"` — three plain Bash calls, never one `;`-chained compound (`_shared/scratch-worktree.md` §7). Inspect only the exit status the Bash tool reports on the second call (`Exit code {n}`; absent means 0) plus that tail." Leave the rest of the paragraph byte-identical.
  - `tests/research/skill-md.test.js` lines 252-256: keep the test name and the `judge-procedure\.md` assertion; replace `assert.match(body, /exit=/, ...)` with three assertions: `/```bash\s*\nmktemp\s*\n```/` (the temp path comes from its own call), `/Exit code \{n\}/` (the exit status source is named), and `/scratch-worktree\.md`? §7/` (the shell constraint is cited); plus `assert.doesNotMatch(body, /;\s*echo\s+["']?exit=\$\?/)`.
- [ ] **Step 4: Run** `node --test tests/exit-echo-compound-conformance.test.js tests/research/skill-md.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/session-tmp-root-migration.test.js tests/bin-lib/docs-health/skill-md.test.js` — PASS.
- [ ] **Step 5: Prove discrimination** — in a scratch `git worktree add` (never the shared tree), revert `source-registry.md` to `HEAD`'s version (`git show HEAD:plugin/skills/research/source-registry.md`) and confirm the new live-sweep test goes red naming `research/source-registry.md:36`.
- [ ] **Step 6: Commit** — one commit: `Split the bounded-execution exit-echo compound into plain calls — research and docs-health, refs #4190` (end with the `Claude-Session:` trailer).

---

## Self-review

- **Spec coverage:** Deliverable 1 (rewrite source-registry.md:36 as separate plain calls citing §7) → Step 3 first bullet. AC 1 (no `; echo "exit=$?"` compound in source-registry.md) → Step 3 + the research test's `doesNotMatch`. AC 2 (prose-conformance assertion fails if the compound reappears under `plugin/skills/`) → Step 1's live sweep, proven red in Step 5.
- **Placeholders:** none.
