# Explicit `--repo` Host Pin — One Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an explicit `--repo`'s GitHub host to `gh` through one mechanism — a per-call env that `ghOptions` builds — and delete the process-global `process.env.GH_HOST` pin and the restore it forced on `materialize.js`.

**Architecture:** `plugin/bin/lib/repo-resolve.js` keeps a module-scoped "explicit repo host" that `pinExplicitRepoHost` records (it no longer writes `process.env`), and `ghOptions` adds it as `GH_HOST` to each gh call's own env. A caller that must scope the host to some calls only (`backlog-grant-gate.js`, whose issue lists read cwd's repo) passes it per call as `ghOptions`'s `deps.explicitHost`. Because `process.env` is never mutated, `materialize.js`'s record-authored Premise-check command inherits the user's real environment, so `envBeforeGhHostPin` and the `env` option plumbed for it are deleted.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191934-record-4795/work/4795-spec.md` (record #4795)

**Scope keywords:** envBeforeGhHostPin, pinnedGhHost, nativeRunnerFor

## Decision (Deliverable 1)

The per-call env wins. The process-global pin cannot serve `backlog-grant-gate.js`: its issue lists run `gh issue list` against cwd's own repo, and a process-wide `GH_HOST` matching none of cwd's remotes breaks them (the comment at `plugin/bin/backlog-grant-gate.js:104-106`). The per-call env serves every caller: all `gh` spawns under `plugin/bin` already route through `ghOptions` (`tests/gh-host-seam-conformance.test.js` enforces it; the one exemption is `ghAvailable`'s host-agnostic `gh --version`), so a host `ghOptions` adds per call reaches every call the old pin reached. None of the 12 CLIs spawns a child node process that would have inherited the old env pin (checked: no `process.execPath`/`'node'` spawn in any of them).

**Key Files correction:** the spec's Key Files names `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` for `nativeRunnerFor`; it lives in the CLI, `plugin/bin/backlog-grant-gate.js:107`. The lib module only consumes the `nativeRunner` it is handed and needs no change.

The 11 `PIN_WIRED` CLIs keep their wiring lines byte-identical (`pinGhHost: (repoSpec) => pinExplicitRepoHost(repoSpec)` + `deps.pinGhHost(repoSpec)`); they migrate because `pinExplicitRepoHost`'s semantics move under them. `backlog-grant-gate.js` migrates explicitly (Task 3). `materialize.js` drops the restore (Task 2).

## Global Constraints

- Release note: "No user-visible change."
- Commit style: `{Verb} {what} — {detail}` (imperative, no conventional prefix), body line `refs #4795` (never `closes`/`fixes`), ending with `Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd`.
- Quoted from `.claude/skills/gh-api-module-pattern/SKILL.md` (governs every file under `plugin/bin` this plan touches):
  - "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.** The seam injects `GH_HOST` for a GitHub Enterprise origin, so a spawn that skips it sends its call to github.com (#4505). Wrap the site's own options object and keep its `timeout`, `stdio`, `maxBuffer` and `windowsHide` literal inside it — `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', windowsHide: true }))` — so the windows-hide scan still sees the flag."
  - "The module takes `runner(args)`, invoked as if `gh ${args.join(' ')}`, returning stdout; a throw is a failed call. … always an argv array, never a shell string (no injection surface, no quoting bugs)."
- Quoted from `.claude/skills/bin-source-scan-conformance/SKILL.md` (governs the new scan in `tests/gh-host-seam-conformance.test.js`):
  - "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." (already imported by that file)
  - "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text."
  - "When a scan uses blank mode, it computes the blank-mode text once and hands that same text to both `stripperVerdict(raw, stripped)` and its matcher, so the mis-parse check judges what the matcher reads."
- The windows-hide scan (`tests/windows-hide-spawn-conformance.test.js`) still requires `windowsHide: true` literally inside every spawn's options object.

## Review Focus

1. **An exported `GH_HOST` (empty string included) at call time beats a recorded pin** — AC4 of #4505 must survive the move from pin-time to call-time precedence. Pinned in Task 1's test.
2. **A gh call whose args name `-R`/`--repo`/`--hostname` still gets the pinned `GH_HOST`** — the old env pin reached those calls too; dropping it there would change which host gh authenticates against. Pinned in Task 1's test.
3. **A call that passes its own `env` (without `GH_HOST`) still gets the pin** — the old pin only reached such a call if the env was copied from `process.env`; the new one reaches it regardless. Pinned in Task 1's test.
4. **`--repo` naming the same host ghOptions already reaches from cwd records nothing**, and origin injection (with its once-per-host note) continues. Pinned in Task 1's test.
5. **Repeated in-process runs don't leak a pin** — `_resetGhHostCache()` clears it. Pinned in Task 1's test.

---

### Task 1: Per-call explicit host in `repo-resolve.js`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js:208-257` (`ghOptions`, `pinExplicitRepoHost`, `_resetGhHostCache`, their comments)
- Test: `tests/bin-lib/repo-resolve.test.js:283-299` (replace the `pinExplicitRepoHost: exports the pinned host on deps.env…` test)
- Test: `tests/materialize-premise-check.test.js:507-516` (flip one assertion — see Step 5)

**Interfaces:**
- Produces: `pinExplicitRepoHost(repoSpec, deps = {}) -> string|null` — computes `explicitRepoGhHost(repoSpec, deps.cwd, deps)`, records the result (host or `null`) as the module's explicit repo host, returns it. Never writes `process.env` or `deps.env`.
- Produces: `ghOptions(args, opts, deps = {})` precedence, in order: (1) the effective env (`opts.env || deps.env || process.env`) already has `GH_HOST` → return `opts` unchanged; (2) `deps.explicitHost || <recorded explicit host>` is set → return `{ ...opts, env: { ...base, GH_HOST: thatHost } }`, no stderr note; (3) explicit host arg → `opts`; (4) origin GHE resolution, unchanged.
- Produces: `_resetGhHostCache()` also clears the recorded explicit host.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/repo-resolve.test.js`, replacing the old `pinExplicitRepoHost` test (reuse the file's existing `ghe` and `dotcom` deps fixtures):

```js
test('AC1.1 (#4795): pinExplicitRepoHost records the host; ghOptions adds it to each call\'s own env and never touches process env', () => {
  _resetGhHostCache();
  const before = process.env.GH_HOST;
  const env = { PATH: '/p' };
  assert.equal(pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env }), 'github.com');
  assert.deepEqual(env, { PATH: '/p' }, 'the pin never writes the env it was handed');
  assert.strictEqual(process.env.GH_HOST, before, 'the pin never writes process.env');
  // a call with no host flag, and one naming --repo, both get the pinned host (Review Focus 2)
  for (const args of [['api', 'user'], ['issue', 'view', '7', '--repo', 'acme/widgets']]) {
    assert.equal(ghOptions(args, { cwd: '/r', env }, ghe).env.GH_HOST, 'github.com', args.join(' '));
  }
  // a call's own env without GH_HOST still gets it (Review Focus 3)
  assert.deepEqual(ghOptions(['api', 'user'], { env: { PATH: '/x' } }, ghe).env, { PATH: '/x', GH_HOST: 'github.com' });
});
test('#4795: a GH_HOST already in the call env beats the recorded pin, empty string included (Review Focus 1)', () => {
  _resetGhHostCache();
  pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env: {} });
  for (const own of [{ GH_HOST: 'mine.example' }, { GH_HOST: '' }]) {
    const opts = { cwd: '/r', env: own };
    assert.strictEqual(ghOptions(['api', 'user'], opts, ghe), opts, JSON.stringify(own));
  }
});
test('#4795: deps.explicitHost scopes the host to one call; _resetGhHostCache clears a recorded pin (Review Focus 5)', () => {
  _resetGhHostCache();
  assert.equal(ghOptions(['api', 'user'], { cwd: '/d' }, { ...dotcom, env: {}, explicitHost: 'github.com' }).env.GH_HOST, 'github.com');
  pinExplicitRepoHost({ host: 'other.ghe.com', owner: 'acme', repo: 'widgets' }, { ...dotcom, cwd: '/d', env: {} });
  _resetGhHostCache();
  const opts = { cwd: '/d', env: {} };
  assert.strictEqual(ghOptions(['api', 'user'], opts, dotcom), opts);
});
test('#4795: a --repo agreeing with the origin host records nothing, so origin injection continues (Review Focus 4)', () => {
  _resetGhHostCache();
  assert.equal(pinExplicitRepoHost({ host: 'acme.ghe.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env: {} }), null);
  assert.equal(ghOptions(['api', 'user'], { cwd: '/r', env: {} }, ghe).env.GH_HOST, 'acme.ghe.com');
  const mine = { GH_HOST: 'mine.example' };
  assert.equal(pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env: mine }), null);
  assert.deepEqual(mine, { GH_HOST: 'mine.example' });
});
```

(Adjust fixture names to whatever the file's `ghe`/`dotcom` deps already carry — e.g. a `stderr` sink — so the origin note does not reach the test output.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js`
Expected: FAIL — the first test's `assert.deepEqual(env, { PATH: '/p' })` fails because the current pin writes `GH_HOST` onto the env it was handed.

- [ ] **Step 3: Implement** the Interfaces above in `plugin/bin/lib/repo-resolve.js`: a module-level `let explicitRepoHost = null;`, set by `pinExplicitRepoHost`, read by `ghOptions` step (2), cleared by `_resetGhHostCache`. Rewrite the comments above `ghOptions` and `pinExplicitRepoHost` to describe the per-call env (drop "exports … as GH_HOST on `deps.env` (process.env)").

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js`
Expected: PASS

- [ ] **Step 5: Flip materialize's pin-lands assertion.** In `tests/materialize-premise-check.test.js`'s `#4505: the GH_HOST materialize pinned for --repo does not reach the Premise-check command` test, replace `assert.strictEqual(process.env.GH_HOST, 'acme.ghe.com', "the pin still lands for materialize's own gh calls");` with `assert.strictEqual(process.env.GH_HOST, undefined, 'the pin never touches process.env (#4795)');`. Rename the test to `#4795: materialize's --repo pin never reaches process.env, so the Premise-check command sees no GH_HOST`.

Run: `node --test tests/materialize-premise-check.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS (the behavior suite's `materialize.js --repo owner/name on a *.ghe.com origin sends every gh call to github.com` now passes through the per-call env).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js tests/bin-lib/repo-resolve.test.js tests/materialize-premise-check.test.js
git commit -m "Move the explicit --repo host pin onto ghOptions's per-call env — process.env is never written

refs #4795

Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

### Task 2: Delete materialize's env restore and the `env` option plumbed for it

**Role:** integration

**Files:**
- Modify: `plugin/bin/materialize.js:144-184` (delete `envBeforeGhHostPin`; `computePremise(command, deps)` loses its `pinnedGhHost` param and always calls `deps.runPremiseCheck(command, { cwd })`; `runPremiseCheckDefault(command, { cwd } = {})` drops `env`), `:383` (delete `let pinnedGhHost`), `:404` (`if (opts.repo && deps.pinGhHost) deps.pinGhHost(repoSpec);`), `:490` (`computePremise(premiseCommand, deps)`)
- Modify: `plugin/bin/lib/health-core/premise-self-check.js:26-42` (drop the `env` option from `defaultRunner` and the comment sentence citing materialize's pin)
- Test: `tests/bin-lib/health-core/premise-self-check.test.js:132-146` (delete the `#4505: defaultRunner passes an explicit env…` test; the no-env-key shape stays pinned by the test just above it at :127-128)
- Test: `tests/materialize-premise-check.test.js` (rename the exported-GH_HOST test — Step 1)

**Interfaces:**
- Consumes: Task 1's `pinExplicitRepoHost` (records, never writes `process.env`).
- Produces: `computePremise(command, deps) -> { command, exit, satisfiedAtBase } | null`; `runPremiseCheckDefault(command, { cwd } = {}) -> exit`; premise-self-check `defaultRunner(command, { cwd, timeoutMs, platform, exec }) -> exit`.

- [ ] **Step 1: Write the failing test.** In `tests/materialize-premise-check.test.js`, rename `"#4505: a user's own exported GH_HOST is never stripped from the Premise-check command"` to `"AC2.1 (#4795): materialize runs the Premise-check command with the user's environment — an exported GH_HOST survives it"` and add this test beside it:

```js
test('#4795: materialize no longer defines an env restore for the Premise-check command', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'materialize.js'), 'utf8');
  assert.doesNotMatch(src, /envBeforeGhHostPin|pinnedGhHost/);
});
```

(If `tests/` lint flags the raw `fs.readFileSync` of source text — `raw-markdown-read` covers markdown only — use `readText` from `tests/helpers/read-skill.js` instead.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/materialize-premise-check.test.js`
Expected: FAIL — `envBeforeGhHostPin` is still defined in `materialize.js`.

- [ ] **Step 3: Implement** the Files/Interfaces edits above in `plugin/bin/materialize.js` and `plugin/bin/lib/health-core/premise-self-check.js`; delete the premise-self-check env test. Rewrite `computePremise`'s header comment to drop the `pinnedGhHost` sentence.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/materialize-premise-check.test.js tests/bin-lib/health-core/premise-self-check.test.js tests/bin-lib/harness-health/cli-validate-findings.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/gh-host-seam-behavior.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/materialize.js plugin/bin/lib/health-core/premise-self-check.js tests/materialize-premise-check.test.js tests/bin-lib/health-core/premise-self-check.test.js
git commit -m "Delete materialize's GH_HOST env restore — the Premise-check command inherits the user's env as is

refs #4795

Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

### Task 3: Grant gate onto `ghOptions`'s `explicitHost`; pin one mechanism in the conformance suite

**Role:** integration

**Files:**
- Modify: `plugin/bin/backlog-grant-gate.js:101-110` — `runner: (args, o = {}, seam = {}) => execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', maxBuffer: LARGE_MAX_BUFFER_BYTES, ...o, windowsHide: true }, seam))`; `nativeRunnerFor: (repoSpec) => { const host = explicitRepoGhHost(repoSpec); return host ? (args) => realDeps.runner(args, {}, { explicitHost: host }) : null; }`; rewrite the `#4505` comment above it to say the host rides `ghOptions`'s per-call `explicitHost`.
- Test: `tests/gh-host-seam-conformance.test.js:290-308` (rewrite the PIN_WIRED comment; add the GH_HOST-construction scan)
- Test: `tests/gh-host-seam-behavior.test.js:237` (rename the materialize `*.ghe.com` test to cite AC1.1) and `:247-251` (rewrite the `nativeRunnerFor` comment to name `explicitHost`)

**Interfaces:**
- Consumes: Task 1's `ghOptions(args, opts, { explicitHost })`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test** in `tests/gh-host-seam-conformance.test.js`, after the PIN_WIRED test (reuse the file's existing `walk`, `BIN_ROOT`, `BLANK`, `readText`, `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES`):

```js
// #4795: an explicit --repo's host reaches gh one way only — ghOptions adds it to a
// call's own env (repo-resolve.js). A file that builds `GH_HOST: …` into an env or
// assigns `….GH_HOST = …` has grown a second mechanism. Blank mode, so a GH_HOST
// named in a message string or comment is not code.
const GH_HOST_BUILD = /\bGH_HOST\s*:(?!:)|\bGH_HOST\s*=(?!=)/;
function ghHostBuilders(raw) {
  const blank = stripComments(raw, BLANK);
  const verdict = stripperVerdict(raw, blank);
  if (verdict !== 'ok') return [STRIPPER_VERDICT_MESSAGES[verdict]];
  return blank.split('\n').map((l, i) => (GH_HOST_BUILD.test(l) ? `line ${i + 1}` : null)).filter(Boolean);
}
test('#4795: the matcher flags an env built or assigned with GH_HOST, and not a read or a message', () => {
  assert.equal(ghHostBuilders('const e = { ...process.env, GH_HOST: h };').length, 1);
  assert.equal(ghHostBuilders('process.env.GH_HOST = h;').length, 1);
  assert.equal(ghHostBuilders("const { GH_HOST: _p, ...env } = process.env;").length, 1);
  assert.deepEqual(ghHostBuilders("if ('GH_HOST' in base) x(); if (e.GH_HOST === h) y(); const m = 'GH_HOST: set';"), []);
});
test('AC3.1 (#4795): no file under plugin/bin but repo-resolve.js builds or assigns GH_HOST', () => {
  const offenders = [];
  for (const file of walk(BIN_ROOT)) {
    const rel = path.relative(BIN_ROOT, file).replace(/\\/g, '/');
    if (rel === 'lib/repo-resolve.js') continue;
    for (const where of ghHostBuilders(readText(file))) offenders.push(`${rel}: ${where}`);
  }
  assert.deepEqual(offenders, [], 'route the host through ghOptions (an explicit --repo: pinExplicitRepoHost, or deps.explicitHost for one call) instead of building GH_HOST by hand');
});
```

Rewrite the PIN_WIRED comment (:290-293) to: an explicit `--repo` records its host through `pinExplicitRepoHost`, which `ghOptions` adds to every later gh call's own env (process.env is never written); each CLI wires it by hand (`pinGhHost` in realDeps plus a `deps.pinGhHost(…)` call in run()), and a caller scoping the host to some calls passes `ghOptions`'s `deps.explicitHost` instead (backlog-grant-gate.js). Keep the roster and its assertions unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/gh-host-seam-conformance.test.js`
Expected: FAIL — `AC3.1` reports `backlog-grant-gate.js: line 109` (`GH_HOST: host`). (After Task 2, `materialize.js`'s destructure is already gone; on the pre-Task-2 base it would also report `materialize.js: line 158`.)

- [ ] **Step 3: Implement** the `backlog-grant-gate.js` edit in Files above; rename/re-comment the two behavior-suite spots.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS (the behavior suite's two `backlog-grant-gate.js` cases — native calls to github.com, issue lists to the origin host, an exported GH_HOST on every call — still pass).

Also run: `grep -rF "pinExplicitRepoHost" plugin/bin`
Expected: only `lib/repo-resolve.js` (definition + export) and the 11 PIN_WIRED files' `require`/`realDeps` lines — one mechanism (AC3.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/backlog-grant-gate.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Route backlog-grant-gate's native host through ghOptions's explicitHost — pin one host mechanism in the conformance suite

refs #4795

Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

### Task 4: Describe the one mechanism in the skill and structure doc

**Role:** integration

**Files:**
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md:16` — rewrite the explicit-`--repo` bullet: keep the Decision Q2 reason, the `pinGhHost`/`deps.pinGhHost(repoSpec)`/`PIN_WIRED` wiring; replace "A pinned `GH_HOST` is process-global … unifying the two is open." with: `pinExplicitRepoHost` records the host in `repo-resolve.js` and `ghOptions` adds it as `GH_HOST` to each later gh call's own env — `process.env` is never written, so a record-authored shell command the CLI runs inherits the user's environment unchanged; a caller that must scope the host to some calls only passes it as `ghOptions(args, opts, { explicitHost })` (`plugin/bin/backlog-grant-gate.js`'s `nativeRunnerFor`, whose issue lists read cwd's repo); `tests/gh-host-seam-conformance.test.js` fails on any `plugin/bin` file but `repo-resolve.js` that builds or assigns `GH_HOST` itself (#4795).
- Modify: `docs/plugin-structure.md:19` — in the repo-resolve sentence, after "pins that repo's host for all its gh calls through `pinExplicitRepoHost`", add "(recorded in the module, added by `ghOptions` to each call's own env — process.env is never written; one call takes it as `ghOptions`'s `deps.explicitHost`)".

**Interfaces:** none.

- [ ] **Step 1: Write the failing check** (scratch, not committed):

Run: `grep -nF "unifying the two is open" .claude/skills/gh-api-module-pattern/SKILL.md`
Expected: FAIL for this task's purpose — the line matches (exit 0), i.e. the stale sentence is still present.

- [ ] **Step 2: Apply both edits** above.

- [ ] **Step 3: Sweep for stale phrasings**

Run: `git grep -n -i -e envBeforeGhHostPin -e pinnedGhHost -e "GH_HOST it pinned" -e "exports explicitRepoGhHost" -e "unifying the two is open" -e "pinned .GH_HOST. is process-global" -- . ':!.claude-tweaks/pipelines' ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md' ':!CHANGELOG.md'`
Expected: no output (exit 1). Control (run at plan time against base `770624963`, exclusions added per #4579): the same command on the base tree matched `.claude/skills/gh-api-module-pattern/SKILL.md:16`, `plugin/bin/lib/health-core/premise-self-check.js:34`, `plugin/bin/lib/repo-resolve.js:244` and seven `plugin/bin/materialize.js` lines (157, 172, 174, 180, 383, 404, 490).

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gh-api-module-pattern/SKILL.md docs/plugin-structure.md
git commit -m "Describe the one explicit --repo host seam — gh-api-module-pattern and plugin-structure

refs #4795

Claude-Session: https://claude.ai/code/session_016yg3zoN7tBVHYZNM7N7Wbd"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 — pick one mechanism, migrate all 12 CLIs | Decision section; Task 1 (11 PIN_WIRED CLIs via `pinExplicitRepoHost`), Task 2 (materialize), Task 3 (grant gate) |
| Deliverable 2 — delete the other mechanism and `envBeforeGhHostPin` | Task 1 (process-env write), Task 2 (restore + `env` plumbing), Task 3 (hand-built GH_HOST env) |
| Deliverable 3 — `PIN_WIRED` + skill bullet | Task 3 (PIN_WIRED comment + scan), Task 4 (skill) |
| AC1.1 | Task 1 test `AC1.1 (#4795)` (recording via `ghOptions`), Task 3 renamed behavior test (stub `gh` records GH_HOST + argv for materialize's issue view and its host-flagless author-association call) |
| AC2.1 | Task 2 test `AC2.1 (#4795)` |
| AC3.1 | Task 3 test `AC3.1 (#4795)` + Step 4 grep |
