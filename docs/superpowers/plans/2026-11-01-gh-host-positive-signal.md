# Gate GH_HOST Injection on a Positive GitHub Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The gh host seam (`plugin/bin/lib/repo-resolve.js`) injects `GH_HOST` for a non-github.com origin only on a positive GitHub signal, so an exported enterprise token is never sent to a non-GitHub host.

**Architecture:** `resolveGhSpec` admits a host only when it ends in `.ghe.com` or is a key of gh's `hosts.yml`. The enterprise-token clause is dropped. Its two guards, `isSshRemote` and the `NON_GITHUB_FORGES` denylist, have no other caller, so they are deleted with it. That removes the bypass spellings (`gitlab.com.`, `git+ssh://`, `ssh+git://`) because nothing admits on the token any more. A new `normalizeHost` lower-cases and strips trailing dots from both the origin host and each `hosts.yml` key before comparison. The explicit opt-in is the existing one, decided by the user at plan review: an exported `GH_HOST`, which `ghOptions` and `explicitRepoGhHost` already leave untouched (pinned by the existing "AC4.1" and "explicitRepoGhHost AC4" tests), or `gh auth login --hostname {host}`, which writes the `hosts.yml` key. No new policy key is added, and no new stderr line.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T191540-spec-4854/work/4854-spec.md` (record #4854)

## Global Constraints

- AC1.1: With only `GH_ENTERPRISE_TOKEN` set and origin `https://git.corp.invalid/o/r.git`, `ghOptions` injects no `GH_HOST` — Task 1's forge-test URL loop.
- AC2.1: A `hosts.yml` GHE host and a `*.ghe.com` origin still get `GH_HOST` injected — the existing AC1.1-seam and AC5.2 hosts.yml tests, unchanged, plus the normalization test.
- AC3.1: `https://gitlab.com./o/r.git`, `git+ssh://alias/o/r` and `ssh+git://alias/o/r` inject no `GH_HOST` — Task 1's bypass-spellings test. AC3 holds when the token is the only signal; a `hosts.yml` key for the host is a positive signal and still admits it (spec Plan Review Clarifications; Review Focus 5).
- The seam stays silent on an unknown host: no new stderr line (decided at plan review).
- AC4.1: `npm test` passes — Common Step 5's verification run.
- An injected `GH_HOST` value is the normalized host: lower-case, no trailing dot.

## Review Focus

1. A GHES user whose only credential is `GH_ENTERPRISE_TOKEN` (no `hosts.yml` entry) now gets no injection. Their opt-in is exporting `GH_HOST`, which the seam must still never overwrite. That is already pinned by "AC4.1", which must stay green unchanged.
2. A `*.ghe.com` origin written with a trailing dot (`https://acme.ghe.com./acme/widgets.git`) must still inject `GH_HOST=acme.ghe.com`, with no dot. Without normalization the `.ghe.com` suffix test fails on `acme.ghe.com.`, so this test discriminates the normalization guard.
3. Several trailing dots (`https://acme.ghe.com../acme/widgets.git`) normalize to `acme.ghe.com` as well. `parseRepo`'s host class accepts dots, so this input reaches the seam.
4. An origin host with a trailing dot (`https://git.corp.example./acme/widgets.git`) matches the `hosts.yml` key `git.corp.example` and injects `git.corp.example`.
5. With the token set and a `gitlab.com` key in `hosts.yml`, the origin `https://gitlab.com./acme/widgets.git` injects `gitlab.com`. The user configured that host for gh themselves (the existing "a hosts.yml key still does" rule).

---

### Task 1: Positive-signal host admission, its tests, and the prose that describes it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/repo-resolve.js`
  - lines 3-7: header comment, drop "a token on a non-SSH remote"
  - lines 91-101: delete `isSshRemote` and its comment
  - lines 113-123: `ghConfigHosts` normalizes keys
  - lines 136-145: delete `NON_GITHUB_FORGES` and `isNonGithubForge`
  - lines 147-161: `resolveGhSpec`
- Test: `tests/bin-lib/repo-resolve.test.js`
  - lines 164-174: flip the token assertion at :173
  - lines 216-227: rewrite the forge test
  - lines 255-260: retitle
  - lines 312-324: flip :322 and retitle
  - add the new cases below
- Modify: `docs/plugin-structure.md:19`: the seam's "known host" parenthetical.
- Modify: `docs/journeys/run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md:24-25`: "Should understand" and "Red flags".
- No change, append-only history: `CHANGELOG.md`, `docs/superpowers/plans/2026-10-31-gh-host-seam.md`, `.claude-tweaks/pipelines/**`.

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `normalizeHost(host: string): string`, module-internal and not exported. It lower-cases the host and strips every trailing `.`.
  - `resolveGhHost`, `ghOptions` and `explicitRepoGhHost` keep their signatures.
  - `module.exports` is unchanged. `isSshRemote`, `NON_GITHUB_FORGES` and `isNonGithubForge` were never exported.

- [ ] **Step 1: Write the failing tests (AC1.1, AC2.1, AC3.1)**

Changes to existing tests in `tests/bin-lib/repo-resolve.test.js`:

- **Line 173:** replace it with an assertion that the token alone admits nothing. Use `GITHUB_ENTERPRISE_TOKEN` and origin `https://git.corp.example/acme/widgets.git`. Retitle the test `'AC5.1, AC5.2 (Decision Q1): an SSH alias host is not injected, even with an enterprise token; a hosts.yml-known GHES host is; a token alone admits no HTTPS host (#4854)'`.
  ```js
  const o4 = { cwd: '/u' };
  assert.strictEqual(ghOptions(['pr', 'list'], o4, { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GITHUB_ENTERPRISE_TOKEN: 't' } }), o4);
  ```
- **The `'review (#4505): the enterprise-token clause never admits a non-GitHub forge…'` test:**
  - Retitle it `'#4854: an enterprise token alone admits no host, forge or not, so the token is never sent there; a hosts.yml key still does'`.
  - Add `'https://git.corp.invalid/o/r.git'` to the URL loop, with both `{ GH_ENTERPRISE_TOKEN: 't' }` and `{ GITHUB_ENTERPRISE_TOKEN: 't' }` envs. Each must return the same `o`.
  - Keep the `configured` gitlab.com hosts.yml assertion.
- **The `'resolveGhHost: a user-less scp-style remote is SSH, so the token clause skips it…'` test:** retitle it `'resolveGhHost: a user-less scp-style remote with a token is not admitted; an unknown HTTPS host without a token is null'`. The assertions are unchanged.
- **The `'final review: an ssh:// remote stays SSH for the token clause…'` test:**
  - Retitle it `'final review: an ssh:// remote with a token is not admitted; hosts.yml admits it; a token does not admit an https:// remote with userinfo and a port (#4854)'`.
  - Line 322's expected value changes from `'git.corp.example'` to `null`.

New test, `'#4854: bypass spellings of the old guards inject nothing with a token set'`. With `env: { GH_ENTERPRISE_TOKEN: 't' }` and `_resetGhHostCache()` per URL, each of these returns the same `opts` object from `ghOptions(['pr', 'list'], o, …)`:
```js
['https://gitlab.com./o/r.git', 'https://GITLAB.COM./o/r.git', 'git+ssh://alias/o/r', 'ssh+git://alias/o/r', 'git+ssh://git@alias/o/r.git']
```

New test, `'#4854: the origin host is normalized (case, trailing dots) before the .ghe.com and hosts.yml checks, and GH_HOST carries the normalized host'`. It covers Review Focus 2-5, with `_resetGhHostCache()` before each:
```js
assert.equal(ghOptions(['pr', 'list'], { cwd: '/r' }, { ...ghe, remoteUrl: () => 'https://acme.ghe.com./acme/widgets.git' }).env.GH_HOST, 'acme.ghe.com');
assert.equal(ghOptions(['pr', 'list'], { cwd: '/r' }, { ...ghe, remoteUrl: () => 'https://ACME.ghe.com../acme/widgets.git' }).env.GH_HOST, 'acme.ghe.com');
assert.equal(resolveGhHost('/c', { ...ghe, remoteUrl: () => 'https://git.corp.example./acme/widgets.git', readFile: () => 'git.corp.example:\n' }), 'git.corp.example');
assert.equal(resolveGhHost('/c', { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', readFile: () => 'Git.Corp.Example.:\n' }), 'git.corp.example');
assert.equal(ghOptions(['pr', 'list'], { cwd: '/g' }, { ...ghe, remoteUrl: () => 'https://gitlab.com./acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' }, readFile: () => 'gitlab.com:\n' }).env.GH_HOST, 'gitlab.com');
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/repo-resolve.test.js`
Expected: FAIL. The token-alone assertions return an injected copy, not `o`. The trailing-dot cases return `undefined`/`null`, because `acme.ghe.com.` fails the `.ghe.com` suffix check.

- [ ] **Step 3: Implement in `plugin/bin/lib/repo-resolve.js`**

- Add `normalizeHost(host)`: `String(host).toLowerCase().replace(/\.+$/, '')`.
- In `resolveGhSpec`, set `host = parsed && normalizeHost(parsed.host)`. Then `known = host.endsWith('.ghe.com') || ghConfigHosts(deps).has(host)`. Drop the token clause and the now-unused `env` local.
- In `ghConfigHosts`, map each key through `normalizeHost` instead of `.toLowerCase()`.
- Delete `isSshRemote`, `NON_GITHUB_FORGES` and `isNonGithubForge`, with their comments. This discharges Deliverable 2's SSH clause: the only guard that read SSH-ness is gone, so no spelling can sidestep it. The bypass-spellings test is the proof (AC3.1).
- Update the header comment (lines 3-7) so the known-host list reads `*.ghe.com or a gh hosts.yml key`. Add one sentence: an enterprise token alone admits nothing, because gh sends it to whatever `GH_HOST` names (#4854).

- [ ] **Step 4: Run tests to verify they pass (AC1.1, AC2.1, AC3.1; AC4.1's full `npm test` runs centrally at build Common Step 5)**

Run: `node --test tests/bin-lib/repo-resolve.test.js tests/gh-host-seam-conformance.test.js`
Expected: PASS, 0 failures.

Discrimination check: temporarily replace `normalizeHost`'s body with `String(host).toLowerCase()`. The normalization test must go red on its `acme.ghe.com.` line. Restore the body afterwards.

- [ ] **Step 5: Sweep the prose**

Run:
`git grep -n -i -e 'GH_ENTERPRISE_TOKEN' -e 'GITHUB_ENTERPRISE_TOKEN' -e 'enterprise-token' -e 'enterprise token' -e 'token clause' -e 'isSshRemote' -e 'NON_GITHUB_FORGES' -e 'isNonGithubForge' -e 'non-GitHub forge' -e 'non-SSH remote' -- ':!CHANGELOG.md' ':!docs/superpowers/plans/' ':!.claude-tweaks/'`

Rewrite each hit that describes the old rule:
- `docs/plugin-structure.md:19`: the parenthetical becomes `(*.ghe.com or a gh hosts.yml key; an enterprise token alone admits nothing, #4854)`.
- Journey "Should understand": a host is known when it ends in `.ghe.com` or is a `hosts.yml` key. An exported enterprise token alone admits no host, because gh sends it to whatever `GH_HOST` names. A GHES user with no `hosts.yml` entry runs `gh auth login --hostname {host}` or exports `GH_HOST`.
- Journey "Red flags": `GH_HOST` injected for a host that is neither `*.ghe.com` nor in `hosts.yml` because an enterprise token is exported.

Hits in test titles or test comments that this task already rewrote are no-change. Re-run the grep: every remaining hit must describe the new rule.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/repo-resolve.js tests/bin-lib/repo-resolve.test.js docs/plugin-structure.md docs/journeys/run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md
git commit -m "Gate GH_HOST injection on a positive GitHub signal — drop the enterprise-token clause (#4854)"
```
