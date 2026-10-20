# Open Items — Review's reproduction-pair disagreement handling should ground-truth-check a mechanically-falsifiable 'code is missing' claim

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build/review | Follow-up (pre-existing gap, surfaced by #3329's whole-branch review): a lens agent's `BLOCKED`/`NEEDS_CONTEXT` reply reason is not a `findings` row, so it never passes `categorise-reproduction` — `step3-lens-dispatch.md` has no routing rule for a lens agent's BLOCKED reply beyond the session-limit partner-death case. Capture as a backlog record (Current State / Deliverables / AC). | open | — |
| 2 | build | SDD minor (deferred): `assertBullet` in `tests/review-absence-claim-ground-truth-conformance.test.js` pins phrases independently; a logic-reversing rewrite that keeps every phrase would pass (judged proportionate for a prose suite by task and whole-branch review). | deferred | — |
