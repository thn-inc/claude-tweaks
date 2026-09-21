# Update Mode — Audit Procedures

Loaded by `/init` Phase 1 when existing config is detected. Covers the Update Mode inventory (Phase 1u), contract-drift detection (Phase 1u.5), the early-exit fast path (Phase 1u.6), and the Phase 4 scoring approach for gaps.

## Sub-phases at a glance

- **Phase 1u** — inventory existing CLAUDE.md, skills, and rules; classify findings as covered / stale / drifted / gap
- **Phase 1u.5** — detect claude-tweaks contract drift: compare the project's plugin-authored CLAUDE.md sections against the current template via `bin/lib/init/claude-md-conformance.js`, reporting missing and drifted sections; detect policy keys still living in CLAUDE.md, which no longer apply, offering to move them; and a general `policy.yml` Policy Configuration Review, distinct from the known-key migrations, with a low-friction skip
- **Phase 1u.6** — early-exit gate: if drift = 0 AND preliminary gaps < 3, skip to Phase 9 with a quick-audit summary; otherwise continue to Phase 2

## Phase 1u: Audit Existing Configuration

Build an inventory of what's currently configured before scanning the codebase:

```markdown
## Existing Configuration Inventory

### CLAUDE.md
- Lines: {count}
- Stack table: {lists these technologies}
- Commands: {lists these scripts}
- Conventions: {count} bullets
- Don'ts: {count} items
- Template conformance: {plugin-authored sections reported missing | drifted | conformant by Phase 1u.5}
- Last meaningful edit: {git log for CLAUDE.md — when, what changed}

### policy.yml
- `project-maturity`: {value, or "not set" if the key is absent}
- Recognized keys present: {count}
- Recognized keys still in CLAUDE.md: {migratableKeys count from the Config Home Drift check below, or "none"}
- Retired keys still in policy.yml: {renamedKeys count from the Renamed key drift check below, or "none"}

### Skills ({count})
| Skill | Description trigger | Key file paths referenced |
|-------|-------------------|--------------------------|
| {name} | {from description field} | {paths mentioned in body} |

### Rules ({count})
| Rule | Scoped to | Content summary |
|------|-----------|-----------------|
| {name} | {paths} | {1-line summary} |
```

Then proceed to Phase 2 as normal — but carry this inventory forward. Every Phase 2 finding will be compared against the inventory to classify it as:

- **Covered** — existing config accurately describes this
- **Stale** — existing config references something that has changed or no longer exists
- **Drifted** — existing config describes a pattern but the codebase has moved away from it
- **Gap** — codebase has this pattern but no config covers it

## Phase 1u.5: claude-tweaks Contract Drift

An existing CLAUDE.md may not match the plugin's current template — because it
predates a template change, or because someone edited a plugin-authored section
in place. Detect both so Update Mode can offer pre-filled patches.

This check is deterministic and compares against the template **live**, so a
future template change is picked up with no edit here. Run:

```bash
node -e "
const {checkConformance} = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/init/claude-md-conformance');
const fs = require('fs');
const tpl = fs.readFileSync('${CLAUDE_PLUGIN_ROOT}/skills/init/claude-md-template.md','utf8');
const project = fs.existsSync('CLAUDE.md') ? fs.readFileSync('CLAUDE.md','utf8') : '';
console.log(JSON.stringify(checkConformance({templateSource: tpl, projectClaudeMd: project}), null, 2));
"
```

Read the result:

- **`missing`** — the section is absent entirely. Record a **Contract Drift**
  entry whose suggested patch inserts the entry's `expected` body verbatim. No
  creative writing required — except when the entry carries
  `generate: 'maturity-classification'` and a null `expected`, which only
  `## Philosophy` does: that section's template body is a placeholder, so
  generate its content from the project's detected maturity the same way Initial
  Mode does, rather than inserting anything verbatim.
- **`drifted`** — the section exists but its body differs from the template's.
  Record a **Contract Drift** entry offering a re-sync, showing `actual` and
  `expected`. A deliberate local edit is a legitimate answer here — the entry is
  an offer, never an automatic overwrite.
- **`conformant`** — no entry.

A project with no CLAUDE.md at all reports every plugin-authored section as
`missing` — the correct and maximally-actionable result here, not an error.

Carry every entry forward into the Drift Report (Phase 3) under a dedicated
"Contract Drift" section so the user can approve them as a batch alongside other
CLAUDE.md patches.

`## Philosophy` is reported present/absent only, never drifted — its content
varies by the project's maturity classification, so a byte comparison would flag
every project. Its *content* freshness is `/claude-tweaks:harness-health`'s
"Philosophy matches current maturity" check, not this one.

If `missing` and `drifted` are both empty, record "Contract: conformant with the
installed template" in the inventory and skip ahead.

### Work-Record Backend Drift

The work-record backend (`work-backend` and `work-types` in CLAUDE.md, `work-links` in `.claude-tweaks/policy.yml`) predates a
versioned contract tag, so it isn't one of the plugin-authored sections the
conformance check above compares — but its drift is detected the same pass and
counts identically toward the Total drift count in Phase 1u.6 below (treat
entries from this table as additional Contract Drift entries from 1u.5). All
three rows are **staged offers** — never a silent CLAUDE.md
edit, per the auto-mode contract's rule that CLAUDE.md is never edited
autonomously.

| Signal | Detection | Offer (staged) |
|---|---|---|
| `work-backend: github-issues` present but `work-types` and/or `work-links` missing | `work-types:` absent from CLAUDE.md, or `work-links:` absent from `.claude-tweaks/policy.yml`, alongside a present `work-backend: github-issues` in CLAUDE.md. **Look for each key in its own home, not both in CLAUDE.md** — `work-links` moved to `policy.yml` in 6.48.0, so checking CLAUDE.md for it fires on every correctly-configured project forever, and the offer re-writes a key that is already set | Run `probeCapabilities()` (`bin/lib/issues/capabilities-probe.js`) and offer to write the missing key(s) — `work-types` into CLAUDE.md, `work-links` into `.claude-tweaks/policy.yml` |
| `work-backend: github-issues` with `work-types` present in CLAUDE.md and `work-links` present in `.claude-tweaks/policy.yml` | — | Every full Update-Mode pass re-probes capabilities (`probeCapabilities()`) and offers a patch when the result has drifted from what's recorded (e.g. the org enabled Issue Types since the last run) |

`work-backend: local-files` needs no probe on any of these rows — its
`work-types: labels` / `work-links: body-text` fallback is unconditional, the same
as bootstrap Step 17b.

### Config Home Drift

`.claude-tweaks/policy.yml` is the only file claude-tweaks reads for config keys
(`_shared/policy-schema.md`). A project configured before that consolidation may still carry
recognized keys in CLAUDE.md, where they no longer apply — the failure is silent, because a key
that is not read looks exactly like a key that was never set, and the lever's default takes over
with nothing objecting.

Each flagged key counts toward Phase 1u.6's Total drift count, the same as Work-Record Backend
Drift above — a project whose only drift is stranded policy keys must not take the early-exit
fast path, since the fast path would suppress the very offer this check exists to make.

Detect by calling the same module `/claude-tweaks:harness-health` uses:

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); console.log(JSON.stringify(auditPolicy(process.cwd()).migratableKeys))"
```

An empty array means nothing to do — omit this check from the Drift Report entirely rather than
reporting a clean result. Otherwise each entry carries `key`, its CLAUDE.md `value`, and
`alsoInPolicy`, which picks the remedy:

| `alsoInPolicy` | What happened | Recommended action |
|---|---|---|
| `false` | The key applies nowhere — the lever has been running on its default | **Move** — add `{key}: {value}` to `.claude-tweaks/policy.yml`, remove the CLAUDE.md line |
| `true` | `policy.yml` already carries this key and is what applies; the CLAUDE.md line is a dead duplicate that may state a *different* value | **Remove** — delete the CLAUDE.md line only, leaving `policy.yml` untouched |

Present a batch table (Key | CLAUDE.md value | policy.yml value or "not set" | Recommended action),
and for any `alsoInPolicy: true` row whose two values differ, say so in the row — that is a project
whose intended setting has not been in effect, and the user may want the CLAUDE.md value promoted
rather than dropped. The policy.yml-side value is not in `migratableKeys` — read it from the
Phase 1u inventory pass above, which has already parsed `.claude-tweaks/policy.yml`;
`alsoInPolicy` only tells you whether the key is present there.

**Show the diff before asking.** Render the exact `policy.yml` additions and the exact CLAUDE.md
lines to be deleted, with their line numbers. CLAUDE.md is the file users hand-tune most, and the
detector matches key-shaped lines wherever they sit — including inside fenced code blocks, which is
deliberate, since that is how the legacy form was often written, but it also means a CLAUDE.md that
*documents* claude-tweaks levers can produce rows that must not be applied. The diff is what lets
the user see that before it happens.

Then call `AskUserQuestion`:

- `question`: `"{N} policy key(s) in CLAUDE.md no longer apply. Move them into policy.yml?"`,
  `header`: `"Config home"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Move {M} key(s)
  into .claude-tweaks/policy.yml and delete {N} line(s) from CLAUDE.md, exactly as shown in the
  diff above"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Choose per-key what happens
  to each of the {N} entries"`
- Option 3 — `label`: `"Skip entirely"`, `description`: `"Leave both files as-is — the keys in
  CLAUDE.md will continue to have no effect"`

On "Override specific items," the user's per-key corrections arrive as ordinary free-text in the
next message, per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field.

**Applying.** This is a **staged offer, never an autonomous edit** — the same rule the
Work-Record Backend Drift section above states, and for the same reason: CLAUDE.md is never
edited without the user accepting the specific change. Under `--defaults`, or any invocation with
no interactive human, present the diff in the report and apply nothing. Remove **only**
exactly-matched whole lines from CLAUDE.md — never reflow a paragraph, never rewrite a heading,
never delete a surrounding fenced block even when removing its only line leaves it empty.

Writing to `.claude-tweaks/policy.yml` has two cases, and appending is only correct in one of
them:

- **Key absent there** (`alsoInPolicy: false`, and the promote case's opposite) — append
  `{key}: {value}`, creating the file if absent.
- **Key already present** (`alsoInPolicy: true`, and the user chose to promote the CLAUDE.md
  value rather than drop it) — **replace that existing line in place.** Do not append: every
  consumer grep in this codebase reads `| head -1`, so a second line for the same key is
  inert and the old value silently keeps winning. That turns "promote my setting" into a
  no-op the user has no way to notice.

On any outcome except "Skip entirely," record the result in Phase 9's Actions Performed table
as an `Operational` row.

#### Renamed key drift

A second, distinct check inside the same Config Home Drift section — not a Total-drift double
count with the `migratableKeys` check above, but a genuinely different failure mode: a key that has
been retired from `POLICY_KEYS` entirely (e.g. `unattended-tier`, merged into `autonomy` — see
`_shared/autonomy-ceiling.md`), still sitting in a project's live `.claude-tweaks/policy.yml`. Read
`auditPolicy(repoRoot).renamedKeys` alongside the existing `migratableKeys` read above (same
`node -e` invocation already returns both fields — no second call needed):

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); const r=auditPolicy(process.cwd()); console.log(JSON.stringify(r.renamedKeys))"
```

An empty array means nothing to do — omit this check from the Drift Report entirely, matching the
`migratableKeys` convention above: "An empty array means nothing to do — omit this check from the
Drift Report entirely rather than reporting a clean result." Otherwise each entry carries `key`,
`value`, `replacedBy`, `suggestedValue`, and `currentReplacementValue` (`bin/lib/policy-schema.js`'s
shape — re-read it at build/run time rather than trusting this restatement, per `[IL-40]`).

Each flagged `renamedKeys` entry counts toward the same Phase 1u.6 Total drift count the
`migratableKeys` check above contributes to — a project whose only drift is a stale
`unattended-tier` key must not take the early-exit fast path.

Present a batch table (Key | Current value | Suggested replacement | Current `{replacedBy}` value
or "not set"; for a retirement, the last cell is `—`):

| Key | Current value | Suggested replacement | Current `autonomy` value |
|---|---|---|---|
| `unattended-tier` | `on` | `autonomy: unattended` | not set |
| `{retired key}` | `{its value}` | retired — delete the line, no replacement | — |

When `currentReplacementValue` is already set to something (the project has both the retired key
and an explicit `autonomy` value), show both values and let the user pick which wins rather than
silently overwriting an explicit existing setting — the same "show both, don't blind-rewrite"
principle `migratableKeys`' `alsoInPolicy: true` differing-values handling above already applies.
When `suggestedValue` is `null` (the retired key's value never unlocked anything the replacement's
own default doesn't already match — `unattended-tier: off` is the shipped example), the offer is
simply "remove this stray key," with no replacement value to set.
When `replacedBy` itself is `null`, the key is retired outright (deliberate retirement, not a
typo — #331's three retirements are the shipped examples; removal trail:
`_shared/policy-deprecations.md`): render its Suggested-replacement cell as
"retired — delete the line, no replacement" and its last cell as `—`. This is warn-tier and
informational only — it never blocks, and declining the offer leaves the stray line untouched
(the key simply continues to have no effect).

Call `AskUserQuestion`:

- `question`: `"{N} retired policy key(s) found in policy.yml. Migrate them?"`, `header`:
  `"Renamed keys"`, `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Remove the
  retired key(s) and, where a replacement key exists, set the suggested replacement value(s),
  exactly as shown in the table above"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Choose per-key what happens
  to each of the {N} entries — e.g. keep the existing replacement value instead of the suggestion"`
- Option 3 — `label`: `"Skip entirely"`, `description`: `"Leave policy.yml as-is — the retired
  key(s) will continue to have no effect"`

On "Override specific items," per-key corrections arrive as ordinary free-text in the next message,
per docs/skill-authoring.md's Multi-item decisions convention — not the tool's `Other` field.

**Applying.** Same staged-offer discipline as `migratableKeys` above — never an autonomous edit.
Under `--defaults`, or any invocation with no interactive human, present the diff in the report and
apply nothing. Remove the retired key's line from `.claude-tweaks/policy.yml`; when a suggested
value applies and no differing existing value blocked it, write (or replace in place, never
append — the same reasoning as the "Key already present" case above) `{replacedBy}: {suggestedValue}`.
A `replacedBy: null` retirement never writes a replacement — accepting deletes the stray line,
declining leaves it exactly as it was.

On any outcome except "Skip entirely," record the result in Phase 9's Actions Performed table as an
`Operational` row.

#### Source-excluded key drift (#839)

A third check in the same Config Home Drift section, distinct from both above: a key that IS
recognized and carries a VALID value in `.claude-tweaks/policy.yml`, but whose `POLICY_KEYS` entry
carries `policySourceExcluded: true` — `policy.yml` is a structurally ineffective source for it
(today, only `merge-authorization`; see `_shared/policy-schema.md`'s row). The value silently never
takes effect, which looks identical to a working setting until read closely — the same silent-gap
shape `migratableKeys`/`renamedKeys` fix for their own failure modes.

```bash
node -e "const {auditPolicy}=require('${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js'); console.log(JSON.stringify(auditPolicy(process.cwd()).sourceExcludedKeys))"
```

An empty array means nothing to do — omit this check, same convention as the checks above.
Otherwise each `{key, value}` entry counts toward Phase 1u.6's Total drift count, the same
self-classifying convention `migratableKeys`/`renamedKeys` already use. Present one line per entry:
`` `{key}: {value}` in policy.yml never takes effect — not a valid source for this lever (see
`_shared/policy-schema.md`). `` Warn-tier, informational only, like `renamedKeys`' retirement case
above — there is no safe auto-fix to offer (the only "fix" is deleting the line; the lever's real
setter, when one exists, is documented per-key elsewhere), so present the finding and let the user
act manually. Never blocks; declining leaves the line untouched. On any manual removal the user
reports back, record it in Phase 9's Actions Performed table as an `Operational` row.

### Policy Configuration Review

A general "does your `policy.yml` look right?" pass, distinct from Config Home Drift and Renamed
key drift above — those catch a key in the wrong file or under a retired name, this reviews the
full recognized-lever surface (every key currently set, whether its value validates, and a
skippable one-click walkthrough of what each lever does). Both empty findings and a non-empty
list count the same way toward Phase 1u.6's Total drift count as the checks above. Read
`policy-review.md` in this skill's directory for the full procedure (the `auditPolicy()` call,
the always-surfaced one-line count, the single low-friction skip prompt, and the Show-details
entrance, which delegates to `${CLAUDE_PLUGIN_ROOT}/skills/help/policy.md`'s Render contract
rather than re-authoring lever descriptions here).

### Maturity Drift

Like the Work-Record Backend Drift check above, maturity drift isn't reported by the
Phase 1u.5 conformance check — that check compares plugin-authored sections
against the template, while this checks whether a *value* has changed. Unlike every other
drift check in this file, it can only be detected as part of a full
reconnaissance pass, never the early-exit fast path (Phase 1u.6): re-detecting
maturity requires re-running Phase 2h, and Phase 1u.6's own early-exit decision
is made *before* Phase 2 ever runs. This entry therefore never contributes to
Phase 1u.6's preliminary drift count.

Unlike Contract Drift and Work-Record Backend Drift, this is not a separate
staged offer requiring its own approval — Phase 3's existing Project
Classification gate already IS the approval step for whatever maturity value
gets written (see `phase-3-classification.md`'s "Writing project-maturity to
policy.yml"), whether or not that value has changed since the last run. What
this check adds is *visibility*: when the value read into the Phase 1u
inventory (`### policy.yml` above) differs from what Phase 3 goes on to
confirm, note that specific change in Phase 9's Actions Performed
Classification row (e.g. "Confirmed maturity `established` (changed from
`early-production`), doc tier `{N}`") rather than the Drift Report — the
Drift Report's own Contract-Drift and Stale/Drifted/Gaps batches are already
presented and resolved earlier in this same phase, before Phase 3's
classification gate produces the value this comparison needs, so it is no
longer an open surface by the time this comparison is computable.

| Signal | Detection | Surfacing |
|---|---|---|
| The `project-maturity` value read into the Phase 1u inventory differs from the classification Phase 3 goes on to confirm | Compare the Phase 1u inventory's stored value against Phase 3's freshly confirmed classification, once Phase 3 completes | Note the change in Phase 9's Actions Performed Classification row (see `SKILL.md`'s Phase 9 Actions Performed table); the write itself happens via Phase 3's existing confirmation gate, not a separate approval here |

### Routine Drift

Unlike the checks above, this isn't a CLAUDE.md/policy.yml marker — it audits the project's
instantiated cloud Routines (`.claude-tweaks/routines/*.yml`) against the templates they were
created from. Run `/claude-tweaks:routine status --all --source init`, and skip this entire
check when it reports "no routines instantiated in this project yet" — nothing is instantiated,
most commonly a project that has never run `/claude-tweaks:routine create`. Do **not** gate that
skip on `.claude-tweaks/routines/` existing locally: those records are committed, so on a
checkout behind the integration branch the directory can be absent here while every record
exists upstream, and this check would skip the very project that most needs it (#190). STATUS
resolves that union itself (`skills/routine/record-freshness.md`), which is why the emptiness
question belongs to its output rather than to a directory test here.

Each returned record resolves to one of five verdicts (see `skills/routine/SKILL.md`'s STATUS
`--all` mode for the full detection logic): In sync, Drifted, Orphaned, Stale, or Malformed.

- **In sync** records need no action — omit them from the presented table entirely.
- **Drifted** records are staged the standard way: present a batch table (Routine | Current →
  live template_version | Field drift | Recommended action: "Re-sync"), then call
  `AskUserQuestion`:
  - `question`: `"{N} routine(s) have drifted from their templates. Re-sync now?"`, `header`:
    `"Routine drift"`, `multiSelect`: `false`
  - Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Re-sync all
    {N} drifted routine(s) to their current templates, keeping each one's existing schedule"`
  - Option 2 — `label`: `"Override specific items"`, `description`: `"Choose per-routine what
    happens to each of the {N} entries"`
  - Option 3 — `label`: `"Skip entirely"`, `description`: `"Leave routines as-is — I'll re-sync
    manually later"`

  On "Apply all recommended," invoke `/claude-tweaks:routine update <skill>
  --defaults --source init` once per Drifted record. On "Override specific items," follow up
  with the per-item choices as ordinary free-text in the next message, per docs/skill-authoring.md's
  Multi-item decisions convention (not the tool's `Other` field). On any outcome except "Skip
  entirely," log to `decisions.md` (or the inventory summary, if this project has no active
  pipeline run dir):
  ```
  AUTO {time} — Update Mode: re-synced {M} of {N} drifted routine(s) to their current templates.
  ```
  **Exclude from the bulk auto-fix any Drifted record whose STATUS row was read from the
  integration branch** (its Detail carries `— read from {ref}`). `/claude-tweaks:routine update`
  hard-stops on exactly that condition, since every step past it writes from a stale copy, so
  offering "Apply all recommended" over such a record queues an invocation that cannot succeed.
  Present those rows in the advisory group below instead, with the recourse STATUS named: pull
  the checkout current, then re-run. This is a stale *checkout*, not stale records — the records
  are already correct where they live.
- **Orphaned**, **Stale**, and **Malformed** records are presented as flagged advisories
  only — no bulk auto-fix offered, since none has a safe default action (Orphaned suggests
  manual investigation — was the skill renamed, delete and recreate under the new name;
  Stale suggests the same delete-and-recreate recourse STATUS Step 2 already documents for a
  routine deleted out-of-band; Malformed requires a human to inspect and fix or delete the
  broken record file directly — there is no template or live routine to resync against). If
  recovery for any of these points at `/claude-tweaks:routine fleet on`, flag first that
  `fleet on` reconciles against the *current* fleet composition table, not the project's prior
  live set — re-provisioning this way can add or change routines beyond restoring parity — and
  offer `/claude-tweaks:routine status <skill>` as the lower-commitment first step, before
  naming `fleet on`.

This check's Drifted count (not Orphaned/Stale/Malformed, which have no auto-fix and so aren't
"drift a re-run of /init would resolve" in the same sense) counts toward Phase 1u.6's Total
drift count — treat each Drifted record as an additional Contract Drift entry for that count,
the same self-classifying convention Work-Record Backend Drift
both already use, so Phase 1u.6's own "Contract Drift entries from 1u.5" formula picks it up
without that table needing its own edit.

### Port Isolation Drift

A literal port that crept back into a file `bootstrap/step-06-5-port-isolation.md`'s rewrite table
already covers — most commonly a re-added `server.port: 3000` after a merge or a manual edit.

| Signal | Detection | Surfacing |
|---|---|---|
| A file previously rewritten by Step 6.5 now contains a literal port again, at a location that rewrite table covers | Re-run the same detection list against the six rewrite-row locations only (not the hard-case ones, which were never rewritten) | "Port literal drift" finding naming the file and line, pointing back at Step 6.5 to re-offer the rewrite |

### Verify-Scope Drift

| Signal | Detection | Surfacing |
|---|---|---|
| `.claude-tweaks/verify-scope.json`'s suites disagree with the workspace | `node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root . --drift --json` — one JSON line `{declared, missingSuites, extraSuites, skipped}` (the verb reads the FILE through `readDeclaration` and detects the workspace itself; never feed the CLI's proposal to `diffAgainstWorkspace`); `declared: false` → no declaration, nothing to report; exit 1 → the declaration itself is invalid (its `readDeclaration` errors are on stderr, stdout is empty) — surface `verify-scope: declaration invalid — {stderr}` as its own finding, never as "no drift" | Report-only: "verify-scope: suites `{extraSuites}` not in workspace; packages `{missingSuites}` have no suite" plus one line per `skipped` entry (`warning: skipped {glob|path} — {reason}`) — never rewritten |

### Routine Relevance

Skip entirely when the Routine Drift check above found no routines (same gate — reuse its
already-resolved record set rather than re-testing for the local directory, which on a checkout
behind the integration branch answers about this checkout instead of the project, #190).
Otherwise, read `${CLAUDE_PLUGIN_ROOT}/skills/harness-health/routine-relevance-analysis.md`
and apply its procedure directly against this project's instantiated records — this is the
one place `/init` reaches into a harness-health-owned file outside that skill's own
SELECT/JUDGE/FILE pipeline (see that file's own header for why).

Present any resulting rows directly, right here in Phase 1u.5 — matching the Work-Record Backend Drift
Migration subsection's own precedent above, this resolves immediately with no Phase 3
hand-off:

```
| Routine | Churn since created_at | Relevance note |
|---|---|---|
| {routine identity} | {N} commits, {date range} | {note} |
```

Resolve with a single acknowledge/defer choice, not a per-row apply (these are judgment calls
with no single mechanical fix, unlike Routine Drift's clean version-diff apply path):

- `question`: `"{N} routine(s) may be worth reconsidering given recent changes to their
  skills. Anything to act on now?"`, `header`: `"Routine relevance"`, `multiSelect`: `false`
- Option 1 — `label`: `"Acknowledged — I'll look into these myself (Recommended)"`,
  `description`: `"No changes made now; revisit manually (e.g. /claude-tweaks:routine update
  <skill> to adjust cadence/tools)"`
- Option 2 — `label`: `"Skip — not relevant"`, `description`: `"Dismiss this run's relevance
  notes entirely"`

Log this pass's outcome to `decisions.md` (or the inventory summary, if this project has no
active pipeline run dir) regardless of outcome: `SCANNED {time} — Routine Relevance: audited
{N} record(s), {M} surfaced for review.` (M may be 0 — log the scan even when nothing was
found, so there's a record the pass ran.)

This check does not count toward Phase 1u.6's Total drift count — like Maturity Drift above,
it isn't a presence/absence signal Phase 1u.6 can cheaply precompute before Phase 3 runs (it
requires reading git history and judging diffs, not checking a marker's existence).

### Routine Environment Dedication

Skip entirely when the Routine Drift check above found no routines (same gate as Routine Drift
and Routine Relevance above — reuse its resolved record set, not a local-directory test, #190).

Build "this project's own routine set" from two complementary sources, unioned and deduplicated by
`trigger_id` (a routine found by both counts once):

(a) **Project-local records** (already known to exist, from the gate above): for each record in
that set — which spans the working checkout *and* the integration branch, so a routine recorded
upstream is still audited here — its `routine_id` field is a `trigger_id`. For any such `trigger_id`
not already present among source (b)'s `list` results below, call `RemoteTrigger {action: "get",
trigger_id: record.routine_id}` to learn its `job_config.ccr.environment_id` (skip a record whose
`get` call fails — that routine was deleted out-of-band; read-only here, no cleanup offered). This
source finds every routine created via `skills/routine/guided-environment-creation.md`'s Create
procedure, which never populates `session_context.sources[].git_repository.url` at all (confirmed
live — see that file's own Create procedure step 7) — those routines are otherwise entirely
invisible to source (b) below, regardless of pagination.

(b) **Account-wide `list` + repo-URL filter**: call `RemoteTrigger {action: "list"}`, filter to
triggers whose `job_config.ccr.session_context.sources[].git_repository.url` matches this project's
own resolved repo URL (`git remote get-url origin`, normalized the same way
`/claude-tweaks:routine`'s CREATE Step 2 normalizes it) — this catches a routine created outside
`/claude-tweaks:routine` entirely (so it has no local record) but does still populate `sources[]`.
**Known limitation, confirmed live** (same one `/claude-tweaks:routine` CREATE Step 4 documents for
this identical call): `{action: "list"}` returns only its first page, with no cursor/pagination
parameter exposed — on an account with enough triggers to paginate, a non-locally-recorded routine
could sit on a later page and go undetected by this source. Source (a) already covers every
locally-recorded routine regardless of pagination; this residual gap only affects a routine neither
recorded locally nor caught by this filter.

If the union is empty, skip.

No API exposes a cloud environment's human-readable name — only its opaque `environment_id`. Check
`.claude-tweaks/routine-environment-cache.yml` first: if it holds both `environment_id` and
`environment_name`, and every one of this project's routines' `environment_id` values (from the
union above) already equals the cached one, report "Routine Environment Dedication: already
on a dedicated environment" and skip further action — no browser pass needed on this run.

Otherwise, at least one routine's `environment_id` is unknown-by-name or doesn't match the cache.
Resolve names for the *distinct* `environment_id` values found among this project's routines by
invoking `skills/routine/guided-environment-creation.md`'s Audit procedure once per distinct ID
(not once per routine — routines sharing the same `environment_id` share the same name, no need to
re-read it). If claude-in-chrome isn't available (Audit's own fallback), skip this entire check for
this run and note in the inventory summary: "Routine Environment Dedication: skipped — browser
automation unavailable to read environment names this run."

For each of this project's routines, its environment now has a known name. Group them: routines
already on an environment whose name matches `claude-tweaks: <project-slug>` (this project's own
`REPO_SLUG`, per `/claude-tweaks:routine`'s CREATE Step 2) need no action. Routines on anything
else (an environment named `Default`, or any other non-matching name — most commonly a shared
environment also used by unrelated ad hoc sessions or other projects) are migration candidates.

If zero candidates, update the cache file's `environment_name` to the now-confirmed matching name
(if it wasn't already cached) and report "already dedicated" as above.

If one or more candidates: present a batch table (Routine | Current environment | Recommended
action: "Move to claude-tweaks: <project-slug>"), then call `AskUserQuestion`:

- `question`: `"{N} routine(s) aren't on a dedicated claude-tweaks environment for this project
  (currently on: {list of distinct current names}). Move them?"`, `header`: `"Env dedication"`,
  `multiSelect`: `false`
- Option 1 — `label`: `"Apply all recommended (Recommended)"`, `description`: `"Move all {N}
  routine(s) to a dedicated 'claude-tweaks: {project-slug}' environment, creating it first if it
  doesn't already exist"`
- Option 2 — `label`: `"Override specific items"`, `description`: `"Choose per-routine whether to
  move it"`
- Option 3 — `label`: `"Skip entirely"`, `description`: `"Leave routines on their current
  environment(s) — I'll move them manually later"`

On "Apply all recommended" or a partial "Override specific items" selection: invoke the Re-point
procedure once per selected routine (its `trigger_id` from the union above,
`target_environment_name` = `claude-tweaks: <project-slug>`) — on the *first* invocation only,
pass `create_if_missing: true` if no environment already named `claude-tweaks: <project-slug>`
was found among the names resolved above (this bootstraps the dedicated environment by
re-pointing that first routine to it, with no throwaway routine ever created — see Re-point's
own header in `guided-environment-creation.md` for why this is the environment-creation path
for a caller with an existing routine to attach to, unlike `/claude-tweaks:routine`'s CREATE
Step 8, which always has a brand-new routine to attach to and so uses Create instead). If that
first call returns `{environment_id, environment_name}` (it does exactly when
`create_if_missing` actually created something), write them into
`.claude-tweaks/routine-environment-cache.yml`. Every subsequent selected routine's Re-point
call passes `create_if_missing: false` (or omits it — that's the default) since the
environment now definitely exists. Report per-routine success/failure; a failed re-point
leaves that routine on its prior environment, unchanged.

On any outcome except "Skip entirely," log to `decisions.md` (or the inventory summary, if this
project has no active pipeline run dir):
```
AUTO {time} — Update Mode: moved {M} of {N} routine(s) to a dedicated claude-tweaks environment.
```

This check's candidate count counts toward Phase 1u.6's Total drift count, the same
self-classifying convention Routine Drift above already uses — treat each migration candidate as
an additional Contract Drift entry, so Phase 1u.6's own "Contract Drift entries from 1u.5" formula
picks it up without that table needing its own edit.

## Phase 1u.6: Update Mode Early-Exit Gate

After Phase 1u (inventory) and Phase 1u.5 (contract drift) complete, evaluate the audit signal before committing to the full phase ceremony. Update Mode's value is in catching drift quickly — when there's almost nothing to catch, the ceremony costs more than it produces.

**Compute the audit totals from Phase 1u + 1u.5 so far:**

| Metric | Source |
|--------|--------|
| **Total drift count** | Contract Drift entries from 1u.5 + any stale/drifted entries from the 1u inventory pass |
| **Gap count** | Codebase patterns that have no existing config (initially zero — full Gap count is computed in Phase 3; this gate uses the preliminary signal from the inventory pass) |

**Early-exit criteria:**

- `$ARGUMENTS` contains `--full` → skip this gate entirely, go straight to the full pass (Phase 2 onward) regardless of drift/gap counts. This is the override the early-exit output text and `SKILL.md` both advertise as the way to force the complete reconnaissance pass.
- Otherwise: Total drift count = 0 **AND** preliminary gap signal < 3 → **early-exit fast path**

**On early-exit:**

1. Present the audit findings inline (one block, not a full phase summary). Enumerate what was verified — the early-exit must still answer "what did you check and find healthy?", just from the inventory + conformance passes (Phases 1u/1u.5), since Phases 2-8.5 were skipped:

   ```
   ### Update Mode — Quick Audit

   Config is current. No drift detected. {N} preliminary gap signals (below threshold).

   **Verified & Consistent**

   Environment & dependencies:
   - Superpowers: present · Code simplifier: available · agent-browser: installed (v{X.Y.Z})
   - Git repo: yes · Node: v{X} · Statusline: wired · Workflow dirs: present

   Template conformance: every plugin-authored CLAUDE.md section matches the installed template — none missing, none drifted.

   Inventory: {M} skills, {R} rules, CLAUDE.md ({L} lines) — all classified "covered" against the existing config.

   {if N > 0: list the N preliminary gap signals briefly with file paths}

   Skipping Phases 2-8.5 (full reconnaissance) — re-run `/init update --full` to force the complete pass.
   ```

   Only include lines for checks that ran; omit any the inventory pass did not compute.

2. Log to the active pipeline's `decisions.md` using the resolution order in `_shared/run-dir-resolution.md`. `/init` is on the standalone-auto allowlist — if `PIPELINE_RUN_DIR` is unset and no recent run matches, create a standalone run dir at `.claude-tweaks/pipelines/{ISO-timestamp}-init-standalone/` and append the entry there. Never suppress the audit-log write.
   ```
   AUTO {ISO-time} — Phase 1u.6: early-exit (drift=0, gaps<3). Reason: Update Mode fast path per the Phase 1u.6 early-exit gate. Reversibility: high.
   ```

3. Skip directly to Phase 9 (Summary). Phase 9's summary template adapts: "Update Mode — no patches needed" instead of the full patch list.

**On full pass (criteria not met):** drift > 0 OR preliminary gap signal >= 3 → continue to Phase 2 (Codebase Reconnaissance) as normal.

The gate is automatic — no user prompt. The user always sees the audit findings, just without the ceremony when there's nothing to act on.

## Phase 4 in Update Mode: Score the Gaps

Update Mode runs Phase 4 only against **gaps** — patterns the codebase has that no existing config covers. Existing skills that need updating are handled as patches in Phase 6, not new skills.

Apply the standard Phase 4 scoring procedure (Frequency + Complexity + Danger; see `phase-4-scoring.md` in this skill's directory) to gap candidates only. Existing skills that were classified as **Drifted** in Phase 3 do not go through scoring — their patches are surfaced in the Drift Report's "Drifted" section.
