# Open Items — Extend sdd-ruling-* ratify/reverse to the PR-hosted and multi-spec Review Consoles

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | Follow-up (final whole-branch review Important 2): `resolve-console` / `console-execute.js` records a reversed `sdd-ruling-*` item as `declined, no reason given` in the PR reply comment and leaves Resolve unticked ("not every item cleared") — `console.json` items carry no staged path or ruling flag to tell a ruling apart. Needs a `console.json` ruling flag written by `_shared/console-on-pr.md`'s render + a reverse outcome in `resolveConsoleExecution`/`decideConsoleExecute` (code + schema change, outside #3513's prose-only scope). Candidate born-ready record. | open | — |
