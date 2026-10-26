Test-impact selection — the `impact` block of `.claude-tweaks/verify-scope.json`, the map it reads, and what `verify.js --scope` reports for it (#4024). Read when the declaration declares `impact`, or a report carries `scope.impact`.

# Test-impact selection

A declaration's `impact` block narrows one suite to the test files a test-impact map says read a changed path. The map is built from one traced full-suite run and stamped with the commit it ran at. Whenever the map cannot be trusted, the suite runs its full command and the report names why. Selection fails closed: an unknown never selects fewer tests.

## Declaration

| Field | Meaning |
|-------|---------|
| `suite` | The declared suite that impact rules narrow (required). |
| `command` | That suite's subset command. It must contain `{files}`, which becomes the path of a list file with one repo-relative test path per line (required). |
| `tests` | Non-empty array of globs naming the suite's test files (required). |
| `maxAgeCommits` | Positive integer, default 200: the most commits a map may trail HEAD. |
| `map` | Where the map lives: a repo-relative path with no `..` segment, optionally behind a leading `{git-common-dir}/`. Default: `{git-common-dir}/claude-tweaks-test-impact.json`, which every worktree of the checkout shares. |
| `fetch` | Optional command that downloads a ready map. It never traces. |

No other key is accepted. `impact` cannot be combined with a tool-scoped `checks.tests` command (`{base}`), since that tool selects its own tests. An impact rule is `{ "match": "<glob>", "impact": true, "static": <bool> }`. Its suite is `impact.suite`, so it takes no `suites` of its own, and it needs a valid top-level `impact` block. The one allowed `suites` is `"*"`, the legacy fallback: a plugin build older than `impact` rejects a rule without `suites` (a usage error that stops every verify), but reads `"*"` as every suite and ignores `impact`, so a declaration committed to a repo whose installed plugin lags the release keeps working. Current readers ignore it. Drop it once no installed build older than the release shipping `impact` reads the file. Rules still match first-wins, so a path that changes how every test runs (the test runner, the map builder) goes in a `"suites": "*"` rule placed above the impact rules.

**`{files}` quoting.** A plain list path substitutes as is. Any other path, for example one with a space anywhere in the log dir's path, is shell-quoted for the platform. In that case:

- A `"{files}"` wrapper (or `'{files}'` on POSIX) is replaced by that quoting.
- Anything else left in `command` that could nest with that quoting refuses the substitution. On POSIX that is any other quote, backtick or backslash, or `${files}`. On win32 it is any other quote, or `^`.
- The list path itself can refuse too, whatever `command` holds: a leading `-` (`leading-dash`) or a control character (`control-character`) on any platform, and on win32 a `"`, `%` or `!`, or a trailing backslash (`cmd-unquotable`). The list lives in the log dir, so a refusal of this kind means changing `--log-dir`.
- A refusal runs the suite full with `files-list-unquotable: {reason}`.

Keep `command` free of those characters.

## The map

The map is JSON: `{version: 1, commit, tracedAt, exitCode, node, dirty, paths, tests}`. `dirty` is `true` when the traced tree held tracked changes (`trace --allow-dirty`; untracked files never count), so the map's `commit` is not what was traced. A map written before the field existed has no `dirty` key and reads as `false`; an older reader ignores the key, so the version stays 1. A `dirty` that is not a boolean is `bad-shape`. `paths` is one sorted table of repo-relative POSIX paths. Each `tests` entry lists indexes into that table under up to four kinds:

| Kind | Records |
|------|---------|
| `f` | content reads: file reads and opens, copy sources, `stat`/`lstat`, module loads, and a `package.json` a `require` reads for `main` or `exports` |
| `s` | existence probes: `exists`, `access`, `realpath`, `readlink`, the candidates a `require` probes up to the one it resolves to (all of them when it fails), minus those under an earlier probe |
| `d` | directory listings: `readdir`, `opendir` |
| `c` | content prefixes: the source directory of a recursive copy, a non-node child's in-repo directory argument, a content-reading `git` subcommand's cwd or pathspec prefix, or `''` (the whole repo) for a node child whose env lost the trace |

A prefix covers a path when `prefix === ''` (the repo root), `p === prefix`, or `p` starts with `prefix + '/'`.

**Selection.** Each changed path matched by an impact rule is checked against every map test still present at HEAD. A modified path (`M`) selects a test that content-read it (`f`) or holds a covering `c` prefix. An added, deleted or renamed path (`A`/`D`) also selects a test that probed it (`s`), listed a directory covering it (`d`), or probed or stat'd an ancestor directory of it (`s`/`f`, never the repo root `''`), since adding a directory's first file or deleting its last changes whether it exists. A path with no recorded status counts as `A`, the broader match. A changed test file also selects the other tests that read it by these rules (a test that reads or lists every test file); it is never `untraced-path`. The selected set is the matched tests, plus changed test files present at HEAD, plus test files at HEAD that the map does not know (untraced tests, which always run).

Every test file the map knows, present at HEAD, whose content differs between the map's commit and HEAD (`git diff --no-renames {commit} HEAD`) is selected too, as untraced, since its recorded reads may be stale. This is a tree diff, so it holds whether or not the map's commit is an ancestor of the base. Any map problem (missing, invalid, failing-suite, not-ancestor, stale) skips the drift read, and those already run the suite full; the map's commit need not be an ancestor of the base. With the map at the base, the drifted tests are the branch's own committed test edits, which are already changed tests, so the selection is unchanged and `driftTests` stays empty (a changed test is never counted as drift). Under merge-narrowing (a stamp-anchored run whose branch later merged the integration branch) the merged-in test edits are dropped from the changed set but still differ from the map's commit, so drift selects them; that is intended and conservative.

## When the impact suite runs full

`report.json`'s `scope.impact.fallback` names the reason:

| Fallback | Cause |
|----------|-------|
| `map-missing` | No map file at the resolved path. |
| `map-invalid: {reason}` | `{reason}` is `unparseable` (not JSON), `bad-shape`, `wrong-version`, `bad-commit`, or `unreadable` (the file exists but cannot be read). |
| `map-from-failing-suite` | The traced run's `exitCode` was not 0. |
| `map-dirty` | The map was traced from a tree with tracked changes (`dirty: true`): its reads belong to no commit, so it is never used. `fetch` replaces a cached dirty map. |
| `map-not-ancestor` | The map's commit is not an ancestor of HEAD. |
| `map-stale: {n} commits > {max}` | The map trails HEAD by more than `maxAgeCommits`. An age git cannot count reads as stale. |
| `untraced-path: {p}` | A changed non-test path that no traced read covers. |
| `head-tests-unreadable` | git could not list the test files at HEAD. |
| `head-tests-empty` | The listing succeeded but named no test file (a sparse checkout, say), so no selection could be trusted. |
| `map-drift-unreadable` | git could not list the test files that differ between the map's commit and HEAD. |
| `map-unlocatable` | git could not name the checkout root or common dir. |
| `files-list-unquotable: {reason}` | `{files}` could not be substituted safely. `{reason}` is `leading-dash` or `control-character` (the log dir's list path itself), `cmd-unquotable` (win32 `cmd`), or `template-quotes` (other quoting left in `command`). |
| `files-list-unwritable: line break in {path}` | A selected path holds a line break, so the list file cannot carry it. |
| `no-anchor` | No usable stamp anchor and no `--integration-branch` merge-base to diff against (an explicit `--base` never anchors). |

When a map problem exists and `fetch` is declared, the runner runs `fetch` once from the checkout root, with a 120 s timeout and its output ignored, and re-reads the map only when it exits 0. A failed fetch leaves the original reason standing.

A non-impact rule, or an unmatched path, that selects the impact suite supersedes the subset, and the suite runs full with `superseded: true`. A delta that touches no impact-rule path gives `files: []`: the impact suite runs nothing. `files: null` always means the suite runs its full command.

## Anchoring

Changed paths are diffed from the stamp's `fullSha`, as every scoped run is. With no usable stamp anchor (none yet, or one stranded by a rebase), an impact declaration anchors on the merge-base with `--integration-branch`. An explicit `--base` never anchors it: that run is full, as without `impact`. The first run of a branch is then impact-selected too, instead of full. The resulting stamp is `scoped`, with `fullSha` set to that base. It is never a full pass, but it does verify HEAD (`verifiedHead`).

## Report

`scope.impact` holds `{suite, files, fallback, selected, changedTests, untracedTests, driftTests, driftSelected, superseded, mapPath, mapCommit, mapAgeCommits, mapDirty, fetch, listPath, selectedFiles}`. `driftTests` names the drift-selected tests and `driftSelected` their count (`null` when no selection ran). `fetch` is `{ran, exitCode, durationMs, timedOut, signal}` when a fetch ran, else `null`: `timedOut` is `true` when the 120 s timeout killed it, and `signal` names the signal that ended it (`null` for a normal exit). `listPath` and `selectedFiles` are set only when a subset ran. The map is read only when selection needs it, so a delta no impact rule matches (or that a full-suite rule already supersedes) never reads the map or runs `fetch`: `mapPath`, `mapCommit`, `mapAgeCommits`, `mapDirty` and `fetch` are then `null`. Under `Scope:`, stdout prints one of:

- `Impact: {selected} of {n} test file(s) selected (map {commit9}, {age} commit(s) old)`, with `, {driftSelected} drift` inside the parentheses when any drift-selected test ran
- `Impact: {selected} of the {suite} test file(s) selected — no impact-rule path changed, map not read`
- `Impact: full {suite} — {fallback | superseded by a full-suite rule}`

## Refresh

The map is built outside the runner by a traced full-suite run: a read tracer preloaded into every node process of the suite records each test file's reads. The usual refresh path is a post-merge CI job that uploads the map, with `fetch` downloading the newest one from a `push` or dispatch run on main (never a pull-request run) whose commit is an ancestor of HEAD. Verify never traces. CI's full suite stays the merge gate. Impact selection only shortens local verification.

**Known limits — what a map can miss:**

- **Module loads.** CommonJS loads and `require` resolution are traced the way Node resolves: relative, absolute, `node_modules` lookups, `require.resolve`'s `paths`, and `package.json` `main`/`exports`. `#` imports and a package's self-reference are not followed, and a native addon (`.node`) is probed but its content is not recorded as read. ESM `import` loads are seen only through the file-system calls the loader makes.
- **Non-node children.** Reads by a non-node child process are approximated. Its in-repo path arguments are recorded, and a content-reading `git` subcommand records a content prefix. `sh`/`bash -c` scripts (with their option clusters) and `env` wrappers are read as the command they run. A node child whose env lost the trace (`env -i`, `-u NODE_OPTIONS`, a `NODE_OPTIONS=` assignment) cannot trace itself, so its reads are unknown: it records the whole-repo prefix `c ''`, which selects the test for every change. Other wrappers (`xargs`, `timeout`, `nice`) and a mid-script `export`/`unset` of `NODE_OPTIONS` are not read; `env` options it does not know (`-S`, a combined cluster such as `-iu`) fall back to recording its path arguments.
- **Trace environment.** The map records reads in the environment it was traced in (CI's, for a post-merge job). A test whose reads depend on the local environment (a skip gated on an installed plugin, say) can be under-selected locally.
- **Tooling not shipped.** The tracer and map builder are the plugin repo's own tooling, not part of the plugin. Another project must produce a map in the format above itself.

## Full mode

`verification.md`'s "Standalone is always full" still governs. Build Common Step 5 is impact-selected only when it is scoped-eligible, meaning `$PIPELINE_RUN_DIR` is set or a parent passed `--source`, and the declaration declares `impact`. It then runs the scoped invocation from that file's Re-verify scoping, so the impact suite runs its selected subset. Otherwise it runs full, as does a standalone `/build`.

An impact-selected run writes a `scoped` stamp, never a full one. `--stamp-status` then reads `verifiedHead: true` and `match: false`.

Standalone `/claude-tweaks:test` passes no `--scope` and is the explicit full mode: every suite runs its full command.
