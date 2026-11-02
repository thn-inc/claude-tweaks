# stuck-open-prs.js passes the raw origin host to gh as --hostname, skipping the #4854 host gate (#4951) Implementation Plan

**Goal:** Move `plugin/bin/stuck-open-prs.js`'s origin-derived repo facts onto #4933's origin-host gate, `gateOriginRepo` in `plugin/bin/lib/repo-resolve.js`. An origin host with no positive GitHub signal is then refused before any gh call, never passed as `--hostname`.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T074712-spec-4933-4951/spec-4951/work/4951-spec.md` (materialized from GitHub issue #4951)

---

### Task 1: Gate stuck-open-prs.js's origin repo through gateOriginRepo, refuse an unknown host

**Files:**
- Modify: `plugin/bin/stuck-open-prs.js`
- Test: `tests/bin-lib/dispatch/stuck-open-pr.test.js`
- Test: `tests/gh-host-seam-conformance.test.js`

**Notes (facts from the tree at plan time):**
- `realDeps.repo` (line 69) is `() => parseRepo(remoteUrl())`. `run()` (lines 167-169) refuses a falsy `repo` or one with no owner/repo via `failRun(2, 'could not resolve owner/repo from the origin remote')`. That is the "code it already returns when owner/repo cannot be resolved" (exit 2, plus a `{failed:{code, message}}` stdout line).
- The gate is `gateOriginRepo(remote, deps)`, which returns `{ spec, refusal }`. `spec` is `{host, owner, repo}` with a normalized host, or `null`; `refusal` is a string naming the host and `GH_HOST={host}`, or `null`. `deps` is `{ env, readFile }` (both optional; `readFile` reads gh's hosts.yml). The other 14 gated CLIs call it as `gateOriginRepo(remote, deps.gateDeps)` (see `plugin/bin/list-claims.js:76-78`).
- `fetchLinkedPRs` (`plugin/bin/lib/issues/linked-prs.js`) adds `--hostname {host}` only for a host other than `github.com`. So the gate's `github.com` spec host, both for a github.com origin and for the bare slug a GH_HOST naming another host produces, carries no `--hostname`.
- Keep `deps.repo`'s current contract (`{owner, repo, host}`, or falsy) so the ~40 existing `run(argv, deps)` tests stay unchanged. Add the refusal as a new shape that `run()` checks first: `realDeps.repo` returns `{ refusal }` on a refusal, and `run()` routes that through `failRun(2, repo.refusal)` before the owner/repo check. `fail()`'s existing `stuck-open-prs.js: ` prefix stands in for the spec's "`stuck-open-prs: {refusal}`". Every other stderr line this CLI writes uses that prefix.
- Export one small helper so a test can drive the real gate without spawning: `repoFromOrigin(remote, gateDeps)` maps `gateOriginRepo`'s result to `spec`, `{ refusal }`, or `null` (unparseable). `realDeps.repo` becomes `() => repoFromOrigin(remoteUrl(), realDeps.gateDeps)`, with `gateDeps: undefined` on `realDeps`, mirroring the other CLIs. `realDeps.repo` must contain no `parseRepo(` call. Drop the now-unused `parseRepo` import.
- `tests/gh-host-seam-conformance.test.js`:
  - Remove the `stuck-open-prs.js` entry from `NOT_ORIGIN` (line 359) and add `'stuck-open-prs.js'` to `ORIGIN_GATED` (line 363), in the same commit.
  - AC9.2's `matched >= 9` floor (line ~425) is the NOT_ORIGIN site total. Removing this entry lowers the true total to 8, so set the floor to 8 and amend its comment to say #4951 moved one site onto the gate. This is a deliberate removal, not the matcher losing recall.

- [ ] **Step 1: Failing test.** In `tests/bin-lib/dispatch/stuck-open-pr.test.js`, add cases that drive `run()` with `deps.repo = () => repoFromOrigin(<origin>, { env, readFile })`. `deps.linked` should call the real `fetchLinkedPRs` with a recording fake `runner`, so the gh argv is asserted, not assumed. Give it one candidate record (`auto:build`, OPEN) so the linked-PR read actually runs. The cases:
  - **AC1.** Origin `https://git.corp.invalid/o/r.git`, `env: { GH_ENTERPRISE_TOKEN: 'x' }`, hosts.yml without that key (`readFile` returns `''` or another key). Expect a non-zero exit (2), and the runner never called: no argv names `git.corp.invalid`, and no bare `o/r` call either. stderr must contain `git.corp.invalid` and `GH_HOST=git.corp.invalid`.
  - **AC2.** Each of these carries `--hostname {host}` on the linked-PR read:
    - `https://acme.ghe.com/o/r.git`
    - a hosts.yml-key origin (`readFile` returns `ghes.corp.invalid:\n    user: x\n` with origin `https://ghes.corp.invalid/o/r.git`)
    - `https://git.corp.invalid/o/r.git` with `env: { GH_HOST: 'git.corp.invalid' }`
  - **AC3.** Origin `https://github.com./o/r.git` carries no `--hostname`.

  Run the new tests against the unmodified CLI and see them fail, since `repoFromOrigin` does not exist yet. If a case would pass at base, add an assertion that goes red.
- [ ] **Step 2: Implement.** Make the `plugin/bin/stuck-open-prs.js` changes in the Notes: `repoFromOrigin`, `realDeps.repo`/`realDeps.gateDeps`, the refusal branch in `run()` placed before the owner/repo check, and the header comment's exit-2 line gaining "an origin host that is not a known GitHub host (refused before any gh call, #4933; `GH_HOST={host}` opts in)". Make the `tests/gh-host-seam-conformance.test.js` roster and floor edits.
- [ ] **Step 3: Run.** `node --test tests/bin-lib/dispatch/stuck-open-pr.test.js tests/gh-host-seam-conformance.test.js` — PASS.
- [ ] **Step 4: Commit.** One commit, `Gate stuck-open-prs.js's origin host through gateOriginRepo — refuse an unknown host before gh`, body `refs #4951`.

---

## Self-review

- **Spec coverage:**
  - Deliverable 1 (gate-derived owner/repo/host, no `parseRepo` on the raw origin, no github.com fallback) and Deliverable 2 (refusal to stderr, exit 2 before any gh call) are covered by Step 2.
  - Deliverable 3 (ORIGIN_GATED) is covered by Step 2's conformance edits.
  - Deliverable 4 (fake-runner regression tests) is covered by Step 1.
  - AC1-AC3 are covered by Step 1's cases. AC4 is Step 3's command.
- **Placeholders:** none.
