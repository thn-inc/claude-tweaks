---
record: 666
origin: human
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 666: permittedGrants contract phase — remove flat bornReady/bornAuthorized/reason at the 2026-11-16 backstop

Surface: backend

## Current State

#647's expand phase shipped per-grant `grants.{bornReady,bornAuthorized}.{granted,reason}` in `bin/lib/issues/autonomy.js` (`permittedGrants`), fixing a bug where the flat top-level `reason` string could pair a granted `bornReady` with the other grant's denial text. The flat `bornReady`/`bornAuthorized`/`reason` keys were kept as a transitional twin, with the module header (`bin/lib/issues/autonomy.js`, lines ~10-15) recording a removal condition: delete the flat keys at the first release on or after 2026-11-16 (ship date + 3 months, per `policy-deprecations.md`'s dated-backstop shape).

Two skill-text consumers carry a matching read-side fallback, tagged with the same removal condition: `skills/capture/SKILL.md` (line ~144) and `skills/backlog/refine-mode.md` (line ~223), both doing `(permitted.grants || {}).bornReady || { granted: permitted.bornReady, reason: permitted.reason }`.

Confirmed at shaping time (2026-08-17): the module header text, both fallback call sites, and `skills/backlog/refine-lanes.md`'s rendered trust-consequence line (`↳ trust: {provenance} / {band} — {verdict}{, {coverage}% coverage}`) all reproduce exactly as described — the trust-table snippet's `bornReady`/`reason` output fields (written to `/tmp/backlog-refine-trust.json`) are genuinely dead: nothing downstream reads or renders them.

The removal date (2026-11-16) has **not** yet passed as of this record's shaping (2026-08-17) — it is roughly three months out. This record documents and prepares the contract phase; it does not authorize building the removal before that date.

## Deliverables

- [ ] Verify, at build time, that the current date is on or after 2026-11-16 (the first release on/after that date) before making any of the changes below. If built before that date, stop without editing anything and report the record as not yet actionable — see Acceptance Criteria #1, a hard gate.
- [ ] Re-run `grep -rn "permittedGrants" skills/ bin/` to confirm every consumer still reads only `grants.*` shapes (no new flat-key consumer introduced since shaping).
- [ ] Remove the flat `bornReady`/`bornAuthorized`/`reason` keys from `permittedGrants`'s return value in `bin/lib/issues/autonomy.js`, and delete the module-header comment block documenting the now-resolved removal condition.
- [ ] Remove the matching read-side fallback in `skills/capture/SKILL.md` (the `(permitted.grants || {}).bornReady || { granted: permitted.bornReady, reason: permitted.reason }` pattern and its explanatory comment), reading `permitted.grants.bornReady` directly.
- [ ] Remove the matching read-side fallback in `skills/backlog/refine-mode.md` (same pattern, same treatment).
- [ ] Drop the dead `bornReady`/`reason` output fields from `skills/backlog/refine-mode.md`'s trust-table snippet (the `node -e` block that writes `/tmp/backlog-refine-trust.json`) — confirmed nothing downstream (`skills/backlog/refine-lanes.md`'s rendered trust-consequence line) reads them.
- [ ] Decide, and record the decision inline as a code/skill-text comment, how to handle the two disclosed conflation residues before deleting the flat keys:
  1. Withheld grants share one reason string today — `grants.bornAuthorized.reason` can carry born-ready's rationale on the human-filed path. Decide whether this stays as-is (the per-grant shape already fixes the *granted*-path pairing bug; the withheld-grant sharing is a separate, lower-severity residue) or gets its own follow-up record.
  2. The granted path's flat `reason` today carries positive rationale text ("class is clean, ceiling is unattended, grant origination opted in") that no per-grant key reproduces. Decide whether to populate that positive rationale into the granted per-grant `reason` field, or record explicitly (in a code comment) that it is intentionally dropped as noise once the grant itself is visible via `granted: true`.
- [ ] Update or remove the flat-key compat tests in the `bin-lib/issues` test suite to match the per-grant-only shape.

## Acceptance Criteria

1. **Hard precondition, checked first:** the build only proceeds once the current date is on or after 2026-11-16. A build attempted before that date stops without modifying any file and reports the record as not yet actionable — this is not a normal "build failed" outcome, it is the record's own documented gate.
2. `permittedGrants` (`bin/lib/issues/autonomy.js`) returns only the per-grant `grants.{bornReady,bornAuthorized}.{granted,reason}` shape — no flat `bornReady`/`bornAuthorized`/`reason` keys at the top level.
3. No consumer (code or skill text, across `skills/` and `bin/`) reads the flat keys or carries a fallback for them — confirmed via `grep -rn "permittedGrants" skills/ bin/` read against every hit.
4. `skills/backlog/refine-mode.md`'s trust-table snippet no longer computes or emits `bornReady`/`reason` fields.
5. The two conflation-residue decisions are recorded (as a comment near the code they affect, or in this record's own close-out note) — not silently dropped.
6. `npm test` passes with the flat-key compat tests updated or removed.

## Technical Approach

Start with the grep re-verification (Deliverables item 2) — the module header itself calls this out as the first step, since a consumer could have appeared between #647 shipping and this record's execution.

`bin/lib/issues/autonomy.js`: delete the flat keys from `permittedGrants`'s two return objects (denied-path and granted-path, around current lines 128-155) and the header comment block (lines 10-15) documenting the removal condition — the condition is satisfied, not evergreen.

`skills/capture/SKILL.md` (~line 144) and `skills/backlog/refine-mode.md` (~line 223): drop the `|| { granted: permitted.bornReady, reason: permitted.reason }` fallback half of each destructure, reading `permitted.grants.bornReady` directly; delete the accompanying "older installed build" comment.

`skills/backlog/refine-mode.md`'s trust-table `node -e` block (~lines 219-234): remove `bornReady`/`reason` from the `out[issue.number]` object literal.

Fold the two conflation-residue decisions into the same edit pass — they're small text/comment changes, not separate work.

Grep the `bin-lib/issues` test directory for `bornReady`/`bornAuthorized` flat-key assertions on `permittedGrants`'s return value and update/remove them alongside the source change, in the same commit.

## Gotchas

- **Date gate is load-bearing, not advisory.** This record was shaped on 2026-08-17, roughly three months before the 2026-11-16 backstop. Confirmed by reading `bin/lib/issues/autonomy.js`'s own module header, which states the removal condition explicitly and cites `policy-deprecations.md`'s dated-backstop shape as precedent for this pattern (see also #628/#629, which apply the same shape to `policy.yml` key retirements). Marking this record `ready` reflects that it is *shaped* and *queued*, not that it is *buildable today* — `/specify` has no mechanism to hold a record out of `ready` pending a future calendar date (only `parked` + `Trigger:` does that, and only `/tidy`/`/wrap-up`/`/reflect`/`/review`'s Defer paths can add it), so this Gotcha and Acceptance Criterion 1 are the only gate. Whoever dispatches this record (`/flow`, `/build`, or a human) must re-check the date before touching code.
- **Information loss is real if the conflation residues are skipped.** Deleting the flat keys without deciding the two residues (the Deliverables item above them) silently drops the granted-path's positive rationale text — no per-grant key reproduces it today. This isn't a formatting nit; a human reading a future trust/grant explanation loses the "why" for a clean grant unless this is deliberately decided and recorded.
- **Verified against live code at shaping time**, not taken on faith from the issue text: read `bin/lib/issues/autonomy.js` lines 1-40 (module header and `permittedGrants`), `skills/capture/SKILL.md` line ~144, `skills/backlog/refine-mode.md` lines ~203-235, and `skills/backlog/refine-lanes.md` lines ~75-100 (the rendered trust-consequence template, confirming it never references `bornReady`/`reason`). All three deliverables reproduce exactly as the original request states — no false premise to correct here.

## Original request

permittedGrants contract phase — remove flat bornReady/bornAuthorized/reason at the 2026-11-16 backstop

Title: permittedGrants contract phase — remove flat bornReady/bornAuthorized/reason at the 2026-11-16 backstop
Type: task
Labels: none

# Staged work-record proposal — #647 contract phase (remove permittedGrants flat keys)

**Related:** #647

## Current State

#647's expand phase shipped per-grant `grants.{bornReady,bornAuthorized}.{granted,reason}` in `bin/lib/issues/autonomy.js` with the flat keys kept as a transitional twin; the removal condition is dated 2026-11-16 in the module header. The skill-text consumers (`skills/capture/SKILL.md`, `skills/backlog/refine-mode.md`) carry read-side fallbacks for installed-build skew, tagged with the same removal condition.

## Deliverables

- [ ] Remove the flat `bornReady`/`bornAuthorized`/`reason` keys and the skill-text fallback reads at the first release on or after 2026-11-16; re-run `grep -rn "permittedGrants" skills/ bin/` first to confirm every consumer reads `grants.*`.
- [ ] Drop the dead `bornReady`/`reason` fields from `skills/backlog/refine-mode.md`'s trust-table snippet output (nothing renders them — the table spec forbids rendering `reason`), retiring the compatibility fallback with them (folded from the batch curation pass's staged dead-field cleanup, wrap-up-skill-refine-trust-dead-fields.md).
- [ ] Decide the two disclosed conflation residues at contract time: (1) withheld grants share one reason string — `grants.bornAuthorized.reason` can carry born-ready's rationale on the human-filed path; (2) the granted path's flat `reason` carries positive text ("class is clean, ceiling is unattended, grant origination opted in") that no per-grant key reproduces — deleting the flat keys is information-lossy unless the positive rationale is populated into granted per-grant reasons or recorded as intentionally dropped.

## Acceptance Criteria

1. `permittedGrants` returns only the per-grant shape; `npm test` passes with the flat-key compat tests updated or removed.
2. No consumer (code or skill text) reads the flat keys or carries a fallback.

Origin: whole-branch review of run 2026-08-16T164927-spec-647-648 (Important finding #1 + Minor #2 + Recommendation).

