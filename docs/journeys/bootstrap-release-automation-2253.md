---
files:
  - plugin/skills/init/bootstrap/step-21-release.md
  - plugin/bin/release-bootstrap.js
  - plugin/bin/lib/init/release-bootstrap.js
  - plugin/skills/init/worktree-policy-finalization.md
  - plugin/skills/init/claude-md-template.md
  - plugin/skills/init/input-grammar.md
---

# Bootstrap Release Automation With Init

**Persona:** Maintainer of a Node service that already tags releases by hand, onboarding claude-tweaks on a GitHub-backed repo pinned to `integration-model: pr-first`, who wants release-please set up without hand-writing its three files or guessing the manifest version.
**Goal:** One `/claude-tweaks:init` pass leaves the repo with a valid release-please config, a manifest seeded at the current version, a workflow on the right branch, and the two `release-*` policy rows present but inert — or a clear refusal naming the release tool that is already in charge.
**Entry point:** `/claude-tweaks:init release` (or any `/init` run that reaches Step 21 after Step 20 has resolved `integration-model`).
**Success state:** `release-please-config.json` and `.release-please-manifest.json` exist with `release-type: node` and the newest `v*` tag's version; `.github/workflows/release-please.yml` triggers on and targets the integration branch and carries a commented `token:` hint; `.claude-tweaks/policy.yml` ends with `# release-hook: …` and `# release-train: false`; the init summary reads `release: bootstrapped — node, manifest 1.10.0`; a second run reads `release: already configured` and touches nothing.

## Steps

### 1. Step 21 opens only when Step 20 answered — init's optional-enhancements pass
- **URL:** `/claude-tweaks:init release` (Enhancement filter token; `input-grammar.md`)
- **Action:** Init runs the core bootstrap, then only Step 21. The step first reads `integration-model` through the canonical resolver; with `pr-first` it proceeds, with an empty or ambiguous value it stops itself.
- **Should feel:** Predictable — the step never guesses an engine; a skipped run says exactly why.
- **Should understand:** The engine choice *is* the integration model (design stance 4): `pr-first` → release-please workflow + config, `local-merge` → config only. There is no separate release-engine key to set.
- **Red flags:** A summary line `release: skipped — integration-model unresolved` on a repo where Step 20 was declined — the fix is Step 20, not this step; a run that writes a workflow under `local-merge`.

### 2. Detection — one verdict, three outcomes
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/release-bootstrap.js" --integration-model pr-first --branch main` (called by the step; one JSON line back)
- **Action:** The CLI scans the repo root for competing release tooling (`.releaserc*`, `release.config.*`, `.changeset/`, `.goreleaser.*`, a foreign `release-please-config.json`) and for this step's own earlier output, and returns `fresh`, `already-bootstrapped`, or `conflict` with the tool and its evidence path.
- **Should feel:** Honest — the existing `v1.9.0`, `v1.10.0` tags do not read as a conflict; only a real second engine does.
- **Should understand:** `conflict` writes nothing and names the file (`release: conflict — changesets`); removing that tool and re-running clears it. `already-bootstrapped` needs *both* the shaped config and the manifest — a half-written earlier run reads as `fresh` and completes itself. A mistyped `--root` is a usage error (exit 2), never a phantom bootstrap.
- **Red flags:** A conflict verdict with no evidence path; `already configured` reported while the manifest is missing; a JSON line whose `verdict` is not one of the four documented values.

### 3. The three files land — release-type from the stack table, version from the tags
- **URL:** repo root — `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`
- **Action:** On `fresh`, the CLI resolves `release-type` from the stack table (exactly one matching row → `node`; zero or several → `simple` with an `extra-files` pointer at a version-bearing JSON manifest), seeds the manifest from the semver-newest `v*` tag (`v1.10.0` beats `v1.9.0`; pre-release tags are ignored; no tags → the stack manifest's version → `0.1.0`), and writes the workflow pinned to `googleapis/release-please-action@v4` with `target-branch` and `branches` both set to the integration branch.
- **Should feel:** Correct on the first try — the manifest matches what the maintainer would have typed.
- **Should understand:** The workflow's commented `token:` line is not decoration: releases created with the default `GITHUB_TOKEN` never trigger a `release: published` publish/deploy workflow, so a PAT secret is the price of having a hook under `pr-first`. Under `simple`, release-please will also create a root `version.txt`.
- **Red flags:** `release-type: node` seeded from a stale root `package.json` on a repo whose real manifest lives elsewhere (this plugin's own case — tracked for unit 8); a workflow with `branches: [develop]` but no `target-branch`.

### 4. The policy rows arrive commented, at the very end
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** The CLI returns the two rows; the step queues them, and init's worktree-policy finalization appends them — through the isolated-worktree write, never a direct edit — as the last filesystem action of the run, skipping a key that is already present.
- **Should feel:** Non-committal — nothing is turned on; the rows are documentation of two levers a later unit will read.
- **Should understand:** `release-hook` is a shell command (spaces and one pair of surrounding quotes are fine; a `#` ends the value) that only the local engine runs; `release-train` stays `false` until the maintainer opts into the unattended train, and even then it is honored only at `autonomy: unattended`.
- **Red flags:** Uncommented rows; rows written directly into the main checkout on a `worktree-always` project; a second `# release-train:` line after a re-run.

### 5. Re-run and the CLAUDE.md section
- **URL:** `/claude-tweaks:init release` again; the generated `CLAUDE.md`'s `## Releasing` section
- **Action:** The second run reports `release: already configured` and writes nothing. The CLAUDE.md template's `## Releasing` section names the engine, where the hook lives, and the `/claude-tweaks:release` invocation — framed as landing with later units of the release family until they ship.
- **Should feel:** Safe to repeat — init never clobbers a config the maintainer has since edited (a manifest-missing re-run rewrites only the missing files).
- **Should understand:** The bootstrap is the whole of #2253; cutting a release is unit 5/6's skill, and this repo's own migration (unit 8) needs an explicit release-type override.
- **Red flags:** A re-run that rewrites a hand-edited config; a CLAUDE.md that tells the maintainer to run a command that does not exist yet without saying so.

## Origin
- Created during build of #2253 (Init bootstrap, detection, and the two policy keys)
- Steps 1-5 built in this session
- Related specs: #2250 (parent design), #2251 (merge-time conventional subject), #2252 (reconcile under squash); units 4, 6, 8 of #2250 consume what this journey leaves behind
