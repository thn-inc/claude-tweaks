# Plan: console-resolve.js's readMembers fallback misses multi-spec parent run dirs (#2028)

## Verification finding (no plan needed — already implemented)

Before writing an implementation plan, Spec Step 2 checked what's already implemented in the
codebase against every deliverable and acceptance criterion in the materialized spec
(`work/2028-spec.md`). All of it is already present, byte-for-byte matching the spec's own
Technical Approach:

- `plugin/bin/lib/wrap-up/pack.js` exports `resolveRecords` and `headerRecords` (line 158, 128)
  alongside the existing `gatherPack, resolveInputs, wrapProbe, withTimeout, parseLedger,
  PROBE_NAMES` exports (module.exports line 480).
- `resolveRecords(deps, runDir, worktree)` implements the exact three-rung ladder the spec
  describes: own `work/` headers → worktree mirror → parent `manifest.yml` +
  `spec-*/work/` headers → `{ records: [], source: 'unavailable' }`.
- `worktreeMirror(runDir, worktree)` returns `null` for a non-string `worktree` (line 147) instead
  of throwing from `path.join` — the exact null-guard the spec's Gotchas section calls out.
- `plugin/bin/lib/console/resolve.js`'s `readMembers` (line 106-112) already delegates to
  `resolveRecords(deps, runDir, worktree)`, deriving `worktree` from `run-state.json` via the
  existing `readJson` helper, keeping the pack-first branch (`inputs.records` wins when non-empty)
  unchanged, and contains no second copy of the header-scanning regex.
- `tests/bin-lib/console/resolve.test.js` already has a test literally tagged `(#2028)` (line 172)
  covering acceptance criterion 1: a multi-spec parent run dir with no `wrap-up-pack.json`,
  `manifest.yml` listing spec ids, and headers under `spec-*/work/`, resolving members without
  `members-unresolved`.
- `tests/bin-lib/wrap-up/pack.test.js` already has the export-shape assertion (line 194, tagged
  `(#2028)`) asserting `resolveRecords`/`headerRecords` are exported functions and that
  `source: 'manifest'` still comes back for the parent-run fixture.

This matches this build's own #1984 "already-shipped deliverable" pattern: PR #2234 (branch
`worktree-record-2028`) already merged this exact change; the record was never closed because that
PR's merge never carried a closing keyword (see `claims/issue-2028.json` on `claims-registry`:
`released: true, reason: "merged: reconciled from PR #2234"`).

## Task

1. No code changes. Run the full test suite (`npm test`) to confirm nothing regressed and that
   the #2028-tagged tests are present and green.
2. Route to the Wrap-Up Review Console's staged-close surface with this verification evidence
   (handled by a later `/claude-tweaks:wrap-up` call, not this build+test run).

## Acceptance criteria

- `npm test` is green (spec Acceptance Criterion 6).
- No working-tree diff beyond this run's own bookkeeping (materialize commit, plan file).
