# Repo-Target Consolidation (#5109) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plugin/bin/claim-targets.js` and `plugin/bin/stale-claim-pr.js` resolve their origin's repo target through one shared helper in `plugin/bin/lib/hooks/git-exec.js`, with the unparseable-remote fallback written once, and each CLI keeps its exit codes.

**Architecture:** Split a pure core that takes a remote URL out of `repoSpecOf`/`repoTargetOf`: `repoSpecOfRemote(remote, gateDeps, { loose })` and `repoTargetOfRemote(remote, gateDeps, { loose })`. The two existing exports become "read origin with runGit, then call the core", so their return shapes do not change. Both CLIs keep their own injectable origin readers (`deps.remoteUrl`, `originUrl(process.cwd())`), pass the URL to `repoTargetOfRemote`, and stop calling `gateOriginRepo` themselves. The loose `[:/]owner/repo(.git)?$` fallback lives only in `repoSpecOfRemote`. A caller whose verdict a github.com guess could falsify turns it off with `{ loose: false }`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T153400-spec-5103-5109/spec-5109/work/5109-spec.md`

**Scope keywords:** gateOriginRepo, repoTargetOf, repoTargetOfRemote, repoSpecOf, repoSpecOfRemote, resolveRepoTarget, resolveGhHost, gateOrigin, resolveTarget, ORIGIN_GATED

## Premise decisions

1. **stale-claim-pr.js keeps exit 3 on a remote the gate cannot read, so it calls the helper with `{ loose: false }`.** Unifying the fallback outright would change behavior. Today a cloud sandbox proxy remote (`http://local_proxy@127.0.0.1:43215/git/acme/w`) exits 3 naming `--repo host/owner/name`. With the loose fallback on, it would list and match on github.com. On a GHE sandbox-proxy origin that is a false no-match, and a false no-match makes a live run's stale claim look abandoned. Two existing tests pin the exit 3: `tests/stale-claim-pr-cli.test.js:466` ("a cloud sandbox proxy remote is not an origin the gate reads: exit 3 naming --repo, nothing called") and `:476` (the exact stderr hint). `:345` (`'not a url'` exits 3) holds either way, because the loose regex needs a `/`. So the fallback still exists once, in the helper, and stale-claim-pr deliberately turns it off. Its exit-code contract (1 / 2 / 3, and a refusal as `unknown-host:` at exit 0) is unchanged.
2. **claim-targets.js uses the default `{ loose: true }`, and nothing it can observe changes.** run() reads only `gate.refusal` and `gate.spec.host` (`plugin/bin/lib/claim-targets/claim-targets.js:341-345` and `:391`, grep below). Owner/repo still come from `gh repo view`.
   - Today, a proxy remote gives `gate.spec === null`. That sends `repoTarget` to `resolveGhHost(process.cwd())`, which parses the same origin with the same `originSpecOf` read, gets nothing, and returns `null`. The host then resolves to `GH_HOST || 'github.com'`.
   - After this change, `gate.spec.host` is `repoTargetOfRemote`'s resolved host, which is the same `GH_HOST || 'github.com'`. The second origin read also disappears, which is the split-read hazard ledger row 28 of `docs/plans/2026-11-01-host-qualified-repo-slug-ledger.md` fixed for the admitted case.
   - Passing a resolved host back into `resolveRepoTarget` as `originHost` returns the same result: `explicit || GH_HOST || originHost || github.com`, where originHost already equals `GH_HOST || gatedHost || github.com`.
   - `resolveGhHost(process.cwd())` stays in `realDeps.repoTarget`, but now it only handles an origin that was **never read** (`originUrl` threw or timed out, so the helper returned `null`). There it is the host the `defaultGh` seam's own memoized read gave `gh repo view`. It is no longer a fallback for an unparseable remote. Exit 2 (`unknown-host`) on a refusal is unchanged.
3. **One roster must change, and it is a conformance roster, not a CLI test.** `tests/gh-host-seam-conformance.test.js`'s `ORIGIN_GATED` (line 410-412, AC9.3) lists exactly the files that call `gateOriginRepo(`. AC1.1 requires removing that call from both CLIs, so `claim-targets.js` and `stale-claim-pr.js` come off the roster. `lib/hooks/git-exec.js` stays on it. The CLI suites named by AC2.1 stay byte-unchanged: `tests/stale-claim-pr-cli.test.js`, `tests/bin-lib/claim-targets/cli.test.js` and `tests/bin-lib/claim-targets/claim-targets.test.js`.

Proving greps (run 2026-11-16 at 40554976dc):
- `grep -n "gateOriginRepo(" plugin/bin/claim-targets.js plugin/bin/stale-claim-pr.js` → `claim-targets.js:57: return gateOriginRepo(remote);` and `stale-claim-pr.js:197: const gated = gateOriginRepo(remote, gateDeps);`. This is the absence-grep control for AC1.1: it matches on the pre-change tree. Its paths are named and lie outside `.claude-tweaks/` and `docs/`, so no exclusions are needed.
- `grep -n "gateOrigin\|repoTarget\|gateHost" plugin/bin/lib/claim-targets/claim-targets.js` → lines 341, 342 (`gate.refusal`), 390-391 (`gate.spec.host`), 586, 629 (`repoTarget.host`, `repoTarget`). No other field of `gate.spec` is read.
- `git grep -n -E "repoTargetOf|repoSpecOf" -- plugin/bin` callers that keep today's shapes: `lib/reconcile/{reap-merged,archive-branches,post-merge,pr-state,prune-remote,archive-merged,release-merged}.js`, `lib/hooks/{teardown-run,sibling-sessions}.js`, `lib/pr-checks/ready-run.js`. They are all pick-one consumers of an unchanged return value.

## Global Constraints

- The spec's two deliverables, verbatim: "Make `claim-targets.js` and `stale-claim-pr.js` resolve their repo target through one shared helper (`repoTargetOf` or a successor), with a single deliberate fallback for an unparseable remote." and "Keep each CLI's existing exit-code contract for a refused or unresolvable origin."
- Release Note: "No user-visible change."
- `repoTargetOf` and `repoSpecOf` keep their exact return shapes. `tests/hooks-git-exec.test.js:431-577` deep-equal-pins them. The new functions are additive exports. No existing return shape is widened.
- No comment in `plugin/bin/claim-targets.js` or `plugin/bin/stale-claim-pr.js` may contain the text `gateOriginRepo(`, because the AC1.1 grep reads comments too. Write the gate as `gateOriginRepo` with no paren.
- Commit style: `{Verb} {what} — {detail}`, and end with `Claude-Session: https://claude.ai/code/session_016yg3zpwNfJinjheX8Wcoan`.
- Governing project skill `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted verbatim:
  - "an origin-derived repo goes through `repo-resolve.js`'s `gateOriginRepo(remote, deps)`, which returns a refusal, never a spec for gh, for an origin host with no positive signal (github.com, `*.ghe.com`, a `hosts.yml` key), and any non-empty exported `GH_HOST` stops the refusal"
  - "A CLI that gates its origin this way joins both `ORIGIN_GATED` in `tests/gh-host-seam-conformance.test.js` and a `CLI_TABLE` row in `tests/helpers/gh-host-seam.js` … A CLI whose refusal is not exit 2 with the gate's text on stderr takes bespoke behavior tests in `tests/gh-host-seam-behavior.test.js` instead of a `CLI_TABLE` row"
  - "A command that both calls `gh` and compares a host takes the two from one `resolveRepoTarget` result (`repo-resolve.js`), never from two separately derived values."
  - "Its host comes only from the gate (or an exported `GH_HOST`), so an unknown host or an SSH alias comes back `{ refusal }`, which the caller reports as `unknown-host` with the refusal text and never sends to gh bare."
- Other project skills checked, and why they do not apply:
  - `bin-source-scan-conformance` covers adding or changing a source scan. This plan only edits a roster array inside an existing one, and adds no matcher.
  - `windows-checkout-test-parity`: no path, CRLF or spawn is involved. The trim in Task 1 handles `\r\n` as well as `\n`.
  - `git-seam.md`: no new git call. The existing `runGit(['remote','get-url','origin'])` is reused.
- Source-scan lint: no new `fs`, `child_process` or `GH_HOST` token is added under `plugin/bin`.

## Review Focus

1. **A remote with a trailing newline.** The real `remoteUrl()` (`repo-resolve.js:61`) and `originUrl()` (`:117`) return untrimmed `execFileSync` stdout. Without a trim, the loose regex reads repo `w\n`, because JS `$` matches only at the end of input. Task 1 pins that `…/acme/w\n` → repo `w`.
2. **A proxy remote with `GH_HOST` exported, in stale-claim-pr.** `{ loose: false }` must return `null` whatever `GH_HOST` says, so the exit 3 holds. Today's code exits 3 there because the gate returns no spec. Task 1 pins the helper half.
3. **claim-targets on a proxy remote.** It must still take its repo from `gh repo view`, list on github.com with today's bare argv, and inject no `GH_HOST`. Task 3 adds a behavior test.
4. **An origin read that throws.** stale-claim-pr exits 3 (existing test `tests/stale-claim-pr-cli.test.js:341`). For claim-targets the gate is `{ spec: null, refusal: null }` and `resolveGhHost` decides the host, as today.
5. **A degenerate remote** (`null`, `undefined`, `''`, whitespace, `'not a url'`) is `null` from both cores and never throws. Task 1 pins it.

---

### Task 1: The remote-taking core in git-exec.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-exec.js:205-242` (repoSpecOf, repoTargetOf, module.exports)
- Test: `tests/hooks-git-exec.test.js` (import line 10-12; append a test after line 577)

**Interfaces:**
- Produces: `repoSpecOfRemote(remote: string|null|undefined, gateDeps?: object, opts?: { loose?: boolean }) -> null | { refusal: string } | { host: string|null, owner: string, repo: string }`.
- Produces: `repoTargetOfRemote(remote, gateDeps?, opts?: { loose?: boolean }) -> null | { refusal: string } | { owner, repo, slug, host, ghRepo }`. This is the same shape `repoTargetOf` returns.
- `loose` defaults to `true`. With `false`, a remote that `gateOriginRepo` neither admits nor refuses is `null`.
- `repoSpecOf(repoRoot, gateDeps)` and `repoTargetOf(repoRoot, gateDeps)` keep their signatures and shapes. Each reads origin with `runGit(['remote','get-url','origin'], repoRoot)` (a failure or empty stdout → `null`) and calls its `*Remote` twin.

- [ ] **Step 1: Write the failing test**

Add `repoSpecOfRemote, repoTargetOfRemote` to the destructured import at line 10-12. Append one test:

```js
// #5109: the remote-taking core both CLIs call. repoTargetOf(root) is "read origin, then this".
test('AC1.2 (#5109): repoTargetOfRemote is repoTargetOf on a URL; the loose fallback trims, and { loose: false } turns it off', () => {
  const none = () => { throw new Error('none'); };
  const deps = (env = {}) => ({ env, readFile: none });
  const PROXY = 'http://local_proxy@127.0.0.1:43215/git/acme/widgets';
  const repo = gitRepo();
  fixtureGit(['-C', repo, 'remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
  for (const url of ['https://github.com/acme/widgets.git', 'git@acme.ghe.com:acme/widgets.git',
    'https://ghe.example.com/acme/widgets.git', 'git@github-work:acme/widgets.git', PROXY]) {
    fixtureGit(['-C', repo, 'remote', 'set-url', 'origin', url]);
    for (const env of [{}, { GH_HOST: 'mine.example' }]) {
      assert.deepStrictEqual(repoTargetOfRemote(url, deps(env)), repoTargetOf(repo, deps(env)), `${url} ${JSON.stringify(env)}`);
      assert.deepStrictEqual(repoSpecOfRemote(url, deps(env)), repoSpecOf(repo, deps(env)), `${url} ${JSON.stringify(env)}`);
    }
  }
  // Review Focus 1: the real origin readers return untrimmed stdout.
  assert.deepStrictEqual(repoTargetOfRemote(`${PROXY}\n`, deps()),
    { owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'github.com', ghRepo: 'acme/widgets' });
  assert.deepStrictEqual(repoSpecOfRemote(`${PROXY}\r\n`, deps()), { host: null, owner: 'acme', repo: 'widgets' });
  // Review Focus 2: { loose: false } is null for a remote the gate cannot read, GH_HOST or not ...
  assert.strictEqual(repoTargetOfRemote(PROXY, deps(), { loose: false }), null);
  assert.strictEqual(repoTargetOfRemote(PROXY, deps({ GH_HOST: 'mine.example' }), { loose: false }), null);
  assert.strictEqual(repoSpecOfRemote(PROXY, deps(), { loose: false }), null);
  // ... and changes nothing the gate decides.
  assert.deepStrictEqual(repoTargetOfRemote('https://acme.ghe.com/acme/widgets.git\n', deps(), { loose: false }),
    { owner: 'acme', repo: 'widgets', slug: 'acme/widgets', host: 'acme.ghe.com', ghRepo: 'acme.ghe.com/acme/widgets' });
  assert.deepStrictEqual(repoTargetOfRemote('git@github-work:acme/widgets.git', deps(), { loose: false }),
    { refusal: gateOriginRepo('git@github-work:acme/widgets.git', deps()).refusal });
  // Review Focus 5: degenerate remotes are null, never a throw.
  for (const r of [null, undefined, '', '   \n', 'not a url']) {
    assert.strictEqual(repoTargetOfRemote(r, deps()), null, JSON.stringify(r));
    assert.strictEqual(repoSpecOfRemote(r, deps()), null, JSON.stringify(r));
  }
});
```

Discrimination:
- Deleting the trim makes the `\n`/`\r\n` assertions red, because repo becomes `widgets\n`.
- Ignoring `loose` makes the three `null` assertions red.
- Each `null` case under `loose: false` uses a remote that is a target under `loose: true` (as the equivalence loop shows), so only the `loose` guard decides it.

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "if (typeof require('./plugin/bin/lib/hooks/git-exec').repoTargetOfRemote !== 'function') { console.error('Error: repoTargetOfRemote is not exported'); process.exit(1); }" && node --test --test-name-pattern "repoTargetOfRemote" tests/hooks-git-exec.test.js`
Expected: FAIL with "Error: repoTargetOfRemote is not exported" (after Step 1 alone, the test itself fails with `TypeError: repoTargetOfRemote is not a function`)

- [ ] **Step 3: Implement `repoSpecOfRemote` and `repoTargetOfRemote` in `plugin/bin/lib/hooks/git-exec.js`**

- Move today's `repoSpecOf` body below its runGit read into `repoSpecOfRemote`, which starts from `String(remote == null ? '' : remote).trim()`, so an empty result is `null`.
- Return `null` before the loose regex when `opts.loose === false`.
- Keep the #4857 comment on the regex, which stays the only copy of it.
- `repoTargetOfRemote` is today's `repoTargetOf` body over `repoSpecOfRemote(remote, gateDeps, opts)`.
- `repoSpecOf` and `repoTargetOf` become the runGit read plus a call to their twin.
- Add both names to `module.exports`.
- Update the two header comments so they name the remote-taking core and the `loose` opt-out.

- [ ] **Step 4: Run tests to verify they pass, callers included**

Run: `node --test tests/hooks-git-exec.test.js tests/hooks-teardown-run.test.js tests/bin-lib/reconcile/pr-state.test.js tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/reconcile/prune-remote.test.js tests/bin-lib/reconcile/archive-branches.test.js`
Expected: PASS, 0 failing

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/git-exec.js tests/hooks-git-exec.test.js
git commit -m "Factor repoTargetOfRemote out of repoTargetOf — one remote-taking core with the loose fallback and a { loose: false } opt-out (#5109)"
```

### Task 2: stale-claim-pr.js resolves its origin through repoTargetOfRemote

**Role:** integration

**Files:**
- Modify: `plugin/bin/stale-claim-pr.js` (header comment lines 51-56 and 64-65, the require at line 76, resolveTarget at lines 182-202)
- Modify: `tests/gh-host-seam-conformance.test.js:410-412` (drop `'stale-claim-pr.js'` from `ORIGIN_GATED`)
- Modify: `tests/gh-host-seam-behavior.test.js:584` (comment only: it says the CLI "calls the gate directly (no repo-resolve helper in between)"; make it name `repoTargetOfRemote` with `{ loose: false }`)
- Test, unchanged (AC2.1): `tests/stale-claim-pr-cli.test.js`

**Interfaces:**
- Consumes: `repoTargetOfRemote(remote, gateDeps, { loose: false })` from Task 1.
- Produces: `resolveTarget(opts, deps)` keeps its result shapes: `{ owner, repo, target: { host, ghRepo } }`, `{ refusal }`, `{ target: null }`.

- [ ] **Step 1: Update the roster**

In `ORIGIN_GATED` remove `'stale-claim-pr.js'`. Leave `'lib/hooks/git-exec.js'`. Edit the line-584 comment in `tests/gh-host-seam-behavior.test.js` as named above.

- [ ] **Step 2: Run test to verify it fails**

Run: `! grep -q "gateOriginRepo(" plugin/bin/stale-claim-pr.js && node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-conformance.test.js`
Expected: FAIL (the grep finds `stale-claim-pr.js:197`. After Step 1 the AC9.3 test also fails with "a file calls gateOriginRepo that ORIGIN_GATED does not list")

- [ ] **Step 3: Route resolveTarget's origin branch through `repoTargetOfRemote(remote, gateDeps, { loose: false })`**

- Keep the `try { remote = deps.remoteUrl(); } catch { remote = null; }` read, and `gateDeps = deps.gateDeps || {}`.
- `null` → `{ target: null }`; `{ refusal }` → `{ refusal }`; otherwise `{ owner, repo, target: { host, ghRepo } }` from the target.
- Require `repoTargetOfRemote` from `./lib/hooks/git-exec`, and drop `gateOriginRepo` from the `./lib/repo-resolve` require. `resolveRepoTarget` stays, for the `--repo` branch.
- Rewrite the header lines 51-56 and 64-65, and the resolveTarget comment. They should say: the origin goes through git-exec.js's `repoTargetOfRemote` (the #4933 gate), with its unparseable-remote fallback off, so a remote the gate cannot read (the cloud sandbox proxy remote) is exit 3 rather than a github.com guess. Do not write `gateOriginRepo(` with a paren.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/stale-claim-pr-cli.test.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js tests/issue-claims-stale-open-pr-conformance.test.js tests/tidy-stale-claim-open-pr-conformance.test.js`
Expected: PASS, 0 failing

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/stale-claim-pr.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js
git commit -m "Route stale-claim-pr's origin through repoTargetOfRemote — loose fallback off keeps exit 3 on a proxy remote (#5109)"
```

### Task 3: claim-targets.js gates its origin through repoTargetOfRemote

**Role:** integration

**Files:**
- Modify: `plugin/bin/claim-targets.js:28-30` (require), `:52-68` (realDeps.gateOrigin, realDeps.repoTarget comment)
- Modify: `tests/gh-host-seam-conformance.test.js:410-412` (drop `'claim-targets.js'` from `ORIGIN_GATED`)
- Modify: `tests/gh-host-seam-behavior.test.js:521-522` (comment: it "joins ORIGIN_GATED"; make it name `repoTargetOfRemote`), and add one test after line 582
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (line 17's `ORIGIN_GATED` sentence and line 68's `repoSpecOf` sentence)
- Test, unchanged (AC2.1): `tests/bin-lib/claim-targets/cli.test.js`, `tests/bin-lib/claim-targets/claim-targets.test.js`
- Read only, not modified: `plugin/bin/lib/claim-targets/claim-targets.js`, by the Premise grep above. run() reads `gate.refusal` and `gate.spec.host` alone, and its `deps.gateOrigin`/`deps.repoTarget` contract is unchanged.

**Interfaces:**
- Consumes: `repoTargetOfRemote(remote)` from Task 1 (default `loose: true`, no gateDeps).
- Produces: `realDeps.gateOrigin() -> { spec: { host, owner, repo } | null, refusal: string | null }`, the shape run() reads today. `spec.host` is the target's resolved host. `realDeps.repoTarget(owner, repo, gateHost)` is unchanged: `resolveRepoTarget({ owner, repo, originHost: gateHost || resolveGhHost(process.cwd()) })`.

- [ ] **Step 1: Update the roster and add the proxy-remote behavior test**

- Remove `'claim-targets.js'` from `ORIGIN_GATED`.
- Edit the 521-522 comment.
- After the `#4794: claim-targets.js on an unknown or SSH-alias origin …` test, add the test below. It is a characterization pin for Premise decision 2, and it passes before and after the change. The Step 2 grep supplies the red.

```js
test('#5109: claim-targets.js on a cloud sandbox proxy origin takes its repo from gh repo view and lists on github.com bare', { skip: STUB_SKIP }, (t) => {
  const r = runGated(t, claimTargetsRow('github.com'), { origin: 'http://local_proxy@127.0.0.1:43215/git/acme/widgets' });
  assert.equal(r.status, 3, `expected exit 3 (in flight); stderr:\n${r.stderr}`);
  for (const line of r.lines) assert.ok(line.startsWith('GH_HOST=unset '), `GH_HOST injected on a proxy origin: ${line}`);
  assert.deepEqual(r.lines.filter((l) => / ARGS=pr list /.test(l)).map(argsOf), [CT_PR_LIST_ARGV]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `! grep -q "gateOriginRepo(" plugin/bin/claim-targets.js && node --test tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js tests/bin-lib/claim-targets/cli.test.js tests/bin-lib/claim-targets/claim-targets.test.js`
Expected: FAIL (the grep finds `claim-targets.js:57`. After Step 1, AC9.3 also fails with "a file calls gateOriginRepo that ORIGIN_GATED does not list")

- [ ] **Step 3: Rewrite `realDeps.gateOrigin` over `repoTargetOfRemote`**

- Keep `let remote = null; try { remote = originUrl(process.cwd()); } catch { remote = null; }`.
- Then `const t = repoTargetOfRemote(remote)`: `null` → `{ spec: null, refusal: null }`; `t.refusal` → `{ spec: null, refusal: t.refusal }`; otherwise `{ spec: { host: t.host, owner: t.owner, repo: t.repo }, refusal: null }`.
- Require `repoTargetOfRemote` from `./lib/hooks/git-exec`, and drop `gateOriginRepo` from the `./lib/repo-resolve` require.
- Rewrite the `gateOrigin`/`repoTarget` comments to say `resolveGhHost` is now the fallback only for an origin that was never read. That is the host the `defaultGh` seam's memoized read gave `gh repo view`. A remote the gate cannot read gets the helper's one loose fallback, and its host there is `GH_HOST` or github.com, as `resolveGhHost`'s null gave before.

- [ ] **Step 4: Update the governing skill's prose**

In `.claude/skills/gh-api-module-pattern/SKILL.md`:
- Line 17: after "joins both `ORIGIN_GATED` …", add that a CLI reaching the gate through `git-exec.js`'s `repoTargetOf`/`repoTargetOfRemote` calls no `gateOriginRepo(` itself, so it is not on that roster (`claim-targets.js`, `stale-claim-pr.js`, #5109).
- Line 68: after the `repoSpecOf(repoRoot)` sentence, add one sentence. A CLI that reads its origin through its own injectable reader passes the URL to `repoSpecOfRemote`/`repoTargetOfRemote(remote, gateDeps, { loose })`, the same composition. `{ loose: false }` turns the unparseable-remote fallback off for a caller that a github.com guess could falsify: `stale-claim-pr.js` exits 3 instead (#5109).

- [ ] **Step 5: Run tests to verify they pass, and the acceptance checks**

Run: `node --test tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js tests/gh-host-seam-behavior-origin-gate.test.js tests/bin-lib/claim-targets/cli.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/claims-single-write-path.test.js tests/flow-claim-preflight.test.js`
Expected: PASS, 0 failing

Run (AC1.1): `grep -n "gateOriginRepo(" plugin/bin/claim-targets.js plugin/bin/stale-claim-pr.js`
Expected: no output, exit 1. Its control matched lines 57 and 197 on 40554976dc (Premise greps).

Run (AC2.1): `git diff --exit-code 40554976dc -- tests/stale-claim-pr-cli.test.js tests/bin-lib/claim-targets/ tests/hooks-git-exec.test.js`
Expected: output only for `tests/hooks-git-exec.test.js`, which gains Task 1's appended test and its import. The two CLI test paths print nothing.

Run: `npm test`
Expected: PASS, 0 failing (impact-selected; CI runs the full suite)

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/claim-targets.js tests/gh-host-seam-conformance.test.js tests/gh-host-seam-behavior.test.js .claude/skills/gh-api-module-pattern/SKILL.md
git commit -m "Gate claim-targets' origin through repoTargetOfRemote — one loose fallback, resolveGhHost only for an unread origin (#5109)"
```

## Acceptance coverage map

| Clause | Covered by |
|---|---|
| AC1.1 `grep -n "gateOriginRepo(" …` finds no direct calls | Task 2 Step 2, Task 3 Step 2 (red), Task 3 Step 5 (absence grep, control recorded) |
| AC1.2 both route through the shared helper | Task 1 test `AC1.2 (#5109): repoTargetOfRemote …`; Task 2 Step 3 / Task 3 Step 3; AC9.3 roster test |
| AC2.1 existing claim-targets and stale-claim-pr CLI tests pass unchanged | Task 2 Step 4, Task 3 Step 5 (`git diff --exit-code` over the CLI suites, plus their runs) |
