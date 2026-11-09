# gh Host Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `gh` spawn under `plugin/bin/` sends its call to the `origin` remote's GitHub Enterprise host (via `GH_HOST` in the child env) without the user exporting `GH_HOST`, and a conformance scan keeps new call sites from regressing.

**Architecture:** Extend `plugin/bin/lib/repo-resolve.js` with an options transform, `ghOptions(args, opts)`, that resolves `origin`'s host once per process per working directory and, when that host is a known GitHub Enterprise host, the env carries no `GH_HOST`, and `args` carry no explicit `-R`/`--repo`/`--hostname`, returns a copy of `opts` whose `env` carries `GH_HOST`. Otherwise it returns `opts` itself, unchanged. Every `gh` spawn site wraps its options argument in `ghOptions(...)` (the planned `ghExecFileSync` helper was deleted in the final review; see Spec premise notes). A transform, not a runner, because the sites spawn through many different runners: `execFileSync`, `execFileSyncTimed` (required inside `lib/reconcile/`), injected `deps.execFile`, and promisified `execFile`. A source-scan test then requires `ghOptions` in the argument text of every call that passes a `'gh'` literal.

**Tech Stack:** Node 18+ CommonJS, `node:child_process`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T023437-record-4505/work/4505-spec.md` (record #4505, re-materialized with the plan-review Decisions; the earlier run's copy at `2026-10-31T181133-record-4505` predates them)

## Global Constraints

- Explicit `-R`/`--repo`/`--hostname` args still win (spec Deliverable 1). Verbatim from the record's plan-review decision (Q2, Reading A): "Any explicit `-R`/`--repo`/`--hostname` suppresses injection; a bare `owner/repo` slug means github.com, per `repoSlug`'s contract." So `ghOptions` injects nothing when `args` carry any of those flags, whatever value they name, including one that agrees with origin's host.
- Verbatim from the record's plan-review decision (Q1, Reading B): "`GH_HOST` is injected only for a known GitHub host: one ending in `.ghe.com`, one listed in gh's `hosts.yml`, or any host when an enterprise-token env var is set. SSH host aliases such as `github-work` get no injection."
- Verbatim from the record's closing decision: "Any further edge case the plan reviewer finds in these areas is the implementer's judgment, not a needs-human gap: the plan records the chosen behaviour, and the review step checks it. Plan review stops the build only for a gap that contradicts an Acceptance Criterion or a decision above."
- The seam carries the existing `GH_TIMEOUT_MS` bound and `windowsHide` (spec Deliverable 1). `ghExecFileSync` sets both (deleted in the final whole-branch review, see Spec premise notes). `ghOptions` is a transform that keeps each site's own `timeout` and `windowsHide` untouched and adds neither (see Spec premise notes for why), so a wrapped site stays bounded exactly as it is today. `GH_TIMEOUT_MS` is a lazy getter on `plugin/bin/lib/shared-primitives.js`. Read it at call time (`sharedPrimitives.GH_TIMEOUT_MS`), never destructure it at module load, never retype `5000`.
- On a github.com origin, `gh` argument lists and child env are unchanged: no `GH_HOST` is injected (AC2). `ghOptions` returns the **same object** it was given whenever it injects nothing, so existing `deepStrictEqual`/identity pins on options still hold.
- An exported `GH_HOST` set by the user is never overwritten (AC4). The check is "the key is present in the effective env" (`'GH_HOST' in base`), so an exported empty string also counts as set.
- Do not resolve the host by running `git remote get-url origin` from the hook hot path on every call. Memoize per process, and fall back to "no host" (github.com) when `origin` is absent (spec Gotcha).
- `GH_HOST` changes which host `gh auth` checks. Log `repoResolutionNote` once per process per host, so a wrong derivation is visible (spec Gotcha).
- Migrate each call site surgically. Wrap only its existing options object, and keep that site's own `timeout`, `stdio`, `maxBuffer`, `input` and `cwd` as they are. A site with no `timeout` today keeps none, because adding a bound to a bulk call is a behavior change outside this record.
- Verbatim from `.claude/skills/gh-api-module-pattern/SKILL.md`: "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.** The scan reads each `child_process` call's own argument text: it accepts a literal `windowsHide` key there, or a bare identifier as the whole options argument whose own `const X = { … }` literal names it (`plugin/bin/lib/policy-schema.js`'s `execOpts`). A spread — `{ ...QUIET, timeout }` with the flag inside `QUIET` — satisfies neither and fails the full suite". Wrapping keeps the literal inside the call text, as in `execFileSync('gh', args, ghOptions(args, { …, windowsHide: true }))`, which the windows-hide scan accepts. A site whose options are a bare identifier (`policy-schema.js`'s `execOpts`) must keep `windowsHide` visible inside the call text after wrapping, so write `ghOptions(args, execOpts)` only if the scan still accepts it. Otherwise spell `windowsHide: true` in the call.
- Verbatim from the same skill: "**Inside `plugin/bin/lib/reconcile/`, a runner spawns through `timing.js`'s `execFileSyncTimed` / `execFileAsyncTimed`, never `child_process` directly.**" Reconcile sites become `execFileSyncTimed('gh', args, ghOptions(args, {…}))`. `repo-resolve.js` is outside `lib/reconcile/`, so its own `git` probe may use `execFileSync`.
- Verbatim from the same skill: "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**"
- Verbatim from `.claude/skills/bin-source-scan-conformance/SKILL.md`: "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." / "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." / "For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree … Set the floor to the count at the time the scan lands." / "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." / "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`" / "use the manual `withFileTypes` walk … and a floor on files walked" / "Include negative cases: the convention's token inside a comment; a message string that contains the command" / "Assert the exact flagged line numbers, not just a count".
- Commit style: `{Verb} {what} — {detail}`, with `refs #4505` in the body. Never write `closes`/`fixes`.

## Review Focus

- **An SSH host alias as origin** (`git@github-work:acme/widgets.git`, `git@github.com-work:acme/widgets.git`). `parseRepo` reads the alias as a non-github.com host. Injecting it as `GH_HOST` would make gh refuse every remote-inferring command ("none of the git remotes … correspond to the GH_HOST environment variable"), so every gh call in the plugin would break for alias users, not only the #2538 sites. Expected behavior: inject only for a *known* GitHub host. That means the host is a top-level key of gh's `hosts.yml`, or ends in `.ghe.com`, or `GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` is set. Pinned in Task 1.
- **An explicit `-R` naming another repo on a GHE origin.** `file-feedback.js` files to the upstream github.com repo, and `engine-verify.js`'s `upstream-feedback` check reads one. Injecting the origin host would send those calls to the wrong host. Expected (Decision Q2): any `-R`/`--repo`/`--hostname` suppresses injection, so nothing is injected. Pinned in Task 1.
- **A GraphQL call that binds `-f owner=…` / `-f repo=…` variables** (`engine-verify.js`'s acceptance-labeling query, `compose-subject.js`'s issue-type fallback). The value `repo=widgets` is not the `--repo` flag. Expected: it is not read as an explicit repo, so the call still gets `GH_HOST`. This is the reported `engine-verify` failure. Pinned in Task 1.
- **The issue-claim lock on a GHE origin** (`claim-store.js`, `release-merged.js`, `claim-targets.js`, `stale-claim-pr.js`, `dispatch-resume.js`). Their `gh api repos/{owner}/{repo}/…` calls carry no `--repo`/`--hostname`, so they move from github.com to the origin host. That is the same host the claim blob's git-CAS path already reaches by pushing to `origin`. Expected: every acquire, read and release of one claim resolves to the origin host. The bare-slug `--repo` calls (premise note) keep their github.com behavior. Checked in Tasks 3, 5, 7 and 10 (**Review risk:** high) by running each module's existing suites unedited.
- **Calls that pass different `cwd`s in one process** (worktree, main checkout, a temp dir with no `origin`). Expected: the host is resolved and memoized per resolved `cwd`. No origin, no git, or a probe timeout yields "no host", never a throw. Pinned in Task 1.
- **A caller that passes its own `opts.env`.** Expected: merge onto that env, not `process.env`, and treat a `GH_HOST` inside it as user-set. Pinned in Task 1.
- **A `--hostname`/`-R` that agrees with origin's host** (`compose-subject.js`'s `issue view --repo acme.ghe.com/acme/widgets`, `materialize.js`'s `repoSlug` args). Expected (Decision Q2): no injection; the call reaches the host through its own flag, which AC1's "or a host-qualified `-R`" accepts. Pinned in Task 1 and in Task 2's behavioral test.

## Spec premise notes (for the build log)

- `plugin/bin/lib/compose-subject.js:217`'s `--hostname` is **kept**, not dropped. Its `repoSpec` can come from a caller-supplied `--repo` naming a host other than origin's (lines 277-278), and the seam only knows origin. Every per-site `--hostname` that threads a caller-supplied host stays, for the same reason (`link.js`, `linked-prs.js`, `native-dependencies.js`, `resolved-refusal.js`, `backlog-grant-gate.js`, `teardown-run.js`, `release.js`, `fetch-sub-issues.js`, `materialize.js`).
- The spec's `engine-verify.js:1022` is at `:1034` on the base. Its regex matches github.com URLs only, so `repoSlug({ host: 'github.com', owner, repo })` yields the same string. The switch removes the hand-rolled slug the skill bans.
- The spec says 30 files spawn `gh` directly. The base (after merging `origin/main` at `aa2671fca`) has 47 files that spawn `gh`, listed across Tasks 2-11. `plugin/bin/lib/reconcile/post-merge.js:261` arrived with that merge. Proving grep: `git grep -n -E "['\"\`]gh['\"\`]" -- plugin/bin`, each hit classified by reading the line. Task 12's walk is the mechanical check that nothing was missed.
- `compose-subject.js`'s `issue view` has passed a host-qualified `--repo` (`repoSlug(repoSpec)`) since `4bc74c101` (#1829). So under Decision Q2 the seam injects nothing there, and the call reaches the host through `--repo`, which AC1 accepts ("or a host-qualified `-R`"). The record reports this call timing out without `GH_HOST` and succeeding with it. That evidence does not separate a missing host from a cold-call timeout, and this record cannot reproduce it without a real GHE host. The review step should weigh this. It is recorded here rather than worked around, because injecting alongside an explicit `--repo` contradicts Decision Q2. Plan-review ruling (2026-11-01, under the record's closing decision): the plan keeps Decision Q2 and AC1 as written (the reviewer's Reading A), so `compose-subject.js` behaves as it does on the base. Its Task 2 case is a pin, not a red-to-green proof. The alternative narrows Decision Q2, which the closing rule rules out.
- Plan-review ruling (2026-11-01, under the record's closing decision): Decision Q1's two sentences conflict for an SSH alias remote when an enterprise token is set ("any host when an enterprise-token env var is set" against "SSH host aliases … get no injection"). The plan follows the specific alias carve-out. A token admits any host except one from an SSH remote that is neither in `hosts.yml` nor ending in `.ghe.com`. An SSH remote's host cannot be told apart from a `~/.ssh/config` alias, and injecting an alias breaks every remote-inferring `gh` call. The cost falls on a token-only GHES user with an SSH remote and no `gh auth login` entry, who gets no injection. That user already needs `gh auth login --hostname`, the same cost Decision Q1 accepts for GHES.
- The seam's bound (Deliverable 1, "carries the existing `GH_TIMEOUT_MS` bound and `windowsHide`"). `ghOptions` carries neither, and there is no seam spawn helper: the planned `ghExecFileSync` (`GH_TIMEOUT_MS` plus `windowsHide`) shipped with no caller and no test (`compose-subject.js` kept its `execFileSync` for a byte pin), so the final whole-branch review deleted it, and each wrapped site's own `timeout` carries the bound (the `repo-resolve.js` header records this). `ghOptions` keeps the wrapped site's own options, because about a third of the sites are deliberately unbounded or bounded differently today: bulk listings such as `backlog-grant-gate.js:101` and `number-list-cli.js:75` set their own `timeout`/`maxBuffer`, and `reconcile/` uses `FETCH_TIMEOUT_MS`/`BULK_TIMEOUT_MS`. Imposing `GH_TIMEOUT_MS` there would be a behavior change outside this record. Every site already passes `windowsHide: true`, as the windows-hide scan enforces.
- Decision Q2 leaves origin-derived bare slugs on github.com: `repoSlugOf` (`lib/hooks/git-exec.js:207`, which drops the host) in the `reconcile/` callers, and `claim-store.js:635`'s `${owner}/${repo}`. An explicit `--repo owner/repo` suppresses injection, so those calls keep their current github.com behavior on a GHE origin. The decision's own Reading A names this as a known limitation. This record does not change them, because `repoSlugOf`'s slug also feeds `repos/${slug}/…` API paths, where a host-qualified value would break. It is logged to the open-items ledger as a follow-up.
- `GH_REPO` in the env is not read as an explicit repo; a GHE origin still gets `GH_HOST` (Decision Q2 names args only).

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (seam) | Task 1 |
| Deliverable 2 (route every site; engine-verify `repoSlug`; per-site `--hostname`) | Tasks 2-11 |
| Deliverable 3 (conformance test) | Task 12 |
| Deliverable 4 (fake-`ghe.com` behavioral test) | Task 2 |
| AC1.1 | Task 2 Step 1 |
| AC2.1 | Task 1 Step 1 (identity), Tasks 2-11 Step 4 (existing suites unchanged) |
| AC3.1 | Task 12 Step 1 |
| AC4.1 | Task 1 Step 1 |
| AC5.1, AC5.2 (Decision Q1: known-host filter, SSH alias gets nothing) | Task 1 Step 1 |
| AC6.1, AC6.2 (Decision Q2: any explicit `-R`/`--repo`/`--hostname` suppresses; bare slug means github.com) | Task 1 Step 1 |

Waived AC5.3: it amends the spec text (Deliverable 1), not runtime behavior; Global Constraints carry the amended rule.
Waived AC5.4: a provenance label for the decision, with no behavior to test.
Waived AC6.3: a provenance label for the decision, with no behavior to test.
Waived AC7.1: the closing rule governs plan review, not runtime behavior.
Waived AC7.2: governs plan review; this plan records the chosen behavior for each edge case in Review Focus and Spec premise notes, which the review step checks.
Waived AC7.3: governs when plan review may stop the build; no runtime behavior.

Waived `plugin/bin/wrap-up-pack.js`: it is a thin CLI over `plugin/bin/lib/wrap-up/pack.js`, which holds the probes. Task 2 Step 3 reads it to confirm it spawns no `gh` of its own.

---

### Task 1: The `ghOptions` seam in `repo-resolve.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js`
- Test: `tests/bin-lib/repo-resolve.test.js`

**Interfaces:**
- Produces:
  - `ghOptions(args: string[], opts?: object, deps?: GhHostDeps) -> object`. Returns `opts` itself when it injects nothing. Otherwise it returns `{ ...opts, env: { ...(opts.env || process.env), GH_HOST: host } }`.
  - `ghExecFileSync(args: string[], opts?: object) -> string|Buffer` is `execFileSync('gh', args, ghOptions(args, { timeout: sharedPrimitives.GH_TIMEOUT_MS, ...opts, windowsHide: true }))`.
  - `resolveGhHost(cwd: string, deps?: GhHostDeps) -> string|null` is memoized per `path.resolve(cwd)`.
  - `_resetGhHostCache() -> void` is for tests only.
  - `GhHostDeps = { remoteUrl(cwd) -> string, readFile(path) -> string, env: object, platform: string, homedir: string, stderr(s) }`. Every key is optional and defaults to the real implementation (`execFileSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS, windowsHide: true })`, `fs.readFileSync(p, 'utf8')`, `process.env`, `process.platform`, `os.homedir()`, `process.stderr.write`).

**Decision rules `ghOptions` implements, in order:**
1. `base = opts.env || deps.env`. If `'GH_HOST' in base`, return `opts`.
2. `host = resolveGhHost(opts.cwd || process.cwd(), deps)`. If `host` is null, return `opts`.
3. Scan `args` for an explicit host signal (Decision Q2): an element equal to `-R`, `--repo` or `--hostname`, or starting with `--repo=`, `--hostname=`, or `-R` followed by at least one more character (pflag's attached shorthand, `-Racme/widgets`). Stop scanning at a bare `--` element. Any signal → return `opts`, whatever value it names. A `-f`/`-F` value such as `repo=widgets` is not a signal, because it starts with neither `--repo` nor `-R`.
4. Return the injected copy. On the first injection for this host in the process, write `claude-tweaks: ${repoResolutionNote(spec)} — gh calls get GH_HOST=${host}\n` through `deps.stderr`.

**`resolveGhHost` rules:** a probe that throws, a remote `parseRepo` rejects, or host `github.com` → `null`. Compare hosts lower-cased throughout. Otherwise the host is used only when it is *known*: it ends with `.ghe.com`, or it is a top-level key of gh's `hosts.yml`, or `deps.env.GH_ENTERPRISE_TOKEN` or `deps.env.GITHUB_ENTERPRISE_TOKEN` is non-empty **and** the origin URL is not an SSH remote (neither scp-style `user@host:path` nor `ssh://`). The token clause excludes SSH remotes because an SSH remote's host may be a `~/.ssh/config` alias, and Decision Q1 gives aliases no injection (plan-review ruling, see Spec premise notes). Match `hosts.yml` keys with `/^([^\s#:][^:\s]*):\s*$/gm` and compare them case-insensitively. Read `hosts.yml` from the first directory in gh's own order: `env.GH_CONFIG_DIR`, then `env.XDG_CONFIG_HOME + '/gh'`, then on win32 `env.AppData + '/GitHub CLI'`, then `homedir + '/.config/gh'`. An unknown host → `null`. Cache the `{ host, owner, repo }` spec (or null), because rule 4's `repoResolutionNote(spec)` needs it.

- [ ] **Step 1: Write the failing tests** (in `tests/bin-lib/repo-resolve.test.js`; each test calls `_resetGhHostCache()` first and passes fake `deps`, never the real `git`/`hosts.yml`)

```js
const ghe = { remoteUrl: () => 'https://acme.ghe.com/acme/widgets.git', readFile: () => { throw new Error('ENOENT'); }, env: {}, platform: 'linux', homedir: '/h', stderr: () => {} };
test('AC1.1 seam: a *.ghe.com origin injects GH_HOST into a copy of opts', () => {
  const opts = { cwd: '/r', encoding: 'utf8', windowsHide: true };
  const out = ghOptions(['pr', 'view', '7', '--json', 'body'], opts, ghe);
  assert.notStrictEqual(out, opts);
  assert.equal(out.env.GH_HOST, 'acme.ghe.com');
  assert.equal(out.encoding, 'utf8');
  assert.equal(opts.env, undefined); // caller's object untouched
});
test('AC2.1: a github.com origin returns the same opts object', () => {
  const opts = { cwd: '/r' };
  assert.strictEqual(ghOptions(['pr', 'view'], opts, { ...ghe, remoteUrl: () => 'git@github.com:acme/widgets.git' }), opts);
});
test('AC4.1: an exported GH_HOST is never overwritten (process-style env and opts.env, empty string included)', () => {
  const o1 = { cwd: '/r' };
  assert.strictEqual(ghOptions(['api', 'graphql'], o1, { ...ghe, env: { GH_HOST: 'other.example' } }), o1);
  const o2 = { cwd: '/r', env: { GH_HOST: '' } };
  assert.strictEqual(ghOptions(['api', 'graphql'], o2, ghe), o2);
});
test('AC5.1, AC5.2 (Decision Q1): an SSH alias host is not injected, even with an enterprise token; a hosts.yml-known GHES host is; a token admits an HTTPS host', () => {
  const alias = { ...ghe, remoteUrl: () => 'git@github.com-work:acme/widgets.git' };
  const o = { cwd: '/a' };
  assert.strictEqual(ghOptions(['pr', 'list'], o, alias), o);
  _resetGhHostCache();
  const o2 = { cwd: '/t' };
  assert.strictEqual(ghOptions(['pr', 'list'], o2, { ...alias, env: { GH_ENTERPRISE_TOKEN: 't' } }), o2);
  _resetGhHostCache();
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/u' }, { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GITHUB_ENTERPRISE_TOKEN: 't' } }).env.GH_HOST, 'git.corp.example');
  _resetGhHostCache();
  const o3 = { cwd: '/m' };
  assert.strictEqual(ghOptions(['pr', 'list'], o3, { ...ghe, remoteUrl: () => 'https://GitHub.com/acme/widgets.git' }), o3); // mixed-case github.com is github.com
  _resetGhHostCache();
  const ghes = { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GH_CONFIG_DIR: '/cfg' },
    readFile: (p) => { assert.equal(p, path.join('/cfg', 'hosts.yml')); return 'git.corp.example:\n    user: me\n'; } };
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/b' }, ghes).env.GH_HOST, 'git.corp.example');
});
test('AC6.1, AC6.2 (Decision Q2): any explicit -R/--repo/--hostname suppresses injection, agreeing with origin or not', () => {
  const o = { cwd: '/r' };
  for (const args of [['issue', 'view', '1', '--repo', 'thn-inc/claude-tweaks'], ['api', 'graphql', '--hostname', 'github.com'],
    ['pr', 'list', '-R', 'other.example/acme/widgets'], ['issue', 'list', '--repo=thn-inc/claude-tweaks'],
    ['issue', 'view', '1', '--repo', 'acme.ghe.com/acme/widgets'], ['issue', 'view', '1', '-R', 'ACME/Widgets'],
    ['api', 'graphql', '--hostname', 'acme.ghe.com'], ['api', 'graphql', '--hostname=acme.ghe.com'], ['pr', 'list', '-Racme/widgets']]) {
    assert.strictEqual(ghOptions(args, o, ghe), o, args.join(' '));
  }
});
test('review focus: GraphQL -f owner=/repo= variables are not an explicit repo; args after -- are not scanned', () => {
  const o = { cwd: '/r' };
  for (const args of [['api', 'graphql', '-f', 'query=q', '-f', 'owner=acme', '-f', 'repo=widgets'],
    ['issue', 'comment', '1', '--body', 'x', '--', '--repo']]) {
    assert.equal(ghOptions(args, o, ghe).env.GH_HOST, 'acme.ghe.com', args.join(' '));
  }
});
test('review focus: caller opts.env is the merge base', () => {
  const out = ghOptions(['pr', 'view'], { cwd: '/r', env: { PATH: '/p', X: '1' } }, ghe);
  assert.deepEqual(out.env, { PATH: '/p', X: '1', GH_HOST: 'acme.ghe.com' });
});
test('review focus: memoized per cwd, probe failure is "no host", note logged once per host', () => {
  let probes = 0; const notes = [];
  const d = { ...ghe, remoteUrl: (cwd) => { probes++; if (cwd === path.resolve('/none')) throw new Error('no origin'); return ghe.remoteUrl(); }, stderr: (s) => notes.push(s) };
  ghOptions(['a'], { cwd: '/r' }, d); ghOptions(['b'], { cwd: '/r' }, d);
  const none = { cwd: '/none' };
  assert.strictEqual(ghOptions(['c'], none, d), none);
  assert.equal(probes, 2);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /resolved repo acme\.ghe\.com\/acme\/widgets \(host: acme\.ghe\.com\) — gh calls get GH_HOST=acme\.ghe\.com/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js`
Expected: FAIL with `ghOptions is not a function` (or `_resetGhHostCache is not a function`)

- [ ] **Step 3: Implement `ghOptions`, `ghExecFileSync`, `resolveGhHost`, `_resetGhHostCache` in `plugin/bin/lib/repo-resolve.js`, and export them**

Follow the decision rules above. The real `remoteUrl` default takes `cwd`. Leave the existing zero-arg `remoteUrl()` export as it is, because callers use it. Update the file's header comment to name the seam and its rules in two or three sentences.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js tests/bin-lib/repo-resolve.test.js
git commit -m "Add the ghOptions host seam — GH_HOST from origin for known GHE hosts, explicit host args win"
```

---

### Task 2: Route the four reported CLIs through the seam, with the fake-`ghe.com` behavioral test

**Role:** integration

**Files:**
- Modify: `plugin/bin/pr-checklist.js:91` (`realDeps.gh` → `ghOptions(args, { …existing literal… })`)
- Modify: `plugin/bin/lib/compose-subject.js:258` (`realDeps.runner` → `ghExecFileSync(args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })`). Keep `:217`'s `--hostname` (see Spec premise notes).
- Modify: `plugin/bin/lib/wrap-up/engine-verify.js` (lines 45-52) (`makeDefaultRunner(cmd, wrap = (_args, o) => o)`; `defaultGh = makeDefaultRunner('gh', ghOptions)`) and `:1034` (`'--repo', repoSlug({ host: 'github.com', owner, repo })`; import `repoSlug`)
- Modify: `plugin/bin/lib/wrap-up/pack.js` (lines 42-80, 610) (`execBounded(deps, cmd, args, cwd, wrap = (_a, o) => o)` applies `wrap(args, { cwd, ...EXEC_OPTS })`; the `gh` probe helper passes `ghOptions`; `defaultGhSync` spawns via `execFileSync('gh', args, ghOptions(args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }))`)
- Create: `tests/gh-host-seam-behavior.test.js`
- Waived `plugin/bin/wrap-up-pack.js`: Step 3 reads it to confirm it has no `gh` spawn of its own

**Interfaces:**
- Consumes: `ghOptions`, `ghExecFileSync`, `_resetGhHostCache` from Task 1; `installStub`, `STUB_SKIP` from `tests/helpers/path-stub.js`.

- [ ] **Step 1: Write the failing behavioral test** in `tests/gh-host-seam-behavior.test.js`. Each case builds a temp git repo whose `origin` is `https://acme.ghe.com/acme/widgets.git` and installs a fake `gh` with `installStub('gh', …)` (`{ skip: STUB_SKIP }`). The fake appends `GH_HOST=${GH_HOST-unset} ARGS=$*` to a log file and prints canned JSON keyed on its first two args. Each case deletes `GH_HOST` from the spawned env and asserts on the log.
  - `AC1.1: pr-checklist.js on a *.ghe.com origin sends gh pr view to the enterprise host`. Spawn `node plugin/bin/pr-checklist.js --run <runDir> --phase build` with cwd = the temp repo (run-state.json carries `pr: { number: 7 }`, which is the minimal fixture `pr-checklist.js`'s `run()` reads). Assert that the log holds at least one network-bound line (one whose `ARGS` is not `--version`, the `ghAvailable` probe in `repo-resolve.js`, which makes no network call), and that every such line has `GH_HOST=acme.ghe.com` or a `-R`/`--repo` starting `acme.ghe.com/`.
  - `AC1.1: compose-subject.js on a *.ghe.com origin sends its issue view to the enterprise host`. Spawn `node plugin/bin/compose-subject.js 7 --tag human-approved` with cwd = the temp repo. Same assertion. Its `issue view` already passes `--repo acme.ghe.com/acme/widgets` (`repoSlug`), so under Decision Q2 that line carries `GH_HOST=unset` and the host-qualified `--repo`. Assert that exact pair for the `issue view` line, so a later change that drops the host from the slug turns this red.
  - `AC1.1: wrap-up-engine verify's gh runner reaches the enterprise host`. Call `require('../plugin/bin/lib/wrap-up/engine-verify').defaultGh(['api', 'graphql', '-f', 'query=q'], tmpRepo)` with the stub on PATH. Assert `GH_HOST=acme.ghe.com` in the log.
  - `AC1.1: the wrap-up pack's gh probe reaches the enterprise host`. Drive `gatherPack({ runDir, cwd: tmpRepo, only: ['<the gh-backed probe needing the least fixture, e.g. pr or recordLabels>'] })` with default deps. Assert `GH_HOST=acme.ghe.com` in the log.
  - `AC2.1: on a github.com origin the fake gh sees GH_HOST unset`. Re-run the `pr-checklist.js` case with origin `https://github.com/acme/widgets.git`. Assert `GH_HOST=unset`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/gh-host-seam-behavior.test.js`
Expected: FAIL. The logged lines show `GH_HOST=unset` for the `pr-checklist.js`, wrap-up verify and pack cases. The `compose-subject.js` case passes already, because its slug is host-qualified, and it stays as a pin.

- [ ] **Step 3: Apply the four module changes in the Files block.** Read `plugin/bin/wrap-up-pack.js` and confirm that it only calls `gatherPack`.

- [ ] **Step 4: Run the tests and the four modules' existing suites**

Run: `node --test tests/gh-host-seam-behavior.test.js tests/bin-lib/compose-subject.test.js tests/windows-hide-spawn-conformance.test.js` plus every `tests/**` file that requires `pr-checklist`, `engine-verify` or `wrap-up/pack` (find them with `git grep -l -e "pr-checklist" -e "engine-verify" -e "wrap-up/pack" -- tests`)
Expected: PASS, 0 failures, with the existing suites unchanged (AC2.1)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/pr-checklist.js plugin/bin/lib/compose-subject.js plugin/bin/lib/wrap-up/engine-verify.js plugin/bin/lib/wrap-up/pack.js tests/gh-host-seam-behavior.test.js
git commit -m "Route pr-checklist, compose-subject, wrap-up verify and pack gh calls through ghOptions — GHE host reaches the child"
```

---

### Migration tasks 3-11 (same shape)

Each task applies one edit at every listed `gh` spawn: wrap the existing options argument in `ghOptions(args, …)`, passing the same argv array the spawn passes. The edit adds `require('<rel>/repo-resolve').ghOptions` (or extends an existing `repo-resolve` require) and changes nothing else at the site. Where a site's argv is built inline in the call, hoist it to a `const` first so the same array reaches both. Where `opts` arrives as a parameter (an injected runner such as `activity-gather.js:68`), wrap the merged literal. A wrapper that spawns both `git` and `gh` through one function (`residue.js:68`) applies `ghOptions` only when `argv[0] === 'gh'`.

**Interfaces (every migration task):** Consumes `ghOptions(args, opts)` from Task 1 (`plugin/bin/lib/repo-resolve.js`). Produces nothing new.

The steps are the same in every migration task:

- [ ] **Step 1: Write the failing check.** Run `git grep -n -E "['\"]gh['\"]" -- <task files>` and record each spawn line that lacks `ghOptions`. That list is the task's checklist.
- [ ] **Step 2: Verify it fails**

Run: `git grep -n -E "\(\s*['\"]gh['\"]" -- <task files>`
Expected: FAIL. At least one listed spawn line does not contain `ghOptions`.
- [ ] **Step 3: Wrap every spawn in the task's files.**
- [ ] **Step 4: Run the existing suites for those files plus the windows-hide and reconcile timing scans**

Run: `node --test tests/windows-hide-spawn-conformance.test.js tests/bin-lib/reconcile/subprocess-timing-conformance.test.js` plus each `tests/**` file that `git grep -l` finds requiring one of the task's modules
Expected: PASS, 0 failures, with no existing test edited (AC2.1)
- [ ] **Step 5: Commit** `Route {area} gh spawns through ghOptions — GHE host for {N} call sites`, with `refs #4505`

### Task 3: [batch] Top-level CLIs A

**Review risk:** high

**Files:**
- Modify: `plugin/bin/fetch-sub-issues.js:71`, `plugin/bin/stale-claim-pr.js:86`, `plugin/bin/apply-refine-labels.js:111`, `plugin/bin/dispatch-resume.js` (lines 80, 95), `plugin/bin/pr-checks.js:95`

### Task 4: [batch] Top-level CLIs B

**Files:**
- Modify: `plugin/bin/activity-gather.js` (lines 68, 70), `plugin/bin/pr-early-open.js:104`, `plugin/bin/release-notes-publish.js:45`, `plugin/bin/closing-links.js:145`, `plugin/bin/console-resolve.js` (lines 111, 152) (wrap at the `'gh'` literal call itself, `execFile('gh', args, ghOptions(args, { cwd }))` with the argv hoisted, never inside the generic `defaultExecFile`, which Task 12's matcher cannot see; `defaultExecFile` spreads its opts, so the env reaches the child)

### Task 5: [batch] Top-level CLIs C

**Review risk:** high

**Files:**
- Modify: `plugin/bin/claim-targets.js:29`, `plugin/bin/backlog-grant-gate.js:101`, `plugin/bin/materialize.js` (lines 206, 212, 221) (keep its `--repo repoSlug(...)`/`--hostname`), `plugin/bin/hooks.js:1417`, `plugin/bin/residue.js:68` (argv runner: `argv[0] === 'gh'`). The argv array in `plugin/bin/lib/residue/probes/forge.js:32` stays as it is. Task 12 allow-lists it with the reason that `residue.js`'s runner applies `ghOptions`.

### Task 6: [batch] lib A

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:774`, `plugin/bin/lib/merge-verification.js:154`, `plugin/bin/lib/release-claim/release.js:22`, `plugin/bin/lib/express/cli.js:475`, `plugin/bin/lib/number-list-cli.js:75`

### Task 7: [batch] lib/reconcile A

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (lines 172, 183, 223), `plugin/bin/lib/reconcile/preflight.js` (lines 15, 19), `plugin/bin/lib/reconcile/ledger-residue.js` (lines 256, 277, 284, 303)

### Task 8: [batch] lib/reconcile B and worktree/timing

**Files:**
- Modify: `plugin/bin/lib/reconcile/pr-state.js` (lines 102, 192, 203, 239, 268, 292, 315, 341), `plugin/bin/lib/reconcile/pr-state-batch.js:132` (its constant `--hostname` already disagrees on a GHE origin, so `ghOptions` injects nothing, which is correct), `plugin/bin/lib/worktree/remote-branch-collision.js:46`, `plugin/bin/lib/worktree/cherry-pick-provenance.js:46`, `plugin/bin/lib/timing/budget.js:171`

### Task 9: [batch] lib C

**Files:**
- Modify: `plugin/bin/lib/feedback/file-feedback.js:32`, `plugin/bin/lib/release-preflight/pack.js` (lines 305, 350, 355, 365, 380) (injected `deps.execFileAsync('gh', args)`: its default at `:113` spreads a third `opts` argument after its own `cwd`, so pass `ghOptions(args, { cwd })` as the third argument at each `'gh'` literal call, with the pack's `cwd` in scope and the argv hoisted. Never wrap inside the default, because Task 12's matcher reads the `'gh'` call's own argument text), `plugin/bin/lib/preflight-records/preflight-records.js:26`, `plugin/bin/lib/hooks/teardown-run.js:37` (`tests/hooks-teardown-run.test.js` AC14 mocks `cp.execFileSync`, and must stay green unedited), `plugin/bin/lib/phase-exit/phase-exit.js:81`

### Task 10: [batch] lib D

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/link.js:27`, `plugin/bin/lib/issues/capabilities-probe.js:30`, `plugin/bin/lib/issues/resolved-refusal.js:151`, `plugin/bin/lib/issues/claim-store.js` (lines 166, 290), `plugin/bin/lib/flow/preflight.js:294`

### Task 11: [batch] lib/reconcile C

**Files:**
- Modify: `plugin/bin/lib/reconcile/console-execute.js:145`, `plugin/bin/lib/reconcile/red-tip.js:91`, `plugin/bin/lib/reconcile/post-merge.js:261` (the `timedGh` default: `execFileSyncTimed('gh', args, ghOptions(args, { cwd: root, input, … }))`; `deps.gh` stays the injected override, so `tests/bin-lib/reconcile/post-merge.test.js` stays green unedited)

---

### Task 12: The seam conformance scan

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `tests/gh-host-seam-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js` (header caller list: add `gh-host-seam-conformance`)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15 caller list: add `gh-host-seam-conformance`)
- Modify: `.claude/skills/gh-api-module-pattern/SKILL.md` (one bullet under "The injectable runner": every `gh` spawn wraps its options in `repo-resolve.js`'s `ghOptions(args, …)`, enforced by `tests/gh-host-seam-conformance.test.js`)

**Interfaces:**
- Produces: `offendingGhCalls(raw: string) -> Array<{ line: number, text: string }>`, local to the test file.

**Matcher contract:** strip comments in literal-keeping mode, and push `stripperVerdict` non-`ok` as `{ line: 0, text: STRIPPER_VERDICT_MESSAGES[v] }`. Flag a `'gh'`/`"gh"`/`` `gh` `` literal that is (a) a top-level argument, in any position, of a call expression whose balanced argument text does not contain the identifier `ghOptions` or `ghExecFileSync`, or (b) the first element of an array literal. Also flag (c) a string or template literal beginning `gh ` passed to a callee whose name matches `/exec|spawn/i` (shell form). Exempt `plugin/bin/lib/repo-resolve.js` by name, since it is the seam. Keep an explicit allow-list keyed `file → exact count`, each entry with a reason: `lib/residue/probes/forge.js` (argv array; `residue.js`'s runner applies `ghOptions`), `lib/reconcile/issue-list-cache.js` (`recordSubprocess('gh', …)` is a timing record, not a spawn), `lib/compose-context/compose.js` (`transport: ['gh', 'mcp']` enum), plus whatever else the walk finds that is a non-spawn use. Settle each such entry by reading the line. A spawn site is never allow-listed.

- [ ] **Step 1: Write the failing tests**

```js
test('AC3.1: the matcher flags an unwrapped gh spawn and accepts the wrapped shapes', () => {
  const src = [
    "const { execFileSync } = require('child_process');",
    "execFileSync('gh', ['pr', 'view'], { windowsHide: true });",            // 2: flagged
    "execFileSync('gh', args, ghOptions(args, { windowsHide: true }));",     // ok
    "execFileSyncTimed(",                                                    // 4: flagged (multi-line)
    "  'gh', args, { windowsHide: true });",
    "execBounded(deps, 'gh', args, cwd);",                                   // 6: flagged (non-first position)
    "execBounded(deps, 'gh', args, cwd, ghOptions);",                        // ok
    "const argv = ['gh', 'pr', 'list'];",                                    // 8: flagged (argv array)
    "require('child_process').execSync('gh pr list --json number');",        // 9: flagged (shell form)
    "// execFileSync('gh', ['x'], {}) in a comment",                         // ok
    "stderr('gh pr view failed');",                                          // ok: message, not exec callee
    "if (transport === 'gh') {}",                                            // ok: comparison
    "ghExecFileSync(['issue', 'view', '1'], { encoding: 'utf8' });",         // ok
  ].join('\n');
  assert.deepEqual(offendingGhCalls(src).map((o) => o.line), [2, 4, 6, 8, 9]);
});
test('a comment-stripper mis-parse is reported as an offender', () => {
  assert.deepEqual(offendingGhCalls("if (cp) /'/.test(cp); const b = 'p//q'; execFileSync('gh', [b], {});").map((o) => o.line), [0]);
});
test('AC3.1: every gh spawn under plugin/bin/ routes through ghOptions', () => {
  // manual withFileTypes walk; readText from ./helpers/read-skill
  // assert files walked >= the count at landing; assert gh-literal sites matched (compliant + offending) >= the count at landing
  // assert allow-list counts are exact per file; assert offenders deepEqual []
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/gh-host-seam-conformance.test.js`
Expected: FAIL (the file does not exist yet before this task; once written, the self-test runs against the matcher stub)

- [ ] **Step 3: Implement `offendingGhCalls` and the tree walk.** Reuse the `balanced`/`lastTopLevelArg` shape from `tests/windows-hide-spawn-conformance.test.js`, copied into this file since that file does not export them. Set both floors to the counts the walk reports on the migrated tree. Update the three caller and skill lists in the Files block.

- [ ] **Step 4: Prove AC3.1's go-red and run the scans**

Temporarily add `execFileSync('gh', ['pr', 'list'], { windowsHide: true });` to `plugin/bin/pr-checks.js`, and run `node --test tests/gh-host-seam-conformance.test.js`. Expected: FAIL, naming `pr-checks.js:{line}`. Revert the line, then run:
Run: `node --test tests/gh-host-seam-conformance.test.js tests/strip-comments-callers-twin.test.js tests/helpers-strip-comments.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add tests/gh-host-seam-conformance.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md .claude/skills/gh-api-module-pattern/SKILL.md
git commit -m "Add gh host seam conformance scan — every plugin/bin gh spawn must carry ghOptions"
```
