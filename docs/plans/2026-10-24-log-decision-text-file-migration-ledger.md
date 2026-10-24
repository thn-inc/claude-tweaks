# Open Items — Migrate the remaining git-text log-decision.js --text call sites to --text-file

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — fold pr-early-run-lifecycle.md deferred-closure and plan-authoring-checks.md AC-evidence --text sites into the final fix wave rather than a follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — scanner hardening (escaped inner quote, backslash-newline continuation) included in the final fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — close T1 deferred minors (exact-content match, single go-red branch, generic G1 anchor) per final-review triage: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — refine-record.md {choice(s)} carries free-text overrides; residual fix dispatched after the single fix wave: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — prose SKIP sites build/dispatch.md:17, flow/manifesto.md:167, flow/steps-and-gates.md:15 carry literal text only, no change: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | Task 1 minor: quoted --text check matches exact content only | accepted | Final-review triage: an edited-content revert drops the holding text so the uniqueness check throws, and the AC1.1 sweep catches it independently |
| 7 | build | Task 1 minor: only the quoted --text branch has a committed go-red | accepted | Final reviewer mutation-probed the citation and before branches red per site on the live tree; AC3 requires the --text revert control only |
| 8 | build | Task 1 minor: G1 anchor "the filled note line" is generic prose | accepted | A future collision makes the uniqueness check throw (fails loud, never silent) |
| 9 | build | Tasks 2-5 minor: verdict-backstop test array shim m=[null,…] | fixed | d6ad83063 — one regex ties --step to the holding clause |
| 10 | build | Tasks 2-5 minor: upstream-draft.md long unwrapped line | fixed | ea1415845 — rewrapped, no word change |
| 11 | build | Task 6 minor: GIT_TEXT unbounded file matched ceremony-profile | fixed | d6ad83063 — \bfile; architecture-alignment ALLOW entry deleted |
| 12 | build | Task 6 minor: ALLOW matched arg substring, not placeholder | fixed | d6ad83063 — (file, placeholder, fragment) triple + go-red |
| 13 | build | Task 6 minor: scanner blind to escaped inner quote and backslash-newline continuation | fixed | d6ad83063 — QUOTED_TEXT regex + go-reds |
| 14 | build | Task 6 minor: prose-only --text shapes in pr-early-run-lifecycle.md and plan-authoring-checks.md | fixed | ea1415845 + d6ad83063 — migrated to --text-file with SITES rows E1, Q1 |
| 15 | build | Final review minor: refine-record.md {choice(s)} not caught by GIT_TEXT | fixed | ee41a5bb5 — site migrated, SITES row B2, choice added to GIT_TEXT |
| 16 | build | Final review minor: prose SKIP sites with no text form (build/dispatch.md:17, flow/manifesto.md:167, flow/steps-and-gates.md:15) | accepted | Controller checked: fixed literal text, no git/user placeholder |
| 17 | build | plugin/skills/build/plan-authoring-checks.md at 52404/52500 B (96 B headroom, pre-existing near the Read-limit rail) | observation | Next editor must cut bytes or move a lazy section out before adding text |
| 18 | build | Prose commit ea1415845 alone leaves new SITES rows and the AC-evidence pin red until d6ad83063 | observation | Bisect-only concern; the PR squash-merges |
| 19 | build/skill | Extends `.claude/skills/skill-prose-conformance-tests` with a table-driven per-site pin + go-red through one shared `checkSite`, and a sweep guard whose allowlist keys on (file, placeholder, fragment) with a staleness test standing in for the skill's "take the sweep root as a parameter" walker proof | open | — |
