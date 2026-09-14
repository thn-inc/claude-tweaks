# Step 21 — Release Bootstrap (detailed procedure)

*Optional Enhancement step — see `SKILL.md`'s `## Input` for when this group is offered or filtered, and `../bootstrap-steps.md` for its ordering and renumbering conventions.*

Gives `detection-tables.md`'s release-process row (Step 2e) a destination (#2253). On a repo with no release automation, writes the release-please engine's files — the config every later phase of the release family reads, the manifest, and (pr-first only) the workflow — and seeds the two `release-*` policy keys. On a repo that already runs a competing tool, refuses and reports rather than layering a second engine on top (design stance 7: existing release automation is a conflict, not a wrap target).

**Gate — Step 20's output.** This step routes on `integration-model` (`_shared/integration-model.md`): `pr-first` → release-please workflow + config, `local-merge` → config only (the local engine reads the same files). Resolve the value the way every consumer does — `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values integration-model`. When Step 20 did not run or the value resolves empty/ambiguous, **skip this step entirely** and record `release: skipped — integration-model unresolved` in the init summary — never guess an engine.

**Branch.** Resolve the integration branch per `_shared/integration-branch.md`'s canonical ladder (never a local paraphrase of it) and pass the result as `--branch`; it is the branch the workflow triggers on and targets.

**Detect and write — one CLI call.** The whole decision is the code twin `bin/lib/init/release-bootstrap.js`, fronted by:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/release-bootstrap.js" --integration-model {pr-first|local-merge} --branch {branch}
```

It prints one JSON line — `{verdict, tool?, evidence?, reason?, releaseType?, version?, tagsFailure?, written[], policyRows[]}` — and exits 0 on every verdict (2 on usage, 1 on an unexpected error). Read `verdict`:

| Verdict | What the CLI did | Init summary line |
|---|---|---|
| `fresh` | Wrote `release-please-config.json` (`release-type` from the stack table below), `.release-please-manifest.json` (seeded from the newest `v*` tag by semver precedence — a pre-release/build-metadata tag such as `v2.0.0-rc.1` is ignored by the seed — else the stack manifest's version, else `0.1.0`), and — `pr-first` only — `.github/workflows/release-please.yml` (`googleapis/release-please-action@v4`, `contents: write` + `pull-requests: write`, with a commented `token:` input — see the file's own comment on why a PAT is needed for a `release: published` hook). `simple` makes release-please create a root `version.txt` on its first release. When the tag listing itself failed the envelope carries `tagsFailure` — report it in the summary line (`release: bootstrapped — node, manifest 0.1.0 (tag listing failed: EACCES — verify the seed)`) instead of trusting the seed | `release: bootstrapped — {releaseType}, manifest {version}` |
| `already-bootstrapped` | Nothing — the config already carries this step's own shape; an idempotent no-op that never re-writes or clobbers. A `local-merge` bootstrap re-run under `pr-first` adds the missing workflow only — that is a `fresh` completion (see above), not `already-bootstrapped` | `release: already configured` |
| `conflict` | Nothing — a competing tool was found: `.releaserc*` / `release.config.*` (semantic-release), `.changeset/` (changesets), `.goreleaser.*` (goreleaser), a foreign `release-please-config.json`, or a manifest/workflow already on disk with no config to match (`release-please (partial files)` — this step never overwrites a file it did not itself create) | `release: conflict — {tool}` (name the `evidence` path). Removing the tool clears it on the next `/init` run |

`v*` tags are not conflict evidence — a project that already tags releases by hand is exactly the onboarding case; tags feed only the manifest seed. Detection is this step's own presence check, deliberately not `_shared/existing-convention-detection.md`'s genre-grammar procedure (its ≥3-file floor and grammar parse answer a different question); only the three-way verdict vocabulary is shared.

Under `local-merge`, the config and manifest are inert until the local engine (unit 4 of #2250) ships — they are written now so both integration models converge on one file shape.

**Policy rows (`fresh` only) — deferred write.** The CLI returns `policyRows`, two commented-out lines:

```
# release-hook: <command run after the local engine tags a release — local-merge only; under pr-first the release: published workflow is the hook — it needs a PAT, GITHUB_TOKEN-created releases do not trigger it>
# release-train: false
```

Append them to `.claude-tweaks/policy.yml` through `worktree-policy-finalization.md`'s isolated-worktree write (`../worktree-policy-finalization.md`, § "How the write itself happens") — queue them exactly as Step 6 queues `worktree-always`, never a direct `Edit` against the main checkout; skip a line whose key is already present (commented or not). Both keys are non-core schema entries (`_shared/policy-schema.md`, Additional levers) and never Manifesto levers; what reads them ships in later units (`bin/release-local.js`, `/claude-tweaks:release --train`).

## Stack table

The canonical stack → `release-type` mapping (code twin: `RELEASE_STACK_TABLE` in `bin/lib/init/release-bootstrap.js`, pinned row-for-row by `tests/init-release-bootstrap-conformance.test.js`). Markers are root-level names; `*.ext` means any root file with that extension. **Exactly one** matching row selects its type; zero or two-plus rows fall through to `simple` — a multi-stack repo is out of scope by design, not resolved by precedence. Later units (the local engine, the preflight fact pack) cite this table rather than re-deriving their own.

| `release-type` | Root markers |
|---|---|
| `node` | `package.json` |
| `python` | `pyproject.toml`, `setup.py` |
| `rust` | `Cargo.toml` |
| `go` | `go.mod` |
| `java` | `pom.xml`, `build.gradle`, `build.gradle.kts` |
| `ruby` | `Gemfile`, `*.gemspec` |
| `php` | `composer.json` |
| `dotnet` | `*.csproj`, `*.sln` |

Under `simple`, `extra-files` names the first version-bearing JSON manifest found — `.claude-plugin/plugin.json`, `plugin/.claude-plugin/plugin.json`, then root `*.json` files with a top-level `version` — as `{type: json, path, jsonpath: $.version}` (a repo whose only manifest is a Claude plugin manifest lands here; a repo that also carries a root `package.json` resolves `node`). None found → no `extra-files` key.

A repo whose real manifest is not its root stack manifest — this plugin's own migration (#2259) is the first consumer — uses the CLI's `--release-type <type> --extra-file <path>` override (`plugin/bin/lib/init/release-bootstrap.js`'s `resolveReleaseType`) to bypass the stack scan entirely: the two flags are given together or not at all; when both are given, `--release-type` is validated against this table's types plus `simple`, and the manifest seed reads that file's own version instead of the stack lookup above. Without the override, this step's single-row rule is unchanged.

**Idempotent:** re-running `/init` on a repo this step already bootstrapped reports `already configured` and writes nothing; declining is not a state this step records — it is offered again next run.

**Failure handling:** a CLI exit of 1 (unexpected error) is surfaced with its stderr line and `/init` continues — never abort the rest of bootstrap on this step. Exit 2 is a prose bug (a malformed invocation above), not a project condition.
