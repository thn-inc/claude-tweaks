# Open Items — Unify the line-anchored section-heading rule across release-note-repair, near-duplicate and compose-record (#4561)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | splitSections (compose-record/compose.js) fenced-heading test covered backtick fences only, not tildes | fixed | Tilde-fence case added in 62947e5bb (tests/bin-lib/compose-record/compose.test.js) |
| 2 | build | apply.js refusal tests asserted RepairError class only, not the message | fixed | Message assertions (/unterminated/, /ambiguous/) added in 62947e5bb (tests/bin-lib/release-note-repair/apply.test.js); this gap hid the final review's Important 1 |
| 3 | build | splitSections now opens a ''-keyed section on a bare '## ' line and reads '##<tab>' and CRLF headings | accepted | Intended consequence of the shared heading-line rule (headingLine); the old CRLF behavior read no headings at all, so CRLF is a fix. Listed with the other behavior changes in the PR Release Note per the sdd-ruling on the spec Release Note |
| 4 | build | shared-heading-rule.test.js OWN_RULE_RE still misses named-group, /^\x60{3}/ and string-built new RegExp('^## ') shapes | accepted | None of these shapes exists in the five scanned modules; the scan is a backstop behind the per-caller behavior tests, and the two common missed shapes ((?:\s{0,3})# and (^\|\n)## ) were added in 62947e5bb |
| 5 | build | Residual: an authored unclosed fence plus a fence closer inside the verbatim Original request text plus a later quoted unfenced '## Original request' still inserts the note inside the verbatim section (apply.js) | observation | Parked by SDD ruling: structurally identical to the ruled AC3.1 positive case, needs three malformed conditions at once, and the post-write verify reports the diff; final whole-branch review agreed (can-wait) |
| 6 | build | SDD ruling — implementers add the missing sectionText/findSection test imports: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 7 | build | SDD ruling — scanFences comment kept naming later-task consumers during Task 1: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 8 | build | SDD ruling — Task 2 AC2.1 pin is characterization; red-first proof is the Task 5 source scan: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 9 | build | SDD ruling — Original request boundary edge deltas (tab/multi-space separator, U+2028) documented, no code change: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 10 | build | SDD ruling — apply.js refuses a body whose only ## Original request heading is fenced: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 11 | build | SDD ruling — two Task 5 apply tests pin existing behavior and were never red: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 12 | build | SDD ruling — the PR Release Note states the behavior changes instead of the spec line No user-visible change: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 13 | build | SDD ruling — merge-gate.js record heading regexes move to the shared rule in a follow-up record: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
