---
files:
  - plugin/skills/help/policy.md
  - plugin/skills/help/SKILL.md
  - plugin/bin/resolve-policy.js
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/init/policy-review.md
  - plugin/bin/lib/hooks/pre-tool-use.js
---

# Review a Project's Policy Configuration

**Persona:** Project owner who wants to know how the project is configured and what to change — without hand-reading `.claude-tweaks/policy.yml` line by line or re-deriving `POLICY_KEYS`' schema defaults from memory.
**Goal:** See every set lever, every config issue, and up to three evidence-backed recommended edits in one pass, then apply the ones that fit — with a safety net that reverts any edit that breaks the audit.
**Entry point:** A terminal at a project checkout root, talking to the agent — `/claude-tweaks:help policy`.
**Success state:** The four render-contract sections rendered from one held snapshot, zero or more approved edits written to `.claude-tweaks/policy.yml`, and a clean re-audit confirming no new issue was introduced (or a named revert if one was).

## Steps

### 1. Ask for the policy review — `/claude-tweaks:help policy`
- **URL:** `/claude-tweaks:help policy`
- **Action:** Invoke `/claude-tweaks:help` with the `policy` argument.
- **Should feel:** A dedicated mode, not the usual dashboard — no command-reference cheat sheet, no workflow status scan.
- **Should understand:** `policy` mode skips `SKILL.md`'s own Section 1 (cheat sheet) and Section 2 (status scan) entirely — `plugin/skills/help/policy.md` owns the whole run from Gather through its own `## Next Actions`, which replaces `SKILL.md`'s default Next Actions block.
- **Red flags:** The dashboard's workflow status or command reference rendering alongside the policy sections; a second Gather call re-running `resolve-policy.js --all` mid-mode instead of reusing the one held snapshot.

### 2. Read the four sections — chat
- **URL:** no command — the agent's rendered response
- **Action:** Read Set levers (grouped by category, each row `` `{key}` — {value} ({source}) · default: {default} — {summary} ``), Issues (each non-empty list, or the literal `Policy config issues: none` line), Notable defaults (core-tier keys still on default where a project signal argues otherwise, or one of the two zero-finding lines), and Advanced tier (one collapsed `{N} advanced levers on defaults` line).
- **Should feel:** Complete in one read — every set lever's value, source, and meaning, without a second lookup.
- **Should understand:** All four sections render from the single `--all` snapshot taken at Gather time; a `null` default renders as `default: no default`, not literal `null`, except the derived-default keys' own special case (`_shared/policy-schema.md`'s Shape A/Shape B list) — `integration-model` renders `computed (forge detection)`, `merge-verification` `computed (derivation ladder)`, `housekeeping-auto-merge` `computed (derived from autonomy)`. `housekeeping-auto-merge` is the differently-shaped Shape B case (#580, render fix #636): its metadata `default` stays the literal `false` (the `supervised` base) while its resolved value derives from `autonomy`, so on a `trusted`/`unattended` project a key **explicitly set** in `policy.yml` now shows that computed wording in Set levers rather than the literal `false`. Left **unset** there, the held snapshot carries `{"value":true,"source":"default"}`: `source` keeps it out of Set levers, and the snapshot-intrinsic finding (any core-tier key whose snapshot `value` differs from its snapshot `default`) always surfaces it in Notable defaults instead — never silently omitted, never promoted. `node plugin/bin/resolve-policy.js housekeeping-auto-merge` is where it is read directly (`docs/journeys/resolve-a-policy-key.md` step 1).
- **Red flags:** A section silently skipped instead of rendering its own zero-finding line; a hand-typed default value instead of one read from the snapshot; an unset `housekeeping-auto-merge` promoted into Set levers because its derived value is `true` — the derivation changes the value, never the `source` that decides which section a key belongs to.

### 3. Expand the advanced tier — chat
- **URL:** no command — say "show advanced" in chat
- **Action:** Ask to see the advanced-tier levers still on default.
- **Should feel:** A free follow-up, not a new decision — no confirmation, no new question.
- **Should understand:** This expands in-conversation from the same held snapshot; it never triggers a new `AskUserQuestion` — the mode has exactly one, reserved for the apply step below.
- **Red flags:** A second `AskUserQuestion` call firing here.

### 4. Answer the one apply question — `AskUserQuestion`
- **URL:** no page — the mode's single `AskUserQuestion` call (`multiSelect: true`)
- **Action:** Review up to three recommended edits (ranked core-tier-severity first) plus a "No changes" option, and check the ones to approve.
- **Should feel:** Concrete, not abstract — each option's description names the exact `key: value` line that would be written, and for an enum key, every legal value read live from `POLICY_KEYS`.
- **Should understand:** Checking "No changes" wins outright over any other checked option in the same batch — nothing is written. Recommendations beyond the cap of 3 are never dropped; they stay visible in section 3's list, tagged for a later ask.
- **Red flags:** An option whose enum values look hardcoded rather than schema-sourced; more than one `AskUserQuestion` call across the whole mode.

### 5. Apply and confirm the re-audit — `.claude-tweaks/policy.yml`
- **URL:** no command — the agent writes `.claude-tweaks/policy.yml` directly
- **Action:** Wait for the agent to validate each approved key (`resolveValue`), write its line, then re-run `auditPolicy()` once against the whole batch.
- **Should feel:** Safe to approve multiple edits at once — a batch that introduces a new issue gets caught and named, not silently left broken.
- **Should understand:** A rejected value is reported and its line is never written; a new issue found by the single post-apply re-audit reverts that key specifically — deleting the line if it didn't exist before this apply, restoring the prior Gather-snapshot value if it did — and no edit is confirmed to the user until that re-audit comes back clean. In a main checkout under `worktree-always: true`, what happens next depends on the running plugin build. On a build newer than `6.86.0` the policy.yml-only write exemption is live: Step 4's question is offered as normal, and each approved line is written as an isolated `Edit`/`Write` to `.claude-tweaks/policy.yml`, staged on its own, then committed by a **separate** bare `git commit` call — never chained, and never staging anything else. The exemption matches the file by its real path, so a path typed with different letter casing on a case-insensitive volume still qualifies (#3495), while a symlink swapped in for `policy.yml` is still denied. On an older build the exemption doesn't exist: the pre-check catches the main checkout before Step 4's question is offered at all, and the agent renders each recommendation as a paste-ready `printf` command for the user to run outside the session.
- **Red flags:** A confirmed edit whose re-audit was skipped; a main-checkout `Edit` to `.claude-tweaks/policy.yml` denied only because the typed path's letter casing differs from the on-disk casing; a main-checkout apply that chains its `git add` and `git commit` into one call, or stages anything besides `.claude-tweaks/policy.yml` (either shape is denied whole); on a build at or below `6.86.0`, a main-checkout write attempted instead of falling back to paste-ready commands.

Reviewing configuration this way is read-only-safe up through Step 3 — `/claude-tweaks:init`'s own Update Mode Policy Configuration Review offers the same rendered content (via `plugin/skills/help/policy.md`'s Render contract, one renderer, two entrances) as a read-only second entrance, pointing back at `/claude-tweaks:help policy` for the actual edits — `/init` never writes `.claude-tweaks/policy.yml` itself through this path.

## Origin
- Updated at wrap-up of the policy-key rename run: Step 5's main-checkout branch now tracks the build-version gate the policy.yml write exemption introduced (#537/#589)
- Related specs: #332 (policy-key naming convention), #602 (`worktree.always` → `worktree-always`)
- Updated by #3495: the policy.yml write exemption now compares case-canonical real paths, so a mis-cased path to the file keeps the exemption
