# Open Items — Split test/verification.md — it sits 12 bytes under the 52,500 B Read rail

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Task 1's targeted run may show the AC3.1 external-citation test red until Task 2 lands; batched execution gates the combined diff: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
| 2 | build | SDD ruling — implementer ran only the named targeted suites, not the full `npm test`; /build Common Step 5 runs the full suite centrally via verify.js: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | |
| 3 | build | SDD ruling — plan defect (stub text "Read …" vs test's lowercase "read `flake-handling.md` in this skill's directory"): accepted the implementer's condition-first reorder: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | |
| 4 | build | SDD ruling — AC3.1 grep scope widened from plugin/docs/tests to the whole repo; repointed `.claude/skills/node-test-output-evidence/SKILL.md:133`: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | |
| 5 | build | SDD ruling — ran the one final fix wave for the final review's two minors plus the heading-level pin: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | |
| 6 | build | flake-handling.md "this file is shared by /build, /test, /deepen, /simplify" now refers to flake-handling.md, not verification.md (byte-identity constraint forced it) | accepted | Final whole-branch review triaged "leave": still true one step removed (all four load it via verification.md); AC4.1 forbids rewording beyond anchors |
| 7 | build | flake-handling.md "the pre-existing adjudication" lost its location qualifier with the move | accepted | Final whole-branch review triaged "leave": equally unqualified before the move; the same paragraphs name verification.md's "Isolating pre-existing failures by file" / "Pre-existing failures" |
| 8 | build | tests/verification-flake-handling.test.js did not pin heading level (`includes('# Flake handling…')` matched `###`) | fixed | cf8eea7a7 — anchored multiline regexes for all three headings |
| 9 | build | The plan file and journey history lines still carry the literal "Flake handling" heading name | accepted | Final whole-branch review triaged "leave": journey lines name the new location "(now `test/flake-handling.md`)" and the plan describes the move; AC3.1 targets citations pointing at a heading inside verification.md, and none do |
