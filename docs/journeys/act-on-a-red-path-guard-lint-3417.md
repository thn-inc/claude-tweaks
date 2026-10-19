---
files:
  - tests/path-guard-conformance.test.js
  - tests/helpers/strip-comments.js
  - plugin/bin/lib/path-guard/index.js
  - docs/donts.md
---

# Act on a Red Path-Guard Lint

**Persona:** A claude-tweaks plugin maintainer. They add or edit a file under `plugin/bin/` that calls `fs.existsSync` or `fs.realpathSync`, or passes either function around as a reference, and `npm test` goes red on `tests/path-guard-conformance.test.js`.
**Goal:** See which file's count changed, decide whether the new check needs a type or containment answer or only an existence answer, and make the lint pass without hiding the check.
**Entry point:** `npm test` (or `node --test tests/path-guard-conformance.test.js`) reports `not ok … AC3.1: passes on the current tree`. One offender line is listed per mismatch.
**Success state:** Either the new check routes through `plugin/bin/lib/path-guard` (`lstatType` / `resolveLeaf` / `canonicalRealpath` / `resolveWithin`) and the file's token count is back to its allowlisted value, or the file's `ALLOWLIST` entry is updated with a reason specific to that file. The lint passes.

## Steps

### 1. Read the offender lines
- **URL:** the failing assertion's diff output in the test run.
- **Action:** Read each offender. The forms are:
  - `{file}: {realpathSync|existsSync} x{actual} (allowlisted: {n})`: the count drifted either way.
  - `{file}: allowlist entry has no reason`: an entry was added without a reason.
  - `{file}: allowlist entry has no matching file under plugin/bin/`: the file is gone.
  - `{file}: the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned — see tests/helpers/strip-comments.js`: the scan could not see part of the file, so its counts are untrustworthy.
  - `{file}: this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it — see tests/helpers/strip-comments.js`: the file itself is not valid CommonJS.
- **Should feel:** Pinpointed. Every line names a file relative to `plugin/bin/` and either the exact count or the reason the scan could not count, so there is nothing to search for.
- **Should understand:**
  - The lint counts tokens, not calls. A reference (`{ realpath: fs.realpathSync }`), a default (`{ realpath = fs.realpathSync }`), a destructured alias (`const { existsSync: ex } = fs`) and a bracket form (`fs['realpathSync']`) all count. A mention inside a comment does not.
  - A count that went *down* (a call migrated to path-guard) is also red, because the allowlist is an exact audit record, not a ceiling.
- **Red flags:**
  - A `mis-parsed this file` line. The shared stripper (`tests/helpers/strip-comments.js`) does not model regex literals. An escaped slash is safe (`/^https?:\/\//`), but a quote or backtick inside a regex, or an unescaped `/*` or `//` in a character class (`/[/*]/`), can blank code after it. Find that regex in the named file and rewrite it rather than adjusting the allowlist: escape a `/` in a character class as `\/`, or build a regex that holds a quote or backtick with `new RegExp(...)` from a string literal: a count read through a mis-parse is wrong in an unknown direction.
  - An offender naming a file the maintainer did not touch, with no mis-parse line. A mis-parse whose stripped text still compiles is not detected, so check the file for one of those regex shapes before suspecting a real change.
  - A green run after rewriting the call as `fs['realpath' + 'Sync']`. Computed member access is not seen, so that hides the check rather than removing it.

### 2. Decide what the check is asking
- **URL:** `docs/donts.md` (the `[IL-150]` and `[IL-161]` rules) and `plugin/bin/lib/path-guard/index.js`'s header.
- **Action:** Ask whether the code goes on to read, write or trust the path as a particular kind of thing (a file, a directory, something inside a root), or only needs to know that something exists.
- **Should feel:** Like a settled rule. A type question goes through `lstatType`, and a containment question goes through `resolveWithin` (on an existing target, or a write's existing parent).
- **Should understand:**
  - `lstatType` returns `missing` only for ENOENT/ENOTDIR. Any other lstat error is `unreadable`, carrying its code, and a fail-closed caller must not treat it as absent.
  - `canonicalRealpath` and `resolveLeaf` default to `fs.realpathSync.native`. Passing the JS `fs.realpathSync` is right only when the other side of a comparison is JS-resolved too, as `realTarget()` does for `isPolicyFile`.
- **Red flags:**
  - Comparing a JS `fs.realpathSync` result with a `.native`, git-reported or un-resolved path. That mismatch is what #3380 hit on a case-insensitive volume.
  - Treating `existsSync(p)` as proof that `p` is a directory before writing under it. That is the gap #3493 tracks in `plan-audit`.

### 3. Route it, or record why it is safe
- **URL:** the edited `plugin/bin/` file, and the `ALLOWLIST` in `tests/path-guard-conformance.test.js`.
- **Action:** For a type or containment question, call the matching path-guard primitive, so the file's token count returns to its allowlisted value. For a pure existence question, update that file's `ALLOWLIST` entry: set the count, and write a reason that names what the check guards and why the type does not matter. Then re-run `node --test tests/path-guard-conformance.test.js`.
- **Should feel:** Small and honest. The reason is something a reviewer can check against the line it describes.
- **Should understand:** A reason starting `UNSAFE —` marks a known hazard with a follow-up record, not an endorsement. Never use it to get a new call past the lint.
- **Red flags:**
  - A generic reason ("existence probe") copied from another entry.
  - A count bumped without reading the new site.
  - An `UNSAFE —` reason with no record behind it.

## Origin
- Created during build of #3417. That build added the shared `plugin/bin/lib/path-guard/` module, routed `transcript.js`, `installed-plugins.js` and `pre-tool-use.js`'s `realTarget()` through it, added the token-count conformance lint, and narrowed [IL-150]/[IL-161].
- Updated during build of #3536. The lint's comment stripper moved into the shared `tests/helpers/strip-comments.js`, so escaped-slash regexes no longer blank code. The Step 1 red flag now names the regex shapes that still can.
- Updated during build of #3573. A file whose stripped text stops compiling now fails the lint with its own offender line (via `stripperVerdict`), instead of silently counting as zero tokens. Step 1 lists the two new offender forms and says what to do about a mis-parse.
- Related: `act-on-a-red-skill-size-guard-3311.md` (the same shape for the skill-size guard), and `notice-a-stale-superpowers-install-3380.md` (the case-canonical realpath incident).
