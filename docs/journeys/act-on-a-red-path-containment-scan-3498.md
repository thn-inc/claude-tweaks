---
files:
  - tests/path-containment-conformance.test.js
  - plugin/bin/lib/shared-primitives.js
  - plugin/bin/lib/path-guard/index.js
  - .claude/skills/pre-tool-use-gate-exemptions/SKILL.md
  - tests/bin-lib/path-guard/callers-characterization.test.js
---

# Act on a Red Path-Containment Scan

**Persona:** A claude-tweaks plugin maintainer. They write a check under `plugin/bin/` that asks whether one resolved path lies inside another. They type either `candidate.startsWith(root + path.sep)` or `path.relative(root, candidate).startsWith('..')`, both of which the code used to use, and `npm test` goes red on `tests/path-containment-conformance.test.js`.
**Goal:** Replace the retyped test with the shared helper, choosing strict or `orEqual` deliberately, without weakening a boundary the check guards.
**Entry point:** `npm test` (or `node --test tests/path-containment-conformance.test.js`) reports one of two failures. Each comes with a `{file}:{line}` hit per retyped test.
- `not ok … AC1.1: no plugin/bin JS file hand-rolls a startsWith(... path.sep) containment test`
- `not ok … #3642 AC1.1: no plugin/bin JS file outside lib/path-guard/ tests containment with startsWith('..')`
**Success state:** Each hit calls `isPathContained(candidate, root)` (root excluded) or `isPathContained(candidate, root, { orEqual: true })` (root admitted) from `plugin/bin/lib/shared-primitives.js`. Both arguments are absolute, already-resolved paths. The scan passes.

## Steps

### 1. Read the hit list
- **URL:** the failing assertion's `deepEqual` diff in the test run.
- **Action:** Each entry is `plugin/bin/{file}:{line}`. Open that line.
- **Should feel:** Pinpointed. The line number is exact, and a mention of the idiom inside a comment never appears in the list.
- **Should understand:**
  - The first scan matches `startsWith(` followed by `path.sep` on one line of code.
  - The second (#3642) matches a literal `startsWith('..')` in any quote style. That idiom wrongly treats a child named like `..foo` as outside its root.
  - A `{file}: …` line instead of a hit means the comment stripper could not parse that file (`tests/helpers/strip-comments.js`). That is a parse problem, not a containment hit.
- **Red flags:**
  - A green run after splitting the expression across lines, aliasing `path.sep` to a local, or swapping `startsWith('..')` for `slice(0, 2) === '..'`. That hides the retyped check rather than removing it.

### 2. Choose strict or orEqual
- **URL:** `.claude/skills/pre-tool-use-gate-exemptions/SKILL.md`'s "A containment check" bullet, and the `isPathContained` note in `plugin/bin/lib/shared-primitives.js`'s header.
- **Action:** Ask whether the root itself may count as inside. A boundary such as "inside the harness worktree domain" stays strict (the default). "Is my cwd this directory or below it" takes `{ orEqual: true }`.
- **Should feel:** Like a single deliberate choice per call site, read off the code's intent.
- **Should understand:** `isPathContained` delegates to `plugin/bin/lib/path-guard`'s `isAncestorOrSelf`, which does path arithmetic (`path.relative`) and never touches the filesystem. A `..` segment, a trailing separator on the root and win32 casing and drives are all handled. A relative argument resolves against `process.cwd()` instead of failing closed, and a null argument throws.
- **Red flags:**
  - Passing an unresolved or relative path. Resolve first (`path.resolve`, or `realpathSync` when symlinks matter), and use path-guard's `resolveWithin` when the decision is about a real filesystem target.
  - Switching a strict boundary to `orEqual` to silence a test.
  - Importing the helper into a module that is deliberately Node-builtins-only. `plugin/bin/lib/visual-decide/` is the one such module (#1202 AC 8). It keeps a whole-segment check (`rel.split(path.sep)[0] === '..'`), pinned by an agreement test against `isAncestorOrSelf` in `tests/bin-lib/path-guard/callers-characterization.test.js`.

### 3. Re-run and confirm
- **URL:** the edited file and its own test suite.
- **Action:** Run `node --test tests/path-containment-conformance.test.js` and the edited module's suite.
- **Should feel:** Mechanical. Both are green, and the module's existing tests needed no edits.
- **Should understand:**
  - Swapping a `startsWith(root + path.sep)` check changes nothing on posix for resolved absolute paths. The characterization file `tests/bin-lib/path-guard/is-path-contained-characterization.test.js` records exactly what `isPathContained`'s delegation changed.
  - Swapping a `startsWith('..')` check does change behavior: a `..foo` child becomes contained. Pin that per site in the `#3642` section of `tests/bin-lib/path-guard/callers-characterization.test.js`.
- **Red flags:** An existing test that now needs editing. That means the containment semantics changed for this caller, so record why in a characterization case rather than rewriting the old assertion.

## Origin
- Created during build of #3498. That build made `isPathContained` a thin strict/`orEqual` wrapper over path-guard's `isAncestorOrSelf`, migrated the last four retyped containment tests, added the conformance scan, and pointed `[IL-161]` and the pre-tool-use-gate-exemptions skill at the same helper.
- Updated during build of #3642. That build migrated the five remaining `path.relative`-derived `startsWith('..')` containment checks, widened the scan to flag that idiom outside `lib/path-guard/`, and recorded the `visual-decide` builtins-only exception.
- Related: `act-on-a-red-path-guard-lint-3417.md` (the sibling lint over `realpathSync`/`existsSync` tokens).
