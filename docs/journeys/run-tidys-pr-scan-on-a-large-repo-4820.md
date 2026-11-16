---
files:
  - plugin/skills/_shared/github-pr-scan.md
  - plugin/skills/_shared/github-pr-scan-triage.md
  - plugin/bin/lib/policy-schema.js
---

# Run Tidy's PR Scan on a Large Repo

**Persona:** a maintainer of a repo with a few hundred open issues and nearly two thousand PRs, who reads `/claude-tweaks:tidy`'s and `/claude-tweaks:help`'s queue counts to decide what to grant next. On a sweep, the grant queue read 54/0/16 when the real counts were 83/0/21, because the open-issue fetch stopped at 200 of 308 and nothing said so.

**Goal:** every count the PR scan reports is either complete or visibly marked as a floor, and the maintainer can raise one policy key to make it complete.

**Entry point:** `/claude-tweaks:tidy` Step 4.8 or `/claude-tweaks:help`'s status scan, which run `_shared/github-pr-scan.md`'s `current-pr` and `repo-wide` scopes and `_shared/github-pr-scan-triage.md`'s `triage-queue` scope.

**Success state:** at the default `backlog-fetch-limit` (1000), the `[queue]` row counts all 308 open issues and prints no warning. On a repo past the cap, the affected count reads `{N}+` and a `WARNING:` line sits beside that scope's rows, verbatim.

## Steps

### 1. Every list fetch is sized from `backlog-fetch-limit`
- **URL:** `github-pr-scan.md` and `github-pr-scan-triage.md`, each scope's **Fetch limit** paragraph, and every `gh issue list`/`gh pr list` call below it
- **Action:** the scan agent runs `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit` once and substitutes the printed number literally for every `{resolved-limit}` in that scope's commands and node blocks, since shell state does not survive between Bash calls.
- **Should feel:** like one dial. The maintainer changes one key in `.claude-tweaks/policy.yml`, and every PR-scan fetch follows it; the key's summary in `plugin/bin/lib/policy-schema.js`, `_shared/policy-schema.md` and `work-record-config.md` say so.
- **Should understand:** the same key also caps `_shared/record-queue-fetch.md`'s backlog pulls, so raising it widens both.
- **Red flags:**
  - A fixed `--limit 50`/`--limit 200` left in either file.
  - `LIMIT=$(node resolve-policy.js …)` computed inside a `gh` fence instead of substituted literally.

### 2. A fetch at its cap warns instead of truncating silently
- **URL:** `repo-wide` item 8 (grant-queue metrics), item 10 (unsettled runs), and `triage-queue` item 1
- **Action:** a node block compares the fetched row count with the cap: `LIMIT` for an unfiltered list, `Math.min(LIMIT, 1000)` for a `--label` list (GitHub's 1000-row cap). At or above it, the block prints a `WARNING:` line naming the scope and the fetch. The maintainer sees that line verbatim beside the scope's rows.
- **Should feel:** trustworthy. Silence means the count is complete; a warning means act.
- **Should understand:** a `--label` fetch warns at 1000 even with the limit set higher, because raising the limit past GitHub's cap does not help.
- **Red flags:**
  - An `=== LIMIT` comparison, which stays silent once the limit is above 1000.
  - A `WARNING:` line dropped from the rendered report.

### 3. A capped count renders as a floor
- **URL:** the Output Contract's `[queue]` row, and each scope's Fetch limit paragraph ("any other count at the cap is a floor")
- **Action:** a count whose fetch hit the cap renders as `{N}+`, e.g. `[queue] 54+ pending authorization, 0+ bot:blocked, 16+ backlog` for the sweep above.
- **Should feel:** honest about what is unknown, without hiding the number that is known.
- **Should understand:** `{N}+` means at least N; raising `backlog-fetch-limit` turns it back into an exact count.
- **Red flags:** a capped count rendered as a plain final number.

### 4. Cross-checks that cannot count say what they skipped
- **URL:** `repo-wide` item 4 (merged/closed PRs with local remnants) and item 10's no-PR `[unsettled]` rows
- **Action:**
  - When the merged or closed PR list returns `{resolved-limit}` rows, the scan emits `[pr] {state} PR list: {resolved-limit} rows (the cap) — older {state} branches unchecked — raise backlog-fetch-limit to check them`, once per capped state.
  - A no-PR `[unsettled]` row adds "(the PR fetch hit backlog-fetch-limit — an older PR may exist)" only when the PR join hit the cap and its oldest fetched PR is newer than that claim, so an older PR could sit past the cap. A row found by its `bot:in-progress` label alone is qualified whenever the join hit the cap, because its claim time is only the issue's last update, an upper bound on the real one.
- **Should feel:** quiet on the common case, where a claim's PR is recent and well inside the fetched window.
- **Should understand:** these results are cross-checks, not counts, so they cannot render as `{N}+`; a sentence takes the place of the floor.
- **Red flags:** the may-be-incomplete qualifier on every no-PR row, which is noise rather than signal.

## Origin

Built by `/claude-tweaks:flow` record #4820 (run `2026-11-01T231622-record-4820`, PR #4902). The `triage-queue` scope moved to `_shared/github-pr-scan-triage.md` in the same build, to keep `github-pr-scan.md` under the 52,500 B Read rail. Follow-ups: #4906 (acceptance-queue fetch), #4907 (render templates' WARNING slot), #4908 (`wrap-up/unblocked-records.md`), #4909 (triage item 3's commit count), and from the review and reflect passes #4910 (cap checks for the remaining sized lists), #4911 (per-PR work in items 1 and 2), #4912 (`/help`'s run-marker join), #4913 (the uncomposed `when: transport=gh` fence), #4914 (item 4 as a bin CLI).
