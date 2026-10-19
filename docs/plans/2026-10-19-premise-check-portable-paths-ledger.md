# Open Items — #2857: Make harness-health Premise-check paths portable across machines

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | repo-relative path starting with `-` reaches `test -r` as an operand — POSIX 2-arg test treats it as operand and grep has `--`, so likely benign | deferred | Whole-branch review triaged benign; no fix needed (SDD minor) |
| 2 | build | no direct test for a relative targetPath with root given (covered indirectly by repoRoot relative finding.path) | deferred | Whole-branch review: `path.resolve(root, targetPath)` covers it trivially; optional (SDD minor) |
| 3 | build | materialize.js comment uneven wrap after edit | deferred | Cosmetic (SDD minor) |
| 4 | build | resolveCheckoutRoot execFileSync without stdio lets git print "fatal: not a git repository" to stderr before degrading to null | deferred | Resolved in fix wave 5daaeac3c (`stdio: ['ignore','pipe','ignore']`) |
| 5 | build | Ruling: implementer reworded Task 1 journey step-3 red flag ("whose path isn't absolute" -> "whose path is relative") so the AC7.1 grep is clean | observation | Same meaning; re-review confirmed sentence correct — cost if wrong: one wording revert |
| 6 | build | Ruling: final-review Important #1 (sweep --root vs git top-level anchor mismatch) fixed by anchoring Premise-check paths and the filing-time self-check on the git top-level of root (root's own spelling); non-git root keeps absolute paths | observation | Fixed in 5daaeac3c, re-review ADDRESSED — cost if wrong: one more fix round on harness-health.js |
| 7 | build | Minor #3 parked: shared relativization helper for keyFiles vs buildPremiseCheck not built (deliberately different validity rules) | observation | Refactoring outside #2857 — cost if wrong: future drift between the two rules |
| 8 | build | parked: a symlinked --root resolves premiseRoot lexically through the link parent, composing a wrong path | observation | Fail-safe (reads unresolved, never falsely resolved), contrived input |
| 9 | build | parked: keyFiles stays relative to --root while Premise-check is relative to the git top-level, so they disagree on a sub-root sweep | observation | keyFiles is advisory metadata with no close risk |
