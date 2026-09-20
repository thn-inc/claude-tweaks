# Policy — Deprecated Key Removal Conditions

The removal-condition home that `bin/lib/policy-schema.js`'s `RENAMED_KEYS` comments point at, for every policy key collapsed, retired, or renamed since #331 — one `##` entry per key below. Each entry states what a stray `policy.yml` line does now, and a re-checkable condition under which the key's `RENAMED_KEYS` entry (and this file's entry) gets deleted. `skills/dispatch/deprecated-aliases.md` holds its own two dispatch-alias conditions — same pattern, separate entries.

Every entry shares one predicate form: **(a)** `grep -nF "{key}:" .claude-tweaks/policy.yml` (fixed-string; the trailing colon keeps `worktree.always:` from matching prose that merely mentions the key) in this repo returns nothing, and **(b)** the release that shipped the entry's rename or retirement (the record named in the entry's heading) — resolve that record's merge commit to the plugin version that first shipped it (`git log --oneline -- plugin/.claude-plugin/plugin.json .claude-plugin/plugin.json` around the merge — both pathspecs, since #418's payload cutover moved the manifest and history straddles the boundary — or the record's `Release` note), then read that version's date row in `docs/shipped-versions.tsv` — is at least 6 months old, checked at the next minor release after both hold. (a) guards regression; (b) is the marketplace grace period, since users' `policy.yml` files cannot be enumerated and their only migration signal is the audit report below. This fixed-string form is what makes clause (a) satisfiable for the dotted old names (#332's four dot→dash entries and #602's `worktree.always`); the earlier regex form — an unescaped `.` matches any character, so it also matched the dash-spelled replacement line forever — could never clear for them.

## `unattended-tier` (renamed to `autonomy`, #289)

Now: migrates at read — `migrate` maps the old `on` value to `autonomy: unattended`; any other stray value null-migrates, falling through to `autonomy`'s schema default rather than minting a value the new key never had. `auditPolicy` reports the stray line under `renamedKeys` with the suggested replacement. A file setting **both** keys follows the resolver's uniform alias rule: the `autonomy` line wins and the old tier key contributes nothing.

Removal condition: the shared predicate above, with `{key}` = `unattended-tier`.

## `execution.always` (merged into `execution-strategy`, #331)

Now: migrates at read — the resolver maps `subagent` → `subagent-only` and `batched` → `batched-only` (full lock semantics preserved, `renamed-from` attribution); any other value null-migrates, falling through to `execution-strategy`'s schema default (`subagent`, unlocked), never minting a malformed `-only` value. `auditPolicy` reports the stray line under `renamedKeys` with the suggested replacement. A file setting **both** keys follows the resolver's uniform alias rule: the `execution-strategy` line wins and the old lock key contributes nothing — a plain-value line therefore leaves the axis unlocked; the audit report and `/claude-tweaks:init --update`'s drift check are what surface that conflict for the user to resolve.

Removal condition: the shared predicate above, with `{key}` = `execution.always`.

## `merge-check` (renamed to `branch-divergence-check`, #331)

Now: migrates at read — identity `migrate`, boolean semantics unchanged, `renamed-from` attribution. The rename resolves the old name's collision with `/claude-tweaks:assess-agent-autonomy`'s `merge-check` verdict mode, which keeps its name.

Removal condition: the shared predicate above, with `{key}` = `merge-check`.

## `review-diff-heuristic-thresholds` (retired, no replacement, #331)

Now: reports as retirement — `auditPolicy` lists it under `renamedKeys` with `replacedBy: null` (deliberate retirement, not a typo); `/claude-tweaks:init --update` offers to delete the line, warn-tier, never blocking. The resolver treats the line as contributing nothing and a request for the name as unknown-key. The threshold values are stated constants in `skills/review/review-effort-derivation.md` step 3.

Removal condition: the shared predicate above, with `{key}` = `review-diff-heuristic-thresholds`.

## `promise-register-min-leaves` (retired, no replacement, #331)

Now: reports as retirement — same audit/init/resolver behavior as the entry above. The value `4` is hardcoded at its read sites (`skills/specify/record-creation-linking.md` — #1346's split of `record-creation.md`, `skills/wrap-up/verification-brief.md`, `skills/_shared/work-record.md`).

Removal condition: the shared predicate above, with `{key}` = `promise-register-min-leaves`.

## `section-confirmation` (retired, no replacement, #331)

Now: reports as retirement — same audit/init/resolver behavior as the entries above. Adaptive section batching is the unconditional behavior (`docs/skill-authoring.md`); the `per-section`/`batch` overrides no longer exist.

Removal condition: the shared predicate above, with `{key}` = `section-confirmation`.

## `review-severity-floor` (renamed to `review-auto-apply-ceiling`, #332)

Now: migrates at read — identity `migrate`, enum semantics unchanged, `renamed-from` attribution. Renamed because the value is the *maximum* severity auto-applied (`medium` → Low and Medium auto-apply, High staged), i.e. a ceiling, and the `-floor` suffix collided with `review-effort-floor`, which is a genuine floor. `auditPolicy` reports the stray line under `renamedKeys` with the suggested replacement; a file setting both keys follows the resolver's uniform alias rule (new key wins).

Removal condition: the shared predicate above, with `{key}` = `review-severity-floor`.

## `automerge-max-lines` (renamed to `auto-merge-max-lines`, #332)

Now: migrates at read — identity `migrate`, integer semantics unchanged, `renamed-from` attribution. Spelling unified with `housekeeping-auto-merge` and the `auto:merge` label.

Removal condition: the shared predicate above, with `{key}` = `automerge-max-lines`.

## `automerge-max-files` (renamed to `auto-merge-max-files`, #332)

Now: as `automerge-max-lines` above.

Removal condition: the shared predicate above, with `{key}` = `automerge-max-files`.

## `project.maturity` (renamed to `project-maturity`, #332)

Now: migrates at read — identity `migrate`, enum semantics unchanged, `renamed-from` attribution. Dot → dash per `_shared/policy-key-naming.md`. `/claude-tweaks:init` writes the new name into generated `policy.yml` files; a pre-#332 project's dotted line keeps resolving until the removal condition is met.

Removal condition: the shared predicate above, with `{key}` = `project.maturity`.

## `harness-health.scoped-rule-budget` (renamed to `harness-health-scoped-rule-budget`, #332)

Now: migrates at read — identity `migrate`, integer semantics unchanged, `renamed-from` attribution. Dot → dash per `## Key naming`.

Removal condition: the shared predicate above, with `{key}` = `harness-health.scoped-rule-budget`.

## `harness-health.always-loaded-budget` (renamed to `harness-health-always-loaded-budget`, #332)

Now: as the entry above.

Removal condition: the shared predicate above, with `{key}` = `harness-health.always-loaded-budget`.

## `doc-convention.adr` (renamed to `doc-convention-adr`, #332)

Now: migrates at read — identity `migrate`, enum semantics unchanged (still no schema default — unset means "detect and ask"), `renamed-from` attribution. Dot → dash per `## Key naming`.

Removal condition: the shared predicate above, with `{key}` = `doc-convention.adr`.

## `worktree.always` (renamed to `worktree-always`, #602)

Now: migrates at read — identity `migrate`, boolean semantics unchanged, `renamed-from` attribution in the resolver. The hook's own reader (`bin/lib/policy.js` `isWorktreeAlwaysOn`) consults the same `RENAMED_KEYS` entry, so an un-migrated project keeps the gate: old line alone → ON; new line present → the new line decides, in any file order. `auditPolicy` reports the stray old line under `renamedKeys` with the suggested replacement. This repo's own `.claude-tweaks/policy.yml` deliberately carries both lines during the transition — see the comment on the old line there — because the *installed* plugin build reads the old literal until it is upgraded to the release that shipped #602. A project that migrates its `policy.yml` to `worktree-always` and then downgrades the plugin below the release that shipped #602 loses the gate — that build reads the old literal only — which is inherent to any rename of a hook-read key, the mirror image of this repo's transitional twin.

Removal condition: the shared predicate above, with `{key}` = `worktree.always` — clause (a) additionally waits for the transitional twin line to be deleted from this repo's `policy.yml`, which happens once the **running** build's `plugin.json` version (`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — not the install pointer `claude plugin update` moves) is at or above the release that shipped #602. That deletion belongs in a **fresh session** started on such a build — never mid-session after `claude plugin update`, since the running session keeps whatever build it started with regardless of where the install pointer moves; see `docs/incident-log.md` `[IL-133]`.

## Bare-SHA verify stamp twin — claude-tweaks-verify-pass (#1921)

Not a policy key: the file `{git-dir}/claude-tweaks-verify-pass` is the pre-#1921 verification pass stamp (a bare SHA an agent used to write by hand). Since #1921 `bin/verify.js` writes the canonical JSON stamp `{git-dir}/claude-tweaks-verify-pass.json` and, as the expand phase of that contract change, still writes the bare-SHA twin so an installed build running older skill prose (`review/code-mode-steps.md`'s former `cat` read) keeps finding it. `stamp.js`'s `readStamp` also reads the bare file as a `{scope: 'full', legacy: true}` fallback when the JSON is absent.

Removal condition: delete the twin write in `stamp.js`'s `writeStamp`, the legacy read branch in `readStamp`, and this entry at the first minor release after the one that shipped #1921 (resolve via `docs/shipped-versions.tsv`), once `grep -rn 'claude-tweaks-verify-pass"' plugin/skills` returns no reader of the bare file.
