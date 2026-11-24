## Review: #4247 — Read nested command substitutions with one shared lexer in the worktree-always redirect scan (draft PR #6225, branch `drive-record-4247`, HEAD `55843c2ef5`)

**Review effort:** not derived. The review stopped at Step 1 (Spec Compliance gate: BLOCKED), before Step 2.5. The record labels would give risk:medium × size:medium.

### Spec Compliance
| Deliverable | Status |
|-------------|--------|
| Replace the two nesting walkers (`advanceNesting` and the `subs` stack in `scanHeredocs`) with one shared word-lexer that both the redirect scan and `stripHeredocBodies` read | **missing**. The branch adds a `case`/`esac` counter (`kd`) and closer-matching to `advanceNesting` only (`plugin/bin/lib/hooks/git-command.js:1832-1866`). `scanHeredocs` is untouched, and no shared lexer exists. The PR body says so: "I did not build the single shared lexer, which would have gone past the 40-line limit." That limit is a driver constraint. The record has no Non-Goal that drops this deliverable. |
| Make the shapes resolve as bash does, keeping the never-fabricate posture | **partial**. The record's three listed shapes now resolve as the acceptance criteria require. The `case` fix only triggers when `case` is the first word inside `$(` (`/^\(\s*case\s/`), so the same bug class remains one word away. Probed on HEAD: `echo "$(true; case $x in a) echo "p>q";; esac)"` → `[{"action":"write","file":"/r/q;; esac)"}]`. That is the exact junk target the record's Current State names, and it is a false deny. This is the failure mode a real lexer (deliverable 1) would remove. |
| Pin each shape in `tests/hooks-gate-coverage.test.js` and the prefilter differential corpus in `tests/hooks-bash-prefilter.test.js`, and run the old and new parsers over a shared command corpus, accounting for every changed result | **partial**. All three shapes are pinned in `hooks-gate-coverage.test.js` and as a `hasFileRedirection` test in `hooks-bash-prefilter.test.js`. Two of the review-fix shapes went into new single-purpose files (`tests/hooks-4247-case-esac-*.test.js`) instead of the named suites. Nothing was added to `DIFFERENTIAL_CORPUS`. The old-vs-new corpus comparison was not run; the PR body confirms: "I did not build the old-versus-new corpus comparison either." |

| Acceptance Criterion | Status |
|---------------------|--------|
| `fileWriteTargets('echo "$(case $x in a) echo "p>q";; esac)"', cwd)` resolves nothing, and the heredoc/apostrophe command resolves `o.js` | met. Probed on HEAD: `[]`. The `o.js` case is pinned in `tests/hooks-gate-coverage.test.js`, which passes. |
| `fileWriteTargets('echo $(cmd x>y)', cwd)` resolves `y`, not `y)` | met. Probed on HEAD: `[{"action":"write","file":"/r/y"}]`. |
| `npm test` and `npm run test:perf` pass, and the `hooks-prefilter` perf budget holds | **unverifiable**. The PR body says full-suite and perf runs were not checked. This review ran the four touched test files (1096 pass, 0 fail) but not `npm run test:perf`. PR CI (4 test shards + `test`) is green. |

Risk markers: none in the record (no Gotchas, ambiguity markers, or Open Questions).
Current-State outcome: **partial**. The diff reaches the redirect scan's `case` shape but not `scanHeredocs`, which the Current State names as the second walker. The `$(…; case` variant of the first shape still fabricates a target.

### Verification (from /test)
Not reached: Step 1.5 was skipped because the gate blocked. For reference, `verify.js --stamp-status` on HEAD shows `verifiedHead: true` from a scoped run (`scope: scoped`, `fullSha: c6f7915151`, `suiteComposed.complete: false`). Of the review's own runs, `node tools/run-tests.js tests/hooks-gate-coverage.test.js tests/hooks-bash-prefilter.test.js tests/hooks-4247-case-esac-suffix-pattern.test.js tests/hooks-4247-case-esac-tail.test.js` printed `ℹ tests 1096 / ℹ pass 1096 / ℹ fail 0`.

### QA Validation (from /test)
- **Status:** Not run (blocked at Step 1; no QA stories apply to this hook-parser change)

### Code Review Findings (confirmed)
Not run: Steps 2-7 were skipped because the gate blocked ("If blocked, skip the rest of the review"). Two gate-evidence observations are recorded for the rebuild, not routed as findings:
- `kd` stores each level's open-`case` count as one decimal digit, clamped by `Math.min(9, …)`. With 10 or more nested `case` words in one level, the count saturates, an `esac` drops it too early, and a pattern `)` can close the level. Today this only produces "no target" or the junk-target shape. A lexer with a real counter removes it.
- The `case`/`esac` word match accepts any of `[\s;&|(]` before the word. That includes words in argument position (for example `echo case`), which bash does not treat as reserved words. Over-counting only keeps the level nested, which is the documented fail-safe direction. Under-counting from a stray `esac` argument (`$(case $x in a) echo esac;; esac)`) is the risky direction.

### Implementation Hindsight
Not run (blocked at Step 1).

### Tradeoffs Accepted
None. The driver's "40-line limit" trade (incremental patch instead of the shared lexer) is **not** accepted by this review: it leaves deliverable 1 missing and the `$(true; case …)` false deny live.

### Visual Review
- **Status:** Skipped — no UI changes (hook parser and tests only)

### Verdict

**BLOCKED — issues need fixing**

Missing: deliverable 1 (the shared word-lexer read by both the redirect scan and `stripHeredocBodies`). Partial: deliverable 2 (`$(true; case $x in a) echo "p>q";; esac)` still resolves `/r/q;; esac)`), deliverable 3 (no `DIFFERENTIAL_CORPUS` entries, no old-vs-new corpus comparison), and the Current-State outcome. Unverifiable: the `npm test` + `npm run test:perf` / `hooks-prefilter` budget criterion.

No fixes were applied by this review. No commits were made and nothing was pushed. Draft PR #6225 is unchanged (not merged, closed, or marked ready). No verdict comment was posted, because this was a standalone invocation with no `$PIPELINE_RUN_DIR`.

### Key Learnings
1. The driver's per-step line limit made it ship an incremental patch in place of the record's first deliverable, and its PR body disclosed this. Spec compliance caught it, but tests could not: every pinned shape passes. For the #6021 trial, this argues for either a larger budget on records whose deliverable is a rewrite, or having the driver stop or park a record it can only partially build, instead of opening a PR that claims `Fixes #4247`.
2. Heuristic patches to a shell walker fix the exact strings in the record and miss the neighbouring shape (`$(true; case …)`, found with a single probe). Before accepting a parser fix, probe one variant per shape beyond the pinned literal.

### Next Actions

**`/claude-tweaks:build 4247`** — build the shared lexer (deliverable 1), add the differential-corpus entries and the old-vs-new corpus comparison (deliverable 3), and pin `$(true; case …)` (recommended)
