# Open Items — Finish `/claude-tweaks:design`: parts and estimate, approval, and filing the parts through decomposition as written

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD ruling — Keep the WORTH_IT_HEADING export; non-numeric local-files id moot: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 2 | build | SDD ruling — check-approval takes --repository for unparsed cloud proxy origins; gate not widened: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 3 | build | SDD ruling — Collapse count is the whole approved list across every repository: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 4 | build | SDD ruling — Approval check first in Step 1; post-create gates keep the part, clear ready: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 5 | build | SDD ruling — Restore the cut CLAUDE.md sentence only if bytes exist in the Artifacts wording: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 6 | build | SDD ruling — CLAUDE.md "Costing less to run" sentence stays cut (budget cap): ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 7 | build | SDD ruling — Repository-aware status; symbolic-blocker sub-issues filed without ready: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 8 | build | SDD ruling (procedural) carried as audit, not staged: Residuals R1-R4 got one targeted fix plus one scoped re-review | observation | — |
| 9 | review | Review fixes (low/info): parts.js:94 shared section scan, design-session.js:7 header, parts.js:289 markFiled short-row conflict, parts.js:219 digest rationale, tests for parts.js:220/250/117 and the SIZES pin at parts.test.js:278 | fixed | Applied in 441cd5806; targeted design-session, ambiguity-resolve and conformance suites green |
| 10 | review | Medium Architecture at ambiguity-resolve.js:52: the no-ready-with-symbolic-blocker rule lives only in readyRestorable; shapeGate and its other callers never check the left-for line | accepted | Digested (genuinely-larger, rule no-evidence): needs a ready-grant gate distinct from shapeGate, since validateShaped must accept the line at create time — https://github.com/thn-inc/claude-tweaks/issues/5046#issuecomment-7236901132 |
| 11 | review | Not fixed: SKILL.md:133 restated specify edge (low), ambiguity-resolve.js:10 issues-lib import of SYMBOLIC_LINE_RE (low), parts.js:64 repo regex variant (info), specify-approved-parts-conformance.test.js:58 verbatim pins (info) | accepted | Intentional patterns: Component-Skill Contract naming its one invoked skill is the house pattern and is test-pinned; one definition of the symbolic line beside its only producer; info findings were awareness-only with tiebreak recommendation drop |
