## Review: #4244 — Write gate misses a command after a compound keyword (PR #6176, branch drive-record-4244)

**Review effort:** medium (derived from record labels: risk:medium × size:low; diff heuristic agrees, medium — 2 files / 29 lines, no merge-sensitive paths configured, exported-API addition; no review-effort-floor set)

Standalone review (no `$PIPELINE_RUN_DIR`): code mode, every step run (the run's `ceremony-profile: fast-lane` applies only inside a pipeline). No open-items ledger — standalone, so findings below are not ledger-tracked.

### Spec Compliance (spec-based only)
| Deliverable | Status |
|-------------|--------|
| 1. Add the compound keywords to #4448's "skip to command word" helper so `findGitLead` and the write-shape lead check read the command after a keyword; export the keyword set beside #4448's prefix set | done — `commandWord` skips a bare lead keyword (now via the shared `COMPOUND_LEAD_WORDS`); `COMPOUND_KEYWORDS` exported. `visitSegment` (cd lead) deliberately unchanged: the record's ADR 0028 scope note moves a cd in a conditional/loop body to #4572 |
| 2. Add the keyword probe cases to the tests, checked against real bash | done after review fix — the build added the cases with no bash verdict; review ran every case under /bin/bash 3.2.57 and Homebrew bash 5 and recorded the verdicts in the test comments |

| Acceptance Criterion | Status |
|---------------------|--------|
| `if…then cp`, `for…do cp`, `while false; do :; done; cp`, `if…then git -C /M commit` report the /M target | met |
| `case x in x) cp a /M/b;; esac` reports the /M target | met (already met at base by the existing case-item walk) |
| Each new case goes red against the current lead check | partially met — at the build, 3 of 9 write cases (`while … done; cp`, `until … done; cp`, `case … esac`) passed at base, so they could not go red (builder admitted the go-red check was never run). The record's own literal `… done; cp` and `case` strings cannot go red by construction (the cp is its own segment / base already reads case items); review kept them as commented regression pins and added discriminating `while true; do cp …; break; done` / `until false; do cp …; break; done` cases, which are `[]` at base and report at HEAD. No keyword-based `case` variant exists to go red |
| A pin test fails if the exported keyword set and the record's list diverge | met — and, after review fix, the set that drives behaviour is pinned too (per-word `commandWord` skip check over `COMPOUND_KEYWORDS`) |
| `npm test` passes | met — impact-selected 196/1417 files, 8016 tests, 0 fail, 12 skipped; PR CI full suite (4 shards) pass |

Risk markers: none (no unvalidated Gotchas, no ambiguity markers, no Open Questions). Current-State outcome: reached — tests drive `fileWriteTargets`/`gitTargets` through `findGitLead` and the write-shape lead; the `visitSegment` gate the Current State also names is owned by #4572 per the record's scope note.

### Verification (from /test)
- Type check: n/a (no type checker configured)
- Lint: n/a (none configured)
- Tests: pass — runner stamp verified HEAD 2dbdff59d1 at review start (scoped on fullSha 8d217321dd); after the fix waves, scoped verify re-run at a536655b67: tests 8016, pass 8004, fail 0, skipped 12; stamp `verifiedHead: true`, clean tree. PR #6176 CI: test + shards 1-4 pass.

### QA Validation (from /test)
- **Status:** Skipped — no stories

### Code Review Findings (confirmed)
| Category | Finding | Severity | Action |
|----------|---------|----------|--------|
| convention | New `COMMAND_LEAD_KEYWORDS` duplicated `COMPOUND_LEAD_WORDS` (#4281, same 7 words + `!`, already used by `processKillLead`/`compoundBodyEnd`), against the record's "single definition of command position" — `git-command.js:828` | medium | fixed (041f089bda) — `commandWord` reads `COMPOUND_LEAD_WORDS`; `!` is already a stripped prefix (`PREFIX_OPTIONS['!'] = null`), so behaviour is unchanged |
| test | Pin test pinned the exported `COMPOUND_KEYWORDS`, which no code reads; the behaviour-driving set was unpinned (dropping `then` or adding `in` stayed green) — `git-command.js:828`, test `:2317` | medium | fixed (041f089bda) — behavioural pin: lead words skipped, `fi`/`done`/`esac`/`in`/`for`/`case` not |
| test | `while … done; cp`, `until … done; cp` and `case … esac` cases non-discriminating (report at base) — test `:2323` | medium | fixed (041f089bda) — break-loop body cases added (go red at base); record's literal cases kept, commented as regression pins |
| test | Same root cause seen at the production line: AC1 while/until skip unproven — `git-command.js:972` | medium | fixed (041f089bda) — same fix |
| docs | `commandWord` header did not list the new keyword skip — `git-command.js:895` | low | fixed (041f089bda) |
| test | No escaped-spelling pin (`\then`) for the keyword skip — `git-command.js:972` | low | fixed (041f089bda) |
| test | No negative case for `in`/`fi`/`done`/`esac` staying unskipped — test `:2322` | low | fixed (041f089bda) — covered by the behavioural pin |
| convention | `COMPOUND_KEYWORDS` appended to the "stripped command prefixes (#4448)" export group — `git-command.js:3979` | low | fixed (041f089bda) — own group comment |
| test | New cases carried no real-bash verdict (shell-scanner-bash-differential skill; record Deliverable 2) — test `:2322` | low | fixed (041f089bda) — verdicts from bash 3.2.57 and bash 5 recorded |
| test | No negative case for a keyword in argument position — `git-command.js:972` | low | accepted — false positive in substance: an argument never reaches the command-word check (`cp then /main/f.js` gives the same target at base and HEAD) |
| convention | `COMPOUND_KEYWORDS` has no reader inside the module — `git-command.js:827` | info | accepted — the export is the record's request (for #4572); it now has a behavioural pin |

Lenses run: 3b Security (pair: no findings — ~25 adversarial shapes probed, no fail-open miss; the scanner skipping a word bash would run as a command, e.g. `env then cp`, only adds a target, the fail-closed side), 3c Error handling (pair: no findings), 3a Convention (pair), 3f Test quality (pair, with scratch-checkout execution evidence). Cross-lens corroboration: no matches. Mutation proof of the fixed rules (scratch copy): dropping `then` from the lead set, adding `in`, dropping the `spanKinds` check, dropping both quoting checks, and removing the skip each turn a #4244 test red; control (throw at load) red, unmutated green. Dropping only `raw[i] === word` survives — an equivalent mutant, since the all-bare `spanKinds` check already rejects every quoted/escaped spelling (same idiom as `processKillLead`).

### Tiebreak
**Verdicts:** 10 confirmed · 0 dropped · 5 digest · 0 console
- AUTO — Reproduction: lens "3a" finding plugin/bin/lib/hooks/git-command.js:827 confirmed by tiebreak:050effc6cf81. Confirmed.
- AUTO — Tiebreak tiebreak:854c12d951e8: lens "3a" finding .claude/skills/single-source-constant-guard/SKILL.md:1 digested: evidence-unverified. Severity: info.
- AUTO — Tiebreak tiebreak:ed92d021bfdb: lens "3f" finding plugin/bin/lib/hooks/git-command.js:972 digested: verdict:cant-tell. Severity: info.
- AUTO — Tiebreak tiebreak:b32eb36993b6: lens "3f" finding tests/hooks-gate-coverage.test.js:2328 digested: verdict:cant-tell. Severity: info.
- AUTO — Tiebreak tiebreak:508063297a7a: lens "3f" finding tests/hooks-gate-coverage.test.js:2326 digested: verdict:cant-tell. Severity: info.
- AUTO — Tiebreak tiebreak:77a04f1e069c: lens "3f" finding tests/hooks-gate-coverage.test.js:2316 digested: verdict:cant-tell. Severity: info.
- AUTO — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:972 confirmed by tiebreak:db3078a7a653. Confirmed. (case row passes at base; Recommendation: drop — regression pin, low)
- AUTO — Reproduction: lens "3a" finding plugin/bin/lib/hooks/git-command.js:895 confirmed by tiebreak:49d1446fc879. Confirmed.
- AUTO — Reproduction: lens "3a" finding plugin/bin/lib/hooks/git-command.js:972 confirmed by tiebreak:92de5c88ecb7. Confirmed.
- AUTO — Reproduction: lens "3a" finding tests/hooks-gate-coverage.test.js:2322 confirmed by tiebreak:339e46c658a2. Confirmed.
- AUTO — Reproduction: lens "3a" finding tests/hooks-gate-coverage.test.js:2317 confirmed by tiebreak:d585166c0097. Confirmed.
- AUTO — Reproduction: lens "3f" finding tests/hooks-gate-coverage.test.js:2323 confirmed by tiebreak:09da1461c2c2. Confirmed.
- AUTO — Reproduction: lens "3f" finding tests/hooks-gate-coverage.test.js:2322 confirmed by tiebreak:21c22214ad1e. Confirmed.
- AUTO — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:972 confirmed by tiebreak:9b9917c48d66. Confirmed.
- AUTO — Reproduction: lens "3f" finding plugin/bin/lib/hooks/git-command.js:972 confirmed by tiebreak:2f6c315940f8. Confirmed.

No can't-tell finding of severity medium or higher (all five digests are `info`: four are the 3f agents' own execution observations — go-red confirmed / quoted negative / unrun base assertion — which the reviewer re-ran directly; one is a "no divergence" non-finding). Standalone review: nothing staged, no digest entries written.

### Fan-out leftovers
None untracked (post-fan-out `git status` identical to the pre-dispatch listing; agent-scratch empty after the tiebreak wave). 1 new local listener since the pre-dispatch snapshot, reported (not killed; ownership unattributed — pid 28881, not started by this review's agents as far as can be told): node:20394.

### Implementation Hindsight
No changes needed — approach is sound. (Considered and accepted: deriving `groupEvents`' `COMMAND_PREFIX_WORDS` from `COMPOUND_LEAD_WORDS` — rejected because `git-command.js:810-816` deliberately keeps one word list per walk, and the two genuinely differ: `time` is a stripped prefix with options in `commandWord`.)

### Tradeoffs Accepted
| Tradeoff | Rationale |
|----------|-----------|
| The record's literal AC cases `while false; do :; done; cp …`, `until true; do :; done; cp …` and `case x in x) cp …;; esac` are kept although they cannot go red | They are the record's own acceptance strings and still guard against regression; discriminating break-loop cases now carry the go-red proof for while/until; `case` needs no keyword skip (base already reads case items) |
| `raw[i] === word` left in the keyword check though it is an equivalent mutant | Matches the established `processKillLead` idiom; removing it would change nothing observable and diverge from the sibling reader |

### Visual Review
- **Status:** Skipped — no UI changes
- Skill-load gate: "no frontend surface (surface: infra) and no UI trigger file in the diff"; journeys whose `files:` overlap the diff: get-a-disguised-main-checkout-write-denied-4303, keep-sibling-sessions-processes-alive-through-a-dispatched-build-4548, run-a-heredoc-node-script-from-the-main-checkout-3989, run-shell-loops-without-a-hook-storm-3074, write-a-glued-redirect-from-the-main-checkout-4015, write-a-quoted-windows-path-from-a-session-4281

### Design Quality (from /claude-tweaks:design-wrapper review)
Design Quality skipped — design integration not configured (run /claude-tweaks:init to enable).

### Code Simplification
- 1 change (code-simplifier, scoped to this branch's hunks): reworded the `COMPOUND_KEYWORDS` comment in `plugin/bin/lib/hooks/git-command.js` (comment only, -4/+4); test file: no simplifications needed. Verification: hooks-gate-coverage + hooks-git-command, 1097 pass, 0 fail; scoped verify at a536655b67: 8016 tests, 0 fail.

### Skill Load Delta
Skill load delta: no skill files changed — skipped

### Docs (lens 3i, informational)
| # | Finding | Severity | Category | Affected | Recommended |
|---|---------|----------|----------|----------|-------------|
| 1 | Doc `docs/donts.md` covers changed areas (`plugin/bin/lib/hooks/**`) but wasn't updated — reviewer read it: no stale text on compound keywords / command position | Low | Docs | docs/donts.md | Review in wrap-up |
| 2 | Doc `docs/hooks.md` covers changed areas (`plugin/bin/lib/hooks/**`) but wasn't updated — reviewer read it: no stale text on compound keywords / command position | Low | Docs | docs/hooks.md | Review in wrap-up |

Journey-story coverage (3g-cov): skipped — no `stories/` directory.

### Manual Steps Required
No manual steps — nothing to do outside the codebase.

### Verdict
**PASS**

### Actions Performed
| Action | Detail | Ref |
|--------|--------|-----|
| Bug fix | Reuse shared `COMPOUND_LEAD_WORDS` in `commandWord`, delete duplicate `COMMAND_LEAD_KEYWORDS`; header + export-group comments — `plugin/bin/lib/hooks/git-command.js` | `041f089bda` |
| Bug fix | Behavioural keyword pin, discriminating break-loop cases, `\then` pin, bash 3.2/5 verdict comments — `tests/hooks-gate-coverage.test.js` | `041f089bda` |
| Simplified | Reworded `COMPOUND_KEYWORDS` comment — `plugin/bin/lib/hooks/git-command.js` | `a536655b67` |

Both commits pushed to `drive-record-4244` (PR #6176 stays draft; not merged, not marked ready). Footer: Security Hardening (6.6), Agent Trust Scope (6.65) and App Store Readiness (6.66) pre-checks skipped — no client/route files, no settings/policy file, no mobile-app files in scope. Step 6.7: nothing to route.

### Key Learnings
1. A probe case whose write follows `done;` (or any `;`) is its own segment, so it passes at base and cannot prove a lead-check change; and `while false; do cp …; done` never runs its body in bash, so a discriminating loop case needs a body that actually runs (`while true; do cp …; break; done`) — the shell-scanner-bash-differential skill's "pin passes at the previous release ⇒ pins nothing" check already covers this; the builder skipped it.
2. Pinning an exported list that no code reads satisfies an AC literally while guarding nothing — pin the behaviour the list is supposed to drive (iterate the exported set through the function under test).
3. Before adding a word set to `git-command.js`, grep for an existing one with the same purpose (`COMPOUND_LEAD_WORDS`, `COMMAND_PREFIX_WORDS`, `STRIPPED_PREFIX_WORDS`): the file keeps one list per walk on purpose, but two lists for the *same* walk are duplication.

### Next Actions

**`/claude-tweaks:wrap-up 4244`** — capture learnings and clean up (recommended)
