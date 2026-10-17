# Journey Health — Step 3.5 Deep Tier

Full procedure for `/journey-health`'s deep tier, run only when `--deep` was passed. Cited from
`SKILL.md`'s Step 3.5 rather than restated there, so `SKILL.md` stays lean and this procedure is
lazy-loaded only when `--deep` is actually passed.

**Step 3.5 — DEEP TIER (only when `--deep` was passed).**

`--dry-run` does not gate anything in this step — sub-steps 1-2 below still resolve a real dev URL and drive a real `/claude-tweaks:test` or `/claude-tweaks:visual-review` run when reached; only Step 5's `validate-findings` and Step 6's filing respect `--dry-run` (see Input).

Re-resolve the target for the deep tier — deep and light tiers use independent cursors, so re-run Step 1's `next-target` call with `--tier deep` (this may select a different journey than Step 1's light-tier pick, or the same one, depending on each tier's own churn/staleness state):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" next-target --root "${ROOT:-$PWD}" --tier deep ${TARGET:+--target "$TARGET"}
```

If `target` is `null`, report "nothing due for the deep tier" and skip the rest of this step.

**Skip condition:** read the selected journey's `files:` frontmatter. If any entry doesn't exist on disk, skip the deep tier for this journey entirely — file-existence drift must be fixed (via the light tier's finding, already emitted in Step 2) before a live run is worth attempting. Do not advance the deep-tier cursor when skipping this way; log the gap.

Otherwise:

0. **Check for recent QA evidence.** Glob `.claude-tweaks/artifacts/screenshots/qa/*/report.json`, take the most recent by timestamp prefix. If none exists, skip to sub-step 1. Read the stories directory and collect the `id` of every story with `journey: {target.id}`, reusing `_shared/journey-coverage-check.md`'s cross-reference (don't recompute it independently). If the journey has no stories at all, skip to sub-step 1 — there is no possible QA evidence to check.

   Otherwise, read that report.json and run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/journey-health.js" qa-evidence <report.json path> --story-ids "<comma-separated story ids>"
   ```
   This prints `{ verdict: "satisfied"|"regression"|"inconclusive", finding?: {...}, reason?: "..." }`.
   - `verdict: "satisfied"` — the deep audit is satisfied by this evidence. Skip sub-steps 1-3 entirely (no dev URL, no live test/visual-review). The deep findings array stays empty. Continue to sub-step 4.
   - `verdict: "regression"` — take the printed `finding`, add `journey: target.id` to it, append it to the deep findings array. Skip sub-steps 1-3 entirely. Continue to sub-step 4.
   - `verdict: "inconclusive"` — fall through to sub-step 1 and drive live verification as normal. The `reason` is worth noting in the eventual summary, but does not block proceeding.

1. **Resolve a dev URL.** Follow `_shared/dev-url-detection.md` in auto mode — this starts an ephemeral server on a free port with no prompt when no server is already running and a dev command is known. Record whether this procedure started the server (`SERVER_STARTED`).
2. **Check for story coverage.** Read the stories directory for any story with `journey: {target.id}`.
   - Stories exist → drive `/claude-tweaks:test qa journey={target.id}` against the resolved dev URL.
   - No stories → fall back to `/claude-tweaks:visual-review journey:{target.id}` against the resolved dev URL.
3. **On failure, judge drift vs. regression** — don't assume either. Compare the failure evidence (a changed selector, a renamed route, a UI element that no longer exists) against the journey file's documented steps:
   - **Confirmed drift** (the app's structure changed and the journey/story text is what's stale): emit `{ journey: target.id, category: "drift", section: "live-check", description: "<what changed>", reason: "<the failure evidence>", confidence: "high"|"med", severity: "high"|"med", recommendation: "Run /claude-tweaks:journeys {target.id} — <what needs updating>" }`. `severity: "high"` when the journey can no longer complete at all; `"med"` for a partial or cosmetic break.
   - **Confirmed regression** (the app's actual behavior broke, journey/story text still accurately describes the intended flow): emit `{ journey: target.id, category: "regression-suspected", section: "live-check", description: "<what broke>", reason: "<the failure evidence>", confidence: "high"|"med", severity: "high"|"med", recommendation: "File as a product bug — journey/story text is accurate, the implementation regressed" }`. Same severity guidance as the drift case above.
   - If genuinely ambiguous, emit the drift-leaning finding with `confidence: "med"`, `severity: "med"`, and say so explicitly in `reason` — never silently pick one.
4. **Clean up.** If `SERVER_STARTED` is `true`, stop the ephemeral server now (`lsof -ti tcp:{port} | xargs kill`) — this is a standalone invocation with no `/wrap-up` to do it later, per `_shared/dev-url-detection.md`'s "Standalone" cleanup rule. (`SERVER_STARTED` is never `true` when sub-step 0 satisfied or resolved the deep tier via QA evidence, since sub-step 1 never ran on that path — this cleanup correctly no-ops.)

Write Step 3.5's findings to `$JH_F_DEEP` (session-scoped `jh-findings-deep.json`, session-tmp-root.md) whenever the **Otherwise:** block above ran — including an empty array `[]` (the QA-evidence-satisfied path and a clean live-verification pass both produce no findings, but the file must still be written so the deep-tier call below runs and the cursor advances). Skip creating this file entirely only when Step 3.5 didn't run at all (`--deep` wasn't passed), resolved `target: null`, or hit the **Skip condition** (missing declared file) — none of those three cases reach the **Otherwise:** block, and none of them should advance the deep-tier cursor.
