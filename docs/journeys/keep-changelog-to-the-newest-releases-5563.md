---
files:
  - plugin/bin/lib/changelog.js
  - plugin/bin/lib/changelog-release-trim.js
  - plugin/bin/lib/release-notes-publish.js
  - plugin/bin/release-local.js
  - plugin/bin/lib/residue/probes/release.js
  - plugin/bin/lib/policy.js
  - plugin/skills/_shared/policy-schema.md
  - plugin/skills/init/bootstrap/version-check.md
---

# Keep CHANGELOG.md to the Newest Releases

**Persona:** A maintainer of a project that releases several times a week. Their `CHANGELOG.md` has grown past half a megabyte, repository-wide searches keep hitting it, and every session already runs a plugin release that knows the trim footer.
**Goal:** Cap the file at a fixed number of releases without losing any older notes and without a later `/claude-tweaks:tidy` putting the trimmed headings back.
**Entry point:** `.claude-tweaks/policy.yml`, where they add `changelog-max-releases: 50`.
**Success state:** After the next release the file holds the header, the newest 50 sections and one `## Older releases` footer that says where every older note is. The release itself reported released, and tidy reports no missing CHANGELOG entries.

## Steps

### 1. Opt in with the key
- **URL:** `.claude-tweaks/policy.yml` — `changelog-max-releases: 50`
- **Action:** Set the key, after checking that no session or workflow still runs an older plugin release.
- **Should feel:** Like a deliberate switch with one stated precondition, not a migration.
- **Should understand:** `0` or an absent key never trims. A value that is not a whole number of 0 or more (`-1`, `1.5`, `abc`) reads as `0`. The `policy-schema.md` row says the trim runs under local-merge in `bin/release-local.js`, and under pr-first only where a `release: published` workflow runs `bin/release-notes-publish.js`. An older build reading a trimmed file reports the removed versions as missing, and its tidy would add their headings back.
- **Red flags:** A trim on a project that never set the key. A malformed value that trims anyway.

### 2. Cut a release and read the trimmed file
- **URL:** `/claude-tweaks:release` (pr-first: the post-publish workflow runs `bin/release-notes-publish.js`; local-merge: `bin/release-local.js`)
- **Action:** Release as usual, then open `CHANGELOG.md` on the default branch.
- **Should feel:** Uneventful. The release reads exactly as before, with one more commit after it.
- **Should understand:** pr-first trims in the Highlights commit, or in `chore: trim CHANGELOG.md to the newest 50 releases` when there are no Highlights. local-merge trims only after the release commit, tag, push and hook have all landed, in its own commit, so the tag keeps the full file. The footer's `Full file up to v{version}: commit {sha}` line is written once and never changes; `Newest release removed:` moves with each trim; a release trimmed later is in the file at its own tag (`git show v<version>:CHANGELOG.md`). Kept sections are byte-identical to before.
- **Red flags:** A failed release because the trim failed. A second footer. A footer sha that changes on a later trim. A tag pointing at the trimmed commit.

### 3. See a trim that could not run
- **URL:** the release output
- **Action:** Read stderr on a release where the trim could not complete (under pr-first an unreadable `policy.yml`; a commit that is not on the default branch; a rejected trim push).
- **Should feel:** Visible but harmless: one line, and the release still reports released.
- **Should understand:** `changelog trim: failed ({reason}); file left untrimmed` or `changelog trim: policy unreadable ({reason}); not trimmed`, one line each. A failed trim push drops its own commit and restores the file and the index; if that restore fails too, the same line says the index may still hold the trimmed file. The policy-unreadable line prints only under pr-first: under local-merge an unreadable `policy.yml` stops `bin/release-local.js` before it changes anything, as it did before the key existed, so there is no release to report.
- **Red flags:** A multi-line error dump. A non-zero exit from a release that landed. A trim commit left behind after its push failed. A local-merge release that went ahead on an unreadable `policy.yml`.

### 4. Run tidy on the trimmed file
- **URL:** `/claude-tweaks:tidy`
- **Action:** Read the release-triple findings after the first trim.
- **Should feel:** Quiet about the removed releases.
- **Should understand:** The release probe treats every tag older than the oldest kept section of a footer-bearing file as not missing. A footer removed by hand removes that floor, and the old findings come back. A heading Backfill adds goes above the footer, in version order.
- **Red flags:** A `CHANGELOG entry for v{X}` finding for a version below the oldest kept section. A Backfill heading written after the footer.

### 5. Update the plugin across the trimmed range
- **URL:** `/claude-tweaks:init` (its version check reads the changelog between the recorded and installed versions)
- **Action:** Update from a version the trim already removed.
- **Should feel:** Honest about what it can summarize.
- **Should understand:** `extractChangelogRange` returns the sections it still has and `partial: true` when the range starts below the footer's `Newest release removed:` version, and the notice says the summary is partial and points at the footer's `git show {sha}:CHANGELOG.md`. A range starting at that version, or above it, is not partial.
- **Red flags:** A summary that silently omits the removed releases. A partial notice on a file that has no footer.

## Origin

Created by `/claude-tweaks:build` for record #5563 (2026-11-16): the `changelog-max-releases` key, the trim and its footer, both release engines, the release probe's floor and the version check's partial notice. Step 3 updated at the wrap-up of #5563 (review fix wave): the unreadable-policy case is pr-first only, since under local-merge that read failure stops `bin/release-local.js` before the release starts.
