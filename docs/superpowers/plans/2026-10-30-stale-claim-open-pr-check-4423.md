# Stale-Claim Open-PR Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/flow`'s claim step from re-claiming a TTL-expired claim whose run still has an open draft PR, and make `/tidy`'s stale-claim proposal name that PR and its resume command instead of a plain release.

**Architecture:** A new `staleClaimInFlightPr` helper in `claim-store.js`, beside `tombstoneInFlightPr`, lists the repo's open PRs once per `run()` and matches the stale blob's validated `runId` against each body's `claude-tweaks-run:` marker. `claim-targets.js` calls it for a not-self-owned `'stale'` blob before the conditional write, stopping through the existing `stopOrSkip(issue, 'in-flight', 'inFlight', 3, { link })`, so `flow/claim-targets.md`'s exit-3 in-flight card and its #958 resume routing apply unchanged. Tidy's claim audit applies the same match in prose.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T172234-spec-4468-4465-4423/spec-4423/work/4423-spec.md`

**Scope keywords:** tombstoneInFlightPr, staleClaimInFlightPr, claude-tweaks-run, Blob classified `'stale'`

## Global Constraints

- The run-id shape is `^\d{4}-\d{2}-\d{2}T\d{6}-[a-z0-9][a-z0-9-]*$` (`plugin/skills/flow/claim-targets.md`'s #958 validation). A blob `runId` that fails it is treated as "no marked PR", with no `gh` call.
- The blob's `runId` and every PR body are untrusted. The `runId` never enters a `gh` argument; the match is an exact string comparison over the listed bodies, and the returned `link` must pass `isSameRepoPrUrl(link, owner, repo)`.
- The check fails open (returns `null`) on any thrown `gh` call, unparseable output, or a non-array result. A broken check must never block a legitimate reclaim, matching `tombstoneInFlightPr`.
- Marker forms, from `plugin/bin/lib/flow/pr-body.js`: `<!-- claude-tweaks-run: {runId} -->` and a plain line `claude-tweaks-run: {runId}`. Match either, line-anchored, after trimming the line. This is the same pair of regexes `pr-checklist.js:72` uses.
- `plugin/skills/**/*.md` files sit under the 52,500-byte `RAIL_BYTES` rail. `scan-procedures.md` is at 48,749 bytes, so keep its addition under 1,500 bytes. `step-6-auto.md` (50,250) is not modified.
- Implementers run only targeted `node --test <file>`, never `npm test`; the controller runs `verify.js`.
- Commit style: `{Verb} {what} — {detail}`, ending with a separate `-m "Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r"`.

## Review Focus

- A stale blob whose `runId` is malformed (e.g. `otherRun`, `../x`, empty): no `pr list` call, plain reclaim. Pinned in Task 1 (`(stale-pr-5)`). Existing test `(c)` must stay green.
- Two stale targets in one `run()`: the open-PR listing is fetched once, not once per target. Pinned in Task 1 (`(stale-pr-6)`).
- An open PR whose body mentions the `runId` only inside other text (not as its own marker line), e.g. `see claude-tweaks-run: X in #12`: no match, reclaim. Pinned in Task 1 (`(stale-pr-3)`).
- A self-owned stale blob (same `runId` as this run) still lands in `alreadyOwned`, never in-flight. The check sits after the self-owned branch. Pinned in Task 1 (`(stale-pr-7)`).
- A tidy stale claim whose open PR has no `### Resume` line still names the PR and does not release. Pinned in Task 2's prose assertion.

---

### Task 1: Stale-claim in-flight check in claim-targets

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (new function beside `tombstoneInFlightPr`, ~line 512; export it)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js` (~lines 410-427 cache comment; insert the stale check after the live/unreadable block, before the "Reclaimable" payload at ~line 488)
- Modify: `plugin/skills/_shared/issue-claims.md` ("In-flight detection at claim time (#315)" paragraph, ~line 478)
- Modify: `plugin/skills/flow/claim-targets.md` (exit-3 in-flight bullet, ~line 244)
- Test: `tests/bin-lib/claim-targets/claim-targets.test.js`

**Interfaces:**
- Produces: `staleClaimInFlightPr(content: string, gh: (args: string[]) => string, owner: string, repo: string) => { link: string } | null`, exported from `claim-store.js`.
- The `gh` call is exactly `['pr', 'list', '--repo', `${owner}/${repo}`, '--state', 'open', '--json', 'url,body', '--limit', '1000']`. Its stdout is a JSON array of `{url, body}`.

- [ ] **Step 1: Write the failing tests**

In the test file, extend `makeGh` with an `openPrs = null` option and a `fail.prList` flag. On `args[0] === 'pr' && args[1] === 'list'`, throw `'pr list failed'` when `fail.prList`, otherwise return `JSON.stringify(openPrs || [])`. Add a helper `staleMarker(runId)` returning `liveMarker(runId, new Date(NOW - 100 * 3600 * 1000).toISOString())`. Use `const RUN = '2026-10-22T001546-record-3315'`. Add these tests after `(k6)`:

- `(stale-pr) stale claim whose run has an open marked PR, default mode` (AC1.1). Reads: `{ 770: [readOk(staleMarker(RUN), 'sha770')] }`. Writes: `{}`. `openPrs: [{ url: 'https://github.com/acme/w/pull/3927', body: `## Spec\n<!-- claude-tweaks-run: ${RUN} -->\n` }]`. Assert: `code === 3`; `body.inFlight` deep-equals `[{ issue: 770, link: 'https://github.com/acme/w/pull/3927' }]`; no `isWrite(a, '770')` call.
- `(stale-pr-2)`: same fixture with `--keep-going`. Assert: `code === 0`; `body.skipped[0]` deep-equals `{ issue: 771, reason: 'in-flight', link: 'https://github.com/acme/w/pull/3927' }`; no write.
- `(stale-pr-3)` (AC1.2): the open PR's body carries a different run id, plus the inline-mention body `see claude-tweaks-run: ${RUN} in #12`. Assert: reclaims (`claimed` = `[772]`, the write `sha` is `sha772`).
- `(stale-pr-4)`: `fail: { prList: true }`. Assert: reclaims (`claimed` = `[773]`).
- `(stale-pr-5)`: `staleMarker('otherRun')` with an `openPrs` body carrying `claude-tweaks-run: otherRun`. Assert: reclaims, and `ghCalls` has no `pr list` call.
- `(stale-pr-6)`: two stale targets 774 and 775, both with `RUN`, under `--keep-going`. Assert: both are skipped `in-flight`, and exactly one `pr list` call is made.
- `(stale-pr-7)`: a stale blob whose `runId` equals this run's `--run-id` (`RUN`, passed as `--run-id`), with an open marked PR. Assert: `body.alreadyOwned` deep-equals `[776]`, `code === 0`, and no `pr list` call. The fake `gh` must also answer the label calls `makeGh` already handles.
- A direct unit test `staleClaimInFlightPr: an HTML-comment and a plain marker line both match; a cross-repo url never returns`. Call `claimStore.staleClaimInFlightPr(staleMarker(RUN), fakeGh, 'acme', 'w')` with the plain form `claude-tweaks-run: ${RUN}` and assert `{ link }`. Then use a body whose url is `https://github.com/evil/x/pull/1` and assert `null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "stale-pr|staleClaimInFlightPr" "tests/bin-lib/claim-targets/claim-targets.test.js"`
Expected: FAIL after Step 1. `(stale-pr)` exits 0 and claims `770` instead of exiting 3, and the unit test throws `staleClaimInFlightPr is not a function`. Before Step 1 no test matches the pattern.

- [ ] **Step 3: Implement `staleClaimInFlightPr` in `claim-store.js` and call it from `claim-targets.js`**

The helper parses `content` and validates `runId` against the Global Constraints regex, returning `null` with no `gh` call on a mismatch. It then calls `gh` with the exact argv above and `JSON.parse`s the result. It returns `{ link: pr.url }` for the first PR whose body has a trimmed line equal to either marker form, but only when `isSameRepoPrUrl(pr.url, owner, repo)` passes. Otherwise it returns `null`, and it wraps the whole body in `try/catch → null`. Give it a header comment in the house style, naming #4423 and the fail-open rationale. Export it.

In `claim-targets.js`, add the stale check just before the `// Reclaimable:` comment:

`if (classified.state === 'stale') { const inFlight = claimStore.staleClaimInFlightPr(content, cachedGhForPrView, repoOwner, repoName); if (inFlight) { const stop = stopOrSkip(issue, 'in-flight', 'inFlight', 3, { link: inFlight.link }); if (stop !== null) return stop; continue; } }`

Call it through `claimStore.` so the module-level spy pattern the file already uses works. Update the `prViewCache` comment so it says the same memo also collapses the stale check's one `pr list` call per run.

- [ ] **Step 4: Update the two prose contracts**

In `issue-claims.md`'s "In-flight detection at claim time (#315)" paragraph, add one sentence. A `'stale'` claim whose `runId` matches an open same-repo PR's `claude-tweaks-run:` marker is in flight too (#4423, `staleClaimInFlightPr`). It reports through the same `inFlight` envelope and fails open the same way.

In `flow/claim-targets.md`'s exit-3 in-flight bullet, extend the trigger clause to say: "…or a `'stale'` claim whose run's marker sits on an open PR (#4423, `claim-store.js`'s `staleClaimInFlightPr`)". The card and resume routing below it stay unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/bin-lib/claim-targets/claim-targets.test.js"`
Expected: PASS, with every test green, including the existing `(c)` and `(k)`–`(k6)`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js plugin/skills/_shared/issue-claims.md plugin/skills/flow/claim-targets.md tests/bin-lib/claim-targets/claim-targets.test.js
git commit -m "Stop re-claiming a stale claim whose run has an open PR — staleClaimInFlightPr beside tombstoneInFlightPr (#4423)" -m "Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r"
```

### Task 2: Tidy's stale-claim proposal names the open PR

**Files:**
- Modify: `plugin/skills/tidy/scan-procedures.md` (Step 4.7 claim audit table row `Blob classified 'stale'` ~line 233, the Releasing paragraph ~line 240, the Collect line ~line 242)
- Create: `tests/tidy-stale-claim-open-pr-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's marker semantics, which are restated in prose. Tidy runs `gh` itself and does not call `staleClaimInFlightPr`, because the scan is model-executed skill prose.

- [ ] **Step 1: Write the failing test**

Write a new test file (AC2.1) in the `tests/tidy-plan-retention-conformance.test.js` style, using `readText` from `./helpers/read-skill` and a `findRow` helper. Slice the section from `## Step 4.7: Audit Issue Claims` to `### Backstops: issue-claim audit-trail integrity checks`, and assert both anchors exist. Assertions:
  - The `| Blob classified `'stale'`` row matches `/open PR/` and `/Resume/`.
  - The section matches `/gh pr list --state open --json number,url,body/`.
  - The section matches `/claude-tweaks-run: \{runId\}/`.
  - The section matches the run-id shape literal `^\\d{4}-\\d{2}-\\d{2}T\\d{6}-[a-z0-9][a-z0-9-]*$`, as an escaped string match.
  - The section matches `/`### Resume` line/`.
  - The section matches `/never release/i`, scoped to the open-PR case.
  - The Collect line matches `/\[claim\] claims\/issue-\{n\}\.json — \{status\} — \{recommendation\}/` and the sentence after it names `PR #{number}`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "tests/tidy-stale-claim-open-pr-conformance.test.js"`
Expected: FAIL. The stale row currently reads only `Release (crashed or abandoned run)`.

- [ ] **Step 3: Edit `scan-procedures.md`**

Change the stale row's recommendation to: `Release (crashed or abandoned run) — or, when an open PR carries its run marker, Resume that PR (below)`.

After the Releasing paragraph, add one paragraph headed `**Stale claim with an open PR (#4423).**`. It says:
- Before recommending Release for a `'stale'` blob, validate its `runId` against the run-id shape regex. A mismatch means plain Release.
- List open PRs once per tidy run: `gh pr list --state open --json number,url,body --limit 1000`.
- Look for a body line reading `claude-tweaks-run: {runId}`, bare or inside `<!-- … -->`. This is the marker `/claude-tweaks:flow`'s claim step also checks (`claim-store.js`'s `staleClaimInFlightPr`).
- A match recommends **Resume** instead. The staged action and its needs-decision `Proposed:` line read `Resume open PR #{number} ({url}) instead of releasing — {its body's \`### Resume\` line}`. With no `### Resume` line, it reads `Resolve open PR #{number} ({url}) before releasing`.
- Approving such an item never releases the claim. It reports the resume command for the human to run.
- A failed listing degrades to plain Release, with one SKIP note.

Then add a sentence after the Collect line: a Resume recommendation's `{recommendation}` carries `PR #{number}` and the resume command.

- [ ] **Step 4: Run the test to verify it passes, and check the byte budget**

Run: `node --test "tests/tidy-stale-claim-open-pr-conformance.test.js" "tests/tidy-scan-action-routing.test.js"`
Expected: PASS for both.

Run: `wc -c plugin/skills/tidy/scan-procedures.md`
Expected: below 50,250 bytes.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/tidy/scan-procedures.md tests/tidy-stale-claim-open-pr-conformance.test.js
git commit -m "Name the open PR in tidy's stale-claim proposal — recommend its resume line over a release (#4423)" -m "Claude-Session: https://claude.ai/code/session_01YPgdwTF5oxR7DnGFhhiX8r"
```
