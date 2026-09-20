# Step 6.6 — Verify-Scope Starter (detailed procedure)

*Core Bootstrap step — runs unconditionally, once per project, right after Step 6.5. Generates the starter `.claude-tweaks/verify-scope.json` that `verify.js --scope` reads (#1922) so the pipeline's re-verify sites (`test/verification.md`'s scoping table, #1923) can shed suites the delta cannot affect. Without a declaration every site resolves `full` — today's behavior.*

## 1. Detect and propose

One plain command (the CLI shells out to nothing and reads only `pnpm-workspace.yaml`, `package.json` files, and lockfiles):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root .
```

It prints the proposed declaration: one suite per workspace package with a `test` script (`pnpm --filter {name} test` / `npm test -w {path}` / `yarn workspace {name} test`, told apart by `pnpm-workspace.yaml` and the lockfile), `packages/shared`-style packages that another package depends on mapped to every suite (`"*"`), each tested package's own tree mapped to its suite, and the pipeline's four bookkeeping globs (`docs/plans/*-ledger.md`, `.claude-tweaks/pipelines/**`, `docs/superpowers/plans/**`, `docs/superpowers/specs/**`) mapped to no suite. A single-package repo gets `checks.tests` from the root `test` script and the bookkeeping rules only. The starter never maps a source path to `[]`; everything it does not name stays unmatched, which the engine fails closed to `full`. Every input the CLI could not use is named on stderr (`warning: skipped {glob|path} — {reason}`: an unexpandable glob, a directory without `package.json`, an unparseable `package.json` (the root's included), a package with no `name`, a name or path that is not shell-safe (never interpolated into a suite command), a symlinked entry (never followed), or an unsupported `!` exclusion pattern) — an unparsed workspace never reads as an empty one; surface those lines with the proposal.

**Already declared** (`.claude-tweaks/verify-scope.json` exists): report `exists — left unchanged` and stop; the file is project-owned and reviewed like code. `--write` is create-if-absent only. Drift between the file and the workspace is `init --update`'s job (`update-mode.md`'s Verify-Scope Drift).

**Nothing to scope** (the proposal declares no suites — no workspace package with a `test` script and no root `test` script): report the bookkeeping-only proposal and skip the write offer — a declaration with no suites is valid but buys nothing until a `test` script exists. A workspace whose tests run from the root (`turbo test`, `vitest --workspace`) keeps that root script as its single `tests` suite and IS offered.

## 2. Offer the write

Render the proposed declaration as a table — `| Rule | Match | Suites | Static |` — plus the `checks` block, then:

- **Interactive:** one `AskUserQuestion` — `question`: `"Write this starter verify-scope.json? You can edit it afterwards; init --update reports drift."`, `header`: `"Verify scope"`, options `Write starter (Recommended)` / `Skip`. On Write: `node "${CLAUDE_PLUGIN_ROOT}/bin/init-verify-scope.js" --root . --write`.
- **`auto` mode:** write it (a reversible, project-owned file) and log `AUTO {time} — Step 6.6: wrote starter .claude-tweaks/verify-scope.json ({n} suites, {m} rules). Reversibility: high.`

If the project's `.gitignore` ignores `.claude-tweaks/` wholesale, a bare negation cannot re-include the file (git excludes the whole directory first) — Step 4's table suggests `.claude-tweaks/*` + `!.claude-tweaks/verify-scope.json` instead; the declaration must be tracked.

## 3. What this step never does

Rewrites test scripts or workspace config; maps a source path to `[]`; overwrites an existing declaration; adds a `policy.yml` key (the declaration is a sibling file — `_shared/policy-schema.md`).
