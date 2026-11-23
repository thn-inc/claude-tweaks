# Hollow Blocker Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A blocker whose reachable closing commit carried no implementation reads `hollow`, not `landed`, so `/dispatch` excludes its dependent and `/flow` Step 2.7b stops on it.

**Architecture:** `blocker-landing.js` gains one REST read per reachable deciding commit (its changed paths) and judges them against the blocker's Key Files (via the existing `extractKeyFiles` parser) and a bookkeeping-path pattern. The new verdict `hollow` flows through the existing `--blocker-landing` envelope; `unlanded-blockers.js` folds it into the existing `unlanded-blocker` exclusion with a distinct report line; the flow and dispatch prose that enumerates verdicts names it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh api` (GraphQL + REST) through the injected runner.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T155013-record-6142/work/6142-spec.md` (record #6142)

Scope keywords: unlanded, blockerLanding, landingExclusions

## Global Constraints

- Bookkeeping-only paths, exactly: `.claude-tweaks/pipelines/**`, `docs/superpowers/plans/**`, `docs/plans/*-ledger.md`.
- Report line, exactly: `#N waits — blocker #M was closed by #PR with no implementation` (N = dependent, M = blocker, PR = closing PR number).
- The new verdict word is `hollow`; it carries a `pr` key (the PR whose merge commit is the deciding commit, `null` when the deciding commit was a direct `Commit` closer).
- No new runner default: `fetchBlockerLanding`'s `runner` stays required (`gh-api-module-pattern`).
- `plugin/skills/dispatch/queue-pull-script.md` is 52497 bytes against `RAIL_BYTES` 52500 — any edit there must be byte-neutral or shrinking. `dispatch/SKILL.md` (52101) and `flow/SKILL.md` (51924) have < 600 bytes headroom: add at most ~20 bytes to each.

## Review Focus

- A commit-files read that fails (rate limit, 404) must not silently read `landed` — it reads `undetermined` with `via: 'files-unreadable'` and a `probeErrors` entry, like a failed compare.
- A closing commit with more than 300 files (GitHub's per-page cap) — the read uses `gh api --paginate`, so a Key File on page 2 still counts.
- A Key File renamed by the closing commit — `previous_filename` counts as touched.
- A Key File entry that is a directory (`plugin/bin/lib/driver/`) — a changed path under it counts as touched (prefix match when the entry ends with `/`).
- A health-sweep blocker (`by:code-health` etc.) whose files come from its header, not `### Key Files` — `extractKeyFiles({ body, labels })` already handles those origins, so the query must fetch `labels`.

---

### Task 1: `hollow` verdict in `blocker-landing.js` (+ `preflight-records.js` doc)

**Files:**
- Modify: `plugin/bin/lib/preflight-records/blocker-landing.js` (query, `classifyBlocker`, `fetchBlockerLanding`, header comment's verdict list)
- Modify: `plugin/bin/preflight-records.js:37-39` (header comment: `--blocker-landing` entries carry `pr` on a `hollow` verdict)
- Test: `tests/bin-lib/preflight-records/blocker-landing.test.js`, `tests/bin-lib/preflight-records/preflight-records.test.js`

**Interfaces:**
- Produces: `BOOKKEEPING_PATH_RE` (exported RegExp), `commitFilesArgs({ owner, repo, host, sha }) -> string[]`, `isHollow(files: string[], keyFiles: string[]) -> boolean` (exported), `classifyBlocker(blocker, node, reach, files: Map<sha, string[]|null>)` — `files` optional for back-compat of direct callers (absent map → no hollow judgment). Result shape for hollow: `{ blocker, verdict: 'hollow', commit, via, pr }`.

- [ ] **Step 1: Update the test fakes, then write the failing tests.** In `blocker-landing.test.js`'s `fakeRunner` add a `files` option (sha → string[] or Error; default for any sha `['src/impl.js']`) answering args where `a[0]==='api'` and `a` includes `/commits/` path; same default in `preflight-records.test.js`'s `landingFixture` and `nativeLandingFixture`. New tests (names and assertions):
  - `#6142 AC1.1: closing commit touching only docs/superpowers/plans/x.md and .claude-tweaks/pipelines/r/work/1-spec.md → hollow with pr` → `deepEqual(results.get(5), { blocker: 5, verdict: 'hollow', commit: 'aaa111', via: 'closer-pr', pr: 90 })`.
  - `#6142 AC2.1: Key Files a.js, commit touches only b.js → hollow` (blocker body `### Key Files\n\n- \`a.js\` — x\n`).
  - `#6142 AC3.1: commit touching a Key File → landed, unchanged` (exact old 4-key shape, no `pr`).
  - `#6142 AC4.1: no Key Files, commit touches a non-bookkeeping file → landed`.
  - `#6142 AC5.1: replay of squash 46e21cbf6 against #6000's Key Files → hollow pr 6061` — files `['.claude-tweaks/pipelines/2026-11-22T104447-record-6000/work/6000-spec.md', '.claude-tweaks/pipelines/2026-11-23T062258-record-6000/work/6000-spec.md', 'docs/plans/2026-11-22-lens-reviewer-worker-role-ledger.md', 'docs/superpowers/plans/2026-11-22-lens-reviewer-worker-role.md']`, Key Files `plugin/bin/lib/driver/roles.js`, `plugin/bin/lib/driver/worker.js`, `plugin/bin/review-lens-workers.js`, `plugin/bin/lib/timing/transcript.js`, closer PR 6061 merge oid `46e21cbf6ca873d6cea96900237d5d60bec18a6b`.
  - Review Focus: `files read throws → undetermined via files-unreadable + probeErrors entry`; `previous_filename of a Key File counts` (fake returns the old name among lines); `directory Key File entry prefix-matches`; `ledger not under docs/plans/*-ledger.md (docs/plans/notes.md) is not bookkeeping`; `query fetches body and labels(first:100)`; `commitFilesArgs` deepEquals `['api', '--paginate', 'repos/acme/w/commits/aaa111', '--jq', '.files[] | .filename, (.previous_filename // empty)']` (plus `--hostname` for a non-github.com host); only one commits read per distinct deciding sha; no commits read for an unreachable/open/not-applicable blocker.
  - In `preflight-records.test.js`: one CLI test, `--blocker-landing prints hollow with pr (#6142)`, asserting the envelope's `blockerLanding` entry includes `verdict: 'hollow', pr: 90`.

- [ ] **Step 2: Run to verify red.** Run: `node --test tests/bin-lib/preflight-records/blocker-landing.test.js tests/bin-lib/preflight-records/preflight-records.test.js` — Expected: FAIL (new tests only; existing tests still pass with the updated fakes once Step 3 lands — before it, the fakes are simply unused).

- [ ] **Step 3: Implement.** Query adds `body labels(first:100){ nodes{ name } }` to each `b{n}` alias (verified live 2026-11-23 against #6000). Key files = `extractKeyFiles({ body: node.body, labels: (node.labels?.nodes||[]).map(l => l.name) })` from `../issues/grouping`. `BOOKKEEPING_PATH_RE = /^(?:\.claude-tweaks\/pipelines\/|docs\/superpowers\/plans\/|docs\/plans\/[^/]+-ledger\.md$)/`. `isHollow(files, keys)`: true when `files` is non-empty and every file matches the bookkeeping pattern, or `keys.length > 0` and no file equals a key (or starts with a key ending `/`); an empty `files` list is not hollow (nothing to judge — reads `landed`). In `fetchBlockerLanding`, after the compare loop, read files once per distinct reachable deciding sha (the first reachable candidate in candidate order — the one `classifyBlocker` picks); a thrown read stores `null` and pushes `{ sha, message }` to `probeErrors`. `classifyBlocker`: on the reachable candidate, `files` map has `null` → `undetermined`/`files-unreadable`; hollow → `{...result(...,'hollow',...), pr}` where `pr` is the closer/reference PR whose `mergeCommit.oid` equals the sha, else `null`. Update the header comment's verdict list (six verdicts; `files-unreadable` in the `via` list) and `preflight-records.js`'s `--blocker-landing` comment.

- [ ] **Step 4: Run to verify green.** Same command — Expected: PASS, 0 fail.

- [ ] **Step 5: Commit** — `git -C {worktree} add` the four files; message `Add the hollow blocker-landing verdict — refs #6142`.

### Task 2: dispatch exclusion and report line for `hollow`

**Files:**
- Modify: `plugin/bin/lib/dispatch/unlanded-blockers.js` (`landingExclusions` + its comment)
- Modify: `plugin/bin/dispatch-unlanded-blockers.js` (Step 9 AUTO line; header comment's verdict sentence)
- Test: `tests/bin-lib/dispatch/unlanded-blockers.test.js`

**Interfaces:**
- Consumes: Task 1's result shape `{ blocker, verdict: 'hollow', commit, via, pr }`.
- Produces: exclusion detail entry for a hollow blocker `{ blocker, commit, verdict: 'hollow', pr }` (an unlanded entry keeps exactly `{ blocker, commit }`); the CLI's stderr line for it is `AUTO — dispatch: #N waits — blocker #M was closed by #PR with no implementation` (with `pr: null`, `closed by {commit}` in place of `#PR`).

- [ ] **Step 1: Failing tests.** `landingExclusions` maps a `hollow` verdict to an `unlanded-blocker` exclusion with `detail.blockers` `[{ blocker: 6000, commit: '46e2…', verdict: 'hollow', pr: 6061 }]`; a mixed record (one unlanded, one hollow) yields one exclusion with both entries in landing order; the CLI run (existing in-process `run` harness in the same file) with a fake preflight envelope carrying #6003 → blocker #6000 `hollow` pr 6061 prints `AUTO — dispatch: #6003 waits — blocker #6000 was closed by #6061 with no implementation` and drops #6003 from stdout groups (this is AC1's and AC5's dependent half).
- [ ] **Step 2: Run red.** `node --test tests/bin-lib/dispatch/unlanded-blockers.test.js` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run green.** Same command plus `node --test tests/dispatch-unlanded-blocker-exclusion-fixture.test.js` — Expected: PASS.
- [ ] **Step 5: Commit** — `Exclude a hollow blocker's dependent from the queue pull — refs #6142`.

### Task 3: name `hollow` on every verdict-enumerating prose surface

**Files:**
- Modify: `plugin/skills/flow/multispec-dependency-ordering.md` (verdict table: `| \`hollow\` | hard fail — stop before Step 2.8 claims, render the card below |` after `unlanded`; the "An `open` or `unlanded` verdict's stop" sentence → `open`, `unlanded` or `hollow`; add a short `hollow` stop card after the `unlanded` card: `Blocker landed hollow — stopping before any claim.` / `#{n} is blocked by #{blocker}, closed by #{pr} ({commit}), which touched none of its Key Files (or only pipeline bookkeeping).` / escape: reopen the blocker (`gh issue reopen {blocker}`) or remove the edge (escape 2 above))
- Modify: `plugin/skills/flow/validation.md:92` (`open` or `unlanded` → `open`, `unlanded` or `hollow`; render that file's stop card for `unlanded`/`hollow`)
- Modify: `plugin/skills/flow/SKILL.md:146` (`open`/`unlanded` → `open`/`unlanded`/`hollow`)
- Modify: `plugin/skills/flow/failure-cards.md:12` (blocker-landing row names `hollow`)
- Modify: `plugin/skills/dispatch/settle-and-merge.md:117` (Blocker-landing special case: `open`, `unlanded` or `hollow`)
- Modify: `plugin/skills/dispatch/SKILL.md:113` (`no \`unlanded\`` → `no \`unlanded\`/\`hollow\``)
- Modify: `plugin/skills/dispatch/queue-pull-script.md:12` (judges `unlanded` → `unlanded` or `hollow`; byte-neutral or shrinking — trim elsewhere in the same bullet)
- Modify: `plugin/skills/dispatch/queue-pull-notes.md` (unlanded-blocker pass paragraph: one clause that a `hollow` verdict excludes too)
- Modify: `plugin/skills/dispatch/blocked-exclusion-report.md` (after the unlanded line: an entry whose blocker carries `verdict: 'hollow'` renders `#{number} waits — blocker #{blocker} was closed by #{pr} with no implementation`)
- Modify: `docs/skill-graph.md:387` (the `blockerLanding` verdict list gains `hollow`)
- Modify: `docs/journeys/stop-a-run-whose-closed-blocker-never-landed-4553.md` (the verdict list — six verdicts — and step 3's hard-fail sentence name `hollow`; one Updated-during-build line for #6142)
- Test: `tests/flow-blocker-landing-conformance.test.js`, `tests/dispatch-unlanded-blocker-consumers-conformance.test.js` (update `REPORT_CHUNKS` and its pinned facts), `tests/settle-blocker-landing-stop-conformance.test.js` if it pins the verdict pair

- [ ] **Step 1: Failing conformance assertions** — each file above contains `hollow` in its verdict enumeration (one assertion per file, in the conformance suite that already pins that file's neighbouring text; the report line pinned verbatim).
- [ ] **Step 2: Run red.** `node --test tests/flow-blocker-landing-conformance.test.js tests/dispatch-unlanded-blocker-consumers-conformance.test.js tests/settle-blocker-landing-stop-conformance.test.js` — Expected: FAIL on the new assertions.
- [ ] **Step 3: Edit the prose** as listed. Verify `wc -c` for `queue-pull-script.md` ≤ 52497, `dispatch/SKILL.md` and `flow/SKILL.md` ≤ 52500.
- [ ] **Step 4: Run green** — same command plus `node --test tests/skill-rail*.test.js` if present (else `git grep -l "RAIL_BYTES" -- tests` and run those) — Expected: PASS.
- [ ] **Step 5: Commit** — `Name the hollow blocker verdict on the flow and dispatch surfaces — refs #6142`.
