---
record: 327
origin: capture
risk: low
size: low
ceremony: fast-lane
grants: [build]
surface: web
design-intent: none
---
# 327: Verify guided-environment-creation.md UI claims (row-click collapse, wrong control label)

Surface: web
Design-intent: none

## Current State

`skills/routine/guided-environment-creation.md`'s Ensure-setup-script procedure (added by commit
`e4735b23`) documents a composer-driven browser flow for pointing an interactive claude.ai/code
session at the plugin's dedicated environment. Unlike every other UI-behavior claim in this file —
which carries an explicit "confirmed live" annotation once verified against the actual product
UI — two claims in this procedure carry no such annotation:

1. Step 2 (lines 178-179) says: when `environment_name` matches an existing row in the open Cloud
   submenu, "click that row to select it," then Step 3 (line 193) immediately says to "Hover the
   row for `environment_name` ... a gear icon appears on hover." Whether the Cloud submenu actually
   collapses/closes after the row-click — leaving a plain hoverable row for Step 3 to act on — is
   unstated. The file's Audit procedure (lines 245-247) documents a related but distinct precedent:
   a *different* control (the routine-form's Environment combobox, read collapsed without ever
   being opened) shows its selection once collapsed. Whether that precedent actually transfers to
   the composer's Cloud submenu (a different control, reached by clicking an open row rather than
   reading a closed one) is the open question.
2. Step 2's "no row matches" branch (lines 183-184) says to click "`Add cloud environment…`"
   and calls it "the same control Create step 4 uses." Create step 4 (line 98) itself labels its
   own equivalent affordance "`+ Add environment`" — a different label string, on a different UI
   surface (the routine-creation form's Environment combobox vs. the composer's Cloud submenu).

Both named artifacts (file, line ranges, procedure names, the two exact label strings) were checked
against the current file content and match — this is a real, well-scoped discrepancy between two
independently-worded claims, not a stale reference.

## Deliverables

- Using `/claude-tweaks:browse backend=chrome`, drive the composer path (sidebar **New** → the
  environment chip → `Cloud` submenu) through both Ensure-setup-script branches live against
  `claude.ai/code`:
  - **Row-match branch:** click a row that matches an `environment_name`, then observe whether the
    Cloud submenu collapses/closes before attempting Step 3's hover-for-gear-icon action. Confirm
    whether the documented sequence (click row, then immediately hover for the gear) works as
    written, or needs an explicit wait/re-open step first.
  - **No-row-match branch:** click the "no row matches" branch's control and record its exact
    visible label text. Compare it against Create step 4's "`+ Add environment`" label and judge
    whether the doc's "the same control" claim holds (same control across both surfaces) or is
    wrong (visually/functionally similar but a different control with a different label).
- Update the Ensure-setup-script procedure section of `skills/routine/guided-environment-creation.md`
  (roughly lines 176-192) to mark each claim "confirmed live" per the file's own existing
  annotation convention, or correct the wording where verification finds a mismatch (e.g. rewording
  the "same control" claim if the two surfaces are in fact different).

## Acceptance Criteria

- Both claims have been checked against the live `claude.ai/code` UI via
  `/claude-tweaks:browse backend=chrome` — not inferred from the Audit procedure's precedent or
  any other reasoning in the file.
- The Ensure-setup-script procedure's text reflects what was actually observed: each of the two
  claims is either annotated "confirmed live" (matching the file's existing convention) or
  corrected to describe the real behavior/label.
- No other content in `skills/routine/guided-environment-creation.md` is modified beyond the two
  claims under review — this record fixes what the pre-release review flagged, nothing more.

## Technical Approach

- Follow this file's own established browser-driven verification pattern: dispatch
  `/claude-tweaks:browse backend=chrome`; if the extension isn't connected or the user declines,
  fall back per the file's own documented fallback shape (this procedure's header) rather than
  blocking.
- Apply the file's documented 1-2 second wait after opening the Cloud submenu before reading or
  clicking anything in it (an existing rule already stated for other steps in this file), to avoid
  a stale-read false negative on the collapse-behavior question.
- When writing the corrected/confirmed text, explicitly address whether the Audit procedure's
  collapsed-combobox precedent (lines 245-247) actually transfers to the composer's Cloud submenu —
  the original report's claim 1 specifically questions that transfer, so the fix should settle it
  rather than restate the same ambiguous cross-reference.

## Gotchas

- The "same control" claim (claim 2) conflates two UI surfaces — the routine-creation form and the
  composer's chip menu. Verification may find they are visually/functionally similar without being
  the same DOM element, in which case the correct fix is a wording clarification (e.g. "the
  equivalent control") rather than a full reversal.
- No automated test can back either claim; correctness here is judged by a human/agent watching a
  live browser session, per this file's own established "confirmed live" verification convention —
  there is no other way to close this record.

## Original request

Verify guided-environment-creation.md UI claims (row-click collapse, wrong control label)

**Related:** none

Context: pre-release whole-branch review found two unverified UI-behavior claims in the
Ensure-setup-script procedure added by e4735b23 — unlike every other sequence in this file, neither
is marked "confirmed live".

Scope: verify against the live claude.ai/code UI — (1) does clicking a matching row in the
checkmark-list menu collapse it before step 3's hover-for-gear-icon, per this file's own Audit
procedure precedent; (2) the "no row matches" branch calls a composer control "the same control
Create step 4 uses," but Create step 4 actually labels it "+ Add environment," not "Add cloud
environment…".

