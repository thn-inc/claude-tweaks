---
files:
  - plugin/bin/lib/residue/probes/release.js
  - plugin/bin/residue.js
  - plugin/bin/lib/residue/render.js
  - plugin/skills/tidy/scan-procedures.md
---

# Trust a Missing-Release-Tag Finding

**Persona:** A claude-tweaks maintainer. They are closing a run from a fresh worktree or a cloud sandbox clone whose local tag set lags `origin`, and they see the residue sweep's release-triple check in the `/claude-tweaks:wrap-up` residue table (or in `/claude-tweaks:tidy`'s repo-wide pass).
**Goal:** Believe a `tag for CHANGELOG entry v{X}` finding. It should name only a version that is truly untagged everywhere, and it should never invite an unattended sweep to push a tag over released history.
**Entry point:** A terminal inside the run's worktree, with a CHANGELOG that has headings for released versions whose `v*` tags exist on `origin` but were never fetched locally.
**Success state:** Published tags produce no finding. A version tagged nowhere produces one finding marked `remedy: record`. An offline sweep still runs and says it only checked local tags.

## Steps

### 1. Sweep a checkout that never fetched its tags
- **URL:** `node plugin/bin/residue.js --base <merge-base> --integration-branch origin/main --scope blast-radius --no-suite`
- **Action:** Run the sweep that wrap-up's residue preamble runs, from a worktree whose `git tag -l 'v*'` lacks tags that `git ls-remote --tags origin 'v*'` lists.
- **Should feel:** Quiet. Released versions don't show up as missing just because this checkout is shallow.
- **Should understand:** `probeRelease` makes one `ls-remote --tags origin 'v*'` call and strips `refs/tags/`, the leading `v`, and an annotated tag's peeled `^{}` suffix. It merges the result with the local tag list before applying the bootstrap-anchor filter (#2882). A tag that exists on either side is not missing.
- **Red flags:** `tag for CHANGELOG entry v{X}` rows for versions `ls-remote` lists. That is the false positive #2552's sweep filed, which led to the now-closed #2847 asking to push tags that already existed.

### 2. Read a genuinely missing tag
- **URL:** the same command, or `--json` to read the finding's fields
- **Action:** Look at a version that has a CHANGELOG heading but no tag either locally or on `origin`.
- **Should feel:** Like a question for a human, not a chore queued for the sweeper.
- **Should understand:** That finding carries `remedy: record`, not `auto`. Creating or pushing a tag over already-released history is a human decision, so `/claude-tweaks:tidy`'s auto-apply pass leaves it alone. The opposite finding, `CHANGELOG entry for v{X}` (a tag with no heading), keeps `remedy: auto`.
- **Red flags:** A missing-tag row with `remedy: auto`. An unattended pass that creates or pushes a `v*` tag.

### 3. Sweep offline
- **URL:** the same command, with no network access or in a clone with no `origin`
- **Action:** Run the sweep where the remote tag read fails, and read the note below the Outstanding table. `render.js` lists a probe that ran on reduced input under "Probes that ran on reduced input", as a `degraded:` line; `--json` carries the same text on the probe's result object.
- **Should feel:** Honest. The check still runs, and it says it ran on less.
- **Should understand:** When `ls-remote` fails, the probe still returns `ran: true` using the local tags only. Its result `reason` names the fallback: `remote tag list unavailable (git ls-remote failed) — checked local tags only`. A finding there may reflect the checkout's lag rather than real history.
- **Red flags:** The release check reporting `ran: false` (silently skipped) on a failed remote read. A fallback run with no `degraded:` line in the rendered table, or no `reason` on its result, saying it checked only local tags.

## Origin

Created by `/claude-tweaks:build` for record #2882 (2026-10-16): the release probe now unions remote and local tags, falls back to local tags with a named reason, and marks missing-tag findings `remedy: record`.
