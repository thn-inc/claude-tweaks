---
files:
  - plugin/bin/lib/policy-schema.js
  - plugin/skills/init/bootstrap/step-14-cloud-routine-parity.md
  - plugin/skills/init/bootstrap/step-15-routine-installation.md
  - plugin/skills/routine/fleet.md
  - plugin/skills/routine/create-and-update.md
  - plugin/skills/_shared/routine-template-schema.md
---

# Opt Out of the Project-Scope claude-tweaks Declaration

**Persona:** Maintainer of a repo that runs claude-tweaks from a user-scope install. They deliberately took `claude-tweaks@claude-tweaks-marketplace` out of the committed `.claude/settings.json` (and its marketplace entry and setup-script lines), as #4841 did across six repos, and want `/init` to stop putting it back.
**Goal:** Make the removal stick: re-running `/claude-tweaks:init` leaves claude-tweaks undeclared, and `/claude-tweaks:routine fleet on` reports the consequence instead of treating the absence as a fault. The routine side says the same: `/init` Step 15 and `/claude-tweaks:routine create` name the cost before a routine exists, and a firing that finds no claude-tweaks stops and names the opt-out.
**Entry point:** `.claude-tweaks/policy.yml`, then `/claude-tweaks:init` (Step 14, Cloud/Routine Parity Setup)
**Success state:** `/init` adds no claude-tweaks line to the committed settings (an entry already there is left as it is) and the generated `scripts/claude-cloud-setup.sh` carries none, while superpowers is still declared. The maintainer knows exactly what cloud sessions and Routines will and won't get. On the routine side, `/init` Step 15 prints its notice once, a standalone `create` preview carries one `claude-tweaks: not declared` line, and an opted-out firing with an empty plugin cache stops on one `claude-tweaks not installed` line instead of running the setup script.

## Steps

### 1. Opt out — `.claude-tweaks/policy.yml`
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** Add `declare-claude-tweaks: false`. Check it with `node plugin/bin/resolve-policy.js --values declare-claude-tweaks`, which prints `false`.
- **Should feel:** Like a one-line, reversible switch. Deleting the line restores today's behavior.
- **Should understand:** Only the literal `false` opts out. Unset, or any other spelling (`off`, `no`, `False`), resolves `true` and keeps declaring claude-tweaks. A malformed value says so on stderr.
- **Red flags:** `off` silently opting out, or `false` being ignored.

### 2. Re-run `/init` — Step 14, Cloud/Routine Parity Setup
- **URL:** `/claude-tweaks:init` (Step 14)
- **Action:** Run `/init` (or `/init --update`). The Cloud parity prompt offers to declare superpowers plus any mirrored local plugins, but never claude-tweaks. That holds even though `~/.claude/settings.json` still lists claude-tweaks, so it is never offered as a mirror candidate either.
- **Should feel:** Respected. The removal is not undone and is not re-asked.
- **Should understand:** superpowers stays a hard requirement whatever the key says. If the project still carries a claude-tweaks entry, `/init` leaves it in place rather than deleting it. A re-run with superpowers alone declared reports "already configured" with no prompt.
- **Red flags:** `claude-tweaks@claude-tweaks-marketplace` or a `claude-tweaks-marketplace` entry reappearing in `.claude/settings.json`, or claude-tweaks shown as a mirror candidate.

### 3. Inspect the regenerated setup script — `scripts/claude-cloud-setup.sh`
- **URL:** `scripts/claude-cloud-setup.sh`
- **Action:** Read the script `/init` regenerated.
- **Should feel:** Predictable. The script installs exactly what the project declares, minus claude-tweaks.
- **Should understand:** There is no `claude-tweaks-marketplace` add or update line, and `PLUGIN_SPECS` starts at `superpowers@claude-plugins-official`. This holds even when a kept settings entry remains, because the key, not the entry, decides what the script installs. A header comment names the key.
- **Red flags:** Any `claude-tweaks-marketplace` line in the script, or an unclosed `\` continuation left where the claude-tweaks lines were removed.

### 4. Provision or reconcile the fleet — `/claude-tweaks:routine fleet on`
- **URL:** `/claude-tweaks:routine fleet on` (Step 2, Cloud-parity honesty check)
- **Action:** Run `fleet on`. The parity check resolves the key first. With superpowers declared and the setup script present, it does not prompt. It prints `Cloud parity: declare-claude-tweaks is false, so this project does not declare claude-tweaks for cloud firings — they will not have claude-tweaks installed by the project declaration, and fleet routines need it installed in the sandbox some other way.`
- **Should feel:** Honest, not alarming. The cost of the choice is named once, plainly.
- **Should understand:** Fleet routines run claude-tweaks skills. With the opt-out on, the project's own declaration won't put claude-tweaks into a cloud sandbox, so something else has to (for example, an environment Setup script edited by hand). A missing superpowers declaration or a missing setup script still triggers the parity prompt, and the opt-out line rides along on the summary's "Gap acknowledged" line.
- **Red flags:** The missing claude-tweaks declaration triggering the "Parity gap" prompt, or the summary reading "OK — claude-tweaks + superpowers declared" while the key is `false`.

### 5. Select a routine during `/init` — Step 15, Routine installation
- **URL:** `/claude-tweaks:init` (Step 15)
- **Action:** Pick at least one routine candidate. Before the Setup-script environment offer, `/init` prints `Routines: this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks — a routine fired here needs claude-tweaks supplied to its environment another way, or the key set back to true.` Then it creates each routine with `/claude-tweaks:routine create … --source init`.
- **Should feel:** Told once, at the moment it matters, with no repetition per routine.
- **Should understand:** The routines are created as usual. The notice names the two ways out: supply claude-tweaks to the environment, or set the key back to `true`. Selecting no candidates prints nothing.
- **Red flags:** The notice printing once per created routine, printing when no routine was selected, or not printing at all while the key is `false`.

### 6. Create a routine directly — `/claude-tweaks:routine create`
- **URL:** `/claude-tweaks:routine create <skill>` (Step 7, Preview and confirm)
- **Action:** Create a routine outside `/init`. The preview carries one extra line: `claude-tweaks: not declared — this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks, and this routine will fire without it unless claude-tweaks is supplied to its environment another way, or the key is set back to true.`
- **Should feel:** Like an informed confirmation. The cost is in the preview, not discovered at the first firing.
- **Should understand:** The line appears only at `false`, and it is skipped under `--source init` and for `fleet on` rows, whose own steps already said it once.
- **Red flags:** The line appearing at the default `true`, or missing from a standalone create while the key is `false`.

### 7. Watch an opted-out routine fire with no claude-tweaks — the routine kernel
- **URL:** the routine's firing transcript at claude.ai/code/routines
- **Action:** A scheduled firing finds an empty plugin cache, so the resolved-build line reads `claude-tweaks version unresolved`. The kernel reads the checkout's `.claude-tweaks/policy.yml`, sees `declare-claude-tweaks: false`, and prints `claude-tweaks not installed: this project sets declare-claude-tweaks: false, so its Setup script does not install claude-tweaks — supply claude-tweaks to this environment another way, or set the key back to true`. Then it stops.
- **Should feel:** Diagnosable at a glance. The firing names the cause instead of failing somewhere downstream.
- **Should understand:** The kernel skips the setup-log read and `scripts/claude-cloud-setup.sh` here, because that script no longer installs claude-tweaks. Only a top-level, unquoted `false` counts. A quoted `"false"` or any other value keeps the normal self-heal. This text is kernel version 2, so routines created before it report kernel-stale drift until `/claude-tweaks:routine update` re-syncs them.
- **Red flags:** The firing running the setup script anyway and failing at "version unresolved", or a routine whose environment does supply claude-tweaks stopping on this line. That environment resolves the build and never reaches this check.

## Origin

#4847: lets a project opt out of `/init` declaring claude-tweaks in its committed settings. It was filed after #4841 removed the project-scope declaration from six repos and the next `/init` run would have re-added it.

#4940: extends the opt-out to the routine side, covering `/init` Step 15's offer, `/routine create`'s preview and the kernel's empty-cache self-heal (steps 5-7).
