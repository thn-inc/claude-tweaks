# Label Bootstrap — Shared Check-Then-Create Snippet

The canonical check-then-create loop every label-filing skill in this codebase uses.
Referenced by the work-record consumers (`_shared/work-record.md` is the taxonomy home —
health skills, `/capture`, `/specify`, `/backlog`, `/dispatch`, `/tidy`,
`wrap-up/cleanup-procedures-execution.md` Section E and `flow/multispec-review-console.md` for the
shared `parked` restoration step). Consumers reference this file; do not restate the loop
inline.

Given a `LABELS` array of `[name, description, color]` triples. Resolve this run's session-scoped
temp path first, per `_shared/session-tmp-root.md`:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" LABEL_BOOTSTRAP_PAYLOADS=label-bootstrap-payloads.json)"
node -e "
  const { ensureLabelPayload } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/labels.js');
  const labels = ${LABELS_JSON};
  console.log(JSON.stringify(labels.map(([n, d, c]) => ensureLabelPayload(n, d, c))));
" > "$LABEL_BOOTSTRAP_PAYLOADS"
node -e "const ls=require('$LABEL_BOOTSTRAP_PAYLOADS'); ls.forEach(l => console.log(l.name + '\t' + l.color + '\t' + l.description))" | while IFS=$'\t' read -r NAME COLOR DESCRIPTION; do
  gh label list --search "$NAME" --json name -q '.[].name' | grep -qx "$NAME" || \
    gh label create "$NAME" --color "$COLOR" --description "$DESCRIPTION"
done
```

`ensureLabelPayload` throws at construction if a description exceeds GitHub's 100-char cap, or if
`color` is missing or not six hex digits with no leading `#` (`bin/lib/issues/labels.js`) — either
fails loudly here, not as a silent 422 on `gh label create`. `${LABELS_JSON}` is a literal JS
array-of-triples, substituted inline by each consumer with its own label list — for a single
label, use a one-element array (`[['bot:blocked', '...', 'FBCA04']]`) rather than reaching for a
separate single-label variant.

## One-shot bootstrap marker

Before running the check-then-create loop above, every consumer checks one repo-wide marker
label instead of probing each label it's about to apply individually — this is the fix for the
common case (11 `gh label list` probes repeating every run once the canonical set already
exists):

```bash
gh label list --search "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" --json name -q '.[].name' \
  | grep -qx "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" && SKIP_BOOTSTRAP=true || SKIP_BOOTSTRAP=false
```

`{LABEL_BOOTSTRAP_VERSION}` is the literal integer below — **current value: `8`**. Bump it (and
this literal) whenever a label is added to or removed from the canonical `LABELS_JSON` array
below, **or whenever an existing label's description or color changes** (#1873 — a color-only
convention update is exactly this case). A marker stamped under the old version no longer matches
the search after a bump, so the next consumer's Preflight falls through to the full loop,
re-establishes the set (including whatever changed) via the reconcile branch below, and re-stamps
the marker at the new version — the versioning is what keeps this compatibility path from silently
stopping coverage of labels (or label metadata) added later (IL-85).

- **`SKIP_BOOTSTRAP=true`** — the canonical set already exists (established by a prior consumer
  in this repo, or `/init`'s one-time provision-now offer). Skip the check-then-create loop
  entirely for this consumer's own labels — zero `gh label list` probes.
- **`SKIP_BOOTSTRAP=false`** — run the check-then-create loop above exactly as documented
  (unchanged: per-label probe-then-create), **then reconcile every canonical label that already
  existed** (#1873): for each label in `$LABEL_BOOTSTRAP_PAYLOADS` that the loop above found
  already present (skipped its own `gh label create`), compare its live `color`/`description`
  against the payload and `gh label edit` only on a mismatch — never unconditionally, since an
  edit call per label on every version bump is exactly the cost the marker exists to avoid:
  ```bash
  node -e "const ls=require('$LABEL_BOOTSTRAP_PAYLOADS'); ls.forEach(l => console.log(l.name + '\t' + l.color + '\t' + l.description))" | while IFS=$'\t' read -r NAME COLOR DESCRIPTION; do
    LIVE=$(gh label list --search "$NAME" --json name,color,description -q ".[] | select(.name == \"$NAME\") | .color + \"\t\" + .description")
    LIVE_COLOR=$(printf '%s' "$LIVE" | cut -f1)
    LIVE_DESC=$(printf '%s' "$LIVE" | cut -f2-)
    if [ -n "$LIVE" ] && { [ "${LIVE_COLOR^^}" != "$COLOR" ] || [ "$LIVE_DESC" != "$DESCRIPTION" ]; }; then
      gh label edit "$NAME" --color "$COLOR" --description "$DESCRIPTION"
    fi
  done
  ```
  This reconcile pass runs once per version bump (gated on `SKIP_BOOTSTRAP=false`, the same
  version-bump-only path the create loop already runs on), never on the common
  `SKIP_BOOTSTRAP=true` case, so it costs nothing when the set is already current. After it
  completes with no `ensureLabelPayload` errors, retire any stale-version marker and stamp the
  current one:
  ```bash
  gh label list --search "claude-tweaks:bootstrapped-v" --json name -q '.[].name' | grep "^claude-tweaks:bootstrapped-v" \
    | while read -r OLD; do gh label delete "$OLD" --yes 2>/dev/null; done
  gh label create "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" --color EDEDED \
    --description "claude-tweaks: canonical label set established (internal bootstrap marker, not a work-record facet)" 2>/dev/null || true
  ```
  The marker's own color is a fixed neutral (`EDEDED`) so it reads visibly as bookkeeping, never
  as one of the graded or family colors above.

The marker is bootstrap-only bookkeeping: never applied to an issue, never read by
`parseRecordFacets` (which ignores unrecognized label prefixes), and carries no locking
semantics — a race between two concurrent first-bootstrappers at worst runs the check-then-create
loop twice, which is already idempotent (`gh label list --search` gates every `gh label create`).
A virgin repo (no marker, no labels) still creates the full set on its first bootstrapping
consumer, exactly as today; only the *re-probing* on every subsequent run is what this marker
removes.

## Canonical LABELS_JSON — the full work-record taxonomy

The complete label set from `_shared/work-record.md`'s Label taxonomy table (the core label
families plus the optional `priority:*` family — see that table for the current per-family
and total counts, rather than a count restated here), with descriptions pre-checked against
GitHub's 100-character cap. **Consumers bootstrap only the labels they are about to apply** —
copy the relevant pairs, don't create the full array below speculatively (except `/init`'s
one-time provision-now offer, which uses this list whole):

```js
[
  ["by:code-health",    "Origin: filed by the code-health skill", "BFD4F2"],
  ["by:harness-health", "Origin: filed by the harness-health skill", "BFD4F2"],
  ["by:journey-health", "Origin: filed by the journey-health skill", "BFD4F2"],
  ["by:docs-health",    "Origin: filed by the docs-health skill", "BFD4F2"],
  ["by:capture",        "Origin: filed via /capture", "BFD4F2"],
  ["by:dispatch",       "Origin: self-filed by /claude-tweaks:dispatch on a headless Preflight failure", "BFD4F2"],
  ["risk:low",          "Scoring: low blast radius — safe for autonomous build", "0E8A16"],
  ["risk:medium",       "Scoring: moderate blast radius — review before merge recommended", "FBCA04"],
  ["risk:high",         "Scoring: high blast radius — human review required", "D93F0B"],
  ["size:low",          "Scoring: small, agent-sized change", "D4C5F9"],
  ["size:medium",       "Scoring: moderate change, may span several files", "8B5CF6"],
  ["size:high",         "Scoring: large change — consider decomposition before building", "5319E7"],
  ["ceremony:fast-lane", "Ceremony: small/clean record — proportionately fewer review & wrap-up steps", "FEF2C0"],
  ["ceremony:standard",  "Ceremony: default depth — full review & wrap-up ceremony applies", "FEF2C0"],
  ["parked",            "Stage: deliberately on hold until its trigger fires (milestone due or watched path change)", "2EA44F"],
  ["ready",             "Stage: spec-shaped and agent-sized — in the authorization gate's worklist", "2EA44F"],
  ["auto:build",        "Grant: agents may build this record autonomously (human-granted; machinery only removes)", "1D76DB"],
  ["auto:merge",        "Grant: a clean autonomous run may merge unreviewed (stacks on auto:build; alone inert)", "1D76DB"],
  ["auto:merge-pending", "Grant: machine-granted merge trust awaiting its veto window (matures to auto:merge)", "1D76DB"],
  ["bot:in-progress",   "Bot state: an agent currently holds the claim on this record", "6A737D"],
  ["bot:blocked",       "Bot state: hit the retry ceiling — needs re-authorization before autonomous retry", "6A737D"],
  ["bot:parked",        "Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact", "6A737D"],
  ["demo:pending",           "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo", "006B75"],
  ["demo:approved",          "Acceptance: a human verified this record does what was asked", "006B75"],
  ["demo:approved-batch",    "Acceptance: approved via /demo's #N,#M batch — no per-record walkthrough", "006B75"],
  ["demo:changes-requested", "Acceptance: a human found a gap during sign-off — see the linked follow-up record", "006B75"],
  ["wontfix",           "Closed as not-planned; health skills will not re-file findings with this fingerprint", "CCCCCC"],
  ["upstream-candidate", "A headless health-sweep finding about claude-tweaks — forward via /claude-tweaks:feedback", "0052CC"],
  ["parent-issue",      "Structure: parent issue — carries the acceptance gate for its sub-issues", "E99695"],
  ["solution:unjustified",   "Solution: named without being traded off against alternatives — add evidence or accept the risk", "F9D0C4"],
  ["breaking",          "Compatibility: a contract change — merge subject gets ! and a BREAKING CHANGE: footer", "8B0000"],
  ["needs:definition",  "Undecided idea — must go through /specify's brainstorm redirect before reaching ready", "7057FF"],
  ["needs:decision",    "a headless unit proposed an action it may not take alone — see the newest decision comment", "7057FF"],
  ["shaped:headless",   "Provenance: shaped by /specify's headless next unit — no human reviewed the spec body", "CFD3D7"],
  ["priority:high",     "Priority: dispatch picks this band first", "B60205"],
  ["priority:medium",   "Priority: dispatch picks after priority:high", "FBCA04"],
  ["priority:low",      "Priority: dispatch picks last among prioritized records", "C2E0C6"],
  ["digest",            "Container: rolling digest for below-floor deferred findings (see _shared/materiality-floor.md)", "EEEEEE"]
]
```
