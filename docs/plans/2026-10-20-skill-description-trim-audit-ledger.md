# Open Items — #2799: Trim skill/AGENTS.md descriptions per newer-model guidance

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor: `docs/skill-graph.md` visualize ← `/review` row claimed `--source review`, which review's own prose does not pass | fixed | Reworded to the informational doc-freshness recommendation — `36fc7829a` |
| 2 | build | SDD minor: audit doc's "listing budget shared with every other installed plugin's skills" was unsourced | fixed | Hedged as an inference decision 0024 does not state — `36fc7829a` |
| 3 | build | SDD ruling — keep the `browse` description trim (removed "defines session naming, screenshot/trace paths…"); playwright-cli anchor still separates it from the other browser skills: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |
| 4 | build | SDD ruling — `docs/skill-authoring.md` edge clause gets a trigger/same-name carve-out, and `ledger`'s consumer-list clause is marked needs-human-judgment rather than trimmed: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |
| 5 | build | SDD ruling — keep the `qa-agent` row in the audit doc's Skill-headed table (the plan's coverage probe requires it; prose explains it): ratify or reverse at the Review Console (staged/sdd-ruling-3.md) | open | — |
| 6 | build | SDD ruling — leave the plan's Task 1 Step 5 `node -e` (refused by the worktree guard because it names `git`; the equivalent check ran from a scratch script): ratify or reverse at the Review Console (staged/sdd-ruling-4.md) | open | — |
| 7 | build | Pre-existing drift: `plugin/skills/visualize/SKILL.md` (lines 14-15, 49, 90) lists `/review` as a `--source review` soft-hook caller, but `plugin/skills/review/step3-doc-freshness-lens.md:35` only recommends `/claude-tweaks:visualize {type} {topic}` with no `--source` — route at wrap-up (fix one side or capture) | open | — |
