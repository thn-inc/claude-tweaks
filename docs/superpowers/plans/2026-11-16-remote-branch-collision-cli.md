# Remote-Branch Collision CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 14-line `node-eval-file.js` heredoc in `plugin/skills/build/adopted-branch-collision-check.md` with one plain `node <cli> --flag "value"` command over a new `plugin/bin/remote-branch-collision.js` CLI, so the worktree-isolation guard stops refusing it (record #5589).

**Architecture:** The heredoc's composition logic moves line for line into one new exported function, `checkAdoptedBranch({ branch, repo, records, git, gh })`, in `plugin/bin/lib/worktree/remote-branch-collision.js`. The CLI only parses flags, calls that function with runners built from its injected `deps`, and prints one JSON line. The skill fence, the three tests that read it, and two docs follow.

**Tech Stack:** Node 18+ CommonJS, `node:test`, `tests/helpers/run-cli.js` (`runCliSync`, `spawnCli`), `tests/helpers/git-fixtures.js` (`originWithTwoClones`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T002809-record-5589/work/5589-spec.md` (record #5589)

Scope keywords: checkAdoptedBranch, adopted-branch-collision-check, remote-branch-collision

## Global Constraints

- Exit codes (spec Deliverable 2, verbatim): "0 when a JSON line was printed, whatever the state. 2 for a malformed call (no `--branch`, an unknown flag, a `--records` item that is not a positive integer, a flag with no value, a repeated flag, a positional argument), with a usage line on stderr and nothing on stdout. An exception from the module prints `claude-tweaks: remote-branch-collision: {message}` on stderr and exits 1 with nothing on stdout".
- Empty values (spec Deliverable 1, verbatim): "an empty `--repo ""` or `--records ""` means the flag was not given (`null` and `[]`) … An empty `--branch ""` is passed to the module, which answers `unreachable` with reason `invalid-branch-name` as it does today, and the CLI exits 0." "`pr` is printed as the module returns it."
- Output shape: `{ state, reason, remoteSha }` in that key order, plus `pr` when the state became `prior-attempt`, or `card` when a stop card was composed. `reason` and `remoteSha` are `null`, never absent, when the module gave none.
- Keep `plugin/bin/node-eval-file.js` and its header unchanged (spec: other fences use it).
- No shared argv parser exists under `plugin/bin/lib/` (checked at plan time: `ls plugin/bin/lib | grep -i -E "arg|cli|parse"` lists only `blast-radius-cli.js`, `number-list-cli.js`, `routine-template-parser.js`, none a general flag parser) — parse by hand like `plugin/bin/closing-links.js`'s `parseArgs`.
- **Deviation from the spec's Technical Approach, decided here:** the spec names `deps` as `{ git, gh, log, err }`. The governing contract (quoted below) names the io keys `stdout(text)`/`stderr(text)` and requires `realDeps` plus `cwd`/`env` threading; the CLI follows the contract: `deps` = `{ git, gh, cwd, env, stdout, stderr, pinGhHost, checkAdoptedBranch }`. Task 2's implementer logs nothing about it; `/build`'s alignment step classifies it. Likewise `--help`/`-h` (usage on stdout, exit 0), which the spec's exit list does not name: kept as the repo-wide CLI convention, recorded here for the same alignment step.
- Governing skill `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`, quoted verbatim:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract"
  - "It exports `run` and `realDeps`; `argv` is `process.argv.slice(2)`, and `run` returns an integer exit code or a Promise of one. The script entry is the file's last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`."
  - "Read `deps.cwd()` only where a relative path or a child process needs it: `realDeps.cwd()` is `process.cwd()`, which throws in a deleted working directory."
  - "Every child process is started with a `cwd` derived from `deps.cwd()` and with `env: deps.env`" … "A gh host or config lookup on the CLI's path (`gateOriginRepo`, `ghOptions`, the gh config dir) reads `GH_HOST`, `GH_CONFIG_DIR` and the home directory from the injected `env`/`homeDir` too — pass them through `injectedGhDeps(pickInjected(deps))` (`plugin/bin/lib/repo-resolve.js`; worked example `plugin/bin/lib/wrap-up/engine-verify.js`)"
  - "Tests call the CLI through `tests/helpers/run-cli.js` (`runCli`, or `runCliSync` for a synchronous `run`), passing an absolute `cliPath`" … "each converted CLI keeps one or two `spawnCli` smoke tests for the script entry, shebang and exit code." … "a CLI that starts `git` or `gh` needs `PATH` (and `SystemRoot` on Windows) in the `env` the test passes."
  - "It looks its flags up with `Object.hasOwn(FLAGS, a)`, which rejects an inherited key such as a bare `constructor` token … Pin the guard with a value after the key (`'constructor', 'x'`)"
  - "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."
  - "Every malformed-input class must actually reach its malformed code — `Number('') === 0` passes `Number.isInteger`, so validate positivity and pair-structure explicitly."
  - From `.claude/skills/gh-api-module-pattern` (summarized in `docs/plugin-structure.md` line 20, quoted): "a CLI taking an explicit `--repo` pins that repo's host for all its gh calls through `pinExplicitRepoHost`" — pinned by `tests/gh-host-seam-conformance.test.js`'s `PIN_WIRED` roster.
- Governing skill `.claude/skills/skill-prose-conformance-tests` (covers the two prose tests, per the spec's Gotchas): every new or changed assertion is proved able to go red by restoring the old fence text in a scratch copy and running it (spec AC6: "stated once in the PR").
- Governing skill `.claude/skills/windows-checkout-test-parity`: the CLI test asserts no filesystem paths; the snippet test keeps its existing `split(path.sep).join('/')` plugin-root form. No other path assertion is added.
- Source-scan suites that walk `plugin/bin/` and apply to the new CLI: `tests/windows-hide-spawn-conformance.test.js` (every `execFileSync` gets `windowsHide: true`), `tests/gh-host-seam-conformance.test.js` (every `gh` spawn's options wrapped in `ghOptions(args, { … })`), `tests/bin-lib/cli-entry-conformance.test.js` and `tests/bin-lib/exit-code-conformance.test.js` (guard shape, no `process.exit`). `tests/path-guard-conformance.test.js` — the CLI reads no file, so no `fs` call.

## Review Focus

1. A forgotten `{records}` substitution — the agent pastes the fence with the literal `{records}` still in it. Expected: exit 2 with a usage line, never a silent `foreign` stop. (Task 3, snippet test "verbatim" case.)
2. A `--records` value with a trailing comma or whitespace (`3887,`, ` 3887`). Expected: exit 2 — `Number(' 3887')` is 3887, so a plain `Number.isInteger` check would accept it. (Task 2, AC2.4 case.)
3. A `gh` failure on the PR lookup. Expected: still exit 0, a `card` saying "PR status unknown (lookup failed)". (Task 2.)
4. A flag whose value is the next flag (`--branch --repo o/r`). Expected: exit 2 "needs a value", never `--repo` taken as the branch. (Task 2, AC3.1 case.)
5. Running in a deleted working directory with no child process needed (`--help`). Expected: exit 0 — `deps.cwd()` is read lazily inside the runners only. (Task 2.)

---

### Task 1: `checkAdoptedBranch` in the module

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/worktree/remote-branch-collision.js` (add the function and export it; extend the header comment with one paragraph naming #5589)
- Test: `tests/bin-lib/worktree/remote-branch-collision.test.js` (append)

**Interfaces:**
- Produces: `checkAdoptedBranch({ branch, repo = null, records = [], git = defaultGit, gh = defaultGh }) -> { state, reason, remoteSha, pr?, card? }`. `records` is an array of positive integers (the CLI parses it). Exported beside the existing five names.

- [ ] **Step 1: Write the failing tests** — append to `tests/bin-lib/worktree/remote-branch-collision.test.js`, importing `checkAdoptedBranch`. One fake `git` per case keyed on `args`: `ls-remote` returns `` `${SHA}\trefs/heads/b\n` `` (or `''`, or throws `exitWith(128)`); `merge-base --is-ancestor <sha> HEAD` returns `''` (ancestor) or throws `exitWith(1)` (not) or `exitWith(128)` (unknown); `fetch` throws `exitWith(128)` for the fetch-failed case; `merge-base --is-ancestor <prHead> <remoteSha>` returns `''`. Fake `gh` returns `JSON.stringify(prs)` and counts its calls. Every expected value is a literal written in the test, never a call to `formatStopCard`:

```js
test('AC1.1: checkAdoptedBranch absent', () => {
  assert.deepEqual(checkAdoptedBranch({ branch: 'b', git: gitAbsent }), { state: 'absent', reason: null, remoteSha: null });
});
// mine:        { state: 'mine', reason: null, remoteSha: SHA_A }
// foreign:     { state: 'foreign', reason: null, remoteSha: SHA_A, card: '<full card text, literal>' }   repo 'o/r', gh → []
// prior-attempt: { state: 'prior-attempt', reason: null, remoteSha: SHA_A, pr: { number: 9, url: 'https://example.test/pr/9' } }
//              repo 'o/r', records [1], gh → [the closed PR object from tests/adopted-branch-collision-snippet-fixture.test.js's AC1.1 case, headRefOid = 'b'.repeat(40)]
// unreachable, no sha: { state: 'unreachable', reason: 'ls-remote-failed', remoteSha: null }  — and gh call count 0
// unreachable, sha:    { state: 'unreachable', reason: 'fetch-failed', remoteSha: SHA_A, card: '<literal card naming `fetch-failed`>' }
```

  Plus: `test('AC1.1: checkAdoptedBranch with no repo skips the PR lookup', …)` — foreign with `repo: null` makes zero `gh` calls and its `card` contains `PR status unknown (lookup failed)`; and `test('AC1.1: checkAdoptedBranch looks up the prior attempt only for foreign', …)` — the unreachable-with-sha case with a matching closed PR and `records: [1]` still returns `state: 'unreachable'` with a `card` and no `pr` key.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: FAIL — `checkAdoptedBranch is not a function`

- [ ] **Step 3: Implement `checkAdoptedBranch`** — move the fence's script body (`plugin/skills/build/adopted-branch-collision-check.md` lines 51-62 at `026e203f3`) into the function line for line: the `out` object; the two-sided condition `r.state === 'foreign' || (r.state === 'unreachable' && r.remoteSha)`; `reason` passed to the card only for `unreachable`; `findPrsForBranch` only when `repo` is truthy; `findPriorAttemptPr` only for `foreign`. Pass `git` to `classifyRemoteBranch` and `findPriorAttemptPr`, and `gh` to `findPrsForBranch`. The script's `records` parsing is not copied (the CLI parses). Return `out`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision.test.js`
Expected: PASS, every test

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/worktree/remote-branch-collision.js tests/bin-lib/worktree/remote-branch-collision.test.js
git commit -m "Add checkAdoptedBranch to the remote-branch collision module — refs #5589"
```

### Task 2: The `remote-branch-collision.js` CLI

**Role:** integration

**Files:**
- Create: `plugin/bin/remote-branch-collision.js`
- Create: `tests/bin-lib/worktree/remote-branch-collision-cli.test.js`
- Modify: `tests/gh-host-seam-conformance.test.js` (add `'remote-branch-collision.js'` to `PIN_WIRED`, keeping its alphabetical order)
- Modify: `docs/plugin-structure.md` (one command line, inserted immediately before the `node plugin/bin/residue.js` line)

**Interfaces:**
- Consumes: `checkAdoptedBranch` (Task 1).
- Produces: `node plugin/bin/remote-branch-collision.js --branch <name> [--repo <owner/name>] [--records <n[,m…]>] [--help]`; exports `{ run, parseArgs, realDeps, USAGE }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/worktree/remote-branch-collision-cli.test.js`, calling the CLI through `runCliSync({ cliPath: <absolute path>, argv, deps: { git, gh, pinGhHost } })` with the same fake runners as Task 1 (the CLI's `git`/`gh` deps take `(args, { cwd, env })`; the fakes ignore the second argument). `gh` is on `FAIL_CLOSED_KEYS`, so every case injects one. Tests (names carry the AC clause ids):
  - `AC1.1: the CLI prints one line that parses to checkAdoptedBranch's object` — for each of the six Task 1 states, stdout is exactly one `\n`-terminated line whose `JSON.parse` deep-equals the same literal as Task 1; exit 0.
  - `AC2.1: --records "3887,3890" reaches the prior-attempt lookup as [3887, 3890]` — gh returns a closed PR closing #3890 → `state: 'prior-attempt'`.
  - `AC2.2: an absent or empty --records reaches it as []` — the same PR with `--records ""` and with no `--records` → `state: 'foreign'`.
  - `AC2.3: an empty --repo skips the PR lookup as an absent one does` — foreign, `--repo ""` and no `--repo`: zero `gh` calls, zero `pinGhHost` calls, card contains `PR status unknown (lookup failed)`; `--repo o/r` calls `pinGhHost` once with the parsed spec `{ host: 'github.com', owner: 'o', repo: 'r' }`, `--repo ghe.example.com/o/r` with `{ host: 'ghe.example.com', owner: 'o', repo: 'r' }`, and an unparseable `--repo nope` makes zero `pinGhHost` calls while the module still receives `repo: 'nope'`.
  - `AC2.4: a --records item that is not a positive integer exits 2` — each of `38x`, `0`, `3887,`, ` 3887`, `-1`: exit 2, stdout `''`, stderr starts with `remote-branch-collision.js:` and contains `usage:`.
  - `AC3.1: a malformed call exits 2 with a usage line and empty stdout` — no `--branch`; trailing bare `--branch`; `--branch --repo o/r`; `--branch a --branch b`; positional `extra`; unknown `--nope x`; `constructor x`.
  - `AC3.1: an empty --branch is passed to the module` — `--branch ""` exits 0 with `{ state: 'unreachable', reason: 'invalid-branch-name', remoteSha: null }`, zero git calls.
  - `AC3.2: a module that throws exits 1 with empty stdout` — inject `checkAdoptedBranch: () => { throw new Error('boom'); }`: exit 1, stdout `''`, stderr exactly `claude-tweaks: remote-branch-collision: boom\n`.
  - `a gh failure on the PR lookup still prints a card` — gh throws → exit 0, `card` contains `PR status unknown (lookup failed)`.
  - `--help prints usage, exits 0 and never reads cwd` — counting `cwd` fake: 0 calls.
  - `spawnCli smoke: the script entry prints absent for a branch not on a real origin` — `originWithTwoClones` fixture, `cwd: r.work`, `env: { ...r.env }`, `--branch worktree-record-1` → exit 0, `{"state":"absent","reason":null,"remoteSha":null}`.
  - `spawnCli smoke: a malformed call exits 2` — no args.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision-cli.test.js`
Expected: FAIL — cannot find module `plugin/bin/remote-branch-collision.js`

- [ ] **Step 3: Implement the CLI** in `plugin/bin/remote-branch-collision.js`:
  - `#!/usr/bin/env node`, a header comment: what it is (#5589, the CLI over the module's `checkAdoptedBranch`, called by `plugin/skills/build/adopted-branch-collision-check.md`), the invocation, the output shape, and the exit codes 0/1/2 exactly as Global Constraints quote them.
  - `parseArgs(argv)`: `FLAGS = { '--branch': 'branch', '--repo': 'repo', '--records': 'records' }`, looked up with `Object.hasOwn`; `--help`/`-h` sets `help`; a value that is `undefined` or starts with `--` is "needs a value"; a flag seen twice is "repeated"; anything else is "unknown argument". An empty string is a valid value. `--repo ""` → `null`; `--records ""` or absent → `[]`; otherwise split on `,` and every item must match `/^[1-9]\d*$/`, else error. Missing `--branch` is an error unless `help`. Returns `{ branch, repo, records, help }` or `{ error }`.
  - `realDeps`: `cwd: () => process.cwd()`, `env: process.env`, `stdout`/`stderr` writing to `process.stdout`/`process.stderr`, `git: (args, { cwd, env }) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000, windowsHide: true, cwd, env })`, `gh: (args, { cwd, env, ghDeps }) => execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, cwd, env }, ghDeps))`, `pinGhHost: (repoSpec, { cwd, env } = {}) => pinExplicitRepoHost(repoSpec, { cwd, env })`, `checkAdoptedBranch`.
  - `run(argv, deps = realDeps)`: parse (error → `deps.stderr(\`remote-branch-collision.js: ${error}\n${USAGE}\`)`, return 2); help → `deps.stdout(USAGE)`, return 0; then inside one `try`: when `repo` is set, parse it as `plugin/bin/link-records.js` does — `parseRepo(repo.split('/').length >= 3 ? repo : \`github.com/${repo}\`)` (`plugin/bin/lib/repo-resolve.js`) — and only when that returns a spec call `deps.pinGhHost(spec, { cwd: deps.cwd(), env: deps.env })` (`pinExplicitRepoHost` reads `repoSpec.host`, so a raw string would always pin `github.com`); the module still receives the raw `repo` string; build `git = (args) => deps.git(args, { cwd: deps.cwd(), env: deps.env })` and `gh = (args) => deps.gh(args, { cwd: deps.cwd(), env: deps.env, ghDeps: injectedGhDeps(pickInjected(deps)) })` (cwd read per call, never eagerly); `const out = deps.checkAdoptedBranch({ branch, repo, records, git, gh })`; print `JSON.stringify(out) + '\n'`; return 0. `catch (e)` → `deps.stderr(\`claude-tweaks: remote-branch-collision: ${(e && e.message) || e}\n\`)`, return 1.
  - Last statement: `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`
  - Add `'remote-branch-collision.js'` to `PIN_WIRED`; the `realDeps.pinGhHost` arrow above matches that test's regex.
  - `docs/plugin-structure.md`: `node plugin/bin/remote-branch-collision.js --branch <name> [--repo <owner/name>] [--records <n[,m…]>]   # Adopted-branch collision CLI (#5589) — classifies a same-name branch on origin for a run that adopted its worktree, over lib/worktree/remote-branch-collision.js's checkAdoptedBranch: prints one JSON line {state: absent | mine | foreign | prior-attempt | unreachable, reason, remoteSha} plus pr (prior-attempt) or card (a stop card); an empty --repo or --records counts as not given. Exit 0 a line was printed, 1 the module threw (nothing on stdout), 2 malformed invocation. Called by plugin/skills/build/adopted-branch-collision-check.md; tests in tests/bin-lib/worktree/remote-branch-collision-cli.test.js`

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/worktree/remote-branch-collision-cli.test.js tests/gh-host-seam-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/bin-lib/cli-entry-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS, every file

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/remote-branch-collision.js tests/bin-lib/worktree/remote-branch-collision-cli.test.js tests/gh-host-seam-conformance.test.js docs/plugin-structure.md
git commit -m "Add the remote-branch-collision CLI over checkAdoptedBranch — refs #5589"
```

### Task 3: The fence becomes one command; the tests and journey that read it follow

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/adopted-branch-collision-check.md` (lines 24-29 and 44-70 at `026e203f3`)
- Modify: `tests/adopted-branch-collision-snippet-fixture.test.js`
- Modify: `tests/adopted-branch-collision-prose-conformance.test.js`
- Modify: `tests/node-eval-file-heredoc-syntax.test.js` (the test at line 187)
- Modify: `docs/journeys/retry-a-record-whose-first-attempt-left-a-branch-3887.md` (frontmatter `files:`, step 2 Action, Origin)
- Waived `tests/dispatch-retry-prior-attempt-conformance.test.js`, `tests/express-lane-prose.test.js`, `tests/worktree-adopt-or-create-consolidation.test.js`: read the same skill file, but a phrase grep for the moved text (`no CLI of its own`, `silently no-ops on Windows`, `classifyRemoteBranch({ branch })`, `node-eval-file`, `re-run once`) hits no test outside the three modified here; Step 4 runs them.
- No change (Check B scope-keyword hits, each read at plan time — they name the skill file's states, its HARD-GATE registration, or the module path, none of which change): `docs/skill-graph.md:273`, `plugin/bin/lib/flow/pr-early-open.js:69`, `plugin/skills/_shared/auto-mode-contract.md:212`, `plugin/skills/_shared/express-lane.md:20`, `plugin/skills/_shared/pr-early-run-lifecycle.md:134,192`, `plugin/skills/build/already-shipped-assessment.md:3`, `plugin/skills/build/worktree-setup.md:9`, `plugin/skills/dispatch/settle-and-merge.md:185`, `plugin/bin/lib/branch-name.js:7`, `tests/helpers/git-fixtures.js:112`, `tests/bin-lib/console/backfill.test.js` and `tests/bin-lib/log-decision/cli.test.js` (decision-log fixtures quoting the paths), `tools/test-durations.json`, `docs/superpowers/plans/2026-11-13-fixture-git-process-churn.md` (history).

**Interfaces:**
- Consumes: the CLI from Task 2, invoked as `node "${CLAUDE_PLUGIN_ROOT}/bin/remote-branch-collision.js" --branch "{branch}" --repo "{repo}" --records "{records}"`.

- [ ] **Step 1: Update the tests first**
  - Snippet fixture: `START_ANCHOR` becomes `` '```bash\nnode "${CLAUDE_PLUGIN_ROOT}/bin/remote-branch-collision.js" --branch "{branch}" --repo "{repo}" --records "{records}"' ``. `fill(snippet, { branch, repo = '', records = '' })` substitutes all three placeholders, each asserted present exactly once. `stubPluginRoot(t, gitFake, prs)` now copies the real `plugin/bin/remote-branch-collision.js` into `<dir>/bin/`, writes one-line re-export shims for every `./lib/…` module the CLI requires other than the worktree module (as `session-tmp.js` is shimmed today), and writes `<dir>/bin/lib/worktree/remote-branch-collision.js` as `{ ...real, checkAdoptedBranch: (o) => real.checkAdoptedBranch({ ...o, ...(gitFake ? { git: gitFake } : {}), gh: () => JSON.stringify(prs) }) }` — so the real composition runs against a pinned git answer (ls-remote returns the sha; `merge-base` exits 128; `fetch` exits 128 → `fetch-failed`) instead of replacing `classifyRemoteBranch`, which `checkAdoptedBranch` calls internally. The "verbatim" case in the AC1.1 test becomes: the unsubstituted `{records}` placeholder exits 2 with empty stdout (`execFileSync` throws; assert `status === 2` and `stdout === ''`). Add `test('AC5.1: the fence carries no shape the worktree guard is known to refuse', …)`: `assert.deepEqual(detectShapes(extractSnippet()), [])` and the same for the filled snippet (`require('../tools/guard-refusals/shapes.js')`).
  - Prose conformance: add `test('AC4.1: the check runs as one plain CLI command, not a node-eval-file heredoc (#5589)', …)` asserting `CHECK` includes the exact command line above, `doesNotMatch(CHECK, /NODE_EVAL_EOF|node-eval-file/)`, and `match(norm(CHECK), /exit 2[^.]*malformed call/i)`.
  - Heredoc-syntax test (line 187): rename it to `'node-eval-file.js header states the unquoted NODE_EVAL_EOF convention (#3102)'` and delete its last five lines (the `snippet`/`fenceAt` read and its `assert.match`); the header half stays byte-for-byte.

- [ ] **Step 2: Run to verify the fence tests fail**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js`
Expected: FAIL after Step 1 — snippet start anchor not found; AC4.1 fails on `NODE_EVAL_EOF`

- [ ] **Step 3: Rewrite the skill text**
  - Lines 24-27 name the CLI: "**Procedure**, via `plugin/bin/remote-branch-collision.js`, the CLI over `plugin/bin/lib/worktree/remote-branch-collision.js`'s `checkAdoptedBranch({ branch, repo, records })` (unit-tested, `tests/bin-lib/worktree/remote-branch-collision.test.js` and `tests/bin-lib/worktree/remote-branch-collision-cli.test.js`), with `{branch}` …" — the rest of that sentence unchanged.
  - Delete line 29 (the heredoc-delimiter sentence).
  - Lines 44-46 become: "Then run the check from the worktree as one plain command, all three values pasted in literally — an empty `{repo}` or `{records}` stays `""`:"
  - The fence becomes the one command line above.
  - Line 69's rule gains the exit-2 clause: "It prints one JSON line. Exit 2, with a usage line on stderr, is a malformed call: correct the call, never re-run it unchanged. No output, or output that does not parse, is not a result: re-run once, then treat it as `unreachable` with reason `no-output` (item 3)." Items 1-5 and the rest of the file are unchanged.
  - Journey: add `plugin/bin/remote-branch-collision.js` to `files:`; step 2's Action names it ("The build runs `bin/remote-branch-collision.js`; the fresh … branch's tip …"); Origin gains "- Updated during build of #5589. The check now runs as `bin/remote-branch-collision.js` (one plain command) instead of a `node-eval-file.js` heredoc the worktree guard refused; the states are unchanged."

- [ ] **Step 4: Run to verify they pass, and prove the new assertions can go red**

Run: `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/node-eval-file-heredoc-syntax.test.js tests/skill-fence-guard-shapes.test.js tests/dispatch-retry-prior-attempt-conformance.test.js tests/express-lane-prose.test.js tests/worktree-adopt-or-create-consolidation.test.js`
Expected: PASS, every file; `tests/skill-fence-guard-shapes.test.js` with no `ALLOWLIST` change.

Then the AC4/AC9 absence checks, each control already run at plan time (`026e203f3`: the first printed lines 49 and 63, the second line 197):

Run: `git grep -n -F "NODE_EVAL_EOF" -- plugin/skills/build/adopted-branch-collision-check.md`
Expected: no output (exit 1)

Run: `git grep -n "adopted-branch-collision-check" -- tests/node-eval-file-heredoc-syntax.test.js`
Expected: no output (exit 1)

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/build/adopted-branch-collision-check.md tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js tests/node-eval-file-heredoc-syntax.test.js docs/journeys/retry-a-record-whose-first-attempt-left-a-branch-3887.md
git commit -m "Run the adopted-branch collision check as one CLI command — refs #5589"
```

- [ ] **Step 6: AC6.1 go-red proof, after the commit** — overwrite the committed skill file with the old one (`git show 026e203f3:plugin/skills/build/adopted-branch-collision-check.md`, redirected over `plugin/skills/build/adopted-branch-collision-check.md`), run `node --test tests/adopted-branch-collision-snippet-fixture.test.js tests/adopted-branch-collision-prose-conformance.test.js`, confirm the AC4.1 test and the changed snippet tests fail, then restore from the commit with `git checkout HEAD -- plugin/skills/build/adopted-branch-collision-check.md` and confirm `git status --porcelain` is empty. Report the failing test names in the task reply (they go into the PR body once).

### Task 4: Live run in a linked worktree (controller, not dispatched)

Folded into `/build` Common Step 5's neighbourhood: it runs after Common Step 5 passes, by the controller, in this worktree session (a linked worktree, so the guard judges the call).

- [ ] **Step 1 (AC7.1, AC7.2):** run, as one Bash call with the worktree's own plugin root pasted literally, `node "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/dispatch-record-5589/plugin/bin/remote-branch-collision.js" --branch "no-such-branch-5589" --repo "thn-inc/claude-tweaks" --records "5589"`. Expected: not refused; prints `{"state":"absent","reason":null,"remoteSha":null}`. Write the output to `$PIPELINE_RUN_DIR/evidence/ac7-live-run.txt` with a plain Bash redirect and log one `AC evidence` entry per `build/plan-authoring-checks.md`'s AC-evidence persistence check; quote the command and line in the PR body (AC7.2).
- AC7.3 (#5590 measures the effect) is a pointer, not a build step.

Waived AC7.3: measured by #5590's parked record after merge, not by this build.
Waived plugin/bin/node-eval-file.js: read only, to confirm it stays (Global Constraints); not modified.
Waived plugin/skills/_shared/issue-claims.md: the spec cites its Deliverable-name collision rule; checked at plan time (the only `remote-branch-collision.js` in the tree is the lib module), not modified.
- AC8.1 (`npm test -- --full`) is Common Step 5's verification run, not a plan task.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (CLI, `checkAdoptedBranch`, empty-value rules) | 1, 2 |
| Deliverable 2 (exit codes) | 2 |
| Deliverable 3 (fence, re-run clause) | 3 |
| Deliverable 4 (tests) | 1, 2, 3 |
| Deliverable 5 (docs) | 2 (`docs/plugin-structure.md`), 3 (journey) |
| AC1.1, AC1.2 | 1, 2 |
| AC2.1-AC2.4 | 2 |
| AC3.1, AC3.2 | 2 |
| AC4.1, AC4.2 | 3 |
| AC5.1 | 3 |
| AC6.1 | 3 |
| AC7.1, AC7.2 | 4 |
| AC8.1 | Common Step 5 |
| AC9.1, AC9.2 | 3 |
| Gotcha: shared parser check | Global Constraints (none exists) |
| Gotcha: #4283 named in the PR | PR body at review/wrap-up — the CLI removes the `${CLAUDE_PLUGIN_ROOT}`-in-a-JS-literal splice |
