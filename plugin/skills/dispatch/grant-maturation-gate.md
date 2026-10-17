# Dispatch — Auto-merge Gate: Grant Maturation (Authorization)

Cited from `settle-and-merge.md`'s Auto-merge gate, Authorization step (in this skill's
directory) — the full two-phase procedure that step's compact paragraph points to. Also cited
from `wrap-up/auto-merge-short-circuit.md`'s own single-record Authorization step, which reuses
`evaluateMaturation` and the Phase 2 promotion write the same way, without this file's group-wide
phase split (a single record has no group to evaluate before acting on).

**Why two phases, not one.** Never interleave evaluation with promotion — a per-member "evaluate,
then immediately promote if matured" loop can promote an early member (real label swap +
`watched.json` seed) before a later member's result is even known; if that later member then
turns out `within-veto-window` or a permanent human veto, the group falls back to pending-review
as a whole but the early promotion has no rollback path — it sits stranded at `auto:merge` with
no realistic route back through this gate. The two phases below exist specifically to make that
ordering impossible.

**Phase 1 — evaluate every member, no side effects.** For each group member, read its live labels
and comments fresh (`gh issue view {n} --json labels,comments`) and run `evaluateMaturation`;
collect every member's `result` before acting on any of them. A member already carrying
`auto:merge` still runs through this — `hasMergeLabel: true` resolves deterministically to
`already-mature` regardless of any pending label (see the module's own check ordering). A member
instead carrying `auto:merge-pending` (never both at once — see `_shared/work-record.md`'s Grant
semantics) gets its real maturation check. This checkpoint is the "existing merge-consult step"
`grant-veto-window-hours` binds to, per `docs/donts.md`'s `[IL-94]`; there is no separate
scheduled job:

```bash
GRANT_VETO_WINDOW_HOURS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values grant-veto-window-hours)
# Run once per group member {n}; record each result (e.g. keyed by {n}) and move
# to the next member — do not act on a result inside this loop.
node -e "
  const { evaluateMaturation, extractPendingGrantedAt, partitionGrantComments } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/grant-maturation.js');
  // labels: this member's fetched label name array (issue.labels[].name).
  // comments: this member's fetched comment objects (issue.comments) - only Trusted authors'
  // bodies reach the grant date (_shared/pr-run-comments.md); each skipped one is named on stderr.
  const { bodies, skippedUntrusted } = partitionGrantComments(comments);
  skippedUntrusted.forEach((note) => console.error(note));
  const pendingSince = extractPendingGrantedAt(bodies);
  const result = evaluateMaturation({
    hasPendingLabel: labels.includes('auto:merge-pending'),
    hasMergeLabel: labels.includes('auto:merge'),
    pendingSince,
    vetoWindowHours: Number('$GRANT_VETO_WINDOW_HOURS'),
    now: new Date(),
  });
  console.log(JSON.stringify(result));
"
```

Carry each skipped-comment line the snippet prints to stderr into the gate's report, so a grant
marker that did not count is visible (`_shared/pr-run-comments.md`'s Trusted authors).

Once every member has a `result`, decide for the group as a whole — this decision gates whether
Phase 2 runs at all:

- **Every member's `result.state` is `already-mature` or `matured`** — the group clears
  Authorization. Proceed to Phase 2.
- **Any member's `result.state` is `within-veto-window`, `not-pending`, or `unknown-age`** — the
  group does NOT clear Authorization this firing. Per this section's own group-wide rule above,
  the **whole group** falls back to the normal pending-review path — apply **zero** promotions
  this firing, including for any other member whose own `result.state` was independently
  `matured` — mixed grants are never split at merge time, the same rule an `auto:build`-only
  member already gets. Do not run Phase 2 at all. For each non-clearing member, log:
  `AUTO {time} — Auto-merge gate: #{n}'s auto:merge-pending has not matured ({result.reason}) —
  group falls back to pending-review. Reversibility: n/a (no label change). [lever:
  grant-veto-window-hours={result.windowHours ?? GRANT_VETO_WINDOW_HOURS} (source)]`. A
  `not-pending` result with no `auto:merge` either is exactly a human veto — permanent, since
  nothing re-adds `auto:merge-pending` (`refine`'s headless posture's own candidate fetch already excludes
  any record carrying an existing `auto:build` grant, so a previously-granted-then-vetoed record
  is never re-evaluated by that gate chain again without a fresh human grant).

**Phase 2 — apply, reached only when every member cleared in Phase 1.** For each member whose
`result.state === 'already-mature'`, there is nothing to do — it already satisfies Authorization
exactly as before #309. For each member whose `result.state === 'matured'`, promote now:

```bash
gh issue edit {n} --remove-label auto:merge-pending --add-label auto:merge
node -e "
  const { writeWatched } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/merge-lane-breaker.js');
  writeWatched(process.cwd(), (current) => ({ ...current, ['{n}']: { grantedAt: new Date().toISOString() } }));
"
```

This is the seed write `refine-headless.md`'s own Step 4 used to perform at grant time before #309 —
it now happens here, at the moment merge trust actually activates, since a still-pending grant
has nothing yet for the circuit breaker to watch. Log:
`AUTO {time} — Auto-merge gate: matured #{n}'s auto:merge-pending to auto:merge ({result.ageHours}h
old, past the {result.windowHours}h veto window). Reversibility: high (label re-removable; no
merge has happened yet). [lever: grant-veto-window-hours={result.windowHours} (source)]`. Once
every `matured` member in the group is promoted this way, every group member satisfies
Authorization exactly as an already-`auto:merge` member does.

## Both sites, and why a veto can't be re-triggered

This procedure runs at two sites (`_shared/work-record.md`'s Grant semantics section names both
as the maturation carve-out): the group path above, cited from `settle-and-merge.md`'s Auto-merge
gate; and the single-record path in `wrap-up/auto-merge-short-circuit.md`, which reuses
`evaluateMaturation` and the Phase 2 promotion write directly (no group to evaluate first, so no
phase split there). Neither site ever originates a fresh grant — both only promote a grant the
origination opt-in (`refine`'s headless posture) already authorized to mature.

A veto — a human removing `auto:merge-pending` before maturation — is permanent: nothing re-adds
it. `refine`'s headless posture's own candidate fetch excludes any record already carrying `auto:build`
(which `auto:merge-pending` is always additive on), so a previously-granted-then-vetoed record is
never re-evaluated by the origination gate chain again without a fresh, unrelated human re-grant.
