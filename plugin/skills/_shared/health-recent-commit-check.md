# Recent-commit overlap check (canonical shape)

Cited by all five filing call sites — `code-health/filing.md`, `harness-health/filing.md`, `docs-health/SKILL.md`, `journey-health/SKILL.md`, and `capture/SKILL.md` — rather than restated per caller (spec #1316's Gotchas: "duplicating the grep/similarity logic per sweep skill would drift").

**Why.** #1068 was filed describing exactly the symptom commit `73478c8b` (refs #959) had fixed the day before — nothing caught the near-duplicate before it reached `ready` and burned a worktree/draft PR on a build that had nothing left to do. This check is the gap-closer: before a new finding/capture reaches `ready`, screen it against recently-merged commits.

**What it is.** A heuristic screen, not a verdict — AC2 requires the false-positive rate to stay low enough that this never becomes filing-time noise, so a match surfaces for human triage (a comment on the new record) rather than holding or blocking filing. `findRecentCommitOverlap` (`bin/lib/issues/recent-commit-check.js`) derives key terms from the finding's own title (or accepts explicit `terms`/`files`), greps a `git log` of the last `lookbackDays` (default 14) for commit subjects overlapping enough of those terms, and returns the strongest matches or `null`. Pure and local-only — reads `git log`, never the network — and fails toward `null` on any git failure (not a repo, no git on PATH): this check must never block or delay filing over its own inability to resolve an answer.

**When it runs.** Immediately after `gh issue create` succeeds for a new record (never for a `reopen` of an existing issue, and never twice for the same payload — a retry-queue drain replaying a payload already screened on its first `gh issue create` attempt skips this a second time). Using the issue number `gh issue create` reported:

```bash
node -e "
const { findRecentCommitOverlap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/recent-commit-check');
const result = findRecentCommitOverlap({ root: process.env.ROOT || process.cwd(), title: process.argv[1] });
console.log(JSON.stringify(result));
" "<payload.title>"
```

**On a non-null result** (`result.commits` is sorted newest-first — `{sha, subject, date, matchedTerms}` per entry), post one triage comment on the just-created issue, naming up to the first 5 commits:

```bash
gh issue comment <new_issue_number> --body "Possible overlap with a recently-merged commit — a human should confirm this finding is still live before build:

- \`<short sha>\` <subject> (<date>)
[... up to 5 commits]

Filed by the recent-commit overlap check (#1316) — a heuristic screen, not a verdict. If a commit above already fixes this, close as a duplicate; otherwise disregard this comment."
```

**On a `null` result** (no match, or the check itself failed): no comment, no other action — proceed exactly as if this step didn't exist. Never let a `git`/`node` failure inside this step block, delay, or fail the surrounding filing loop — catch and log, then continue to the next payload, matching the fail-open posture the retry-queue/regressed-reopen mechanics already use elsewhere in the same filing step.

**Lookback window.** Default 14 days (the module's own `DEFAULT_LOOKBACK_DAYS`), matching the spec's own suggestion. Not currently exposed as a per-project config knob — the lookback window and match-strength threshold are tuning knobs with no measured baseline yet (spec #1316's Gotchas); every call site uses the module's own default until real filing-time signal justifies promoting it to `.claude-tweaks/policy.yml`.
