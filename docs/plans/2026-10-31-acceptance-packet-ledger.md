# Open Items — Acceptance packet: schema, canonical marker comment, new sections

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | flow | Step 2.6 shape check: cross-task dependency chain deeper than 3 (Task 1 → 2 → 3 → 6 → 9); proceeded under `auto` (tangled-task risk accepted) | open | — |
| 2 | flow | Step 2.5 pre-flight branch-divergence-check (run 2026-11-01T190532): origin/main was 2 commits ahead; continued under `auto`, caught up by the Post-creation catch-up merge | open | — |
| 3 | flow | Step 2.5 pre-flight branch-divergence-check (run 2026-11-01T204632): origin/main was 2 commits ahead; continued under `auto`, caught up by the Post-creation catch-up merge | open | — |
| 4 | flow | Step 2.5 pre-flight branch-divergence-check (run 2026-11-01T212059): origin/main was 1 commit ahead; continued under `auto`, caught up by the Post-creation catch-up merge | open | — |
| 5 | build | SDD ruling — C1: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 6 | build | SDD ruling — C2: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 7 | build | SDD ruling — C3: ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 8 | build | SDD ruling — C3: ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 9 | build | SDD ruling — C4: ratify or reverse at the Review Console (staged/sdd-ruling-5.md) | open | — |
| 10 | build | SDD ruling — C5: ratify or reverse at the Review Console (staged/sdd-ruling-6.md) | open | — |
| 11 | build | SDD ruling — C6: ratify or reverse at the Review Console (staged/sdd-ruling-7.md) | open | — |
| 12 | build | SDD ruling — C7: ratify or reverse at the Review Console (staged/sdd-ruling-8.md) | open | — |
| 13 | build | SDD ruling — C8: ratify or reverse at the Review Console (staged/sdd-ruling-9.md) | open | — |
| 14 | build | SDD ruling — C9: ratify or reverse at the Review Console (staged/sdd-ruling-10.md) | open | — |
| 15 | build | SDD ruling — C10: ratify or reverse at the Review Console (staged/sdd-ruling-11.md) | open | — |
| 16 | build | SDD ruling — C11: ratify or reverse at the Review Console (staged/sdd-ruling-12.md) | open | — |
| 17 | build | SDD ruling — C11: ratify or reverse at the Review Console (staged/sdd-ruling-13.md) | open | — |
| 18 | build | SDD ruling — R1: ratify or reverse at the Review Console (staged/sdd-ruling-14.md) | open | — |
| 19 | build | SDD ruling — R2: ratify or reverse at the Review Console (staged/sdd-ruling-15.md) | open | — |
| 20 | build | SDD ruling — also pinned: ratify or reverse at the Review Console (staged/sdd-ruling-16.md) | open | — |
| 21 | build | SDD ruling — implementer concerns 1 and 2 are correctness, fixed before review: ratify or reverse at the Review Console (staged/sdd-ruling-17.md) | open | — |
| 22 | build | SDD ruling — concerns 3 and 4 stand as implemented: ratify or reverse at the Review Console (staged/sdd-ruling-18.md) | open | — |
| 23 | build | SDD ruling — Important 1 (plan-mandated text-screen shapes): ratify or reverse at the Review Console (staged/sdd-ruling-19.md) | open | — |
| 24 | build | SDD ruling — Task 8's contract states the widened shapes and the per-escape decode, and that hosts compare by hostname, ignoring port: ratify or reverse at the Review Console (staged/sdd-ruling-20.md) | open | — |
| 25 | build | SDD ruling — link false positives (?sort_key=name, ?page-key=2) stand: ratify or reverse at the Review Console (staged/sdd-ruling-21.md) | open | — |
| 26 | build | SDD ruling — %ZZ%74oken=abc and the http:localhost and mailto:a@localhost allowedHosts inputs stand: ratify or reverse at the Review Console (staged/sdd-ruling-22.md) | open | — |
| 27 | build | SDD ruling — session_id, apikey and + as a space are fixed in round 2, keeping the 14-key constant and matching separator-insensitively: ratify or reverse at the Review Console (staged/sdd-ruling-23.md) | open | — |
| 28 | build | SDD ruling — a risk-proofs claim citing no proof fact is dropped, and one citing a failed or skipped check/story proof routes to Tried to break or Couldn't test whatever its wording: ratify or reverse at the Review Console (staged/sdd-ruling-24.md) | open | — |
| 29 | build | SDD ruling — a verified claim citing a failed link or recording stays kept: ratify or reverse at the Review Console (staged/sdd-ruling-25.md) | open | — |
| 30 | build | SDD ruling — credential screening stays Test-guide only per Q2, and a tested tried-to-break claim with a skipped ref moves to Couldn't test per the brief: ratify or reverse at the Review Console (staged/sdd-ruling-26.md) | open | — |
| 31 | build | SDD ruling — the contract also states the risk-proof rule from Task 2 (no proof fact drops; a failed or skipped check/story proof routes whatever its wording): ratify or reverse at the Review Console (staged/sdd-ruling-27.md) | open | — |
| 32 | build | SDD ruling — recording urls get the shared credential screen, and a refused one renders a stated refusal: ratify or reverse at the Review Console (staged/sdd-ruling-28.md) | open | — |
| 33 | build | SDD ruling — inline also neutralizes other autolinks (any scheme URL, email, @mention, #12, owner/repo#12) as code spans: ratify or reverse at the Review Console (staged/sdd-ruling-29.md) | open | — |
| 34 | build | SDD ruling — secrets in free text outside commands and Test-guide claims (a check reason, a tried-to-break claim) stay unscreened: ratify or reverse at the Review Console (staged/sdd-ruling-30.md) | open | — |
| 35 | build | SDD ruling — render exits 1 and posts nothing when chars exceeds MAX_PACKET_CHARS after truncation, and --dropped-out holds section and key only for screened entries, never claim text: ratify or reverse at the Review Console (staged/sdd-ruling-31.md) | open | — |
| 36 | build | SDD ruling — gather normalizes surface to the lowercase enum before writing facts: ratify or reverse at the Review Console (staged/sdd-ruling-32.md) | open | — |
| 37 | build | SDD ruling — GH-12, bare SHAs and owner/repo@sha stay live: ratify or reverse at the Review Console (staged/sdd-ruling-33.md) | open | — |
| 38 | build | SDD ruling — parseAcceptanceCriteria also reads 1), bold-number, bulleted and checkbox criteria with positional ids, tolerates ### and suffixed headings, and a spec with zero parsed criteria gets a stated partial note: ratify or reverse at the Review Console (staged/sdd-ruling-34.md) | open | — |
| 39 | build | SDD ruling — --ac-results keys use parseAcceptanceCriteria's ids, including positional ones for bulleted criteria, and the prose says so: ratify or reverse at the Review Console (staged/sdd-ruling-35.md) | open | — |
| 40 | build | SDD ruling — a settled staged finding (dismissed or dropped with no tiebreak) is excluded from Least confident, filtered before numbering: ratify or reverse at the Review Console (staged/sdd-ruling-36.md) | open | — |
| 41 | build | SDD ruling — parseStoryFile runs per file and its results are concatenated, never the joined text; storyResults ids may be null: ratify or reverse at the Review Console (staged/sdd-ruling-37.md) | open | — |
| 42 | build | SDD ruling — the post CLI wires pinGhHost and joins PIN_WIRED: ratify or reverse at the Review Console (staged/sdd-ruling-38.md) | open | — |
| 43 | build | SDD ruling — the contract says earliest by createdAt, not by comment id: ratify or reverse at the Review Console (staged/sdd-ruling-39.md) | open | — |
| 44 | build | SDD ruling — AC 2a's planned stories are read through Decision Q13: ratify or reverse at the Review Console (staged/sdd-ruling-40.md) | open | — |
| 45 | build | SDD ruling — snapshot never overwrites an existing manifest from the main checkout whatever mergeBase says, widening the brief's guard: ratify or reverse at the Review Console (staged/sdd-ruling-41.md) | open | — |
| 46 | build | SDD ruling — the prose passes --stories-dir always and stops on any non-zero render exit: ratify or reverse at the Review Console (staged/sdd-ruling-42.md) | open | — |
| 47 | build | SDD ruling — a parent target also reads a packet, with no parent guard, reading Q1's unchanged as 'unchanged when no packet is present': ratify or reverse at the Review Console (staged/sdd-ruling-43.md) | open | — |
| 48 | build | SDD ruling — Task 11 also updates docs/skill-graph.md for the new contract and its lines 249 and 707 that describe the brief: ratify or reverse at the Review Console (staged/sdd-ruling-44.md) | open | — |
| 49 | build | SDD ruling — the parent-gate file's Fail-open paragraph and Resolve-the-parent no-parent branch also move to the packet, and a note ahead of the verbatim template says which file its Try it block and Step references mean: ratify or reverse at the Review Console (staged/sdd-ruling-45.md) | open | — |
| 50 | build | SDD ruling — packet-post.js gets its DEMO_LABEL_READERS row in tests/accept-label-reader-conformance: ratify or reverse at the Review Console (staged/sdd-ruling-46.md) | open | — |
| 51 | build | SDD ruling — Step 3 builds a Try it url as the local base URL plus the route, falls back to a command fact when no base URL resolves, and gives each Try it group its own link id: ratify or reverse at the Review Console (staged/sdd-ruling-47.md) | open | — |
| 52 | build | SDD ruling — AC6's 'five call sites' reads as every row of the Routing table, six today: ratify or reverse at the Review Console (staged/sdd-ruling-48.md) | open | — |
| 53 | build | SDD ruling — below-floor records newly get a timing PR comment because Step 4's timing line runs whatever the packet's outcome; it stands: ratify or reverse at the Review Console (staged/sdd-ruling-49.md) | open | — |
| 54 | build | SDD ruling — /demo reads the packet on any record that has one, not only a label-backed one: ratify or reverse at the Review Console (staged/sdd-ruling-50.md) | open | — |
| 55 | build | SDD ruling — reverses the Task 2 and Task 3 screening rulings: ratify or reverse at the Review Console (staged/sdd-ruling-51.md) | open | — |
| 56 | build | SDD ruling — evidence screenshots stay plain links, and the contract says so: ratify or reverse at the Review Console (staged/sdd-ruling-52.md) | open | — |
| 57 | build | SDD ruling — a re-run replacing a rich packet with a thin one, and a failed below-floor post invisible to verify, both stand: ratify or reverse at the Review Console (staged/sdd-ruling-53.md) | open | — |
| 58 | build | SDD ruling — raw tokens with no key shape (ghp_..., a bare Bearer abc) are not screened in this record; a capture follows: ratify or reverse at the Review Console (staged/sdd-ruling-54.md) | open | — |
| 59 | build | SDD ruling — residuals after the fix wave's re-review get one targeted fix plus one scoped re-review, as build/dispatch.md authorizes for fix-now items: ratify or reverse at the Review Console (staged/sdd-ruling-55.md) | open | — |
| 60 | build | packet-render.js:119-121 a claim whose only citation is withheld renders doubled parentheses ((id withheld: credential-shaped)); render one pair and pin it | open | — |
| 61 | build | packet-post.js:206 removing an orphan on a CRLF body last line with no final newline leaves a bare CR; strip it | open | — |
| 62 | build | acceptance-packet.md:63-67 state that a lone end delimiter stays as text, and where the packet lands when an orphan start comes first | open | — |
| 63 | build | packet-render.js:291-309 a plan key line with no value (--api-key) followed by a same-indent sibling holding the value still publishes it (- --api-key then - SECRET); drop the next line when the key ends its line with no value, with a CLI test | open | — |
| 64 | build | packet-render.js:254 screening an edge plan line brings back blank edges; trim them after the filter | open | — |
