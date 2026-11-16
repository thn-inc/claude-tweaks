# Trim test history comments and duplicated cases (#5552) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace two multi-hundred-line bump-history comments with a short rule plus a self-checked `Last bump:` line, shrink two dedup test files to an identity assertion, and move scaffold-only argument-parsing cases from two CLI test files into the scaffold's own test — with no coverage lost.

**Architecture:** A new test helper `tests/helpers/last-bump.js` reads a pin test's own source, finds its single `Last bump: {old} -> {new}, #{record}` line, and asserts the line directly below it is the count assertion pinning `{new}`. Both pin tests call it. The dedup and number-list changes are pure test-file moves/deletions, ordered so no behaviour is untested between commits.

**Tech Stack:** Node 20, `node --test`, `node:assert/strict`.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231051-spec-5538-5552/spec-5552/work/5552-spec.md` (worktree copy)

Scope keywords: Last bump, extend it, don't replace it

Check B note: an earlier, wider keyword set (`POLICY_KEYS.length`, `strictEqual(total,`, `makeNumberListCli`) matched only out-of-scope files — the scaffold and its three consumer CLIs (read-only here; `resolve-foreign-blockers.js` is a Non-Goal), `docs/incident-log.md` (historical, left as-is per Gotchas), five unrelated older plans, and three tests mentioning `TRUST_POLICY_KEYS.length` or other keywords with no pin on either number. None needs a change. The final keyword set's three hits are also unrelated: `plugin/bin/lib/issues/record-payload.js:17` ("never extend it") and `plugin/bin/lib/policy-schema.js:132` (the `overlap` summary "extend it, skip it, or replace it") match the words, not the bump rule, and `docs/superpowers/plans/2026-11-02-settle-policy-digest-findings-4816.md` is a shipped plan.

Waived docs/donts.md: states the recompute rule, not a comment mandate; left untouched per Technical Approach.
Waived docs/incident-log.md: describes the comment block historically; left untouched per Gotchas.

## Spec coverage map

| AC clause | Where |
|---|---|
| AC1.1 | Task 1 Step 5 (line counts; both numbers unchanged) |
| AC2.1 | Task 1 Step 5 (`git grep -P` prints one line per file) and `assertLastBump`'s exactly-one check |
| AC3.1 | Task 6 Step 1 (scratch merge-conflict check, PR evidence) |
| AC4.1 | Task 3 Steps 1-3 (identity test; local-copy mutation goes red) |
| AC5.1 | Task 4 Step 1 (five tests) |
| AC5.2 | Task 4 Step 4 (one mutation per case) |
| AC6.1 | Task 5 Step 3 (retained-assertion grep) |
| AC6.2 | Task 5 Step 2 (`tests 10` / `tests 11`) |
| AC7.1 | Task 2 Steps 1 and 3 |
| AC8.1 | Task 6 Step 2 (PR CI full suite) |
| AC9.1 | Task 1 Step 6 (pin changed, line not rewritten → red naming the line) |
| AC9.2 | Task 1 Step 6 (once per file, reverted) and Task 6 Step 3 (PR body) |
| Plan Review Clarification (`advanced-proof-patterns.md:43`) | Task 2 Steps 1-3 |

## Global Constraints

- Do not bump either number: `assert.strictEqual(total, 423)` and `assert.strictEqual(POLICY_KEYS.length, 109)` / `new Set(...).size, 109` stay exactly as they are. If the suite reports a different count on the base, another change landed a row or key; rebase, do not adjust.
- Seed lines, verbatim: `Last bump: 422 -> 423, #3898` (anti-patterns) and `Last bump: 106 -> 109, #5224` (policy-schema).
- Each replaced history comment is at most six lines including the `Last bump:` line; the rule says: the number changes only with a recorded reason; re-derive it by running the parser or counting the list, never by adding a delta; IL-99.
- Out of scope (Non-Goals): `RENAMED_KEYS.length` pin at `tests/policy-schema.test.js:449`; `tests/bin-lib/harness-health/dedup.test.js`; `plugin/bin/resolve-foreign-blockers.js`; new tests for `parseList`/`malformedMessage`/`missingMessage`.
- Keep `tests/resolve-blockers-cli.test.js`'s `fakeDeps` helper — five other test headers cite "`tests/resolve-blockers-cli.test.js`'s deps-injection style".
- Do not edit `tests/bin-lib/health-core/dedup.test.js` (open record #5528 relies on it passing unedited), `docs/donts.md`, `docs/incident-log.md`, or `CHANGELOG.md`.
- `git grep -E` with `\b` matches nothing on this machine — use `-P`, `-w` or `-F`.
- Worktree shell constraint: one plain command per Bash call — no `&&`/`;` chains, no `cd ... &&`, no heredoc, no loop, no `$(...)`, no shell variable carried between calls. Use `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552" ...` and literal absolute paths. File content via Write/Edit only.
- Every commit message ends with `Claude-Session: https://claude.ai/code/session_01UwjosHw5wcz1a5BNJTJCmu` and carries `Refs #5552`. Write the message with the Write tool to a scratch file and commit with `git commit -F {file}`.
- Scope and edit discipline (quoted from CLAUDE.md Working Approach): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `skill-prose-conformance-tests` (`advanced-proof-patterns.md:42`), quoted: "**Measure by running the parser on the working tree; never add the delta to the old number.**" — kept by this change; only the comment-history mandate (`:40` tail, `:45` tail) changes, plus `:43`'s tail, which moves the "which form you used" note from the comment to the commit message (decided by the user at plan review).
- Governing skill `policy-key-addition` (`SKILL.md:14`), quoted: "3. **The key count.** `tests/policy-schema.test.js` pins `POLICY_KEYS.length`. Bump it in the same commit." — Task 2 extends it with the `Last bump:` rewrite.
- AC evidence from scratch checks goes to `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T231051-spec-5538-5552/spec-5552/evidence/{name}.txt"` (create the dir first with `mkdir -p`) plus one `decisions.md` entry: `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.170.0/bin/log-decision.js" --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T231051-spec-5538-5552/spec-5552" --section "/build" --status AUTO --step "AC evidence" --text-file "{text-file}" --reversibility n/a`, the text file naming the AC id, the command shape, and pass/fail counts. Every mutation is made in the worktree file, its test run, then reverted with Edit (never `git checkout`/`git reset`); confirm `git status --porcelain` shows only intended changes before committing.

## Review Focus

1. A pin test whose `Last bump:` line is present but not directly above the count assertion (a blank line or another comment between) — the helper must fail, naming the line, not silently pass.
2. Two `Last bump:` lines in one file (a sloppy merge keeping both sides) — the helper must fail with the count found.
3. The pinned number changed but the `Last bump:` line left alone — fails with a message naming the line (AC9.1); covered by Task 1 Step 6.
4. A moved number-list case that passes for the wrong reason (e.g. the trailing-comma case passing because `''` is rejected by a different check) — each moved case is proven by its own mutation (Task 4 Step 4).
5. A CLI-specific assertion silently lost while deleting scaffold cases (usage name, `-f owner=`, `--hostname`, success shapes, exit 3) — Task 5 Step 3 greps for each.

---

### Task 1: `Last bump:` helper and the two pin comments

**Role:** integration

**Files:**
- Create: `tests/helpers/last-bump.js`
- Modify: `tests/bin-lib/skill-audit/anti-patterns.test.js:141-672` (comment `:141-671` replaced; assertion `:672` kept)
- Modify: `tests/policy-schema.test.js:41-155` (comment `:41-153` replaced; assertions `:154-155` kept)

**Interfaces:**
- Produces: `assertLastBump(file: string): void` exported from `tests/helpers/last-bump.js` (`module.exports = { assertLastBump }`). Reads `file` as UTF-8; finds every line matching `/^\s*\/\/ Last bump: (\d+) -> (\d+), #(\d+)\s*$/`; throws `AssertionError` unless exactly one; requires the immediately following line to match `/assert\.strictEqual\([^,]+,\s*(\d+)\);/`, else throws naming the `Last bump:` line number; throws unless that captured number equals the line's `{new}`. Every failure message contains `${path.basename(file)}:${lineNo}` and the full `Last bump:` line text, and for the mismatch case the phrase `rewrite the Last bump line`.

- [ ] **Step 1: Write the failing wiring.** In `anti-patterns.test.js`, replace lines `:141-671` with exactly these five lines (indent 2 spaces, inside the existing test):

```js
  // Live corpus measurement. This total changes only with a recorded reason (a
  // row added or removed on purpose). Re-derive it by running this parser on the
  // working tree, never by adding a delta to the old number ([IL-99]). Each bump
  // rewrites the line below; the full history is `git log -L` on the assertion.
  // Last bump: 422 -> 423, #3898
```

keep `assert.strictEqual(total, 423);` directly below, and add `assertLastBump(__filename);` on its own line directly above the first of the five comment lines (the call must run before the count assertion: a changed pin otherwise fails the count assertion first and the `rewrite the Last bump line` message never shows; it cannot sit between the `Last bump:` line and the assertion, which must stay adjacent), with `const { assertLastBump } = require('../../helpers/last-bump');` beside the file's other requires. In `policy-schema.test.js`, replace lines `:41-153` with exactly:

```js
  // Changes only with a recorded reason. Recompute by counting the merged list,
  // never by summing either side's delta (IL-99); history is `git log -L`.
  // Last bump: 106 -> 109, #5224
```

keep `:154-155` directly below unchanged, add `assertLastBump(__filename);` on its own line directly above the first of the three comment lines (before the count assertion, for the same reason), and `const { assertLastBump } = require('./helpers/last-bump');` after the existing `require('./helpers/run-cli')` line.

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "require('/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552/tests/helpers/last-bump.js')"`
Expected: FAIL with `Cannot find module` (and `node --test` on `tests/policy-schema.test.js` fails the same way once Step 1's require is in)

- [ ] **Step 3: Implement `assertLastBump(file)` in `tests/helpers/last-bump.js`** per the Interfaces block (`'use strict'`, `fs`, `path`, `node:assert/strict`; header comment naming the two callers and #5552).

- [ ] **Step 4: Run both files to verify they pass**

Run: `node --test "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552/tests/policy-schema.test.js" "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552/tests/bin-lib/skill-audit/anti-patterns.test.js"`
Expected: PASS, `fail 0`.

- [ ] **Step 5: AC1.1 / AC2.1 measurements.** `wc -l` both files (before: 673 and 1169; required after: at most 153 and at most 1064), and `git grep -n -P "Last bump: \d+ -> \d+, #\d+" -- tests/bin-lib/skill-audit/anti-patterns.test.js tests/policy-schema.test.js` prints exactly two lines, one per file, each the line directly above its count assertion. Absence control: `git grep -n -P "Last bump: \d+ -> \d+, #\d+" HEAD -- tests/policy-schema.test.js` against the pre-change base prints nothing and against the working tree prints one line (proves the pattern matches its target).

- [ ] **Step 6: AC9.1 / AC9.2 go-red evidence, once per file.** For each file: Edit the pinned number only (`423` → `424` in anti-patterns' `strictEqual(total, …)`; `109` → `110` in policy-schema's `:154` line), run that file with `node --test`, capture output to `{evidence}/ac9-{anti-patterns|policy-schema}.txt` via a plain `>` redirect, confirm the failure message names the `Last bump:` line (`rewrite the Last bump line`), then revert with Edit and re-run green. Also prove Review Focus 1 and 2 once against the policy-schema file (insert a blank line between `Last bump:` and `:154`; duplicate the `Last bump:` line) — each red with the helper's message — and revert. Log one `AC evidence` entry covering AC9.1/AC9.2 with the evidence paths.

- [ ] **Step 7: Commit** `tests/helpers/last-bump.js`, `tests/bin-lib/skill-audit/anti-patterns.test.js`, `tests/policy-schema.test.js` — message `Replace the two pin-history comments with a checked Last bump line — #5552`.

### Task 2: Bump-rule prose in the two project skills

**Role:** transcription

**Files:**
- Modify: `.claude/skills/skill-prose-conformance-tests/advanced-proof-patterns.md` (lines 40, 43 and 45)
- Modify: `.claude/skills/policy-key-addition/SKILL.md` (line 14)
- Read only: the skill-prose-conformance-tests `SKILL.md` line 175 row points at the section by its unchanged heading and states no comment mandate; Step 2 confirms it still reads correctly.

**Interfaces:**
- Consumes: Task 1's `Last bump:` line format and `assertLastBump` behaviour.

- [ ] **Step 1: Run the AC7.1 absence grep to see it fail (matches today)**

Run: `git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552" grep -n -F -e "extend it, don't replace it" -e "still belong in the comment" -e "say in the comment which form you used" -- .claude/skills`
Expected: three lines, all in `advanced-proof-patterns.md` (`:40`, `:43`, `:45`).

- [ ] **Step 2: Edit.** In `advanced-proof-patterns.md:40` replace the clause `and the running comment above the assertion is the only place the bump history lives — extend it, don't replace it:` with `and the bump history lives in \`git log -L\` on the assertion line — a bump overwrites the single \`Last bump: {old} -> {new}, #{record}\` comment directly above the assertion, which the test checks against the pinned number (\`tests/helpers/last-bump.js\`):`. In `:43` replace `and say in the comment which form you used.` with `and say in the commit message which form you used.` (the spec's Plan Review Clarification; nothing else on that line changes). Replace `:45` with: `Rows *reworded in place* change no count, need no bump, and need no comment.` In `policy-key-addition/SKILL.md:14` replace `Bump it in the same commit.` with `Bump it in the same commit, and rewrite the \`Last bump: {old} -> {new}, #{record}\` line directly above the assertion — the test fails when that line's new value differs from the pin.` Read `skill-prose-conformance-tests/SKILL.md:175` and confirm no edit is needed.

- [ ] **Step 3: Re-run the Step 1 grep** — Expected: no output (AC7.1).

- [ ] **Step 4: Commit** both edited files — message `Point the pin-bump rule at the Last bump line — #5552`.

### Task 3: Reduce the docs-health and journey-health dedup tests to the identity assertion

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/docs-health/dedup.test.js` (whole file)
- Modify: `tests/bin-lib/journey-health/dedup.test.js` (whole file)
- Waived `tests/bin-lib/health-core/dedup.test.js`: read-only — every deleted title maps to it (docs-health → `:6, :10, :15, :54, :30, :44`; journey-health → `:6, :10, :15, :54, :74, :30, :44`); not edited (#5528).

- [ ] **Step 1: Rewrite each file** in the shape of `tests/bin-lib/harness-health/dedup.test.js`: requires, a short header comment (the module is the one line `module.exports = require('../health-core/dedup');`, so every export is health-core's; behaviour is tested in `tests/bin-lib/health-core/dedup.test.js`), and one test titled `AC4.1: decide is the shared health-core implementation, not a local reimplementation` asserting `assert.strictEqual(decide, require('../../../plugin/bin/lib/health-core/dedup').decide);` with `decide` required from that file's own module (`docs-health/dedup` / `journey-health/dedup`).

- [ ] **Step 2: Run** `node --test` on both files — Expected: PASS, `tests 1` each.

- [ ] **Step 3: AC4.1 go-red.** For each module in turn, Edit `plugin/bin/lib/{docs-health|journey-health}/dedup.js` to `module.exports = { ...require('../health-core/dedup'), decide: (...a) => require('../health-core/dedup').decide(...a) };`, run that test file (Expected: FAIL), capture to `{evidence}/ac4-{name}.txt`, revert with Edit, re-run green. Log one `AC evidence` entry for AC4.1.

- [ ] **Step 4: Commit** both test files — message `Reduce two health dedup tests to the identity assertion — #5552`.

### Task 4: Move the five scaffold-only cases into the scaffold test

**Role:** integration

**Files:**
- Modify: `tests/bin-lib/number-list-cli.test.js:1-8` (header) and append after the `no --repo and no resolvable origin remote — exit 2` test (`:102-108`)
- Temporarily mutated, always reverted (Step 4): the scaffold `number-list-cli.js` under `plugin/bin/lib/` — never committed.

**Interfaces:**
- Consumes: the file's existing `buildCli()` and `fakeDeps()` (default configuration — no `parseList`/`malformedMessage`/`missingMessage`, the one both CLIs use; `git grep -n -E "parseList|malformedMessage|missingMessage" -- plugin/bin` finds them passed only by `plugin/bin/resolve-foreign-blockers.js:45-47`).

- [ ] **Step 1: Add five tests**, each `const { run } = buildCli();`:
  - `AC5.1: non-positive <n> — exit 1` — `run(['0'], fakeDeps())` → `1`, stderr matches `/malformed <n>/`.
  - `AC5.1: a comma list with one malformed entry — exit 1, gh never probed` — deps `ghAvailable` throws; `run(['720,abc,730'])` → `1`, `/malformed <n>/`.
  - `AC5.1: a trailing comma (empty segment) — exit 1` — `run(['720,'])` → `1`, `/malformed <n>/`.
  - `AC5.1: --repo followed by another flag is a missing value, not the value — exit 1` — deps `ghAvailable` and `remoteUrl` throw; `run(['720','--repo','--help'])` → `1`, `/missing value for --repo/`.
  - `AC5.1: \`gh\` absent — remoteUrl is never called` — deps `ghAvailable: () => false` and a recording `remoteUrl` (`let remoteCalls = 0; remoteUrl: () => { remoteCalls += 1; return null; }`); `run(['720'])` → `2` and `assert.strictEqual(remoteCalls, 0)`. Never a throwing `remoteUrl` here: the scaffold wraps the call in `try { … } catch { remote = null; }`, which swallows the throw, so the case would stay green under mutation 5.
  Rewrite the header `:1-8`: it covers the factory's parse/exit-code contract once — including the cases moved here from the two concrete CLIs' test files by #5552 — and the concrete CLIs' files test only their own usage name, `gh` argv, `--hostname`, output shapes and GraphQL failure. Keep the `mirroring tests/resolve-blockers-cli.test.js's deps-injection style` phrase.

- [ ] **Step 2: Run** `node --test "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow+spec-5538-5552/tests/bin-lib/number-list-cli.test.js"` — Expected: PASS (these pin existing behaviour), `tests 22`.

- [ ] **Step 3: Commit** — message `Move five scaffold-only parse cases into the number-list-cli test — #5552`.

- [ ] **Step 4: AC5.2 go-red, one mutation per case** in `plugin/bin/lib/number-list-cli.js`, each applied alone, the file's test run (Expected: exactly the named case fails), output captured to `{evidence}/ac5-{n}.txt`, then reverted with Edit:
  1. non-positive: `isPos` → `(n) => Number.isInteger(n)` (the trailing-comma case also fails here; that is expected).
  2. malformed entry: `numbers.some(` → `numbers.slice(0, 1).some(`.
  3. trailing comma: `raw.split(',')` → `raw.split(',').filter((p) => p !== '')`.
  4. `--repo` then flag: `if (!v || v.startsWith('--'))` → `if (!v)`.
  5. remoteUrl when gh absent: move the `let remote = null; if (!opts.repo) { … }` line above the `if (!deps.ghAvailable())` line.
  After the last revert, `git -C … diff --stat -- plugin/bin` prints nothing. Log one `AC evidence` entry for AC5.2 listing the five evidence paths and which test failed under each.

### Task 5: Delete the scaffold-covered cases from the two CLI test files

**Role:** transcription

**Files:**
- Modify: `tests/resolve-blockers-cli.test.js` (header `:1-10`; delete 10 tests)
- Modify: `tests/resolve-linked-prs-cli.test.js` (header `:1-9`; delete 8 tests)

**Interfaces:**
- Consumes: Task 4's committed cases (must land first).

- [ ] **Step 1: Delete these titles.** `resolve-blockers-cli.test.js`: `non-integer <n> is malformed — exit 1`, `non-positive <n> is malformed — exit 1`, `a comma list with one malformed entry is malformed — exit 1, no network call`, `an empty comma segment (trailing comma) is malformed — exit 1`, `unknown flag is a malformed invocation — exit 1`, `trailing --repo with no value is malformed — exit 1, no network call`, `--repo followed by another flag is rejected as missing a value, not treated as the value`, `--repo owner/name (well-formed) is unaffected`, `` `gh` absent — exit 2, no attempt to resolve owner/repo ``, `no --repo and no resolvable origin remote — exit 2`. `resolve-linked-prs-cli.test.js`: the same list minus `an empty comma segment …` and `--repo followed by another flag …`. Keep `fakeDeps`, the missing-`<n>` and `--help` tests, and every `--repo … overrides`, `#2240`, `success:` and GraphQL-failure test. Rewrite each header's "Covers argument parsing and …" sentence to: argument parsing and repo resolution are tested once in `tests/bin-lib/number-list-cli.test.js` (the shared `makeNumberListCli` scaffold); this file keeps only this CLI's usage name, its `gh` argv (`-f owner=`/`-f repo=`, `--hostname`), its output shapes and its GraphQL failure. Drop now-empty section banners only if no test remains under them (`--- gh / repo resolution ---` keeps `--repo owner/name overrides the git remote` and the `#2240` tests, so it stays).

- [ ] **Step 2: Run** `node --test` on both files — Expected: PASS, `tests 10` (blockers) and `tests 11` (linked-prs) — AC6.2.

- [ ] **Step 3: AC6.1 retained-assertion grep**, per file: `git -C … grep -n -F -e "usage: resolve-" -e "-f owner=" -e "--hostname" -e "missing repository" -e "JSON.parse(deps.calls.stdout[0])" -- {file}` shows the usage-name match (missing-arg and `--help`), `-f owner=` (override and origin-parsed), `--hostname` (both `#2240` tests), `missing repository` (exit 3), and one `JSON.parse` per success-shape test.

- [ ] **Step 4: Commit** both files — message `Drop scaffold-covered parse cases from the two number-list CLI tests — #5552`.

### Task 6 (controller): AC3 merge-conflict scratch check and PR evidence

**Role:** judgment

**Files:**
- Waived all repo files: scratch only; result goes to the run directory and the PR body.

- [ ] **Step 1: AC3.1.** Write a Node script in the scratchpad (never in the repo) that creates a temp dir, `git init`s it, commits a copy of the post-Task-1 `tests/policy-schema.test.js`, then on two branches from that commit each changes `109` → `110` in both assertions and rewrites the `Last bump:` line (branch A `…, #9001`, branch B `…, #9002`), commits, merges B into A, and prints the merge exit status and the conflicted path list. Expected: merge exits non-zero with `tests/policy-schema.test.js` conflicted on the `Last bump:` line. Control: the same script variant that leaves the `Last bump:` line unchanged on both branches merges cleanly (exit 0) — the conflict comes from the line. Capture to `{evidence}/ac3-merge-conflict.txt`; log one `AC evidence` entry for AC3.1.

- [ ] **Step 2:** AC8.1 (`npm test -- --full`) is satisfied by the PR's CI run on the pushed branch, read at Common Step 5 / `/claude-tweaks:test`; not run locally here.

- [ ] **Step 3:** The AC3 and AC9 evidence summaries are appended to PR #5591's body as an `### AC evidence (#5552)` block above the fixes block, keeping the session link line below the fixes block, at Common Step 7.
