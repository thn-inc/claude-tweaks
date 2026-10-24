---
files:
  - plugin/bin/init-verify-scope.js
  - plugin/bin/lib/init/verify-scope-starter.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/skills/init/bootstrap/step-06-6-verify-scope.md
  - plugin/skills/init/update-mode.md
  - .claude-tweaks/verify-scope.json
  - tests/verify-scope-declaration.test.js
---

# Declare What Each Path Affects With a Verify-Scope Starter

**Persona:** A maintainer bootstrapping a project with `/claude-tweaks:init` (or re-running `init --update` months later) who wants the pipeline's re-verifies to stop running every suite for a ledger commit, without hand-writing the declaration `verify.js --scope` reads.
**Goal:** Get a reviewed `.claude-tweaks/verify-scope.json` into the tree that maps each workspace package to its own suite, shared packages to every suite, and the pipeline's bookkeeping paths to nothing — then see drift reported when the workspace changes.
**Entry point:** A project checkout root with `pnpm-workspace.yaml` or `package.json` `workspaces` (or a single package with a `test` script); the plugin's `bin/init-verify-scope.js` reachable.
**Success state:** A tracked declaration that `readDeclaration` accepts, a proposal table the maintainer read before writing, no source path mapped to `[]`, and `init --update` printing "verify-scope: … none … none" until a package is added or removed.

## Steps

### 1. Ask for the proposal, not the file
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root .`
- **Action:** Run it in a workspace repo and read the pretty-printed proposal plus the status line.
- **Should feel:** Report-only by default — nothing on disk changed; the last line says `not written (pass --write)`.
- **Should understand:** One suite per package with a `test` script, named by the package's own `name` (`pnpm --filter {name} test`, `npm test -w {path}`, or `yarn workspace {name} test` — the tool is read from `pnpm-workspace.yaml` or the lockfile); a package another package lists under `dependencies` maps its tree to `"*"` (every suite) even when it has its own tests; a tested package's tree maps to its suite; the four bookkeeping globs (`docs/plans/*-ledger.md`, `.claude-tweaks/pipelines/**`, `docs/superpowers/plans/**`, `docs/superpowers/specs/**`) map to nothing. A repo with no per-package tests but a root `test` script gets that script as its single `tests` suite. Anything the CLI could not use is named on stderr as `warning: skipped {glob|path} — {reason}` — an unparsed workspace never reads as an empty one.
- **Red flags:** A source path proposed with `suites: []`; a package with a `test` script missing from `checks.tests` with no `warning: skipped` line explaining why; a `pnpm --filter` suite named by path instead of package name; a `./**` rule for the root.

### 2. Write it once, never over
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root . --write` (what `/claude-tweaks:init` Step 6.6 runs after its one write/skip question — unattended in `auto` mode, logged)
- **Action:** Run it twice.
- **Should feel:** The first run reports `written: .claude-tweaks/verify-scope.json`; the second reports `exists: … (left unchanged)` and exits 0 — the file is project-owned and reviewed like code.
- **Should understand:** `--write` is create-if-absent (an `O_EXCL` write): an existing declaration is never clobbered, even by a later `init`. If the project ignores `.claude-tweaks/` wholesale, a bare negation does nothing — Step 4's suggestion is `.claude-tweaks/*` plus `!.claude-tweaks/verify-scope.json`, because git cannot re-include a path under an excluded directory.
- **Red flags:** A second `--write` changing the file's mtime; the declaration absent from `git status` after the write; `--write` combined with `--drift` accepted instead of rejected as a usage error.

### 3. Watch drift instead of re-generating
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root . --drift --json` (what `init --update`'s Verify-Scope Drift row runs)
- **Action:** Add a workspace package with a `test` script, or rename one, then run the drift verb.
- **Should feel:** Report-only — one JSON line `{declared, missingSuites, extraSuites, skipped}`; `init --update` renders it as "verify-scope: suites `{extra}` not in workspace; packages `{missing}` have no suite" and never rewrites the file.
- **Should understand:** The verb reads the FILE through `readDeclaration` and detects the workspace itself; the proposal from Step 1 is never the input. A single-package declaration (`checks.tests: "npm test"`) declares the suite `tests`, which matches no package — the verb treats it as the sentinel it is and reports no drift for it. `declared: false` means no file exists (exit 0); a malformed file prints its validation errors and exits 1.
- **Red flags:** Every package reported missing on a correct declaration (the proposal was fed to the diff instead of the file); the `tests` sentinel reported as an extra suite forever; drift "fixed" by overwriting the file.

### 4. Read this repo's own declaration as the worked example
- **URL:** `cat .claude-tweaks/verify-scope.json` in the claude-tweaks checkout, then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --scope .claude-tweaks/verify-scope.json --integration-branch main --cmd tests="npm test" --cmd journeys="{the declaration's checks.tests.journeys command}"`
- **Action:** Compare the rules with what `npm test` reads, then commit a change to one `docs/journeys/*.md` file and re-run.
- **Should feel:** Conservative — `tools/run-tests.js` and `tools/test-impact/**` map to every suite; the rest of `plugin/**`, `tests/**` and `tools/**`, plus `docs/**` and root `*.md`, are impact rules that run only the test files a test-impact map says read the changed path (`docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md`) and run the whole suite when the map cannot be trusted; `docs/journeys/**` maps to the `journeys` suite alone (the seven test files that read the live journey tree, about a second); only ledger rows, run-dir files, consumed plans and design docs map to nothing; everything else (`package.json`, `.github/**`) is unmatched and fails closed to `full`. The journey-only re-run prints `Scope: scoped — … suites: journeys; static: no; unmatched: 0`.
- **Should understand:** `checks.tests` is a suite map (`tests` → `npm test`, `journeys` → the journey readers), so every `--scope` invocation passes one `--cmd` per declared suite — a run missing `--cmd journeys` exits 2 naming it. A full run executes both suites (the journey files twice — seconds). The declaration only cheapens a delta since the last full pass, and only once a full pass has written a stamp — a baseline-adjudicated pass (#3043) writes one too, but a run with an attributable failure never does, and with no stamp every `--scope` run resolves `full`. `tests/verify-scope-declaration.test.js` pins that no `[]` rule names anything outside the bookkeeping list, that a ledger-row delta classifies as `none`, a skill-prose delta as impact-selected, and a journey-only delta as `scoped` to `journeys`.
- **Red flags:** A `[]` rule on a path any suite reads; a `--scope` run reporting `none` for a delta that touched `plugin/**`; a journey-only delta reported `unmatched` or `full`; a new test that reads `docs/journeys/` left out of the `journeys` command (the pipeline then under-verifies it until CI's full run catches it); expecting the saving before a stamp exists; an impact rule committed without `"suites": "*"` (a plugin build older than the release that shipped `impact` rejects the whole file, and `tests/verify-scope-declaration.test.js` pins the fallback).

## Origin
- Created during build of #1924 (init generates a starter `verify-scope.json`, reports drift, and this repo declares its own) — the operator-facing half of the scoping engine (#1922) and its pipeline wiring (#1923).
- Updated during build of #3337 — Step 4: this repo's declaration gains a `journeys` suite and a `docs/journeys/**` rule, so a journey-only delta re-verifies in about a second instead of failing closed to the full suite.
- Step 4 revisited after #4024: `plugin/**`, `tests/**` and `tools/**` (and `docs/**`, root `*.md`) became impact rules selected by a test-impact map instead of mapping to every suite, each also carrying `"suites": "*"` so a plugin build older than the release shipping `impact` can still read the file.
- Related journeys: `run-a-deterministic-verification-check.md` Steps 8-9 (what the declaration does at a scoped re-verify; the shared changed-file set).
