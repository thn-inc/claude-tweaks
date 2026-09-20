# Label Bootstrap — Shared Check-Then-Create Snippet

The canonical check-then-create loop every label-filing skill in this codebase uses.
Referenced by the work-record consumers (`_shared/work-record.md` is the taxonomy home —
health skills, `/capture`, `/specify`, `/backlog`, `/dispatch`, `/tidy`,
`wrap-up/cleanup-procedures-execution.md` Section E and `flow/multispec-review-console.md` for the
shared `parked` restoration step). Consumers reference this file; do not restate the loop
inline.

Given a `LABELS` array of `[name, description]` pairs. Resolve this run's session-scoped temp
path first, per `_shared/session-tmp-root.md`:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" LABEL_BOOTSTRAP_PAYLOADS=label-bootstrap-payloads.json)"
node -e "
  const { ensureLabelPayload } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/labels.js');
  const labels = ${LABELS_JSON};
  console.log(JSON.stringify(labels.map(([n, d]) => ensureLabelPayload(n, d))));
" > "$LABEL_BOOTSTRAP_PAYLOADS"
node -e "const ls=require('$LABEL_BOOTSTRAP_PAYLOADS'); ls.forEach(l => console.log(l.name + '\t' + l.description))" | while IFS=$'\t' read -r NAME DESCRIPTION; do
  gh label list --search "$NAME" --json name -q '.[].name' | grep -qx "$NAME" || \
    gh label create "$NAME" --description "$DESCRIPTION"
done
```

`ensureLabelPayload` throws at construction if a description exceeds GitHub's 100-char cap
(`bin/lib/issues/labels.js`) — a too-long description fails loudly here, not as a silent 422 on
`gh label create`. `${LABELS_JSON}` is a literal JS array-of-pairs, substituted inline by each
consumer with its own label list — for a single label, use a one-element array
(`[['bot:blocked', '...']]`) rather than reaching for a separate single-label variant.

## One-shot bootstrap marker

Before running the check-then-create loop above, every consumer checks one repo-wide marker
label instead of probing each label it's about to apply individually — this is the fix for the
common case (11 `gh label list` probes repeating every run once the canonical set already
exists):

```bash
gh label list --search "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" --json name -q '.[].name' \
  | grep -qx "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" && SKIP_BOOTSTRAP=true || SKIP_BOOTSTRAP=false
```

`{LABEL_BOOTSTRAP_VERSION}` is the literal integer below — **current value: `7`**. Bump it (and
this literal) whenever a label is added to or removed from the canonical `LABELS_JSON` array
below. A marker stamped under the old version no longer matches the search after a bump, so the
next consumer's Preflight falls through to the full loop, re-establishes the set (including
whatever changed), and re-stamps the marker at the new version — the versioning is what keeps this
compatibility path from silently stopping coverage of labels added later (IL-85).

- **`SKIP_BOOTSTRAP=true`** — the canonical set already exists (established by a prior consumer
  in this repo, or `/init`'s one-time provision-now offer). Skip the check-then-create loop
  entirely for this consumer's own labels — zero `gh label list` probes.
- **`SKIP_BOOTSTRAP=false`** — run the check-then-create loop above exactly as documented
  (unchanged: per-label probe-then-create). After it completes with no `ensureLabelPayload`
  errors, retire any stale-version marker and stamp the current one:
  ```bash
  gh label list --search "claude-tweaks:bootstrapped-v" --json name -q '.[].name' | grep "^claude-tweaks:bootstrapped-v" \
    | while read -r OLD; do gh label delete "$OLD" --yes 2>/dev/null; done
  gh label create "claude-tweaks:bootstrapped-v{LABEL_BOOTSTRAP_VERSION}" \
    --description "claude-tweaks: canonical label set established (internal bootstrap marker, not a work-record facet)" 2>/dev/null || true
  ```

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
  ["by:code-health",    "Origin: filed by the code-health skill"],
  ["by:harness-health", "Origin: filed by the harness-health skill"],
  ["by:journey-health", "Origin: filed by the journey-health skill"],
  ["by:docs-health",    "Origin: filed by the docs-health skill"],
  ["by:capture",        "Origin: filed via /capture"],
  ["by:dispatch",       "Origin: self-filed by /claude-tweaks:dispatch on a headless Preflight failure"],
  ["risk:low",          "Scoring: low blast radius — safe for autonomous build"],
  ["risk:medium",       "Scoring: moderate blast radius — review before merge recommended"],
  ["risk:high",         "Scoring: high blast radius — human review required"],
  ["size:low",          "Scoring: small, agent-sized change"],
  ["size:medium",       "Scoring: moderate change, may span several files"],
  ["size:high",         "Scoring: large change — consider decomposition before building"],
  ["ceremony:fast-lane", "Ceremony: small/clean record — proportionately fewer review & wrap-up steps"],
  ["ceremony:standard",  "Ceremony: default depth — full review & wrap-up ceremony applies"],
  ["parked",            "Stage: deliberately on hold until its trigger fires (milestone due or watched path change)"],
  ["ready",             "Stage: spec-shaped and agent-sized — in the authorization gate's worklist"],
  ["auto:build",        "Grant: agents may build this record autonomously (human-granted; machinery only removes)"],
  ["auto:merge",        "Grant: a clean autonomous run may merge unreviewed (stacks on auto:build; alone inert)"],
  ["auto:merge-pending", "Grant: machine-granted merge trust awaiting its veto window (matures to auto:merge)"],
  ["bot:in-progress",   "Bot state: an agent currently holds the claim on this record"],
  ["bot:blocked",       "Bot state: hit the retry ceiling — needs re-authorization before autonomous retry"],
  ["bot:parked",        "Bot state: merge-verification parked it (CI red/timed-out) — auto:* grants stay intact"],
  ["demo:pending",           "Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo"],
  ["demo:approved",          "Acceptance: a human verified this record does what was asked"],
  ["demo:approved-batch",    "Acceptance: approved via /demo's #N,#M batch — no per-record walkthrough"],
  ["demo:changes-requested", "Acceptance: a human found a gap during sign-off — see the linked follow-up record"],
  ["wontfix",           "Closed as not-planned; health skills will not re-file findings with this fingerprint"],
  ["upstream-candidate", "A headless health-sweep finding about claude-tweaks — forward via /claude-tweaks:feedback"],
  ["parent-issue",      "Structure: parent issue — carries the acceptance gate for its sub-issues"],
  ["solution:unjustified",   "Solution: named without being traded off against alternatives — add evidence or accept the risk"],
  ["breaking",          "Compatibility: a contract change — merge subject gets ! and a BREAKING CHANGE: footer"],
  ["needs:definition",  "Undecided idea — must go through /specify's brainstorm redirect before reaching ready"],
  ["needs:decision",    "a headless unit proposed an action it may not take alone — see the newest decision comment"],
  ["shaped:headless",   "Provenance: shaped by /specify's headless next unit — no human reviewed the spec body"],
  ["priority:high",     "Priority: dispatch picks this band first"],
  ["priority:medium",   "Priority: dispatch picks after priority:high"],
  ["priority:low",      "Priority: dispatch picks last among prioritized records"],
  ["digest",            "Container: rolling digest for below-floor deferred findings (see _shared/materiality-floor.md)"]
]
```
