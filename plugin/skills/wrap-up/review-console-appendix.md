# Wrap-Up Review Console — reference appendix (#2546)

Rare-branch content split out of `review-console.md`'s operative head, read only when the head's
own citation points here. Nothing in this file runs on the common-case single-spec path.

## Multi-spec defer protocol — full procedure

Applies only when `MULTISPEC_REVIEW_DEFER=1` is set (by `/flow` multi-spec orchestration):

1. Do NOT present the console
2. Do NOT apply or revert any staged items — leave `staged/` and `decisions.md` untouched in the per-spec subdirectory
3. Append a final entry to this spec's `decisions.md`:
   ```
   AUTO {time} — Review Console deferred to multi-spec consolidated console. Per-spec staged items: {count}. Auto-decisions: {count}. Parent run dir: {MULTISPEC_PARENT_DIR}.
   ```
4. Write `verify-expectations.json` in this spec's own run directory (`$PIPELINE_RUN_DIR`, the per-spec `spec-{N}/` subdirectory) through the sanctioned writer — a direct Write there is refused from a worktree-isolated session (#2764): `node "${CLAUDE_PLUGIN_ROOT}/bin/set-verify-expectations.js" --run "$PIPELINE_RUN_DIR" --deferred design-caches,worktree,ephemeral-server,claim-release,run-dir-archival`, which leaves `{"version": 1, "memory": [], "upstream": [], "deferred": ["design-caches", "worktree", "ephemeral-server", "claim-release", "run-dir-archival"]}`. The five deferred cleanup items map 1:1 to `deferred`'s vocabulary (`cleanup-procedures.md`'s items 3/4/6/7/8). `memory`/`upstream` stay empty here — this spec's own M#/U# resolution never ran (deferred to the parent console); the parent's own consolidated run directory carries the real resolution once it completes, so a per-spec `verify` run against a `MULTISPEC_REVIEW_DEFER=1` spec will correctly render its `memory-updates`/`upstream-feedback` rows as `skip (nothing recorded)` rather than the more alarming `unknown (expectations file missing)` (a known, accepted limitation of per-spec verification under multi-spec defer, not a full resolution). The writer read-modify-writes, so an `oversightExempt` array `verification-brief.md`'s Oversight-floor gate already recorded in this same file is preserved. Exit 3 from that writer means the run dir is wrong — re-resolve `$RUN_ROOT` per `_shared/pipeline-run-dir.md` and retry; exit 2 is a malformed call to fix, never a reason to fall back to a direct Write.
5. Proceed to the phase-trace report — the per-spec summary still renders, but its "Review Console" row reads `deferred — see multi-spec consolidated console`
6. Skip the run-directory archival in Phase 4's cleanup planning — the parent `/flow` orchestration owns archival of the multi-spec parent dir after its consolidated console completes

This is the *only* condition under which `/wrap-up` skips the Review Console when a run directory exists. Every single-spec run — in any mode — always runs the per-spec console.

## Auto-merge short-circuit — applicability detail

The maturation/applicability routing itself lives in `review-console.md`'s own "Auto-merge
short-circuit" section; this is the rationale behind its two "live, never the pack" clauses.

A pending `auto:merge-pending` label still routes to `auto-merge-short-circuit.md` so that file's
own maturation check can run (#309). `manifesto-authorized-merge.md`'s applicability check is the
`merge-authorization` lever (#715).

The grant read stays a **live** `gh issue view --json labels` fetch, never the fact pack: a Phase
3 snapshot is minutes old by the time this routing decision runs, and a grant revoked in between
must not route a merge (#1930). `pack.recordLabels` in `{run-dir}/wrap-up-pack.json` is the
console's **audit snapshot** of those same labels only — render it beside the live verdict, never
in place of it. When the pack file is absent, or its field is `ok: false` (`gh-absent`, `no-forge`,
a failed query), omit the snapshot line entirely; a failure of the *live* read is still the
"Otherwise skip it entirely; do not read the file" branch, exactly as if the live labels didn't
carry the grant.

## Auto-resolution short-circuit — console-resolve.js execution detail

Full mechanics behind the `console-resolve.js` call in `review-console.md`'s "Auto-resolution
short-circuit" section. The CLI applies the stances in that section to every staged item
(`bin/lib/console/resolve.js`'s `SECTION_STANCES`, its prefix table `SECTION_MAP`) — a staged
patch is `git apply --check`ed first and resolves to `stale — re-derive from Invariant:` when it
no longer applies, never applied blind, per `_shared/staged-patch.md`; an unrecognized staged
prefix lands in Pending review as `pending — unmapped-prefix`, never auto-approved; a staged item
named by a `REFUSED` line in `decisions.md` is classified under **Refused — no defer reason**
before any prefix rule runs and resolves to `refused` — those rows are in the CLI's table like
every other row, and a `refused` item is never applied, at any tier, per `refused-proposals.md`.
The CLI also computes the merge half with both carve-outs (`merge.resolution` = `merge` |
`leave-open`, with the reason — it **never** runs the merge itself), appends one decisions block
(`AUTO {time} — Review Console: Console auto-resolved {n} item(s) at unattended
(console-resolve.js). Reversibility: per item.` plus one line per item), and writes
`{run-dir}/console.json` (`{resolved: true, mode: 'auto-resolve', at, ceiling, items, merge}` —
the write the reconciler's archival needs, #1854). That file may later gain an optional
`residueAcknowledgedAt`, written only by `console-residue.js --ack`/`--ack-all` (#3370); and
`console-resolve.js --json` on a fresh resolution carries an `unresolved` array (the
`pending`/`keep-staged` items, `[]` when none); the idempotent re-render of an already-resolved
console prints the stored table and the `Needs a human` block as text whatever the flags.

### Resolution-to-step mapping

Each resolved value maps to exactly one execution step from `review-console.md`'s "On approval"
procedure — no row is left unrouted:

- `applied` — execute **nothing**. It is already in a commit; the row exists only so an override
  can revert it.
- `apply` on a **Pending review** item — step 1, which covers every staged item 5–7, not only the
  patches: a `.patch` via `_shared/staged-patch.md`'s `git apply` (a stale one takes the
  `Invariant:` re-derivation below), and a staged `.md` proposal (`polish-suggestion-*`,
  `visual-review-*`, `design-decision-*`, `build-deviation-*`, `simplify-*`, `deepen-*`) applied
  as that step already describes for a non-patch item.
- `apply` on a `Q#` item — step 7 (record creation), whose `refused-proposals.md` check still
  runs first; on an `M#` item — step 8 (the `_shared/learning-routing.md` memory write plus its
  `MEMORY.md` index line).
- `approve` — the curation steps: step 2 (Skill updates), step 3 (Documentation updates), step 4
  (Journey updates), step 5 (Configuration updates). A **Reference repairs** row has no numbered
  step of its own — it is applied by Phase 4's execution step, per
  `execution-and-verification.md`'s Reference repairs bullet. Cleanup actions run at step 6.
- `filed` — step 9's `/claude-tweaks:feedback --pre-confirmed` filing (the `U#` divergence stated
  in review-console.md).
- `stale` — still step 1, but its re-derivation path only: rebuild the diff from the item's
  `Target:`/`Invariant:` preamble. Never `git apply` a diff the CLI already reported as failing
  `--check`, and never drop it silently.
- `keep-staged`, `pending`, and `refused` — execute **nothing**. They stay in `staged/`, are named
  in the closing pointer, and are never applied; `refused` rows have no default at any tier
  (`refused-proposals.md`).

**Retain `staged/` files** rather than deleting them — applied ones included (they stay as revert
artifacts, the same way the auto-merge short-circuit's own commit is still revertible).

## On approval — execution detail

Full detail behind `review-console.md`'s "On approval" step 11 (`verify-expectations.json`).

**`--file` writer (#2764):** never a direct Write into the run dir, which a worktree-isolated
session is refused — exit 3 from `set-verify-expectations.js` means the run dir is wrong
(re-resolve `$RUN_ROOT` per `_shared/pipeline-run-dir.md` and retry); exit 2 is a malformed call
to fix, never a reason to fall back to a direct Write.

**`--issues` form:** written on every non-Approve-all resolution (#3365) — `engine-verify.js`'s
`resolvedIssueNumbers()` reads it only when no materialized header resolves (neither the run dir's
own `work/` nor the worktree mirror, which cleanup may already have removed by the time verify
runs), so it is harmless when a header resolves. `finish-console` drops an `issues` key from its
stdin payload, so the Approve-all path does not write it.

**`oversightExempt` preservation:** `verification-brief.md`'s Oversight-floor gate (#2383) may
have already read-modify-written this file earlier in the same run, once per exempted record;
both writers read-modify-write, carrying `oversightExempt` forward unchanged.

**Absent vs. empty file:** an absent file and an empty one are DISTINCT states to the `verify`
verb (`engine-verify.js`): absent means this write step itself didn't run, empty means it ran and
found nothing to record — write the file even when `memory`/`upstream` are both empty, consistent
with "no memory file is ever written" under `--dry-run`.

### Non-zero exit codes — full rationale

Exit code 4 (ceiling not granted) → skip the short-circuit section and proceed to "Present a real
stop," the ordinary path. Exit code 5 (this run's `console.json` is already a console rendered on
the PR and awaiting a human, or it will not parse — the CLI wrote nothing either way) → also
proceed to "Present a real stop," the human path: a rendered console is somebody's open decision,
and no flag overwrites it. Exit codes 2 and 3 (malformed invocation / `--run` not anchored) → a
HARD-GATE failure: stop the wrap-up and report the CLI's stderr — an unattended run has nobody to
answer a real stop. Send one consolidated `PushNotification` summarizing the run, at the same
point the auto-merge short-circuit sends its own FYI (`_shared/autonomy-ceiling.md`'s Notification
section) — one notification for the whole run, never one per item. End with the absolute path to
`decisions.md`, `console.json`, and any retained `staged/*` files, so the operator has a concrete
pointer even though nothing prompted at `unattended`.
