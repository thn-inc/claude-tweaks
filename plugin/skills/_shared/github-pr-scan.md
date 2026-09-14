# GitHub PR Scan — Shared Procedure

Single source of truth for scanning GitHub pull-request and issue state. Consumed by `/claude-tweaks:help` (Stage 4.5, **`current-pr`** scope; Stage 4.6, **`triage-queue`** scope; Stage 4.7, **`acceptance-queue`** scope; Stage 4.8, which inlines `_shared/forge-detection.md`'s Detection Ladder alone — its fetch and render come from `_shared/trust-table.md`, so it consumes no scope section below) and `/claude-tweaks:tidy` (Step 4.8, **`repo-wide`** scope; Step 4.8, **`acceptance-gap`** scope; Step 4.8, **`parent-gate`** scope). Subagents cannot read this file — the dispatcher inlines the relevant scope section and this file's Output Contract, plus `_shared/forge-detection.md`'s Detection Ladder, into the scan agent's prompt (the same pattern as `tidy/scan-procedures.md`). A scope section is inlined **whole**, its `work-links` resolution and fetch-limit sub-sections included: the `acceptance-gap` and `parent-gate` scopes each carry a `work-links: body-text` / `work-links: native` branch pair, and an agent that cannot resolve `work-links` cannot choose between them — taking the first-listed `body-text` branch on a `native` repo returns zero sub-issues from every parent and makes both scopes silently wrong (see each scope's own resolution sub-section for the failure it produces).

Every `gh issue list`/`gh pr list` call below carries an explicit `--limit` — `gh`'s implicit default is 30, which silently truncates instead of erroring. A result count landing exactly at the stated limit means the scan may be incomplete; treat that as a signal to narrow the query (a tighter label/state filter) or re-run with a higher `--limit`, not as a final count.

## Detection Ladder (fail-open)

Extracted to `_shared/forge-detection.md` (the re-read cut: a consumer needing only the three-check gate no longer has to load this file's full 39 KB to get it). This heading stays as a stub so existing section references still resolve in one hop. Every scope section below still runs behind this ladder exactly as before — read `forge-detection.md` for the checks, the skip-row format, the fail-open posture, and the transport-aware check-2 note.

## Transport (gh-absent fallback)

`forge-detection.md`'s check 2 ("`gh` present → proceed via the `gh` CLI. `gh` absent → a consumer with a documented MCP fallback proceeds via that path instead of stopping") applies to every scope section below, at **item granularity**, not scope granularity — every scope here mixes issue-backed and PR-backed calls, so a scope-wide skip would still throw away the half that has a real fallback:

- **Issue-backed items** (`gh issue list`, `gh issue view`, `gh api .../contents/...` reads of committed blobs) — route through `_shared/github-write-transport.md`'s CRUD mapping (`list_issues` / `issue_read`) when `gh` is absent. These items run exactly as documented, on either transport.
- **PR-backed items** (`gh pr list`, `gh pr view`, `gh pr checks`, the review-thread `gh api graphql` query, `gh api repos/.../commits`) — `_shared/github-write-transport.md`'s CRUD mapping covers issues, not pull requests, so there is no MCP fallback for these. When `gh` is absent, that item degrades **individually**: emit its own finding row noting the skip (`{prefix} PR scan skipped (item) / no MCP fallback for PR reads`, using the scope's own Output Contract prefix) and continue with the rest of the scope's items rather than skipping the whole scope. A scope whose items are entirely PR-backed (`current-pr`) therefore still degrades per-item with an explicit, documented message instead of a blanket skip at check 2 — the outcome for that scope's data is the same, but the routing decision is explicit and item-scoped rather than an implicit whole-scope short-circuit.

This is the same posture `/tidy` Step 4.7 already applies to its own `gh`-absent case (`tidy/scan-procedures.md`) — one shared rule stated once here, not restated per scope below.

## Staleness Thresholds

Keyed on `updatedAt`. Same scale as /tidy's backlog-record audit:

| Age since last update | Classification |
|----------------------|----------------|
| < 2 weeks | Fresh |
| 2-4 weeks | Review |
| > 4 weeks | Stale |

## Scope: `current-pr` (consumed by /help Stage 4.5)

Deep scan of the current branch's PR only, plus one cheap repo-wide count. Every item below is PR-backed (see Transport above) — on `gh`-absent, this scope has no issue-backed item to fall back to, so it degrades per-item rather than resolving to a blanket "GitHub scan skipped" at check 2: item 1 emits `[pr] PR scan skipped (item) / no MCP fallback for PR reads` and items 2-4 are skipped as a consequence (each depends on item 1's PR number or is the same class of call).

1. **PR lookup** — `gh pr view --json number,title,isDraft,reviewDecision,statusCheckRollup,closingIssuesReferences,url`. Non-zero exit means no PR for the current branch → emit one info row (`No open PR for current branch`), then run item 4 only.
2. **Unresolved review threads** — resolve `{owner}` and `{repo}` via `gh repo view --json owner,name -q '.owner.login + " " + .name'`, `{number}` from item 1, then run exactly:

   ```bash
   gh api graphql -f query='query($owner:String!,$repo:String!,$pr:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$pr){reviewThreads(first:100){nodes{isResolved}}}}}' -f owner='{owner}' -f repo='{repo}' -F pr={number} --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved | not)] | length'
   ```

3. **CI checks** — `gh pr checks {number}` → count failing / pending / passing. Exit code 8 means checks are still pending; a non-zero exit that still lists checks is valid output, not a scan failure.
4. **Repo-wide stale count (maintenance signal only)** — `gh pr list --state open --json number,updatedAt --limit 100` → total open PRs + count stale per the thresholds above. This row is routed to the caller's maintenance-signals rendering, not the Current PR dashboard section.

Emit `[pr]` rows per the Output Contract.

## Scope: `repo-wide` (consumed by /tidy Step 4.8)

Full sweep of open PRs, `by:code-health`-labelled issues, `by:harness-health`-labelled issues, `by:journey-health`-labelled issues, and `by:docs-health`-labelled issues. Backlog-record findings (stale, parked-trigger, unsynced, needs-scoring, `bot:blocked`, legacy-taxonomy, `bot:parked`) are `/tidy` Step 1's job now, not this scope's — `repo-wide` no longer queries the retired `backlog` label (see `tidy/step-1-records.md`).

**Transport split (see Transport above):** items 3, 5, 6, 7, and 8 are issue-backed (`gh issue list`) and run unchanged on either transport. Items 1, 2, 4, 9, and 10 are PR-backed (`gh pr list`/`gh pr checks`/`gh api graphql`/`gh api repos/.../commits`) — on `gh`-absent, each degrades individually per the rule above rather than the whole scope skipping; item 10's claims-registry read (its first fetch) is issue-adjacent, not PR-backed, and already has a documented MCP path via `_shared/issue-claims.md`'s "List all claims", so only item 10's second (`bot:in-progress` list — issue-backed, routes via MCP too) and third (`gh pr list --state all`, PR-backed — degrades) fetches split the same way.

> **Parallel execution:** Use parallel tool calls aggressively — items 1, 3, 4, 5, 6, 7, 8, and the initial fetches of items 9 and 10 below, plus each open PR's own review-thread query in item 2, are independent gh/bash calls with no dependency on one another and should run concurrently. Item 9's per-candidate thread/link fetches and item 10's per-issue claim-blob reads depend on their own item's earlier filter step, so only those later sub-steps are sequential.

1. **Open PRs** — `gh pr list --state open --json number,title,updatedAt,isDraft,reviewDecision,headRefName,url --limit 100` → classify each per the Staleness Thresholds. A PR that is simultaneously not draft, not yet `Stale` (< 4 weeks since `updatedAt` — spans both the `Fresh` and `Review` bands, since neither currently has its own finding for a PR with nothing wrong), has zero unresolved review threads (item 2 below), and has no failing/pending CI (`gh pr checks`) gets its own finding, carrying a per-PR command rather than landing as summary-only: `[pr] PR #{n}: {title} — awaiting review — last updated {age} ago, CI {status}, 0 unresolved threads — gh pr view {n} --web`. This is informational only — see the Severity mapping and `tidy/SKILL.md`'s Step 6 routing below — but "informational" describes the *severity*, not whether the row carries a command: the trailing `gh pr view {n} --web` is what a human runs to actually look at the PR, and its absence was a confirmed gap (a bare summary sentence with zero per-PR follow-up), not a deliberate no-command finding. A PR with failing/pending CI (`gh pr checks`) or `reviewDecision: CHANGES_REQUESTED` instead gets its own finding, regardless of staleness: `[pr] PR #{n}: {title} — CI failing/pending or changes requested — CI {status}, review {reviewDecision}`. This is `high` severity per the Severity mapping below, not informational — see the Findings and recommendations table below.
2. **Unresolved threads per open PR** — the same GraphQL query as `current-pr` item 2, once per open PR.
3. **Code-health issues** — `gh issue list --label by:code-health --state open --json number,title,labels,updatedAt,url --limit 100`.
4. **Merged/closed PRs with local remnants** — `gh pr list --state merged --limit 50 --json number,headRefName` AND `gh pr list --state closed --limit 50 --json number,headRefName` (GitHub's PR `state` is `OPEN`/`CLOSED`/`MERGED` — mutually exclusive — so `--state closed` never overlaps `--state merged`; both queries are needed to cover "merged or closed without merging"); cross-check each `headRefName` from either result against `git -C "{REPO_ROOT}" branch --list` output.
5. **Harness-health issues** — `gh issue list --label by:harness-health --state open --json number,title,labels,updatedAt,url --limit 100`.
6. **Journey-health issues** — `gh issue list --label by:journey-health --state open --json number,title,updatedAt,url --limit 100`.
7. **Docs-health issues** — `gh issue list --label by:docs-health --state open --json number,title,labels,updatedAt,url --limit 100`.
8. **Grant-queue counts** — one self-contained query feeds three maintenance-signal counts, per `_shared/work-record.md`'s record taxonomy. Not gated on `work-backend` — this scope only runs once the Detection Ladder already confirmed a reachable GitHub remote, regardless of which driver stores records:

   Resolve this item's session-scoped temp path first, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated):

   ```bash
   eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PR_SCAN_RECORDS=pr-scan-records.json)"
   gh issue list --state open --json number,title,labels --limit 200 > "$PR_SCAN_RECORDS"
   node -e "
     const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
     const { isPendingAuthorization } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/pending-authorization.js');
     const issues = require('$PR_SCAN_RECORDS');
     const faceted = issues.map((i) => parseRecordFacets(i.labels));
     const withFacets = issues.map((i, idx) => ({ number: i.number, title: i.title, facets: faceted[idx] }));
     const pending = withFacets.filter((i) => i.facets.stage === 'ready' && isPendingAuthorization(i.facets)).length;
     const blocked = withFacets.filter((i) => i.facets.bot.blocked).length;
     const backlog = withFacets.filter((i) => i.facets.stage === 'backlog').length;
     console.log(JSON.stringify({ pending, blocked, backlog }));
   "
   ```

   - **Pending authorization** — `ready` ∧ no `auto:*` ∧ no `bot:*` (`bot:in-progress`, `bot:blocked`, or `bot:parked`). Origin-agnostic: any record any health skill, `/claude-tweaks:capture`, or a human filed counts, with or without a `by:*` label — matching `/claude-tweaks:backlog refine`'s own origin-agnostic `ready`-queue pull (`skills/backlog/refine-mode.md`), which no longer tiers any health-skill origin specially. This is a maintenance signal only — `/tidy` never grants authorization itself (`/claude-tweaks:backlog refine` owns that).
   - **`bot:blocked`** — records that hit their retry ceiling; needs a human's renewed judgment at `/claude-tweaks:backlog refine` before re-entering the autonomous queue (same definition as `tidy/step-1-records.md`'s Shape 5). A record `_shared/pr-first-merge.md`'s Step 2.5 (Merge-verification gate) parked on a red or timed-out PR check carries `bot:parked` instead — a distinct label, since that path leaves `auto:*` grants intact (`tidy/step-1-records.md`'s Shape 5-parked) — and is not counted here.
   - **Backlog-state** — open records carrying neither `ready` nor `parked` — the default, unasserted state per `_shared/work-record.md`'s lifecycle spine.

   Surface all three as the `[queue]` Output Contract row below — bare counts only, per the Output Contract's own documented shape. No per-record enumeration is produced or needed here.

9. **Unarmed ready PR** — a green, gate-passed, granted or grantable, plugin-created PR whose `--auto` was never armed. "Plugin-created" is detected purely GitHub-side, from the PR body's `<!-- claude-tweaks-run: {run-id} -->` marker (stamped by `_shared/pr-early-run-lifecycle.md`'s PR-open template) or one of the two mechanical-housekeeping markers — `<!-- tidy-housekeeping-pr -->` (stamped by `/claude-tweaks:tidy` Step 7 at creation) or `<!-- wrap-up-residue-pr -->` (stamped by `wrap-up/residue-sweep.md`'s pr-first landing path — the same low-judgment, purely-mechanical shape as a tidy Step-7 commit, gated by the identical `housekeeping-auto-merge` lever) — no local run-dir join, so this check works from a fresh sandbox exactly like every other item here.

<!-- when: transport=gh -->
   Resolve this item's session-scoped temp paths first, per `_shared/session-tmp-root.md`:

   ```bash
   eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PR_SCAN_UNARMED=pr-scan-unarmed.json PR_SCAN_UNARMED_CANDIDATES=pr-scan-unarmed-candidates.json)"
   UNARMED_AGE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values pr-unarmed-age-hours)
   HOUSEKEEPING_GRANT=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values housekeeping-auto-merge)
   ALLOW_AUTO_MERGE=$(gh api repos/{owner}/{repo} -q .allow_auto_merge 2>/dev/null)
   gh pr list --state open --json number,title,updatedAt,isDraft,body,autoMergeRequest,statusCheckRollup,closingIssuesReferences,url --limit 100 \
     > "$PR_SCAN_UNARMED"

   UNARMED_AGE="$UNARMED_AGE" node -e "
     const fs = require('fs');
     const AGE_HOURS = Number(process.env.UNARMED_AGE);
     const now = Date.now();
     const RUN_MARKER = /<!-- claude-tweaks-run: [^\s]+ -->/;
     const HOUSEKEEPING_MARKER = /<!-- (?:tidy-housekeeping-pr|wrap-up-residue-pr) -->/;
     const prs = require('$PR_SCAN_UNARMED');
     const candidates = prs.filter((pr) => {
       if (pr.isDraft || pr.autoMergeRequest) return false;
       const ageHours = (now - Date.parse(pr.updatedAt)) / 3600000;
       if (ageHours < AGE_HOURS) return false;
       const checks = pr.statusCheckRollup || [];
       // A job whose own if: condition is false (e.g. a default-branch-only
       // cleanup job) reports SKIPPED on every feature-branch PR, permanently --
       // treating that as non-green made this filter unsatisfiable for any PR
       // carrying such a job. NEUTRAL is the same shape from another CI provider.
       const NON_BLOCKING = new Set(['SUCCESS', 'SKIPPED', 'NEUTRAL']);
       const green = checks.every((c) => NON_BLOCKING.has(c.conclusion || c.state));
       if (checks.length && !green) return false;
       return RUN_MARKER.test(pr.body || '') || HOUSEKEEPING_MARKER.test(pr.body || '');
     });
     fs.writeFileSync('$PR_SCAN_UNARMED_CANDIDATES', JSON.stringify(candidates));
   "
   ```

   The age/gate/marker filter above narrows to a small candidate set before any further per-PR calls — unresolved threads (the same GraphQL query as `current-pr` item 2, run once per **candidate**, never against the full open-PR list) gate out any candidate that still has one, since a PR with an open thread is not actually ready regardless of CI or age. For each surviving candidate carrying the `claude-tweaks-run` marker (not the housekeeping one), fetch every linked record's labels — `closingIssuesReferences` names the numbers, not their labels. Re-resolve this fence's session-scoped paths (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variable):

   ```bash
   eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PR_SCAN_UNARMED_CANDIDATES=pr-scan-unarmed-candidates.json PR_SCAN_UNARMED_LINKS=pr-scan-unarmed-links.jsonl)"
   : > "$PR_SCAN_UNARMED_LINKS"
   node -e "
     const seen = new Set();
     require('$PR_SCAN_UNARMED_CANDIDATES').forEach((p) => (p.closingIssuesReferences || []).forEach((i) => seen.add(i.number)));
     [...seen].forEach((n) => console.log(n));
   " | while read -r N; do
     gh issue view "$N" --json number,labels --jq '{number: .number, labels: [.labels[].name]}' >> "$PR_SCAN_UNARMED_LINKS"
   done
   ```

   Classify each surviving candidate — granted when every linked record carries `auto:merge` **and none carries `bot:blocked` or `bot:parked`** (a housekeeping-marker PR is granted instead by `housekeeping-auto-merge` alone, no record grant needed). The `bot:blocked`/`bot:parked` exclusion is what keeps this sweep from un-parking a deliberately parked run: a record carries `bot:blocked` because dispatch hit its retry ceiling, or `bot:parked` because `_shared/pr-first-merge.md`'s Step 2.5 (Merge-verification gate) took the red path, and both mean a human owes a re-triage before anything arms that PR — a later-green rollup does not retract the park. Re-resolve this fence's session-scoped paths:

   ```bash
   eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" PR_SCAN_UNARMED_CANDIDATES=pr-scan-unarmed-candidates.json PR_SCAN_UNARMED_LINKS=pr-scan-unarmed-links.jsonl)"
   HOUSEKEEPING_GRANT="$HOUSEKEEPING_GRANT" ALLOW_AUTO_MERGE="$ALLOW_AUTO_MERGE" node -e "
     const fs = require('fs');
     const HOUSEKEEPING = process.env.HOUSEKEEPING_GRANT === 'true';
     const ALLOW_AUTO_MERGE = process.env.ALLOW_AUTO_MERGE; // 'true' | 'false' | '' (probe failed — unknown)
     const armNote = ALLOW_AUTO_MERGE === 'false'
       ? ' (repo setting Allow auto-merge is OFF — arm will degrade per _shared/pr-first-merge.md Step 3, not fail)'
       : '';
     const candidates = require('$PR_SCAN_UNARMED_CANDIDATES');
     const links = fs.existsSync('$PR_SCAN_UNARMED_LINKS')
       ? fs.readFileSync('$PR_SCAN_UNARMED_LINKS', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
       : [];
     const labelsByIssue = new Map(links.map((l) => [l.number, l.labels]));
     candidates.forEach((pr) => {
       const isHousekeeping = /<!-- (?:tidy-housekeeping-pr|wrap-up-residue-pr) -->/.test(pr.body || '');
       let granted;
       if (isHousekeeping) {
         granted = HOUSEKEEPING;
       } else {
         const linked = (pr.closingIssuesReferences || []).map((i) => i.number);
         granted = linked.length > 0
           && linked.every((n) => (labelsByIssue.get(n) || []).includes('auto:merge'))
           && !linked.some((n) => (labelsByIssue.get(n) || []).includes('bot:blocked') || (labelsByIssue.get(n) || []).includes('bot:parked'));
       }
       if (granted) {
         console.log('[pr-unarmed] PR #' + pr.number + ': ' + pr.title + ' — green and granted, --auto never armed — arm per _shared/pr-first-merge.md' + armNote);
       } else {
         console.log('[pr-unarmed] PR #' + pr.number + ': ' + pr.title + ' — green but ungranted — needs auto:merge on every linked record (or housekeeping-auto-merge for a tidy PR) before it can arm' + armNote);
       }
     });
   "
   ```

   Both outcomes share the `[pr-unarmed]` prefix — the row content, not the prefix, distinguishes granted (recommends arming now) from ungranted (recommends granting first). Every row also carries the repo's `allow_auto_merge` state (`ALLOW_AUTO_MERGE`, read once above via `gh api repos/{owner}/{repo} -q .allow_auto_merge`) whenever it's `false`, so a recommendation to "arm" never implies a live `--auto` arm will succeed on a repo where it structurally can't — the degrade path still applies. **The list-time snapshot above is never trusted for the actual write**: grant labels, the `bot:blocked`/`bot:parked` exclusion (a record parked between the scan and the arm — or one whose labels the classifier's `gh issue view` loop failed to fetch and defaulted to `[]` — must still block the arm), `housekeeping-auto-merge`, and gate status (CI/draft/threads) are all re-read immediately before `gh pr merge --auto` runs, whether that arm happens interactively or via `/claude-tweaks:tidy`'s own Step 6/7 batch approval.
<!-- /when -->

10. **Unsettled run** — a claimed or `bot:in-progress`-labeled issue whose pipeline shows no evidence of progress since it was claimed, past a threshold. Detected purely GitHub-side, in three fetches:

    Resolve this item's session-scoped temp paths first, per `_shared/session-tmp-root.md`:

    ```bash
    eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" \
      PR_SCAN_UNSETTLED_CLAIMS=pr-scan-unsettled-claims.jsonl \
      PR_SCAN_UNSETTLED_LABELLED=pr-scan-unsettled-labelled.json \
      PR_SCAN_UNSETTLED_PRS=pr-scan-unsettled-prs.json)"
    UNSETTLED_AGE=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values unsettled-age-hours)

    # 1. Claims-registry: filenames are `issue-{n}.json`; read each blob and pair it
    #    with its issue number. A blob that fails to parse or classifies anything
    #    other than 'live'/'stale' (tombstoned, or the file vanished between the
    #    list and the read) is dropped here, not surfaced — a released or contested
    #    claim is not an unsettled one.
    : > "$PR_SCAN_UNSETTLED_CLAIMS"
    gh api "repos/{owner}/{repo}/contents/claims?ref=claims-registry" -q '.[].name' 2>/dev/null | while read -r FNAME; do
      NUM=$(echo "$FNAME" | sed -E 's/^issue-([0-9]+)\.json$/\1/')
      CONTENT=$(gh api "repos/{owner}/{repo}/contents/claims/${FNAME}?ref=claims-registry" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null)
      node -e "
        const { classifyClaimBlob } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims.js');
        const c = classifyClaimBlob(process.argv[2] || null, Date.now());
        if (c.state !== 'live' && c.state !== 'stale') process.exit(0);
        const parsed = JSON.parse(process.argv[2]);
        console.log(JSON.stringify({ number: Number(process.argv[1]), claimedAt: parsed.claimedAt, source: 'claim' }));
      " "$NUM" "$CONTENT" >> "$PR_SCAN_UNSETTLED_CLAIMS"
    done

    # 2. bot:in-progress-labelled issues with no matching claim above (a claim/
    #    label drift case — release wrote the tombstone but the label never
    #    cleared, or the reverse). Anchored on the issue's own updatedAt, the
    #    best available timestamp once there is no claim blob to read a
    #    claimedAt from.
    gh issue list --label bot:in-progress --state open --json number,updatedAt --limit 200 \
      > "$PR_SCAN_UNSETTLED_LABELLED"

    # 3. Every PR, to reverse-join by closingIssuesReferences (the same field
    #    GitHub computes from a PR's own `Fixes #{n}` line — no marker regex
    #    needed here, unlike item 9's plugin-created detection).
    gh pr list --state all --json number,url,closingIssuesReferences,comments,commits --limit 200 \
      > "$PR_SCAN_UNSETTLED_PRS"
    ```

    A live claim with `claimedAt` older than `unsettled-age-hours` qualifies; a `bot:in-progress` label with no matching claim entry above qualifies once its `updatedAt` clears the same threshold. For a qualifying candidate, find the PR whose `closingIssuesReferences` includes its issue number. **No PR found** qualifies unconditionally — there is nothing to check progress against. A PR found qualifies only when its progress — the later of its last head-branch commit date and its last comment date, any actor, bot comments included — is **no more recent than the claim's `claimedAt`** (nothing has happened since the claim was taken, however active the PR looked when it was first opened); a PR with newer activity is not unsettled; it does not report:

    Re-resolve this fence's session-scoped paths (`_shared/session-tmp-root.md`; a fresh bash invocation does not inherit the prior fence's shell variables):

    ```bash
    eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" \
      PR_SCAN_UNSETTLED_CLAIMS=pr-scan-unsettled-claims.jsonl \
      PR_SCAN_UNSETTLED_LABELLED=pr-scan-unsettled-labelled.json \
      PR_SCAN_UNSETTLED_PRS=pr-scan-unsettled-prs.json)"
    node -e "
      const fs = require('fs');
      const AGE_HOURS = Number(process.env.UNSETTLED_AGE);
      const now = Date.now();
      const claimed = fs.existsSync('$PR_SCAN_UNSETTLED_CLAIMS')
        ? fs.readFileSync('$PR_SCAN_UNSETTLED_CLAIMS', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
        : [];
      const claimedNumbers = new Set(claimed.map((c) => c.number));
      const labelled = require('$PR_SCAN_UNSETTLED_LABELLED')
        .filter((i) => !claimedNumbers.has(i.number))
        .map((i) => ({ number: i.number, claimedAt: i.updatedAt, source: 'label' }));
      const candidates = claimed.concat(labelled);
      const prs = require('$PR_SCAN_UNSETTLED_PRS');
      function matchedPr(issueNumber) {
        return prs.find((pr) => (pr.closingIssuesReferences || []).some((i) => i.number === issueNumber));
      }
      function progressOf(pr) {
        const commitDates = (pr.commits || []).map((c) => c.committedDate || c.authoredDate).filter(Boolean);
        const commentDates = (pr.comments || []).map((c) => c.createdAt).filter(Boolean);
        const all = commitDates.concat(commentDates);
        return all.length ? all.sort().pop() : null;
      }
      candidates.forEach(({ number, claimedAt }) => {
        const ageHours = (now - Date.parse(claimedAt)) / 3600000;
        if (ageHours < AGE_HOURS) return;
        const pr = matchedPr(number);
        if (!pr) {
          console.log('[unsettled] #' + number + ': no PR found ' + Math.round(ageHours) + 'h after claim — resume: node \"\${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" reconcile, then re-run /claude-tweaks:dispatch or /claude-tweaks:flow #' + number);
          return;
        }
        const progress = progressOf(pr);
        if (progress && Date.parse(progress) > Date.parse(claimedAt)) return;
        console.log('[unsettled] #' + number + ': PR #' + pr.number + ' silent ' + Math.round(ageHours) + 'h after claim — resume: read the Resume line in ' + pr.url + \"'s body (PIPELINE_RUN_DIR=... /claude-tweaks:flow ...), per _shared/pr-early-run-lifecycle.md\");
      });
    "
    ```

    `gh pr list`'s `commits`/`comments` fields are bounded per-PR (recent-first) — a PR whose activity list is long enough to truncate before reaching its true latest entry is not the failure mode this check guards against (truncation drops the *oldest* entries, and this check only ever needs the *newest* one), so no `--limit`-exhaustion warning applies here the way it does for the `acceptance-gap`/`parent-gate` scopes' parent-fetch truncations. The resume command comes from the PR body's own Resume line (`_shared/pr-early-run-lifecycle.md`'s `PIPELINE_RUN_DIR="{run-dir}" /claude-tweaks:flow "{target}" {next-step}`) when a PR exists — read and report it verbatim rather than reconstructing it, since only the PR body carries `{next-step}`. When no PR exists, the claim blob's own `runId` is all that is known — the reconstructed command above starts from `reconcile` rather than a specific `{next-step}`, since a claim with no PR is exactly the state `_shared/pr-early-run-lifecycle.md`'s reopen-or-create step is designed to repair on its own the next time anything touches that run.

Findings and recommendations (tidy Action Vocabulary):

| Finding | Recommendation |
|---------|---------------|
| Open PR awaiting review, nothing wrong (item 1's first finding) | `gh pr view {n} --web` — informational, optional human look, no action required |
| Open PR has failing/pending CI or `CHANGES_REQUESTED` (item 1's second finding) | Investigate the CI failure or address the requested changes — local action |
| Open PR stale (>4 weeks, no updates) | Close (GitHub) or Resume — judgment call |
| Open PR superseded (related spec complete, equivalent changes merged) | Close (GitHub) |
| Merged/closed PR whose head branch or worktree still exists locally | Corroborates Step 4.5 `[git]` cleanup — dispatcher merges at assembly |
| Unresolved review thread addressed by a later commit (evidence: commit touching the flagged lines) | Resolve thread |
| Unresolved review thread not addressed | Capture to backlog or run `/claude-tweaks:review` — local action |
| `by:{skill}` issue stale (>4 weeks, the flagged code/target/journey/doc has since changed or been removed) — `{skill}` is any of `code-health`/`harness-health`/`journey-health`/`docs-health` | Close (GitHub) — superseded |
| `by:{skill}` issue still valid | Suggest `/claude-tweaks:backlog refine` or Capture to backlog — all four health skills are report-only and never apply patches directly (see each skill's own SKILL.md Anti-Patterns table), so a still-valid issue always needs a human-routed fix regardless of which skill filed it |
| Unarmed ready PR, granted (item 9) | Arm `--auto` per `_shared/pr-first-merge.md` — local action, no new merge mechanics |
| Unarmed ready PR, ungranted (item 9) | Grant `auto:merge` on every linked record, or set `housekeeping-auto-merge` for a tidy PR — judgment call, never auto-granted by this sweep |
| Unsettled run (item 10) | Resume via the reported command, or release the claim and let a fresh dispatch pick the record back up — judgment call |

Emit `[pr]` and `[gh-issue]` rows per the Output Contract. Backlog-record findings (the record-scan shapes: stale, parked-trigger, unsynced, needs-scoring, `bot:blocked`, legacy-taxonomy, `bot:parked`) no longer originate from this scope — see `tidy/step-1-records.md` for their findings table and `[backlog]`/`[parked]`/`[unsynced]`/`[scoring]`/`[blocked]`/`[legacy]`/`[bot-parked]` row prefixes. Items 9 and 10 emit their own `[pr-unarmed]` and `[unsettled]` prefixes instead — see the Output Contract below.

**Anti-pattern: a self-scheduled per-PR check-in loop.** Do not have a session poll or re-check a single PR's arm/CI/merge state on its own schedule to "make sure it merges" — that durability lives in GitHub's own `--auto` (which merges the moment checks pass, with no session watching) plus this scheduled sweep (which catches the cases `--auto` alone can't: unarmed PRs and unsettled claims), neither of which depends on any session surviving. A per-PR loop dies with the session that started it and duplicates what the sweep already covers on a schedule nothing has to remember to run.

## Scope: `triage-queue` (consumed by /help Stage 4.6)

Three cheap counts for the dashboard's Triage Queue section. This scope exists so `/help` never hand-writes its own query for these numbers — see the fix this closes: Stage 4.6 previously computed "pending authorization" without excluding `bot:blocked` records, so a blocked record counted as both pending AND blocked on the same dashboard.

**Transport split (see Transport above):** items 1 and 2 are issue-backed and run unchanged on either transport. Item 3's commits-endpoint query has no MCP equivalent — on `gh`-absent it degrades individually (omit the "Auto-merged this week" line rather than the whole scope).

1. **Pending authorization** — `ready` ∧ no `auto:*` ∧ no `bot:*` (`bot:in-progress`, `bot:blocked`, or `bot:parked`). Origin-agnostic: matches `/claude-tweaks:backlog refine`'s own `ready`-queue pull (`skills/backlog/refine-mode.md`), which tiers no health-skill origin specially — every `ready` record, with or without a `by:*` label, is in scope.

   Resolve this item's session-scoped temp path first, per `_shared/session-tmp-root.md`:

   ```bash
   eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TRIAGE_QUEUE_READY=triage-queue-ready.json)"
   gh issue list --label ready --state open --json number,labels --limit 200 > "$TRIAGE_QUEUE_READY"
   node -e "
     const { parseRecordFacets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
     const { isPendingAuthorization } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/pending-authorization.js');
     const issues = require('$TRIAGE_QUEUE_READY');
     const pending = issues.filter((i) => isPendingAuthorization(parseRecordFacets(i.labels))).length;
     console.log(pending);
   "
   ```

2. **Blocked** — `gh issue list --label bot:blocked --state open --json number --limit 200 -q 'length'`

<!-- when: transport=gh -->
3. **Auto-merged this week** — `[fast-lane]`-tagged, `[auto-merge]`-tagged, or
   `[manifesto-authorized]`-tagged commits on the *default* branch (never the current worktree's
   own branch — see the note on `worktree-always` below), last 7 days. All three skip the
   interactive finish-branch prompt because `merge-check` already cleared it — that is what this
   metric counts, not headlessness: `[auto-merge]` is always dispatch-originated (singleton or
   bundle, both via `dispatch/settle-and-merge.md`'s Dispatching-session merge execution —
   genuinely headless); `[fast-lane]` (`wrap-up/review-console.md`'s Auto-merge short-circuit) is
   reachable only by an interactive, human-run single-record `/flow` — its own dispatch-claim
   branch redirects a dispatch-originated singleton to `[auto-merge]` instead, so a `[fast-lane]`
   commit is never headless; `[manifesto-authorized]` (`wrap-up/manifesto-authorized-merge.md`,
   the `merge-authorization` lever) is likewise never headless — it requires a live Manifesto
   `confirm`/`hybrid` override, the same interactive precondition as `[fast-lane]`.

   ```bash
   SINCE=$(node -e "console.log(new Date(Date.now() - 7*24*60*60*1000).toISOString())")
   gh api "repos/{owner}/{repo}/commits?since=${SINCE}&per_page=100" -q '[.[] | select(.commit.message | contains("[fast-lane]") or contains("[auto-merge]") or contains("[manifesto-authorized]"))] | length'
   ```

   The commits endpoint defaults to the default branch when no `sha=` param is given — correct regardless of which branch/worktree `/help` itself runs from under `worktree-always`. `SINCE` is computed via `node`, not shell `date` arithmetic, which differs between BSD/macOS and GNU date.
<!-- /when -->

Render as three lines: `Pending authorization: **{N}** records awaiting your decision` / `Blocked: **{N}** records hit their retry ceiling` / `Auto-merged this week: **{N}** auto-merges` — omit any line whose count is 0.

## Scope: `acceptance-queue` (consumed by /help Stage 4.7)

Extracted to `_shared/github-pr-scan-acceptance.md` (#204 — this file was approaching the 40 KB
ceiling). This heading stays as a stub so existing section references still resolve in one hop.
Read that file's own `acceptance-queue` scope section — it runs behind this file's Detection
Ladder and Transport rule (above) and reports per this file's Output Contract below, exactly as
before the split. Its calls are entirely issue-backed (`gh issue list`), so on `gh`-absent they
route through `_shared/github-write-transport.md`'s `list_issues` mapping unchanged, with no
per-item PR degrade needed.

## Scope: `acceptance-gap` (consumed by /tidy Step 4.8)

Extracted to `_shared/github-pr-scan-acceptance.md` (#204). Same stub convention as
`acceptance-queue` above — read that file's `acceptance-gap` scope section, behind this file's
Detection Ladder and Transport rule (above), reporting per this file's Output Contract below.
Its calls are entirely issue-backed (`gh issue list`, `gh api .../sub_issues`), so on `gh`-absent
they route through `_shared/github-write-transport.md`'s mapping unchanged.

## Scope: `parent-gate` (consumed by /tidy Step 4.8)

Extracted to `_shared/github-pr-scan-acceptance.md` (#204). Same stub convention as the two scopes
above — read that file's `parent-gate` scope section, behind this file's Detection Ladder and
Transport rule (above), reporting per this file's Output Contract below. Its calls are entirely
issue-backed (`gh issue list`, `gh api .../sub_issues`), so on `gh`-absent they route through
`_shared/github-write-transport.md`'s mapping unchanged.

## Output Contract

Two collection prefixes for PR/code-health/harness-health/journey-health/docs-health findings, one grant-queue-metrics prefix (`repo-wide` scope only, unconditional — the grant-queue counts exist regardless of which driver stores records), one un-dispositioned-closed-record prefix (`acceptance-gap` scope only), and one un-gated-parent prefix (`parent-gate` scope only) — all emitted as standard Template A rows (`_shared/subagent-dispatch-core.md`) so existing dispatchers consume them unchanged:

- `[pr]` — pull-request findings: `[pr] PR #{n}: {title} — {issue} — {recommendation}`
- `[gh-issue]` — code-health/harness-health/journey-health/docs-health issue findings: `[gh-issue] #{n}: {title} — {issue} — {recommendation}`
- `[queue]` — grant-queue metrics (item 8 above, `repo-wide` scope only, derived from the single `gh issue list --state open` query already fetched): `[queue] {N} pending authorization, {M} bot:blocked, {K} backlog`
- `[acceptance-gap]` — closed records with no acceptance disposition (`acceptance-gap` scope above): `[acceptance-gap] #{n}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo #{n}`
- `[parent-gate]` — decomposition parents with every sub-issue closed and no acceptance disposition on the parent (`parent-gate` scope above): `[parent-gate] #{n}: {title} — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo #{n}`
- `[pr-unarmed]` — a green, gate-passed, plugin-created PR whose `--auto` was never armed, granted or not (`repo-wide` item 9): `[pr-unarmed] PR #{n}: {title} — {granted-or-ungranted content} — {recommendation}`
- `[unsettled]` — a claimed or `bot:in-progress` issue whose pipeline shows no progress past the threshold (`repo-wide` item 10): `[unsettled] #{n}: {PR-silent-or-no-PR content} — resume: {command}`

Backlog-record findings (the record-scan shapes: stale, parked-trigger, unsynced, needs-scoring, `bot:blocked`, legacy-taxonomy, `bot:parked`) no longer emit from this scope — they are `/tidy` Step 1's `[backlog]` / `[parked]` / `[unsynced]` / `[scoring]` / `[blocked]` / `[legacy]` / `[bot-parked]` rows now (`tidy/step-1-records.md`).

Severity mapping (Template A Severity column):

| Signal | Severity |
|--------|----------|
| Failing CI or `CHANGES_REQUESTED` on any open PR (current branch's or repo-wide) | high |
| Unresolved review threads | medium |
| Stale open PR (>4 weeks) | medium |
| Open PR superseded (related work already merged) | medium |
| Merged/closed PR with local branch/worktree remnants | medium |
| Code-health/harness-health/journey-health/docs-health issue stale/superseded | medium |
| Code-health/harness-health/journey-health/docs-health issue still valid, awaiting `/claude-tweaks:backlog refine` | low |
| Open PR awaiting review (not draft, not yet `Stale`, 0 unresolved threads, CI clean) | info |
| Closed record with no acceptance disposition (`acceptance-gap` scope) | info |
| Decomposition parent complete with no acceptance disposition (`parent-gate` scope) | info |
| Unarmed ready PR, granted (item 9) — actionable, mechanical: arm now | medium |
| Unarmed ready PR, ungranted (item 9) — nothing to act on until a human grants it | info |
| Unsettled run (item 10) — a stuck claim silently blocks the record from being picked up again | medium |
| Fresh draft PR / no PR / scan skipped | info |
