# Tidy — Step 1: Audit Work Records

Step 1's full scan procedure, extracted from `scan-procedures.md` so the record scan is one
lazy-load unit instead of one section of an eleven-step file. That file keeps the
`## Step 1: Audit Work Records` heading as a stub pointing here, so an external reference naming
"`scan-procedures.md` Step 1" — or one of its shapes — still resolves in one hop.

The dispatcher reads this file **whole** and inlines it into the Work Records agent's prompt;
subagents cannot read sibling files, so everything that agent needs is either here or in the
`_shared/` fragments this file names for the dispatcher to inline alongside it.

Every other scan step (3, 4, 4.5, 4.6, 4.7, 4.8, 4.9, 5, 5.5) stays in `scan-procedures.md`;
every reference below to one of those steps means that file. The Collection routing table is a
further extraction from that file, in `collection-routing.md`.

---

## Step 1: Audit Work Records

Read the `work-backend` field from the project's CLAUDE.md (under a `## Work records` section, written by `/claude-tweaks:init`). A missing flag is treated as `local-files`.

One query per driver feeds every finding shape below — the record store itself is the current landscape; there is no separate directory or index file to read (`_shared/work-record.md`). This single step replaces the old file-scan (former Step 1), spec-directory scan (former Step 2), and the backlog-issue portion of Step 4.8's `repo-wide` scan — all three read from the same record taxonomy now, so they collapse into one query + one facet parse.

Resolve this step's session-scoped temp paths once, per `_shared/session-tmp-root.md` (cited throughout this file rather than restated): `eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TIDY_RECORDS=tidy-records.json TIDY_RECORDS_FACETED=tidy-records-faceted.json TIDY_UNSYNCED=tidy-unsynced.json)"`. Fetch and facet-parse the queue per `_shared/record-queue-fetch.md` — the dispatcher inlines that file's `work-backend` resolution, both drivers' fetch commands (including the Session-scoped record snapshot section, so this fetch shares one `gh issue list --state all` pull per session with `/backlog`/`/capture`/`/specify`/`/help`/`/visualize` instead of paying for its own), and the Staleness clock and Threshold resolution sections into this agent's prompt (the same pattern already used for `_shared/github-pr-scan.md`), with `{tmp-records-file}` = `$TIDY_RECORDS`, `{tmp-faceted-file}` = `$TIDY_RECORDS_FACETED` — the legacy-taxonomy shape below (**Shape 5.5**) needs the raw `labels` array, not just the parsed `facets`, and the shared fetch's script already preserves both (its spread keeps `labels` alongside the derived `facets`).

Also pull any local fallback records left behind by a failed GitHub write — these feed the Sync shape below:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TIDY_UNSYNCED=tidy-unsynced.json)"
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  console.log(JSON.stringify(queryRecords('specs', { unsynced: true })));
" > "$TIDY_UNSYNCED"
```

Every record returned by the `local-files` driver's fetch already carries its parsed `.facets` — no separate parse pass needed. The shapes below are not all driver-universal, in both directions. Three never fire under this driver: no Sync finding (`facets.unsynced` is a github-issues-fallback-only concept — see `_shared/work-record.md`), no `bot:blocked` finding (the local driver "carries no bot state"), and no legacy-taxonomy finding (Shape 5.5 — its frontmatter schema never held the retired label vocabulary in the first place; that vocabulary is GitHub-label-only). Conversely, the two acceptance backstops — Shape 7 (parent gate due) and Shape 8 (closed record with no disposition) — fire **only** under this driver; their `github-issues` counterparts are Step 4.8's `parent-gate` and `acceptance-gap` scopes, which read GitHub issues. Both also run their own `queryRecords` pass rather than reading the fetch above, since both look at closed records and that fetch returns open ones.

**Staleness clock**, either driver: per `_shared/record-queue-fetch.md`'s Staleness clock and
Threshold resolution sections (`{REPO_ROOT}` resolves the same way Step 4.5 already
documents). Bands are computed by `classifyStaleness(ageMs, thresholdMs)`
(`bin/lib/issues/record-buckets.js`) against the resolved `record-staleness-weeks` threshold
(default 4 weeks): `fresh` below half the threshold, `review` from half the threshold up to
and including the threshold itself, `stale` beyond it. Shapes 1 and 2 below are the only
consumers of this scale — Step 3's design-doc age rows and Step 4.7's claim-staleness
rows read different data sources and are not governed by `record-staleness-weeks`.

The predicates referenced below (`isBacklog`, `isParked`, `isBotBlocked`) and `classifyStaleness`
come from `require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record-buckets.js')`
(`bin/lib/issues/record-buckets.js`).

**Worklist rule (Shapes 1, 2, 3, 4, 5, 7, 8).** Per `_shared/work-record.md`'s worklist rule — a
headless unit skips any record another unit is already asking a human to decide — every
record-scoped shape below excludes a record carrying a `needs:*`-prefixed label from its own
findings, before applying that shape's own classification. `work-backend: github-issues`: exclude
any record whose raw `labels` array (preserved alongside `facets` by the shared fetch above)
contains a name matching `/^needs:/`. `work-backend: local-files`: exclude any record with
`facets.needsDefinition === true` — the only `needs:*` concept this driver structurally carries;
`needs:decision` is a `github-issues`-only label in this record's scope, with no local-files facet
to check. Shapes 5.5 and 6 are exempt — 5.5 never mutates anything (it only surfaces a rename
recommendation), and 6 is a stub pointing at Step 4.8. This is the first of the worklist rule's two
checks. The second, narrower one — same shape list, `work-backend: github-issues` only (the local
driver carries no comment mechanism to check): before collecting a finding, read the record's
`<!-- needs-decision: tidy -->` comments (`_shared/work-record.md`'s Decision-comment template) and
skip collecting this finding when an UNRESOLVED one (no `**Resolved:**` line) has a `Proposed:` line
matching this finding's own proposed action, word for word. A comment whose `Proposed:` text names a
different action never suppresses this finding — only an identical proposal already awaiting the
same decision does. Only `needs-decision: tidy`-tagged comments are consulted; a comment another
unit wrote (`backlog-refine`, `backlog-grant`) never suppresses a `/tidy` finding. Writing the
marker itself — the comment-then-label ordering and the repair rule for a label with no matching
comment — is `decision-markers.md`'s scope, cited from Phase 6, not restated here.

### Shape 1 — backlog record stale

`isBacklog(record)` (`bin/lib/issues/record-buckets.js`) — no stage label (`github-issues`) or no `stage:` frontmatter (`local-files`); the default state, per `_shared/work-record.md`'s lifecycle spine. Classify by the staleness clock above:

| Age | Default Recommendation |
|-----|----------------------|
| Fresh | Keep |
| Review | Keep (unless clearly stale) |
| Stale | Delete or Promote |

**Decomposition parents are exempt — always `Keep`, at every age.** A record carrying `parent-issue` (`github-issues`) or `facets.isParentIssue === true` (`local-files`) is `isBacklog` by construction and forever: `/claude-tweaks:specify` never gives a parent a stage label and nothing ever promotes one, so every live parent crosses the staleness threshold and lands on `Delete or Promote` while its sub-issues are still being built — and `Delete` here is `gh issue close --reason "not planned"`, which destroys the decomposition's only acceptance checkpoint. Sub-issues landing weeks apart is the dominant workflow, so a parent going stale mid-decomposition is the common case, not the edge one. Give the row the reason inline (`Keep — decomposition parent, gated by the parent-gate sweep, not by staleness`) rather than dropping it silently, so a reader sees why one stale-looking record is being left alone. **Name the sweep the resolved driver actually uses** — Step 4.8's `parent-gate` scope under `github-issues`, **Shape 7 below** under `local-files` — since citing Step 4.8 on a project that never runs it points the reader at a sweep that will never produce the row it promises. Either way, that sweep is what acts on parents and this shape must not race it with a contradictory recommendation for the same record; under `local-files` they are not even separate agents — Shape 7 runs in this same Step 1 prompt, so a `Delete or Promote` row here would contradict a `[parent-gate]` row this same agent emits in the same reply.

**Digest containers are exempt too — always `Keep`, at every age.** An issue carrying `digest` is the materiality floor's rolling container (`_shared/materiality-floor.md`), not a work record: it never gets a stage label, so like a decomposition parent it is `isBacklog` by construction and forever, and a long-lived container inevitably crosses the staleness threshold — where `Delete` would close it out from under every entry it holds. Give the row the reason inline (`Keep — materiality-floor digest container, its lifecycle is Step 5.6's digest sweep, not staleness`). Only that sweep ever closes a digest issue (its 100-comment rollover), and it bootstraps the replacement in the same move — so this shape must not race it, exactly as it must not race the `parent-gate` sweep above.

→ Collect each as: `[backlog] {title} — {age} — {recommendation}`

### Shape 2 — parked trigger met

`isParked(record)` (`bin/lib/issues/record-buckets.js`). Judge the trigger live — the same evidence `_shared/github-pr-scan.md`'s `repo-wide` scope already reads, so this shape and that procedure never disagree:

| Trigger status | Default Recommendation |
|---------------|----------------------|
| Milestone attached, `milestoneDueOn` is in the past | Promote (re-run `/claude-tweaks:specify`) |
| A `**Watched paths:**` line in the body names a path with a matching commit since the record was parked (per `git log`), and that commit's own diff/message does not already resolve the record's described problem | Promote |
| A `**Watched paths:**` line in the body names a path with a matching commit since the record was parked (per `git log`), **and that commit's own diff/message already resolves the record's described problem** | Delete — already implemented (cite the resolving commit SHA in the closing comment) |
| Neither trigger met, not yet `Stale` (per the staleness clock above) | Keep |
| Neither trigger met, `Stale` (per the staleness clock above) | Re-evaluate or delete |
| Prose-only trigger, no clear date/path condition | Judge live each sweep — Keep, or move back to backlog state. When the trigger states a blocker as settled fact rather than naming an event to wait for, re-verify that fact directly against live evidence (grep the codebase/API/config for the asserted absence) — don't only search for an announcement that it was resolved |

A watched-path match is a signal to look again, not proof the record still needs work — read the matching commit's diff and message before recommending Promote. A commit that merely touches the watched path is not evidence the underlying problem is solved; only a commit whose content demonstrably addresses what the record describes counts as resolved. Conflating the two risks recommending `/claude-tweaks:specify` on a record whose work is already done, producing a redundant decomposition.

The prose-only row's live-evidence guard exists because a trigger can state its blocker as settled fact (e.g. #68: "Blocked today on an upstream capability that does not exist") — judging only whether that fact was ever announced resolved searches indefinitely for release notes that never arrive when the capability existed undocumented all along, or never existed as claimed. Re-verifying the blocker itself, not a report about it, closes that gap. The milestone row and the two watched-paths rows above are audited and confirmed immune to this same failure mode: a past-due `milestoneDueOn` and a matching commit since the record was parked are themselves the live evidence, not an announcement about it, so judging them live already checks the fact rather than a report of the fact — no separate guard is needed there.

→ Collect each as: `[parked] {title} — {recommendation}`

`local-files`: the same trigger lives as body prose — `local-store.js`'s facet schema carries no dedicated trigger/milestone/watched-paths keys, so a locally parked record's `**Trigger:**` (and, when file-shaped, `**Watched paths:**`) line is read straight out of the record body, judged exactly the same way.

### Shape 3 — unsynced local record

`work-backend: github-issues` only. Every record this step's session-scoped `$TIDY_UNSYNCED` returned (`facets.unsynced === true`) is a local fallback from a failed GitHub write — `/claude-tweaks:capture`'s or `/claude-tweaks:specify`'s failure path (`_shared/work-record.md`). This is F9 from the program promise register: it covers `specs/{id}-{slug}.md` records with `unsynced: true` facets, exactly the artifact `/capture` and `/specify` already promise `/tidy` reconciles.

→ Collect each as: `[unsynced] {title} — local-only, not yet mirrored to GitHub — Sync to GitHub`

### Shape 4 — ready record missing scoring

`facets.stage === 'ready'` and (`facets.risk === null` or `facets.size === null`). Labels are projection, not truth (`_shared/work-record.md`) — a `ready` record reaching this state without scoring usually means the label was hand-added on GitHub rather than stamped by `/claude-tweaks:specify`'s Shaping mode or a health skill's born-ready filing. `/claude-tweaks:backlog refine`'s own grant sub-stage would flag the identical gap reactively when it next pulls the `ready` queue; this surfaces it proactively during hygiene instead of waiting for a refine run.

→ Collect each as: `[scoring] {title} — missing {risk|size|both} — flag for scoring (/claude-tweaks:specify re-stamps it)`

### Shape 5 — `bot:blocked` needing re-triage

`isBotBlocked(record)` (`bin/lib/issues/record-buckets.js`; `work-backend: github-issues` only — the local driver's `facets.bot.blocked` is always `false`, per `facet-shape.js`'s shared defaults, so this predicate never fires there). The record hit its retry ceiling (`_shared/issue-claims.md`, `dispatch/SKILL.md`'s Settle step) and needs a human's renewed judgment at `/claude-tweaks:backlog refine` before it can re-enter the autonomous queue.

→ Collect each as: `[blocked] {title} — hit its retry ceiling — re-authorize at /claude-tweaks:backlog refine`

### Shape 5.5 — record carries a retired taxonomy label

**`work-backend: github-issues` only** — the retired vocabulary below is GitHub-label-only, and a
local record's frontmatter schema never held it (the driver note above). Numbered 5.5 rather than
appended, so Shapes 6, 7, and 8 keep the numbers other files already cite.

Read the raw `labels` array the shared fetch preserves alongside `facets`, **not** the parsed
facets: a retired label is by definition one `parseRecordFacets` projects into the *renamed*
facet, so a facets-only read cannot tell which of the two label spellings produced it.

Retired labels — [IL-85] PERMANENT adopter-compat list; entries removable only at a major version dropping pre-rename repo support:

| Retired label | Current name | Renamed by |
|---|---|---|
| `family:parent` | `parent-issue` | #339 — see `_shared/work-record.md`'s Label taxonomy |
| `framing:baked` | `solution:unjustified` | #475 — see `_shared/work-record.md`'s Label taxonomy |

A record carrying an entry above is still **read** correctly everywhere: `_shared/github-pr-scan-acceptance.md`'s
`parent-gate` and `acceptance-gap` scopes fetch both spellings for `family:parent`/`parent-issue`,
and `record.js`/`local-store.js` keep the matching legacy-label/frontmatter fallback for every row
in this table. This shape does not fix a broken read — it surfaces the rename as a one-command
hygiene action, so an adopter repo eventually stops needing the compatibility path at all. The
recommended command is the current-name rename for whichever retired label was found on this
record — `{retired}`/`{current}` below are that row's own two columns, not a literal.

→ Collect each as: `[legacy] {title} — carries retired label {retired} — recommend: gh label edit "{retired}" --name "{current}"`

Severity `info`, and **no mutation** — the row is surfaced for visibility and the rename stays the
user's call, since `gh label edit` re-labels every issue carrying it repo-wide in a single
outward-facing API write. It is therefore not one of the Action
Vocabulary's atomic actions (`SKILL.md`), and routes as an always-surfaced no-op at every
aggressiveness tier (`step-6-auto.md`'s **Legacy taxonomy** row), exactly like Shapes 4 and 5.

### Shape 5.6 — `bot:parked` needing re-triage

**`work-backend: github-issues` only** — same local-driver caveat as Shape 5 (`facets.bot.parked` is always `false` on the local driver). Numbered 5.6 rather than appended, for the same reason as Shape 5.5 — Shapes 6, 7, and 8 keep the numbers other files already cite.

`isBotParked(record)` (`bin/lib/issues/record-buckets.js`). `_shared/pr-first-merge.md`'s Step 2.5 (Merge-verification gate) parked it on a red or timed-out check on its PR — a distinct label from Shape 5's `bot:blocked`, since this path parks **without** revoking any grant (a CI park is not a build failure, so there is no Settle classification and no retry increment behind it). Re-triage here means checking the PR's checks, not re-authorizing a build.

→ Collect each as: `[bot-parked] {title} — merge-verification parked it on a red/timed-out PR check — check the PR, then resume via /claude-tweaks:dispatch`

### Shape 6 — flagged code demonstrably gone

Not scanned here. This is Step 4.8's code-health/harness-health/journey-health/docs-health issue judgment (`_shared/github-pr-scan.md`'s `repo-wide` scope, items 3/5/6/7) — unchanged by this merge. It's listed in this file only so the finding shapes the record-scan design replaces (former Steps 1 and 2, plus former Step 4.8's backlog-issue item) stay documented in one place; the mechanics that actually judge "is the flagged code gone" continue to live where they already did.

### Shape 7 — decomposition parent gate due

**`work-backend: local-files` only.** Finds decomposition parents whose every sub-issue has closed
but which carry no acceptance disposition yet — the population
`/claude-tweaks:wrap-up`'s Parent-Gate Procedure (`wrap-up/verification-brief.md`) gates eagerly
when it closes a parent's last sub-issue. A parent whose last sub-issue closes any other way — by
hand, or by a run that ended before wrap-up — never reaches that eager path; this shape catches it
after.

Both backstop shapes below (this one and Shape 8) filter out below-floor candidates the same way
their `github-issues` counterparts do — the same `bin/lib/issues/oversight-floor.js` predicate
(#366), mirrored here rather than reimplemented. Each shape resolves `risk-floor`/`size-floor`
**once, inside its own code block** (one `resolve-policy.js` call regardless of population size,
never resolved per record) and passes the printed values as literal `process.argv` arguments to
that same block's script — never resolved in a separate block and carried over via a shell
variable, since shell state does not survive between separate Bash calls (the same discipline
`_shared/github-pr-scan-acceptance.md`'s fetch-limit/work-links resolutions state for their own
identical case). A closed record below the floor never needed a disposition in the first place, so
it is not a gap.

It is the local twin of Step 4.8's `parent-gate` scope (`_shared/github-pr-scan-acceptance.md`) — same
finding, same `[parent-gate]` prefix, same `Open parent gate` action; only the store differs. It
lives in this step rather than that file because that file is skipped whole whenever `gh` is
absent, and a sweep needing no `gh` must not inherit that skip; that scope's own header states
the full reasoning, including what `_shared/forge-detection.md`'s Detection Ladder (which that scope runs behind) does and does not gate on.

Classification is entirely `parentGateState`'s (`bin/lib/issues/acceptance.js`) — do not
reimplement it. That predicate is backend-agnostic: it takes `{subIssues, parentLabels}` (the shipped
signature's own key names), and a local parent's disposition translates to the one-element
`['demo:' + facets.acceptance]` (empty when unset), exactly as
`wrap-up/verification-brief.md`'s **Evaluate the gate** does for this driver.

It needs its own query, not Step 1's shared fetch: that fetch returns open records only and
carries no sub-issue-to-parent index, and a parent's sub-issues are closed by definition when its
gate is due.

A parent's aggregate risk is the **max** `risk:*` tier across its sub-issue records — never a size
read at the parent level (a local parent carries no scoring of its own, same as its `github-issues`
counterpart), and the predicate call below passes the literal `sizeFloor: null`, never the resolved
`$SIZE_FLOOR` value: passing the real value here, with no `size` facet to read, would fail every
parent closed on a missing size it was never meant to have. Any single unscored sub-issue (missing
or out-of-vocabulary `risk`) makes the whole parent's aggregate unscored too, matching
`exceedsOversightFloor`'s own fail-closed rule:

```bash
RISK_FLOOR=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor)
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const { parentGateState } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/acceptance.js');
  const { exceedsOversightFloor } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/oversight-floor.js');
  const { TIERS } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
  const [riskFloor] = process.argv.slice(1);
  const parents = queryRecords('specs', { isParentIssue: true });
  const gates = parents.map((p) => {
    const subIssueRecords = [
      ...queryRecords('specs', { parent: p.id }),
      ...queryRecords('specs', { parent: p.id, closed: true }),
    ];
    return {
      id: p.id,
      title: p.title,
      path: p.path,
      needsDefinition: p.facets.needsDefinition === true,
      parentLabels: p.facets.acceptance ? ['demo:' + p.facets.acceptance] : [],
      subIssues: subIssueRecords.map((r) => ({ number: r.id, state: r.facets.closed ? 'CLOSED' : 'OPEN', risk: r.facets.risk })),
    };
  });
  function maxRiskTier(subIssues) {
    let hasUnscored = false;
    let maxIndex = -1;
    for (const subIssue of subIssues) {
      const index = TIERS.indexOf(subIssue.risk);
      if (index === -1) { hasUnscored = true; continue; }
      if (index > maxIndex) maxIndex = index;
    }
    return hasUnscored ? undefined : TIERS[maxIndex];
  }
  gates
    .filter((f) => !f.needsDefinition)
    .filter((f) => exceedsOversightFloor({ risk: maxRiskTier(f.subIssues) }, { riskFloor, sizeFloor: null }).exceeds)
    .filter((f) => parentGateState({ subIssues: f.subIssues, parentLabels: f.parentLabels }) === 'due')
    .forEach((f) => console.log(f.path + '\t[parent-gate] ' + f.id + ': ' + f.title + ' — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo ' + f.id));
" "$RISK_FLOOR"
```

Each line is `{path}<TAB>{finding}` — the path fills the row's `Path:Line` column (`SKILL.md`'s
Tidy-specific column semantics: the local record path on this driver, where `github-issues` rows
carry `#{n}`), the rest is the finding.

Both `queryRecords` shapes are deliberate. `{ isParentIssue: true }` returns **open** parents only
(closed records are excluded unless the filter names `closed`) — the right set, since a closed
parent was already dispositioned and closed by `/claude-tweaks:demo`, and it mirrors the
`github-issues` scope's `--state open` fetch. The sub-issue listing is the open+closed two-call
merge for the same reason: one call alone drops every closed sub-issue, exactly the ones that make
a gate due. No fetch-limit or truncation warning applies, unlike the API-paging twin —
`queryRecords` reads the whole `specs/` directory every call.

→ Collect each as: `[parent-gate] {id}: {title} — parent complete, no acceptance disposition — Open parent gate, then /claude-tweaks:demo {id}`

Severity `info` — with several open decompositions this is a standing backlog, not a defect
count, and Step 6 caps rows highest-severity-first (the same tier and reason as its
`github-issues` twin). The recommendation is the `Open parent gate` action, staged at every
aggressiveness tier and never writing `demo:approved`/`demo:changes-requested`, which is why the
row still ends with `/claude-tweaks:demo {id}`; `actions-local-files.md`'s `## Open parent gate`
and `step-6-auto.md`'s row carry that action's execution, its staging reasoning, and what it
does not cover.

### Shape 8 — closed record with no acceptance disposition

**`work-backend: local-files` only.** Finds records that closed carrying no acceptance
disposition at all — work that shipped and disappeared with nothing on record about whether it
actually solved the problem. Its `github-issues` counterpart is Step 4.8's `acceptance-gap` scope
(`_shared/github-pr-scan-acceptance.md`), and this shape exists for the same reason Shape 7 does: that scope
queries GitHub labels, and its whole file is skipped whenever `gh` is unreachable — its Detection
Ladder gates on remote/install/auth, never on the driver — so a sweep that needs no `gh` must not
inherit that skip. Same `[acceptance-gap]` prefix, same recommendation, same severity, so no
consumer distinguishes the two; only the store differs.

This is the backstop, not the eager path. `/claude-tweaks:wrap-up` applies a disposition as it
closes a record it owns (`wrap-up/verification-brief.md`); a record closed any other way — by
hand, by a `closed: true` frontmatter edit, by a run that ended before wrap-up — never reaches
that path, and with no sweep here would stay invisible permanently.

Classification is entirely `needsBackstop`'s (`bin/lib/issues/acceptance.js`) — do not reimplement
the disposition taxonomy. That predicate is backend-agnostic: it reads `{state, labels,
hasParent}`, and a local record translates as `facets.closed === true` → `state: 'CLOSED'`,
`facets.acceptance` → the one-element `['demo:' + facets.acceptance]` and empty when unset (the
identical translation Shape 7 and `wrap-up/verification-brief.md`'s `local-files` paths already
use), and `facets.parent !== null` → `hasParent`.

**Excluding decomposed sub-issues is load-bearing, not a refinement.** `needsBackstop` returns
`false` for anything passed `hasParent: true`, because a sub-issue's acceptance lives on its parent
issue — Shape 7's population — and never on the sub-issue. Drop that translation and every
sub-issue of every closed decomposition lands here as a row, flooding the report with exactly the
records another shape already covers. That is the same reason the `github-issues` scope resolves
its own sub-issue set before filtering.

It needs its own query, not Step 1's shared fetch: that fetch returns open records only, and every
record this shape looks at is closed by definition. `risk-floor`/`size-floor` are resolved again
here, independently of Shape 7's own resolution above — per the discipline stated at the top of
Shape 7, shell state does not survive between separate Bash calls, so a value resolved there is
empty here:

```bash
{ read -r RISK_FLOOR; read -r SIZE_FLOOR; } < <(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values risk-floor size-floor)
node -e "
  const { queryRecords } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/local-store.js');
  const { needsBackstop } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/acceptance.js');
  const { exceedsOversightFloor } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/oversight-floor.js');
  const [riskFloor, sizeFloor] = process.argv.slice(1);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  queryRecords('specs', { closed: true })
    .filter((r) => r.facets.needsDefinition !== true)
    .filter((r) => {
      const closedAt = Date.parse(r.facets.closedAt);
      return Number.isNaN(closedAt) || closedAt >= cutoff;
    })
    .filter((r) => exceedsOversightFloor({ risk: r.facets.risk, size: r.facets.size }, { riskFloor, sizeFloor }).exceeds)
    .filter((r) => needsBackstop({
      state: r.facets.closed ? 'CLOSED' : 'OPEN',
      labels: r.facets.acceptance ? ['demo:' + r.facets.acceptance] : [],
      hasParent: r.facets.parent !== null,
    }))
    .forEach((r) => console.log(r.path + '\t[acceptance-gap] ' + r.id + ': ' + r.title + ' — closed with no acceptance disposition — recommend /claude-tweaks:demo ' + r.id));
" "$RISK_FLOOR" "$SIZE_FLOOR"
```

Each line is `{path}<TAB>{finding}`, the same shape Shape 7 emits — the path fills the row's
`Path:Line` column (`SKILL.md`'s Tidy-specific column semantics: the local record path on this
driver, where `github-issues` rows carry `#{n}`), the rest is the finding.

`{ closed: true }` is required, not decorative. `queryRecords` mirrors `gh issue list --state
open` and drops every closed record unless the filter names `closed`
(`bin/lib/issues/local-store.js`), so the bare `queryRecords('specs', {})` this step's shared
fetch uses returns exactly zero of this shape's population — silently, with no error to say so.
No fetch-limit or truncation warning applies, unlike the API-paging twin: `queryRecords` reads the
whole `specs/` directory every call.

The 30-day window nominally matches the `github-issues` scope's own closed-record set. It reads
`closed-at:`, which `closeRecord` stamps — **and deliberately keeps every record whose `closedAt`
is absent or unparseable**, regardless of age. A record closed by a hand-edited `closed: true`
with no timestamp is precisely the un-dispositioned, nobody-remembers-it case this backstop exists
for, so the bound fails open, toward surfacing; filtering on a missing timestamp would drop the
shape's best population. **`#205`: this makes "same population" true only for the timestamped
majority** — `gh issue list` always stamps a real `closedAt` on a closed issue, so the
`github-issues` twin has no equivalent fail-open case and its 30-day cutoff is strict. A
hand-closed local record with no timestamp can surface here at any age; its `github-issues`
counterpart cannot. The population this shape actually catches skews toward exactly that
untimestamped set — `closeRecord`-closed records (the common path) always get a timestamp and so
are excluded past 30 days like the other driver.

→ Collect each as: `[acceptance-gap] {id}: {title} — closed with no acceptance disposition — recommend /claude-tweaks:demo {id}`

Severity `info` — the same tier and the same reason as its `github-issues` twin: on a project that
closes records ad hoc this is a standing backlog rather than a defect count, and Step 6 caps rows
highest-severity-first, so any tier above `info` would permanently evict actionable rows beneath
it. Unlike Shape 7, the recommendation is **not** one of the Action Vocabulary's atomic actions —
this shape mutates nothing at all, on either driver. It recommends `/claude-tweaks:demo {id}` and
stops there, because disposing a closed record is a human judgment about whether shipped work
solved the problem. It is staged at every aggressiveness tier for that reason (`step-6-auto.md`'s
Acceptance-gap row, which covers both drivers), the auto-mode contract keeping that judgment off
what `auto` silences.
