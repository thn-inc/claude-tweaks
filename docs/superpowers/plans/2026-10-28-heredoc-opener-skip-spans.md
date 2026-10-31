# Heredoc opener: skip `${ … }` and same-line `$( … )` (#4246) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `scanHeredocsWith` from stripping real commands after a `<<` it wrongly took for a heredoc opener — one inside an unquoted `${ … }`, or one inside a `$( … )` that closes on the opener line.

**Architecture:** Both fixes live in `scanHeredocsWith`'s char loop (`plugin/bin/lib/hooks/git-command.js`). (1) An unquoted, *closed* `${ … }` span (read through `spans.param`, the reader the segment scanners already use at `:81`) is emitted whole, so no `<<` inside it is an opener candidate. (2) The existing `subs` stack (today: one frame per open `"$( … )"`) also takes a frame for every unquoted `$(` that is not `$((`; each pending heredoc remembers the frame it was opened in, and when that frame's `)` closes while the heredoc is still pending (that is, on the opener line), the heredoc is dropped from `pending`, so the following lines stay visible to the walk. Unquoted frames never change `lineText` (it keeps reading from the innermost *double-quoted* frame, as today), so multi-line unquoted substitutions plan exactly as before.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T093056-record-4246/work/4246-spec.md`

## Global Constraints

- Governing skill `shell-scanner-bash-differential` (quoted verbatim):
  - "Run every case you add or change under `/bin/bash` (3.2, macOS) and a bash 5 (`/opt/homebrew/bin/bash` here)." "Write the verdict into the test comment … When the versions disagree, note it … and side with whichever shell writes. Never derive an expected target from the scanner's own output or from memory of the bash manual."
  - "The gate's tradeoff is that a spurious deny is acceptable and a leak is not."
  - "Every new rule can regress a shape that already worked. Run the full case list through `git-command.js` at the merge-base … Diff the targets. Anything that moves from denied to allowed needs its own bash verdict." "The common shapes that must keep stripping live in the `#4149 routine` table in `tests/hooks-gate-coverage.test.js`. Add a shape there whenever a rule touches its neighbourhood."
  - "Every rule earns a mutant that turns a test red."
  - "Wall-clock budgets go in `perf/heredoc-scan-linearity.test.js`." "Asserting wall clock in tests/ … flakes."
  - "Test titles name the record and the behavior (`#4149: …`), never review-round labels."
  - "Expected paths the scanner resolves go through `path.resolve`."
  - "Run zsh as a third oracle … add each zsh-only divergence to the known gaps in `policy-schema-coverage.md` … do not quietly side with zsh in the expected target."
- Bash-tool constraint for any driver: no heredocs, no `cd &&` chains, no `git` token in quoted args — use scratchpad node scripts.
- `plugin/skills/_shared/policy-schema-coverage.md` is 36,737 B against `RAIL_BYTES` 52,500 B — ~15.7 KB headroom; the prose addition is a few hundred bytes.
- Do not regress `perf/heredoc-scan-linearity.test.js` (#4329's `"$( #"` case is already over budget).

## Oracle verdicts (gathered at HEAD fbffbd0e3, bounded driver, scratch tree)

| Case (`/M/zz` = a file in the guarded dir) | bash 3.2 | bash 5.3 | zsh | scanner at base |
|---|---|---|---|---|
| `echo ${x:-<<EOF}\n: > /M/zz\nEOF}` | zz | zz | – | – (leak) |
| `echo $(cat <<EOF)\n: > /M/zz\nEOF` | zz | – | zz | – (leak) |
| `echo $(cat <<EOF; echo x)\n: > /M/zz\nEOF` | zz | – | zz | – (leak) |
| `echo ${x:-$(cat <<EOF)}\n: > /M/zz\nEOF` | zz | – | zz | – (leak) |
| `cat $(cat <<A) <<B\n: > /M/zz\nB` | – | – | – | zz (spurious) |
| `echo "$(cat <<'EOF'\n: > /M/zz\nEOF\n)"` (routine) | – | – | – | – |
| `echo $(cat <<EOF\n: > /M/zz\nEOF\n)` | – | – | – | zz (spurious, unchanged) |

Bash 5 reads the lines after a same-line `$(cat <<EOF)` as that heredoc's body; bash 3.2 and zsh run them. Side with the shells that write: keep them visible.

## Review Focus

1. A heredoc inside a `$( … )` that spans lines (the routine commit-message idiom, quoted and unquoted) must keep stripping/keeping exactly as base — pinned by the existing `#4149 routine` table plus one new unquoted row.
2. A real outer opener on the same line after a closed `$(cat <<A)` (`cat $(cat <<A) <<B`) still plans its own body (B), and only A is dropped.
3. An unclosed `${` (runs off the end) keeps base behavior — only a closed span is skipped, like the segment scanners' `nested.closed` guard.
4. A `$( … )` closed early by a `case` pattern `)` only drops a pending heredoc (more text visible) — never strips more than base.
5. A double-quoted `"$(cat <<EOF)"` closing on the opener line is dropped by the same rule (base already reported its target via another path; must not regress).

---

### Task 1: Skip `<<` inside an unquoted `${ … }`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`scanHeredocsWith`, ~`:1838`; header comment ~`:1829`)
- Test: `tests/hooks-gate-coverage.test.js`

- [ ] **Step 1: Write the failing test** — `test('#4246: a `<<` inside an unquoted ${ … } is literal text, not a heredoc opener', …)` asserting `fileWriteTargets(cmd, '/r')` deep-equals `[{ action: 'write', file: path.resolve('/M/zz') }]` for `'echo ${x:-<<EOF}\n: > /M/zz\nEOF}'` and `'echo ${x:-$(cat <<EOF)}\n: > /M/zz\nEOF'`. Every new case must be red at base (AC "each new case goes red"), so shapes base already gets right (an opener after the span, `echo ${x:-a} <<EOF`) go in the scratch base comparison, not the suite. Comment carries the oracle verdicts from the table above (zsh does not write the first).
- [ ] **Step 2: Run** `node --test --test-name-pattern="#4246" tests/hooks-gate-coverage.test.js` — Expected: FAIL (both write cases give `[]`).
- [ ] **Step 3: Implement** — in `scanHeredocsWith`, an unquoted (`quote === null`) `$` followed by `{`: `const r = spans.param(str, i + 2)`; when `r.closed`, `emit(str.slice(i, r.end))` and `i = r.end`; otherwise fall through to the existing branches. Place it before the `$[` branch. Update the function header comment (`… a `<<` inside quotes, inside a closed `${ … }`, or after a word-boundary `#` is never an opener`).
- [ ] **Step 4: Run** the Step 2 command — PASS; then `node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/hooks-bash-prefilter.test.js tests/teardown-gate.test.js` — PASS.
- [ ] **Step 5: Commit** — `Skip heredoc openers inside unquoted \${…} — refs #4246`.

### Task 2: Drop a heredoc whose `$( … )` closes on the opener line; prose

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (`scanHeredocsWith`: the `subs` stack, the `<<` branch, the `(`/`)` frame branch, the `lineText` slice)
- Modify: `plugin/skills/_shared/policy-schema-coverage.md` (the "Two parser rules" sentence in the `Bare shell redirection is covered (#3080)` paragraph)
- Test: `tests/hooks-gate-coverage.test.js`

**Interfaces:**
- Consumes: Task 1's `${ … }` skip (a `$(` inside a skipped `${ … }` never opens a frame).
- Produces: `subs` frames shaped `{ depth, start, dq }`; a pending heredoc carries `h.frame` (the innermost open frame at its `<<`, or `null`).

- [ ] **Step 1: Write the failing tests** —
  - `test('#4246: a heredoc whose $( … ) closes on the opener line has no body, so the next lines are commands', …)`: each of `'echo $(cat <<EOF)\n: > /M/zz\nEOF'`, `'echo $(cat <<EOF; echo x)\n: > /M/zz\nEOF'` → `[MAIN zz]` (`x=$(cat <<EOF)` and `echo "$(cat <<EOF)"` already report zz at base, so they stay in the scratch comparison) (`path.resolve('/M/zz')`). Comment: bash 3.2 and zsh write zz, bash 5 reads the lines as the body; the scan sides with the shells that write.
  - `test('#4246: a real opener after a same-line $(cat <<A) still plans its own body', …)`: `'cat $(cat <<A) <<B\n: > /M/zz\nB'` → `[]` (bash 3.2, 5 and zsh write nothing; base reports zz, a spurious deny this fix removes, so this is the one new case that moves toward allow and needs the oracle verdict in its comment).
  - Nested: `'echo $(echo $(cat <<EOF))\n: > /M/zz\nEOF'` → `[zz]` (bash 3.2 and zsh write zz).
  - The routine shapes need no new row: the quoted `"$(cat <<'EOF' … EOF\n)"` rows in the `#4149 routine` table already pin the strip, and an unquoted multi-line `x=$(cat <<'EOF' … )` keeps its body at base (fail-closed, structure left open) and must keep doing so — unquoted frames do not touch `lineText`.
- [ ] **Step 2: Run** `node --test --test-name-pattern="#4246" tests/hooks-gate-coverage.test.js` — Expected: FAIL (the same-line write cases other than the quoted one, and the nested case, give `[]`; the `<<A) <<B` strip case gives zz).
- [ ] **Step 3: Implement** in `scanHeredocsWith`:
  - existing `"$(` push becomes `{ depth: 1, start: i + 2, dq: true }`; add a branch for unquoted `$(` (`quote === null`, `str[i + 2] !== '('`): `emit('$(')`, push `{ depth: 1, start: i + 2, dq: false }`, `i += 2`.
  - `lineText` start uses the innermost frame with `dq: true` (none → `lineStart`), so unquoted frames leave line planning as base.
  - in the `<<` branch, set `h.frame = subs[subs.length - 1] || null` before pushing to `pending`.
  - in the frame `(`/`)` branch, on pop: `quote = '"'` only when the popped frame is `dq`; `pending = pending.filter((h) => h.frame !== popped)`.
  - Comment each rule with #4246 and the bash 3.2 / 5 split.
- [ ] **Step 4: Prose** — in `policy-schema-coverage.md`, change "Two parser rules:" to "Four parser rules:" and append: a `<<` inside a closed unquoted `${ … }` is literal text, not an opener; and a heredoc opened inside a `$( … )`, quoted or not, whose `)` closes on the opener line has no body, so the lines after it are scanned as commands (bash 3.2 and zsh run them, bash 5 reads them as the body; the scan sides with the shells that run them, #4246) — keeping the existing `"$(cat <<'EOF' … EOF)"` (#4210) clause, whose `)` is on a later line, consistent.
- [ ] **Step 5: Run** the Step 2 command — PASS; the four suites from Task 1 Step 4 — PASS; `node --test perf/heredoc-scan-linearity.test.js` — no new failure beyond the known #4329 case.
- [ ] **Step 6: Base comparison + mutants** (scratch, not committed): run the oracle case list through base `git-command.js` (`git show fbffbd0e3:plugin/bin/lib/hooks/git-command.js` into the scratchpad) and HEAD; every case that moves from a target to `[]` must have an oracle verdict of no write. Mutants: remove the `${` branch; remove the `pending.filter`; make unquoted frames affect `lineText` — each must turn a test red.
- [ ] **Step 7: Commit** — `Drop heredoc openers whose $(…) closes on the opener line — refs #4246`.

## Self-review

- Spec coverage: Deliverable 1 → Task 1; Deliverable 2 → Task 2; Deliverable 3 + AC "each new case goes red" → Step 2 of each task; AC routine shape → Task 2 routine row + existing table; `npm test` → Common Step 5; prose Gotcha → Task 2 Step 4; perf Gotcha → Task 2 Step 5.
- Placeholders: none.
