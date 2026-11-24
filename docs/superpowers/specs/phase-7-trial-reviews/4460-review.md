## Review: #4460 — Write gate misses a quoted '(x' redirect target and a cd with a glued redirect (cd>f DIR) — draft PR #6191

**Review effort:** medium (derived from label medium, diff heuristic low (risk:medium × size:low; 4 files / 56 lines, no merge-sensitive, schema, infra or dependency paths, so risk proxy low × size proxy medium))

Scope: `origin/main...drive-record-4460`, base `7d33c5d66b` (merge-base), reviewed head `3333e01388`, standalone code mode (no `$PIPELINE_RUN_DIR`), no merge commits in the range, no cherry-pick duplicate of an open PR. The review's own fixes landed on top as `36ad869165` (pushed; PR stays draft).

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| 1. Skip a redirect target as a process substitution only when its `(` is bare; a quoted or escaped `(` is file text | done |
| 2. Split a redirect glued to the lead word (`cd>f`, `cd>>f`) before reading the cd | done. At `3333e01` it missed the `&>` operator (`cd&>f DIR`), a confirmed leak; fixed in `36ad869165` |
| 3. Pin both shapes in `tests/hooks-gate-coverage.test.js` with bash 3.2 and 5 verdicts | done. At `3333e01` two of the pins sat in review-named side files with no bash-version verdicts; folded into the suite in `36ad869165` |

| Acceptance Criterion | Status |
|---------------------|--------|
| `echo x > '(x'` resolves `/r/(x`, and `cat <(true)` still resolves no target | met |
| `cd>f /main; cp a g.js` resolves `/r/f` and `/main/g.js`, so it is denied from a worktree whose main checkout is `/main` | met. The gate-level deny was unpinned at `3333e01`; `e2e #4460` now drives it through the real gate |
| Each rule has a red-turning mutant | met, after the review. At `3333e01`, three rules had no discriminating test (glued `>$A` bareParen, the `>&` word branch, the cd `<`/kinds guard), and one rule (the separate-token bareParen) was dead. Final mutant run, 12 mutants over the four scanner suites, all red: control pass 1290 / fail 0; M1 gluedCd off fail 2, M2 offset always 1 fail 1, M3 no `&>` in lead fail 2, M3b no `&>` in offset fail 1, M4 no kinds[2] guard fail 1, M6 operator-token bareParen null fail 1, M8 stale `>&` targetKinds fail 2, M9 no `.slice(1)` fail 1, M10 every `(` skipped fail 1, M11 no `(` skipped fail 2, M12 unknown kinds read as not bare fail 1. Two rules no mutant could turn red were deleted as dead (see Actions) |
| The four scanner suites pass | met — `tools/run-tests.js` over hooks-gate-coverage, hooks-git-command, hooks-bash-prefilter and teardown-gate: pass 1290, fail 0 |

Current-State outcome reach: reached — `e2e #4460` runs `cd>f MAIN; cp a g.js` and `cd&>f MAIN; cp a g.js` through `linkedWorktree4303`'s real PreToolUse gate and asserts `deny`, with the worktree-target control still allowed. Risk markers: none (the record has no Gotchas validation status, ambiguity markers or Open Questions). PR-body deliverables: none.

### Verification (from /test)
- Type check: n/a (no types stage declared)
- Lint: n/a (no lint stage declared)
- Tests: pass — gate at start: runner stamp `verifiedHead: true` on `3333e01` (scoped, CI-sourced), PR checks green. Re-verify after the fix wave: `verify.js --scope .claude-tweaks/verify-scope.json --integration-branch main` on `36ad869165`, tests taken from PR CI run 45376201744 (tests 36426, pass 36400, fail 0; impact 222 of 1420 files); stamp `verifiedHead: true`. PR checks on `36ad869165`: shard 1-4/4 pass, test pass, label-fix-branch pass. A CI-sourced pass does not cover macOS, Node 22 or Windows; the new pins resolve expected paths through `path.resolve` and the e2e single-quotes its paths (`shellQuote`), so they are written to hold on win32.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| security | `gluedCd` (`git-command.js:1105`) matched only `cd<`/`cd>`, so `cd&>f /main; cp a g.js` (and `cd&>>f`, `cd&> f`) was read as no cd: `/r/g.js` reported where bash 3.2 and 5 write `/main/g.js` (bash 3.2 rejects `&>>`; bash 5 writes) — a write into the main checkout the gate allowed. Lens 3b pair, severity contested (high / medium) | medium | fixed — `36ad869165` |
| test | No gate-level pin for criterion 2's deny from a worktree; only `fileWriteTargets` was asserted (3f pair) | medium | fixed — `e2e #4460` |
| convention | `tests/review-4460-glued-cd-split-target.test.js` and `tests/review-4460-var-paren-target.test.js`: review-round-named side files beside the suite that holds the #4460 pins, titles without `#4460:`, `bash:` comments without the bash 3.2 and 5 verdict (3a pair; `shell-scanner-bash-differential` Project Conventions) | medium | fixed — folded into `tests/hooks-gate-coverage.test.js`, files deleted |
| test | Separate-target-token `bareParen` read (`git-command.js:3508`) had no discriminating test (3f pair); the mutant run showed it dead — it changes only a `> (x$A` shape bash rejects as a syntax error | low | fixed — rule deleted (mutant M7 survived every suite) |
| test | Glued `>$A` `bareParen` read from the operator token (`:3500`) undiscriminated (tiebreak confirmed) | low | fixed — `A='(x'; echo x >$A` row; M6 red |
| test | `>&` word-branch `targetKinds = kindsAt(i)` / `.slice(1)` (`:3525`) undiscriminated (tiebreak confirmed) | low | fixed — `>& '(x'` and `>&'(x'` rows; M8, M9 red |
| test | `cd<` branch and the `spanKinds[cdLead][2] === 'b'` guard (`:1105`) untested (tiebreak confirmed) | low | fixed — `cd<>f`, `cd<&0`, `cd<<<x`, `cd<<< x`, `'cd>f'`, `cd\>f` rows; M4 red |
| test | Weak `includes` assertions in both review-named files (tiebreak confirmed ×2) | low | fixed — exact `deepStrictEqual` lists in the suite |
| security | `echo x > $'(x'` (and `"$A"x` with `A='('`) resolves no target where bash 3.2 and 5 write `(x` (3b pair, anchored at `:3534`). Re-traced: not the paren rule — base `7d33c5d66` drops them too, and so are `$'ab'` and `"$A"y` (A=x), with no `(` at all: the tokenizer reads `$'…'` as a bare `$` + single-quoted span, and a quoted `$NAME` glued to text is unsubstituted; both targets then fall out as unresolvable `$` | medium | deferred — `"$A"x` is already tracked by #4328 ("A quoted `$NAME` glued to a bare continuation", `"$A"g`); the plain ANSI-C target is staged as a proposal below (Defer-reason: pre-existing-outside-diff; not filed, per this run's rules) |
| convention | Both branch commits use a `fix:` prefix and `3333e01`'s subject ends `— refs — refs #4460`, against CLAUDE.md:37's feature-branch commit style (tiebreak confirmed). Root cause is outside this diff: the driver writes `${title} — refs #${record}` (`plugin/bin/lib/driver/steps.js:1074`) on a worker title whose `#N` `normalizeTitle`/`neutralize` already stripped (`BARE_REF`, `plugin/bin/lib/driver/events.js:248`), leaving `— refs` | low | deferred — staged record proposal below (Defer-reason: pre-existing-outside-diff); the squash merge replaces these subjects |

Reviewer-found during the mutant pass (not a lens finding): the review's own first `cd&>` fix added a `spanKinds[cdLead][3] === 'b'` guard that no mutant could turn red (`cd&\>f` never reaches it — the segment splitter cuts at that lone `&`), so it was dropped for a comment; and mutant M12 (unknown span kinds read as not bare) survived, so the no-span-kinds reading is now pinned (`redirectWriteTargets(['echo','x','>(cat)'], '/r')` → `[]`, bash writes no file).

Lens 3c (error handling): no findings from either agent — every new index read is guarded, `bareParen`/`targetKinds` reset per iteration, and the probes (`cd>`, `echo >`, `>&` at end of input, `> ''`, `>&$A`) threw nothing.

### Tiebreak
**Verdicts:** 6 confirmed · 1 dropped · 0 digest · 0 console
- AUTO 11:12:02 — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:3500 confirmed by tiebreak:f5f691529d5a. Confirmed. Reversibility: high.
- AUTO 11:12:02 — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:3525 confirmed by tiebreak:9ab5d890d138. Confirmed. Reversibility: high.
- AUTO 11:12:02 — Tiebreak tiebreak:73151a740c12: lens "3f" finding plugin/bin/lib/hooks/git-command.js:3534 dropped: refuted by tiebreak. Evidence: plugin/bin/lib/hooks/git-command.js:3534 " if (rawTarget.startsWith('(') && (targetKinds ? targetKinds[0] === 'b' : bareParen !== false)) continue;". Severity: low. Reversibility: high.
- AUTO 11:12:02 — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:1105 confirmed by tiebreak:23eed23eb90a. Confirmed. Reversibility: high.
- AUTO 11:12:02 — Reproduction: lens "3f" finding tests/review-4460-glued-cd-split-target.test.js:10 confirmed by tiebreak:9e0193125a5f. Confirmed. Reversibility: high.
- AUTO 11:12:02 — Reproduction: lens "3f" finding tests/review-4460-var-paren-target.test.js:9 confirmed by tiebreak:24ef762f4b40. Confirmed. Reversibility: high.
- AUTO 11:12:02 — Reproduction: lens "3a" finding CLAUDE.md:37 confirmed by tiebreak:29d0dc7b2dc3. Confirmed. Reversibility: high.

The judge read a detached checkout of the reviewed sha `3333e01`, not the post-fix tree, and `resolve-tiebreak --root` checked its quotes against that same checkout. No can't-tell findings.

### Fan-out leftovers
0 untracked files left by the review fan-out (worktree status identical to the pre-dispatch snapshot; `agent-scratch/` empty). 9 new local listener rows since the pre-dispatch snapshot, reported (not killed; ownership unattributed — other sessions were running): `2.1.325`:54373, `2.1.325`:54415, `2.1.325`:55163, `2.1.325`:57435, `2.1.325`:58564, `node`:20241, `node`:20300 (IPv4 and IPv6 rows of the two node ports collapsed).

### Implementation Hindsight
- Approach is sound: reading the glued operator at the cd lead and judging the `(` by span kinds are the right levers; no structural debt, and no consolidation onto `gluedRedirectOpEnd` is possible (it handles a glued `>` after a plain word only, not `&>` or `<`).
- Skill-worthy pattern → change now (D2): `.claude/skills/shell-scanner-bash-differential/SKILL.md` gains "A rule that matches a redirect operator by its own pattern lists every operator" — the `/^cd[<>]/` lead named only the operators its author thought of and missed `&>`; run every operator bash has (`>`, `>>`, `>|`, `<`, `<>`, `<&`, `>&`, `&>`, `&>>`, `<<<`, fd prefix) through such a rule, glued and spaced. Applied in `36ad869165`. [skill: shell-scanner-bash-differential]

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| `cd&>>f DIR` is read as a cd, as bash 5 does, though bash 3.2 rejects it as a syntax error | The skill's rule: side with the shell that writes; reading it as a cd is the fail-closed side |
| With no span kinds, a target starting with `(` is still read as a process substitution (base behavior), now pinned | Both production callers (`bash-prefilter.js:100`, `git-command.js:3777`) pass span kinds; only the bare `redirectWriteTargets(t, cwd)` test entry point has none |
| The ANSI-C `$'…'` target and the quoted-`$NAME`-glued target stay unresolved on this branch | Pre-existing at base, unrelated to the `(` rule, and their fix belongs in `tokenize`/`substituteVars` (#4328 already names the second) |

### Visual Review
- **Status:** Skipped — no UI changes
- Step 6 skill-load gate: `no frontend surface (no surface declared) and no UI trigger file in the diff`; journeys whose `files:` overlap the diff: get-a-disguised-main-checkout-write-denied-4303, keep-sibling-sessions-processes-alive-through-a-dispatched-build-4548, run-a-heredoc-node-script-from-the-main-checkout-3989, run-shell-loops-without-a-hook-storm-3074, write-a-glued-redirect-from-the-main-checkout-4015, write-a-quoted-windows-path-from-a-session-4281

Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- No simplifications needed (code-simplifier on the #4460 hunks of `git-command.js` and the #4460 tests; no edits).

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Staged proposals (not filed — this run may only commit review fixes)
1. **Record:** "Keep the record number in a driver commit subject: `— refs — refs #N`" — Type: bug · Defer-reason: pre-existing-outside-diff · Current State: `plugin/bin/lib/driver/steps.js:1074` writes `${title} — refs #${ctx.record}`, and the worker title has already lost its own `#N` to `neutralize`'s `BARE_REF` (`plugin/bin/lib/driver/events.js:248`), so a title ending `— refs #4460` becomes `… — refs — refs #4460` (seen on `3333e01388`); a worker `fix:` prefix also passes through, against CLAUDE.md:37's feature-branch style. Key Files: `plugin/bin/lib/driver/steps.js`, `plugin/bin/lib/driver/events.js`. To file: `/claude-tweaks:capture` with this body and `--defer-reason=pre-existing-outside-diff --source review`.
2. **Record or #4328 addition:** "Resolve an ANSI-C `$'…'` redirect target" — Type: bug · Defer-reason: pre-existing-outside-diff · Current State: `fileWriteTargets("echo x > $'ab'", '/r')` and `"echo x > $'(x'"` return `[]` at base `7d33c5d66` and at `36ad869165`; bash 3.2 and 5 write `ab` / `(x`. `tokenize` reads `$'…'` as a bare `$` plus a single-quoted span, so the value `$ab` is dropped as unresolvable. After a `cd` into the main checkout this is a leak. #4328 names other ANSI-C misreads (`$'\''`) but not a plain `$'…'` target. Key Files: `plugin/bin/lib/hooks/git-command.js` (`tokenize`). To file: `/claude-tweaks:capture` with this body and `--defer-reason=pre-existing-outside-diff --source review`, or add it to #4328's checklist.

### Process notes
- Standalone review: no run directory, so nothing went to `decisions.md`, the ledger, or a PR verdict comment. The four lens pairs (3a, 3b, 3c, 3f at `medium`) ran in one parallel batch instead of one pair at a time (the diff is under 10 files). The pairs were matched by reading both replies, not through `categorise-reproduction`, and no cross-lens corroboration matched (the only overlap was with already-confirmed 3a rows).
- The fixes were applied under this run's brief ("commit and push only fixes the review itself applies"), in place of the interactive batch-approval prompt. The PR is still a draft; nothing was merged, closed or marked ready, and wrap-up was not run.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Read `cd&>f`, `cd&>>f` and `cd&> f` as a cd with its own redirect — `plugin/bin/lib/hooks/git-command.js` | `36ad869165` |
| Bug fix | Delete two dead rules (the kinds[3] guard after `cd&`, the separate-token `bareParen` read) and correct the `bareParen` comment — `plugin/bin/lib/hooks/git-command.js` | `36ad869165` |
| Bug fix | Fold the review-named tests into `tests/hooks-gate-coverage.test.js` with `#4460:` titles, exact lists and bash 3.2/5 verdicts; add `>$A`, `>&`, `>(cat)`, no-span-kinds, `cd<>f`/`cd&>`/`cd<&0`/`cd<<<` and lookalike rows and the `e2e #4460` gate deny; delete `tests/review-4460-*.test.js` | `36ad869165` |
| Skill update | `.claude/skills/shell-scanner-bash-differential/SKILL.md`: list every redirect operator through a rule that matches operators by its own pattern | `36ad869165` |

### Key Learnings
1. A rule that recognises a redirect operator with its own regex drifts from the shared operator readers: `/^cd[<>]/` missed `&>` while every other glued form worked. Only the 3b lens pair's adversarial probes found it, and the fix rounds did not — enumerate bash's full operator set against any such rule.
2. Mutation-checking found two dead rules, one from the driver's build and one from this review's own first fix. Run the mutant pass on the reviewer's fixes too, not just the implementer's.
3. Driver-built commits carry a `fix:` prefix and a doubled `— refs — refs #N` from title neutralization, so every driver-trial PR will show it until the driver is fixed (staged proposal 1).

### Next Actions
**`/claude-tweaks:wrap-up 4460`** — capture learnings and clean up (recommended)
