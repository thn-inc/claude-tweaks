---
files:
  - tools/upstream-drift/manifest.yml
  - tools/upstream-drift/checks.js
  - .claude/skills/upstream-repin/SKILL.md
  - .claude/skills/upstream-drift/SKILL.md
---

# Re-pin an Upstream Plugin Dependency and Prove the Pinned Lines Still Hold

**Persona:** A claude-tweaks maintainer who just saw a newer superpowers release land in `~/.claude/plugins/cache/` and is about to write skill prose that leans on a line only that release contains — but the drift manifest still pins an older version, so any assertion they add would be checked against the wrong copy.
**Goal:** Move the dependency's pin to the installed release, keep every existing assertion honest against it, add assertions for the new lines the repo will rely on, and know — with evidence — that the drift check would go red if upstream dropped any of them.
**Entry point:** A checkout with `tools/upstream-drift/manifest.yml` and the newer release present in the plugin cache (`~/.claude/plugins/cache/*/superpowers/{version}/.claude-plugin/plugin.json`).
**Success state:** The entry's `pinned` names the installed release; a drift run reports the version check `ok` and the assertions check `ok` with every assertion `ok` and none `skipped`; a deliberately broken `must-match` turns exactly that assertion `unmatched`; and the maintainer has read what changed between the old and new release in the files the repo depends on, not just whether the literals still match.

## Steps

### 1. See what the manifest is actually checking
- **URL:** `/upstream-drift --dep superpowers --drift-only` (or a scratch script calling `checkVersion` / `checkAssertions` from `tools/upstream-drift/checks.js`)
- **Action:** Run it before touching anything and note the pinned version, the installed versions, and the assertion count.
- **Should feel:** Like a baseline reading, not a verdict — "version ok" only means the pinned version is *among* the installed caches.
- **Should understand:** Assertions are checked only against the cache copy whose version equals `pinned` (`resolveRoots`), byte-for-byte with `content.includes`. A line that exists only in the newer release can never match while the old pin stands — re-pin first, then add assertions.
- **Red flags:** Reading "no breach" as "the newer release is verified"; an assertions result of `skipped`, which means no root resolved and nothing was checked.

### 2. Move the pin, reading the version from the artifact
- **URL:** `.claude/skills/upstream-repin/SKILL.md` → edit the entry's `pinned:` in `tools/upstream-drift/manifest.yml`
- **Action:** Set `pinned` to the version the installed `plugin.json` reports, with a comment naming the old and new versions.
- **Should feel:** Mechanical and sourced — the value is copied from the installed artifact, never from release notes or a marketplace page.
- **Should understand:** A pin is a verification baseline, not a minimum-version requirement; a project still on an older project-scope install is a separate concern (a version notice), not something the pin enforces.
- **Red flags:** A version string typed from memory; a second site that holds the same pin left on the old value.

### 3. Re-verify every existing assertion and retarget what upstream retired
- **URL:** a byte-count of each `must-match` against the new cache copy of its `upstream-path`
- **Action:** Count every literal; for each that now reads 0, find the surviving upstream line that still states the claim and point the assertion at it, with a comment giving the reason.
- **Should feel:** Strict — a retarget keeps the same local `file:` and the same claim; it never loosens a `must-match` until it matches anything.
- **Should understand:** One rewrite upstream can silently orphan a claim the repo still makes (here, 7.0.0's brainstorming rewrite dropped `Invoke the writing-plans skill`; the surviving line is `invoke superpowers:writing-plans and no other skill`). If no surviving line states the claim, drop the assertion together with the local claim it backed.
- **Red flags:** A `must-match` shortened to a generic fragment so it "passes"; a retarget that changes which local file the assertion backs.

### 4. Pin the new lines the repo is about to rely on
- **URL:** append assertions to the entry, each with `file:`, `claims:`, `upstream-path:`, `must-match:`
- **Action:** Add one assertion per upstream line a dependent record will lean on, using a single-line fragment checked with `grep -cF` first, and a `claims:` that names the dependent record and the release the line first appeared in.
- **Should feel:** Forward-looking but traceable — a future red drift report points straight at the record that introduced the reliance.
- **Should understand:** A literal that wraps across two lines upstream never matches; first-appearance versions are measured against the local caches, and "6.2.0 or earlier" is the honest answer when the oldest cache already has the line.
- **Red flags:** A two-line quote as `must-match`; a `claims:` with no record number.

### 5. Prove the check can fail
- **URL:** temporarily change one new `must-match` to a string absent upstream, re-run `checkAssertions`, then restore and confirm `git diff --exit-code tools/upstream-drift/manifest.yml` exits 0
- **Action:** Watch exactly that assertion go `unmatched` and the overall status go `drift`, then restore.
- **Should feel:** Conclusive — the green result in Step 6 means something because you saw it go red.
- **Should understand:** The altered manifest is never committed; the run's evidence file records both the red run and the restored green one.
- **Red flags:** More than one assertion turning red; a commit that carries the altered literal.

### 6. Read what changed, not just whether it still matches
- **URL:** `diff -u` of each `contract-paths` file between the old and new cache copies
- **Action:** Read the hunks that touch what the repo's own files rely on (for superpowers: SDD's workspace, `progress.md`, the per-task review loop, `## Final Review`, Finish) and list each behavior change with the repo file it affects.
- **Should feel:** Like reading a changelog aimed at you — a literal can match while the behavior around it moved.
- **Should understand:** In 6.2.0 → 7.0.0 every pinned literal still matched, yet SDD stopped asking the human on a load-bearing finding and started writing `Ruling:` lines, which `plugin/skills/build/dispatch.md`'s carry-forward did not copy at the time. That gap became its own follow-up record (#3386, which now carries `Ruling:` lines into the run ledger) — the diff read is where such changes surface.
- **Red flags:** Concluding "nothing breaks" because every assertion is `ok`; fixing a behavior gap inside the re-pin instead of filing it.

## Origin
- Created during build of #3376 (re-pin superpowers to 7.0.0 and pin the upstream text the dispatch cost-shape records lean on), part of the "Build dispatch cost shape" decomposition (parent #3374).
- Related: `.claude/skills/upstream-repin/SKILL.md` (the re-pin procedure) and `.claude/skills/upstream-drift/SKILL.md` (the read-only drift audit).
