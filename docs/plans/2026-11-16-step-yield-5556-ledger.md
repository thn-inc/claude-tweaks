# Open Items — Write a step yield file per closed run: what each step cost and produced (#5556)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | ops | Pre-flight branch-divergence-check: origin/main was 1 commit ahead at Step 2.5; caught up by the post-adopt merge | fixed | Merged origin/main into the worktree branch at c0658f7dfa (Post-creation catch-up) |
| 2 | build | SDD ruling — T4's cant-tell fixture finding carries severity medium (or higher) so resolveTiebreak writes a `console:` line: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 3 | build | SDD ruling — per-task affected runs use the fallback set (touched-path tests plus importers) instead of verify.js impact se: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 4 | build | SDD ruling — step3-tier-variants.md:17's single-read coverage line is an eighth Reproduction producer: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 5 | build | SDD ruling — phase attribution uses per-occurrence spans: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 6 | build | SDD ruling — decision-line clock placement is monotone within a ## section (placeEntry appends at the section end): ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 7 | build | SDD ruling — judge: none is matched only before the first " Evidence: ": ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 8 | build | SDD ruling — a legacy line naming more than one finding or verdict is not a pair line and counts as unparsed; every free le: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 9 | build | SDD ruling — direct-verification-elevated is a relabel (0/0/+1): ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 10 | build | SDD ruling — strict-tier lens keys stay verbatim: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 11 | build | SDD ruling — CLOCK_RE 99:99 minor needs no change: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 12 | build | SDD ruling — span-end instants (a merge commit at the merge span end) attribute to the span ending there, in step-yield onl: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 13 | build | SDD ruling — HEAD_LOOSE restricted to an archive-measured writer-label allow-list: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 14 | build | SDD ruling — the writer-label allow-list applies to both the strict and loose pair-line heads (strict takes a colon-termina: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 15 | build | SDD ruling — STATUS_HEAD widened to read a no-seconds clock, a hyphen separator and a bare date: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 16 | build | SDD ruling — the terminal close-run event, ending the last span, counts in that step's events rather than unattributed.even: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 17 | build | SDD ruling — a close logs at most one timing-family SKIP; a step-yield.json dropped because the close bound ran out is name: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 18 | build | SDD ruling — ISO-timestamp status heads before Reproduction: stay unread (no change): ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 19 | build/skill | parse-signal-discipline extends: a signal line read from an append-only log is also quoted or carried forward by later writers (wrap-up carry-forward, routing notes), so a reader counting signals keys on a measured writer-label allow-list, not any label before the token (pair-lines.js WRITER_LABEL, #5556) | open | — |
| 20 | review | Security (low) at plugin/bin/lib/timing/step-yield.js:102 | fixed | Fixed at b62b1627f5: a lens or event-type key of __proto__/constructor from log text was stored on a plain object, dropping or corrupting counts: own-key helpers (ownGet/ownSet) |
| 21 | review | Security (low) at tools/step-yield-report.js:110 | fixed | Fixed at b62b1627f5: a lens key of constructor/toString/__proto__ threw inside the report accumulator: own-key accumulator |
| 22 | review | Error (low) at plugin/bin/lib/timing/at-close.js:173 | fixed | Fixed at b62b1627f5: a yield lock miss inside the bound logged nothing: it now carries its SKIP text, folded into the close's one line |
| 23 | review | Error (low) at plugin/bin/lib/timing/at-close.js:222 | fixed | Fixed at b62b1627f5: a throwing yield logged its own SKIP beside the timing SKIP: one folded timing-family line per close |
| 24 | review | Error (low) at tools/step-yield-report.js:42 | fixed | Fixed at b62b1627f5: an unreadable root was skipped silently: named on stderr, listed in rootsUnreadable, exit 2 |
| 25 | review | Architecture (low) at plugin/bin/lib/timing/step-yield.js:143 | fixed | Fixed at b62b1627f5: the Evidence delimiter and judge-none rules moved into pair-lines.js (entryLine, isJudgeNone) |
| 26 | review | Architecture (low) at plugin/bin/lib/calibration/decisions-classifier.js:11 | fixed | Fixed at b62b1627f5: classifyDecisionLine restored to base behavior; the lenient reading is an opt-in used by step-yield only |
| 27 | review | Test (low) at tests/bin-lib/timing/step-yield.test.js:27 | fixed | Fixed at b62b1627f5: temp run dirs are tracked and removed in an after hook |
| 28 | review | Test (low) at tests/step-yield-report.test.js:93 | fixed | Fixed at b62b1627f5: temp roots are tracked and removed in an after hook |
| 29 | review | Performance (low) at plugin/bin/lib/timing/pair-lines.js:132 | fixed | Fixed at b62b1627f5: absence-refuted and vacuity-reconfirmed strict patterns split at their delimiters, linear on repeated-delimiter lines (11741 ms to 1.6 ms at 22 KB), with a bounded-time test |
| 30 | review | Architecture (medium) at plugin/bin/lib/timing/at-close.js:343 | fixed | Fixed at b62b1627f5: writeIn and writeYieldIn share underTimingLock, which owns the lock, vacated check and both releases |
| 31 | review | Test (low) at plugin/bin/lib/timing/step-yield.js:65 | fixed | Fixed at b62b1627f5: the AC8.2 test checks every emitted leaf's type and nullability against KEY_PATHS |
| 32 | review | Test (low) at plugin/bin/lib/timing/step-yield.js:83 | fixed | Fixed at b62b1627f5: tests pin the five-sample cap and the 200-character truncation |
| 33 | review | Docs (low) at plugin/bin/lib/timing/pair-lines.js:26 | fixed | Fixed at b62b1627f5: dangling plan citations replaced by inline rules and named doc sections |
| 34 | review | Docs (low) at plugin/bin/lib/timing/step-yield.js:126 | fixed | Fixed at b62b1627f5: dangling plan citation replaced by a pointer to the Tiebreak lines table |
| 35 | review | Docs (low) at plugin/bin/lib/timing/at-close.js:189 | fixed | Fixed at b62b1627f5: the archive-twin second release is explained once inside underTimingLock |
| 36 | review | Test (low) at tests/bin-lib/timing/step-yield-schema.test.js:70 | fixed | Fixed at b62b1627f5: liveYield is a memoized getter, not computed at module load |
| 37 | review | Architecture (low) at plugin/bin/lib/timing/derive.js:425 | accepted | Not fixed: deliberate: per-occurrence span attribution is the as-built reading already staged as SDD ruling 4 (ledger row 5) for the Review Console to ratify or reverse |
| 38 | review | Test (low) at tests/bin-lib/timing/step-yield-schema.test.js:76 | accepted | Not fixed: the two key-path walkers give identical results for every real key (no status, action, verdict, outcome or lens equals a MAPS field name); sharing a helper would couple two test files |
| 39 | review | Test (info) at tests/bin-lib/timing/step-yield.test.js:355 | accepted | Not fixed: positive observation (AC9 is discriminating), not a defect |
| 40 | review | Error (low) at plugin/bin/lib/timing/derive.js:460 — fix agent noted countGuardEvents reads GUARD_TYPES[e.type] on a plain object | fixed | Fixed in the next commit: own lookup via Object.hasOwn, with a test; same class as the own-key fix |
| 41 | review/hindsight | [skill: parse-signal-discipline] a map keyed by text parsed from a log line or event (lens, event type, action) must read and write own properties only (Object.hasOwn plus defineProperty): __proto__ vanishes and constructor reads an inherited value; keep ordinary {} so deepStrictEqual still holds (step-yield.js ownGet/ownSet, #5556) | open | — |
| 42 | review/hindsight | [skill: regex-scan-linearity] a strict log-line pattern with several unanchored .+ groups is super-linear on a line repeating its own delimiter (absence-refuted measured 11741 ms at 22 KB): split at the first delimiter with negated classes and pin a repeated-delimiter probe in the pattern test (pair-lines.js, #5556) | open | — |
