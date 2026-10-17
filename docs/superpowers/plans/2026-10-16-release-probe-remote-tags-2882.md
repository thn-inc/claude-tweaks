# Missing git tags for CHANGELOG entries v6.129.0-v6.132.0 (#2882) Implementation Plan

**Goal:** The residue release probe stops reporting already-published release tags as missing when the local checkout hasn't fetched them, and never marks a missing tag as auto-remediable.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T181217-spec-2882/work/2882-spec.md` (materialized from GitHub issue #2882)

---

### Task 1: Union remote and local tag sets in probeRelease; missing-tag findings become remedy 'record'

**Files:**
- Modify: `plugin/bin/lib/residue/probes/release.js`
- Test: `tests/bin-lib/residue/probes-observed.test.js`
- Test: `tests/bin-lib/residue/cli.test.js` (run only; confirm it still passes)

- [ ] **Step 1: Failing test** — in `tests/bin-lib/residue/probes-observed.test.js`, extend `mockRun` with a `remoteTags` option answering the `ls-remote --tags origin` call (default: `null`, meaning the remote read fails), then add tests for the spec's three Acceptance Criteria: (1) local tag list lacks `v6.130.0`, remote `ls-remote` output contains it (including an annotated tag's peeled `^{}` line), and the probe reports no finding for v6.130.0; (2) a heading whose tag is absent from both lists yields exactly one `tag for CHANGELOG entry v{X}` finding with `remedy: 'record'`; (3) a failing remote read still returns `ran: true` on the local list, with `reason` naming the fallback.
- [ ] **Step 2: Implement** — in `probeRelease`: one `run(['git', 'ls-remote', '--tags', 'origin', 'v*'])` call (the probe's injectable `run`; best-effort, never throws); parse lines `{sha}\trefs/tags/v{X}` and strip a trailing `^{}`; union with the local `git tag -l 'v*'` set before the version filter; when the remote read returns `null`, keep the local list and set `reason` to a string naming the fallback while `ran` stays `true`; change only the missing-tag finding's `remedy` from `'auto'` to `'record'` (leave the `CHANGELOG entry for v{X}` finding as is).
- [ ] **Step 3: Run** `node --test tests/bin-lib/residue/probes-observed.test.js tests/bin-lib/residue/cli.test.js` — PASS.
- [ ] **Step 4: Commit** — one commit, `Read remote tags in the residue release probe — published tags no longer report as missing`, body `refs #2882`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (remote+local union) and AC1 → Steps 1-2; Deliverable 2 (named fallback) and AC3 → Steps 1-2; Deliverable 3 (`remedy: 'record'`) and AC2 → Steps 1-2; Deliverable 4 (unit tests) → Step 1; AC4 → Step 3.
- **Placeholders:** none.
