---
files:
  - plugin/bin/lib/run-manifest/write.js
  - plugin/bin/lib/run-manifest/facts.js
  - plugin/bin/lib/hooks/run-dir-resolve.js
  - plugin/bin/lib/flow/manifesto-write.js
  - plugin/bin/lib/set-config/write.js
  - plugin/bin/set-config.js
  - plugin/bin/lib/express/cli.js
  - plugin/bin/lib/driver/adopt.js
  - docs/reference/run-manifest.md
  - tests/bin-lib/run-manifest/write.test.js
  - tests/bin-lib/run-manifest/facts.test.js
  - tests/hooks-resolve-run-dir-cli.test.js
---

# Read What a Run Started Under From Its Manifest

**Persona:** the claude-tweaks maintainer looking at two pipeline runs that behaved differently and asking what each one started under: which plugin build, which route, which ceremony, which policy. A second persona is the dispatch tooling that reads the same file for each station visit and compares lanes by plugin version.
**Goal:** answer "what was this run started under?" from one small file in the run directory, without reconstructing it from `config.yml`, `decisions.md` and the plugin cache, and know which of its values are real and which are "not known yet".
**Entry point:** a run directory under `.claude-tweaks/pipelines/` (live, or moved to `archive/` by the reconciler), or a dispatch station visit that carries the manifest's fields.
**Success state:** the nine fields of `{run-dir}/manifest.json` have been read and each one understood as a fact, a not-yet-known value, or an absence that is not an error. The two runs' `pluginVersion`, `lane`, `ceremonyProfile` and `policyHash` are laid side by side, and the maintainer can say whether they ran the same build under the same policy.

## Steps

### 1. Find the manifest, live or archived
- **URL:** `{pipelines}/{run-id}/manifest.json`, or `{pipelines}/archive/{run-id}/manifest.json` once the run was archived.
- **Action:** Open the file from the run directory, or from `archive/` when the live path is gone. Archival moves the whole directory, so the manifest travels with it.
- **Should feel:** Like opening a label on the run, not an investigation. It is one small JSON object with keys in alphabetical order, so two runs' files diff line by line.
- **Should understand:** Only claude-tweaks code writes this file; no skill tells a model to. It is written when the run directory is minted, by `hooks.js resolve-run-dir --create`, and re-resolving an existing run leaves it byte-identical. `resolve-run-dir` still prints only the directory path and keeps its exit codes. This is not the multi-spec `manifest.yml` (the parent run's spec list), and not the acceptance packet's `packet-inputs/manifest.json`.
- **Red flags:** The reader assuming the live path and giving up when the run was archived. A run directory minted by a build that predates this file being read as broken instead of as "no manifest yet". Confusing it with `manifest.yml`.

### 2. Read the nine fields
- **URL:** the same file: `v`, `runId`, `createdAt`, `pluginVersion`, `lane`, `ceremonyProfile`, `policyHash`, `baseCommit`, `modelProfile`.
- **Action:** Read each field against `docs/reference/run-manifest.md`'s field table. `pluginVersion` is the running build's version, never the repository's own `plugin.json`. `baseCommit` is the integration branch's tip at mint, not the worktree's first commit. `modelProfile` is `{stance, ceiling}`.
- **Should feel:** Every field answers one question, and none of them holds a secret: a version, an enum name, a sha or a hash.
- **Should understand:** `null` and `lane: unknown` mean "not known yet or never known", never an error. A bare mint writes `ceremonyProfile: null` and, unless the run is a `drive-{n}` driver run, `lane: unknown`. Any gathered fact (`pluginVersion`, `policyHash`, `baseCommit`, `modelProfile`) can also be `null`: no `CLAUDE_PLUGIN_ROOT`, an unreadable `policy.yml`, no `origin` remote ref, or no git. An interactive run, or a standalone tidy, keeps `ceremonyProfile: null` for good. A manifest written by a fill (a run minted before the file existed) carries only the filled fields; the others are `null`, and `lane` is `unknown` unless filled.
- **Red flags:** A `null` rendered as a failure or an empty string. A `policyHash` that is not `sha256:` plus 64 hex digits, or a `baseCommit` that is not 40 lowercase hex. A secret, a path or a policy value inside the file.

### 3. Learn which route the run took, and when it was recorded
- **URL:** `lane` and `ceremonyProfile` in the manifest, read at different points in the run's life.
- **Action:** Read `lane` and `ceremonyProfile` and match them to the step that fills each. The Manifesto, or a `set-config.js --set` batch holding every one of the 13 Manifesto levers, sets `lane: standard`. The express gate sets `lane: express` when every record's verdict is `eligible: true`. The driver's adoption of a dispatch-minted run sets `lane: driver`. `ceremonyProfile` follows the `ceremony-profile` key through `set-config`, whoever writes it.
- **Should feel:** The lane is a claim the run made once and kept, not a guess the tooling revises. What you read is what the run did first.
- **Should understand:** `lane` is the first route attempted. `unknown` counts as unset, a fill never writes `unknown`, the first known lane wins, and a known lane is never overwritten. An express run that escalates to the normal path stays `express`. A record the driver adopted and then refused keeps `driver`. `ceremonyProfile` is the one field a fill overwrites: a ceremony-escape-hatch downgrade from `fast-lane` to `standard` changes it and no other field. A partial `--set` batch (the downgrade, the express lane's `configSet`) never sets the lane.
- **Red flags:** `lane` flipping between two known values over a run's life. An ineligible express verdict leaving `lane: express`. A `lane` of `unknown` on a run the Manifesto or the express gate demonstrably ran for.

### 4. Compare two runs by plugin version and policy
- **URL:** `pluginVersion` and `policyHash` in each run's manifest.
- **Action:** Put the two files side by side. Equal `pluginVersion` and equal `policyHash` mean the same build ran under the same resolved policy. Two different hashes mean at least one hashed policy value differed.
- **Should feel:** A quick yes or no, not a policy diff. The hash says that two policies differ, never which values, and that is the point: the values are not copied anywhere.
- **Should understand:** `policyHash` is the sha256 of the canonical JSON of every resolved policy key except `integration-model` and `merge-verification`, which run forge detection and can call `gh`. Changing only `integration-model` therefore does not change the hash. It is taken at mint, so a mid-run edit of `.claude-tweaks/policy.yml` is not reflected. No per-run `config.yml` overlay is applied. A value the factory layer supplies (`CLAUDE_TWEAKS_FACTORY_POLICY` or `~/.claude-tweaks/factory-policy.yml`, #6006) is hashed like a `policy.yml` value, so two runs of one `policy.yml` hash differently when their machines' factory layers differ. An absent `policy.yml` is a valid policy and hashes the defaults; only an unreadable one gives `null`. `baseCommit` can differ between two runs of one policy because it is the integration tip at mint: the worktree itself starts from local `HEAD` plus a catch-up merge of that ref, so the two agree except when local `HEAD` carries unpushed commits or `origin` moved after the mint.
- **Red flags:** Equal resolved policies hashing differently (equal `policy.yml` files under different factory layers are not equal policies). A changed hashed value leaving the hash unchanged. `pluginVersion` taken from the repository checkout instead of the running build.

### 5. (Dispatch tooling) Read it without failing on what it does not know
- **URL:** the manifest of the run behind a station visit, from the live path or `archive/`.
- **Action:** **Dispatch tooling** copies the object into the visit and adds `machineId`, `account` and `model` itself, then ignores any key it does not recognize and treats `null`/`unknown` as unknown.
- **Should feel:** Boring and stable. A new field in a later plugin version never breaks an older reader.
- **Should understand:** Compatibility is additive. A field is added, never renamed or retyped; removing or retyping one needs a `v` bump and a note on the reference page. `tests/bin-lib/run-manifest/write.test.js` pins a `v: 2` object carrying an unknown key through a fill. A visit with no readable manifest says the rest is unknown instead of guessing.
- **Red flags:** A reader that throws on an unknown key. A reader that assumes the live path. A reader that treats `lane: unknown` as a lane to be counted.

### 6. Make sense of a missing or empty manifest
- **URL:** a run directory with no `manifest.json`, or one whose only contents are `manifest.json`.
- **Action:** Check whether the directory is one of the cases that carries none before treating it as a fault: the hook-stamped `{ts}-adhoc-standalone` directories, a multi-spec `spec-N/` child (the one manifest lives at the parent run directory), or a run minted by a plugin build older than this file.
- **Should feel:** An absence with a stated reason, not a silent gap.
- **Should understand:** A hook event must not read `process.env` or spawn policy and git work, so the mint skips the ad-hoc directories. A fill into a missing run directory writes nothing, and a fill that changes nothing creates no file. A directory holding only `manifest.json` is not an initialized run: `resolveRunArg` and the orphaned-mint sweep do not read it. A failed write never fails a caller; it drops with one stderr line, `claude-tweaks: run-manifest: …`, and that line is the only trace.
- **Red flags:** A `manifest.json` created inside a `spec-N/` child. A `--create` that adopts an existing run rewriting its manifest. A `claude-tweaks: run-manifest:` line accompanied by a changed exit code, or an adopted or orphaned-looking directory that changes classification because a manifest sits in it.

## Origin

Built by #5903 (run `2026-11-19T073130-spec-5903`): the run-manifest half of the dispatch factory-floor design (parent #1903), whose station events (#5902) carry the manifest's fields. Format reference: `docs/reference/run-manifest.md`.
