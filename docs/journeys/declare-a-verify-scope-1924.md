---
files:
  - plugin/bin/init-verify-scope.js
  - plugin/bin/lib/init/verify-scope-starter.js
  - plugin/bin/lib/verify/declaration.js
  - plugin/skills/init/bootstrap/step-06-6-verify-scope.md
  - plugin/skills/init/update-mode.md
  - .claude-tweaks/verify-scope.json
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
- **URL:** `cat .claude-tweaks/verify-scope.json` in the claude-tweaks checkout, then `node "${CLAUDE_PLUGIN_ROOT}/bin/verify.js" --scope .claude-tweaks/verify-scope.json --integration-branch main --cmd tests="npm test"`
- **Action:** Compare the rules with what `npm test` reads.
- **Should feel:** Conservative — `plugin/**`, `tests/**`, `tools/**` map to every suite; only ledger rows, run-dir files, consumed plans and design docs map to nothing; everything else (top-level `docs/*.md`, `CLAUDE.md`, `package.json`) is unmatched and fails closed to `full`.
- **Should understand:** The declaration only cheapens a bookkeeping-only delta since the last full pass, and only once a full pass has written a stamp — on a checkout whose suite is red at the baseline, no stamp is ever written and every `--scope` run resolves `full`. `tests/verify-scope-declaration.test.js` pins that no `[]` rule names anything outside the bookkeeping list and that a ledger-row delta classifies as `none` while a skill-prose delta classifies as `full`.
- **Red flags:** A `[]` rule on a path any suite reads; a `--scope` run reporting `none` for a delta that touched `plugin/**`; expecting the saving before the baseline is green.

## Origin
- Created during build of #1924 (init generates a starter `verify-scope.json`, reports drift, and this repo declares its own) — the operator-facing half of the scoping engine (#1922) and its pipeline wiring (#1923).
- Related journeys: `run-a-deterministic-verification-check.md` Steps 8-9 (what the declaration does at a scoped re-verify; the shared changed-file set).
