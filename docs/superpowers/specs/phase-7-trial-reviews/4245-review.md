## Review: #4245 — Write gate misses the command after a backslash-newline line continuation (PR #6221)

**Review effort:** medium (derived from label low, diff heuristic medium (risk:low × size:low; the diff touches `plugin/bin/lib/hooks/git-command.js`, the PreToolUse write-guard lexer, a cross-package interface → risk proxy medium; 4 files / 38 lines → size proxy medium))

Mode: code (standalone — no `$PIPELINE_RUN_DIR`, so every step ran, the record's `ceremony:fast-lane` label notwithstanding). Reviewed range `origin/main...9323090fc3` (base `49ee30eefe`); no merge commits, no cherry-pick provenance match.

### Spec Compliance (spec-based only)

Status at review start (HEAD `9323090fc3`) → status after this review's fixes (HEAD `46f4c84c69`):

| Deliverable | Status |
|-------------|--------|
| 1. The four probe cases as regression tests, in `tests/hooks-git-command.test.js` and `tests/hooks-gate-coverage.test.js` | done → done |
| 2. The two preservation cases (single-quoted backslash-newline keeps its literal; heredoc-body line ending in `\`), checked against real bash | partial → done (the single-quote test asserted only a write target that is the same either way, and the heredoc case was absent; the single-quote pin now asserts a redirect target that carries the literal, and a `#4245` heredoc-body pin was added. Both cases, like every #4245 pin, are judged against bash 3.2.57 and 5.3.20.) |
| 3. No production change unless a new case fails at HEAD; if one does, fix it here and name it in the PR | partial (the build's `&\<nl>&` fix is named in the PR body, but the body's first sentence still says "I added tests only, with no production change", and this review's three production fixes are named in the commits, not the PR body — left unedited under the trial's commit-and-push-only rule) |

| Acceptance Criterion | Status |
|---------------------|--------|
| The four probe cases pass at HEAD | met |
| Each of the four fails when `tokenize`'s backslash-newline removal (#4281) is reverted locally | not met → met. At `9323090fc3`, reverting #4281 left all four green: the build's new segmenter line dropped the backslash-newline before `tokenize` saw it. That line was removed (redundant with #4281; the `&\<nl>&` operator read never needed it). Re-proved on the final code in a scratch extract: with #4281 reverted, each of the four inputs returns `[]`, and both test blocks go red. A throw-at-load control went red first. |
| The single-quoted case keeps its literal, and the heredoc-body case's result is unchanged from HEAD | partially met → met (the literal is asserted through the write target, and a mutant that joins inside single quotes turns it red; the existing #4149 heredoc joining pins pass unchanged) |
| `npm test` passes | met at the scoped level: `verify.js --scope … --local` on `46f4c84c69` ran 238/1432 impact-selected files, tests 9932, pass 9919, fail 0. PR CI was green (4 shards + test) on the build's head `9323090fc3`; CI on the review's head `46f4c84c69` had not started when this summary was written. |

Risk markers: none (no unvalidated Gotchas, no ambiguity markers, no Open Questions). Current-State outcome: reached (the four named probe shapes are pinned and discriminate).

### Verification (from /test)
- Type check: n/a (no type-check command configured)
- Lint: n/a (static checks ran within the scoped suite: `static: yes`)
- Tests: pass — scoped local runs after the fix wave (`d7a0907b69`: 235 files, 9883 pass, 0 fail) and after simplification (`46f4c84c69`: 238 files, 9919 pass, 0 fail); runner stamp `verifiedHead: true` on a clean tree

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| test | The four #4245 probes did not discriminate #4281: the build's segmenter drop at `git-command.js:51-52` stripped the backslash-newline before `tokenize`, so reverting #4281 left every probe green (acceptance criterion 2 unmet) | high | fixed — `d7a0907b69` |
| security | `separatorOp` (`git-command.js:3006`) read the raw character after `|`, so the newly cut `|\<nl>|` was classified as a pipe: `false |\<nl>| cd /x && git commit` reported only `/r`, while bash 3.2 and 5 commit in `/x` (fail-open, missed target) | high | fixed — `d7a0907b69` |
| security | The `#` comment-start check (`git-command.js:136`) read raw `str[i-1]`, so `echo a\<nl>#c && cd /x && git commit` was swallowed as a comment; bash joins `a#c` and commits in `/x` (fail-open; already on main, in the record's own defect class) | medium | fixed — `d7a0907b69` |
| convention | The new `|\<nl>|` join had no test, so a mutant dropping it survived | medium | fixed — `d7a0907b69` |
| test | The single-quoted case asserted only `/r/f`, identical whether or not the literal is kept | medium | fixed — `d7a0907b69` |
| convention | One-off `tests/hooks-4245-amp-continuation.test.js` split the record's pins across three files; the record asked for them beside the #4281 block | medium | fixed — moved into the two existing suites, file deleted, `d7a0907b69` |
| convention | The #4245 test comments gave no bash 3.2 / 5 verdict, which `shell-scanner-bash-differential` requires (`tests/hooks-git-command.test.js:763`, `tests/hooks-gate-coverage.test.js:4323`) | low | fixed — `d7a0907b69` |
| test | No #4245 heredoc-body pin (deliverable 2); joining itself is already pinned by #4149 | info | fixed — added a non-duplicate pin (a `bash <<EOF` body line ending `&\` joins the next line; bash gives `/M`), `d7a0907b69` |
| report fidelity | The PR #6221 body's spec summary says "tests only, with no production change" and later describes a production fix, and it does not name this review's fixes | low | accepted here — not edited, because the trial rules limit this review to commits and pushes; the driver or a human should rewrite the spec summary |

Every fix applied was the user's "Apply all (Recommended)" choice (hub item 1235).

### Tiebreak

**Verdicts:** 5 confirmed · 2 dropped · 0 digest · 0 console
- tiebreak:9422ff5a664b — plugin/bin/lib/hooks/git-command.js:3006 — `separatorOp` reads `|\<nl>|` as a pipe (high) — confirmed
- tiebreak:aafccd11b3f3 — tests/hooks-git-command.test.js:763 — no bash 3.2 / 5 verdict in the #4245 comments (low) — confirmed
- tiebreak:23aae361e2ff — plugin/bin/lib/hooks/git-command.js:2522 — deliverable 2 heredoc pin missing (low) — dropped, refuted: joining already pinned at `tests/hooks-gate-coverage.test.js:1660-1671`
- tiebreak:4eb69e9e23a6 — plugin/bin/lib/hooks/git-command.js:124 — `|\<nl>|` join untested (medium) — confirmed
- tiebreak:84954fa33d10 — tests/hooks-gate-coverage.test.js:4323 — no bash 3.2 / 5 verdict in the #4245 comments (low) — confirmed
- tiebreak:f93825784c8a — plugin/bin/lib/hooks/git-command.js:2295 — heredoc-body case untested (medium) — dropped, refuted: covered by the #4149 pins
- tiebreak:0bae1390882c — plugin/bin/lib/hooks/git-command.js:2140 — heredoc-body case absent from the diff (info) — confirmed, recommendation drop (behavior already pinned); acted on anyway with a non-duplicate pin, since deliverable 2 asks for one

Lens dispatch: medium tier ran 3b, 3c, 3a and 3f as reproduction pairs (8 agents). Six findings were confirmed by pair agreement, no cross-lens corroboration fired, and the 7 unconfirmed findings went to one capable tiebreak agent. All dispatches were independent agents; none were read inline. The pairs were dispatched in one parallel batch rather than lens by lens in sequence.

### Fan-out leftovers
None — no new untracked files, no leftover `agent-scratch/` files, no new listeners, no stray scratch worktrees.

### Implementation Hindsight
- Approach: sound — the record allowed a production change when a new case fails, and every fix is a shape real bash reads differently from the scanner. → no change
- Consolidation considered: routing `lineFeedsOnlyDataReaders`' inline separator read through `separatorOp`. The difference only shows with a command substitution after `<<` on the right of `|\<nl>|`, and the current read errs fail-closed. → accept as-is: no realistic input changes the result
- Skill-worthy (D2, `[skill: shell-scanner-bash-differential]`): (a) when the splitter reads an operator across a backslash-newline, every other raw-index reader next to a cut needs the same join (`separatorOp` and the `#` check both missed it); (b) adding a normalization in an earlier layer silently kills the pins of the layer that already had it (#4281's pins went non-discriminating). → change now — two sentences added to `.claude/skills/shell-scanner-bash-differential/SKILL.md`, `10bd499f6c`

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| The `#` comment fix lands in a record scoped as tests only | Deliverable 3 makes a real residual defect found by a new case a fix-here item; `a\<nl>#c` is the record's own defect class (the command after a continuation is missed) and fails open in a write guard |
| PR body left with a self-contradictory spec summary | The trial rules permit only commits and pushes from this review; flagged above for the driver or a human |
| `npm test` evidence is the scoped impact run, not the whole suite locally | The repo declares `localRuns: on-request`; the whole suite runs in PR CI, which was green on `9323090fc3` and pending on `46f4c84c69` at writing time |

### Visual Review
- **Status:** Skipped — no UI changes
- Gate reason: no frontend surface (surface: infra) and no UI trigger file in the diff. Journeys whose files overlap the diff: get-a-disguised-main-checkout-write-denied-4303, judge-a-scanner-shape-against-real-bash-without-a-runaway-writer-4391, keep-sibling-sessions-processes-alive-through-a-dispatched-build-4548, merge-a-pipeline-pr-only-after-its-run-finishes-6143, run-a-heredoc-node-script-from-the-main-checkout-3989, run-shell-loops-without-a-hook-storm-3074, write-a-glued-redirect-from-the-main-checkout-4015, write-a-quoted-windows-path-from-a-session-4281

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- `plugin/bin/lib/hooks/git-command.js`: extracted the duplicated backslash-newline skip loop (segmenter and `separatorOp`) into one `pastLineContinuations` helper (-4/+8). The diff audit matched the agent's report, and the scoped re-verify and mutant matrix passed after it. `46f4c84c69`
- Test files: no simplifications needed

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
| # | What | Where |
|---|------|-------|
| 1 | Rewrite the PR #6221 body's spec summary: drop "tests only, with no production change", name the three review fixes (`|\<nl>|` as `||` in `separatorOp`, the `#`-after-continuation comment check, removal of the redundant segmenter drop), and note that the #4281 revert proof now passes | PR #6221 body |
| 2 | Confirm PR CI (4 shards + test, including Windows) is green on `46f4c84c69` before any merge decision | PR #6221 checks |

### Verdict
**PASS**

### Actions Performed

| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | `separatorOp` reads `|\<nl>|` as `||` — `plugin/bin/lib/hooks/git-command.js` | `d7a0907b69` |
| Bug fix | `#` after a backslash-newline continuation is not a comment — `plugin/bin/lib/hooks/git-command.js` | `d7a0907b69` |
| Bug fix | Removed the segmenter's duplicate backslash-newline drop that masked the #4281 pins — `plugin/bin/lib/hooks/git-command.js` | `d7a0907b69` |
| Test fix | Moved the `&\<nl>&` pins into the existing suites, deleted `tests/hooks-4245-amp-continuation.test.js`, added `||`, `#` and heredoc pins, strengthened the single-quote pin, recorded bash 3.2 / 5 verdicts — `tests/hooks-git-command.test.js`, `tests/hooks-gate-coverage.test.js` | `d7a0907b69` |
| Skill update | Continuation-join and layered-normalization traps — `.claude/skills/shell-scanner-bash-differential/SKILL.md` | `10bd499f6c` |
| Simplified | Shared `pastLineContinuations` helper — `plugin/bin/lib/hooks/git-command.js` | `46f4c84c69` |

All three commits are pushed to `drive-record-4245` (PR #6221 head `46f4c84c69`). The PR is still a draft; it was not merged, closed or marked ready, and wrap-up was not run.

### Key Learnings
1. A regression-pin record can lose its own acceptance criterion through its build's extra fix: duplicating #4281's normalization one layer earlier made every #4245 pin pass with #4281 reverted. Only an actual revert run, not a green suite, showed it. — any "pin an existing fix" record needs the original layer reverted in scratch before it ships.
2. Teaching the segmenter to read an operator across a backslash-newline is not done until every raw-index reader of the same input agrees: `separatorOp` and the `#` word-start check both still read raw characters, and both failed open. — the shell-scanner skill now names this.
3. Real bash 3.2 and 5 settled every disputed shape in seconds (`&\<nl>&`, `|\<nl>|`, `a\<nl>#c` vs `a \<nl>#c`, single-quoted `\<nl>`, heredoc bodies) — the oracle run is cheaper than reasoning about these shapes and should precede the fix.

### Next Actions

**`/claude-tweaks:wrap-up 4245`** — capture learnings and clean up (recommended)
