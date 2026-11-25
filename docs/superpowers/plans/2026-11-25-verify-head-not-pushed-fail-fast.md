# verify.js head-not-pushed fail-fast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scoped `verify.js` run whose HEAD GitHub does not know (`head-not-pushed`) ends at once with no verdict (exit 3) under any declaration, and every other CI fallback that sends a suite to a local run says so on stderr when it is decided.

**Architecture:** The change stays in `plugin/bin/verify.js`'s CI loop (the #4347/#5369 block): `head-not-pushed` joins `localRuns: "on-request"` as a stop condition and as a `noVerdict` selector, `noVerdictLines` gains a head-not-pushed variant naming the short sha, and a one-line early notice is written where a non-on-request run decides a local fallback. The stale-baseline-warning hold (which keeps an exit-3 run's stderr line 1 the no-verdict line) widens from on-request declarations to every declaration with a `ci` block, since all of them can now exit 3. Docs (`verification.md`, `ci-source.md`, `docs/plugin-structure.md`, one journey) and their conformance pins follow.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T075757-record-5800/work/5800-spec.md` (record #5800)

## Global Constraints

- The no-verdict first line keeps its shape: `verify.js: no verdict yet for suite "{suite}" — CI could not answer ({reason})` (spec Deliverable 2).
- head-not-pushed variant, verbatim: first line `verify.js: no verdict yet for suite "{suite}" — CI could not answer (head-not-pushed): HEAD {short-sha} is not on the remote; no check ran and no pass stamp was written.`, second line `  Push the branch (commit first if the tree is dirty), then re-run this command,`, third line the existing `  or re-run it with --local to run the suite on this machine.`
- Short sha is `String(sha).slice(0, 9)` — the width every other short sha in `verify.js` uses.
- Early notice, verbatim: `verify.js: CI could not answer suite "{suite}" ({reason}) — running it on this machine` (spec Deliverable 3). Printed only without `localRuns: "on-request"`, never for `local-requested`/`not-consulted`, never for `head-not-pushed`.
- `--local` still never consults CI and never exits 3.
- No flag, verb or field changes (spec Gotchas: behavior change, not `breaking`).
- Commit messages: `{Verb} {what} — {detail}`, ending with `refs #5800` (never `closes`/`fixes`) and the `Claude-Session:` trailer.
- From the project CLAUDE.md, quoted: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing project skill `.claude/skills/skill-prose-conformance-tests/SKILL.md` applies to Task 2's conformance pins, quoted: "When one region must state many facts, use a missing-facts predicate and prove each fact returns exactly itself." and "Keep the patterns non-global". Both suites already use `missingFactsOf` / `assertEachPatternGoesRed` / `checkFacts`; new pins are rows in the existing fact tables, each matching exactly once in its slice.

Scope keywords: head-not-pushed, noVerdictLines, localRuns, running it on this machine

## Review Focus

1. A stale baseline scratch worktree present on a no-`localRuns` run that exits 3: stderr line 1 must still be the no-verdict line (the routing in `verification.md` reads line 1). Pinned in Task 1 (rewritten stale-warning test).
2. A `--scope` usage error (bad `--cmd` name) with a stale worktree, with and without the key: the stale warning still precedes the usage error. Pinned by the existing test at `ci-cli.test.js` "stale baseline warning precedes a --scope usage error", which must stay green unchanged.
3. Two CI-declared suites, no `localRuns`, unpushed HEAD: the second suite is never fetched (one `gh` call) and is `not-consulted`. Pinned in Task 1.
4. A dirty tree without `localRuns` still runs locally (not exit 3) and prints the early notice with `dirty-tree`. Pinned in Task 1.
5. `--local` on an unpushed HEAD: exit 0, no gh call, no notice line. Pinned in Task 1.

---

### Task 1: verify.js stops on head-not-pushed and announces local fallbacks

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/ci-source.js` (export a `HEAD_NOT_PUSHED = 'head-not-pushed'` constant beside `LOCAL_REQUESTED`/`NOT_CONSULTED`; use it at the `fallback('head-not-pushed')` site)
- Modify: `plugin/bin/verify.js` (`noVerdictLines` ~L234-242; stale-warning hold ~L536-540 and ~L616 and `scopeUsageExit` ~L591; CI loop and `noVerdict` finder ~L960-1006)
- Modify: `plugin/bin/lib/driver/steps.js` — no-change (its scoped call already passes `--local`, L1183-1187; its comment "under a declaration's localRuns" stays accurate enough — classify no-change)
- Test: `tests/bin-lib/verify/ci-cli.test.js`

**Interfaces:**
- Produces: `HEAD_NOT_PUSHED` export from `plugin/bin/lib/verify/ci-source.js`.
- Produces: `noVerdictLines(attempt, sha)` → `string[]` (3 lines). `attempt.fallback === HEAD_NOT_PUSHED` → the head-not-pushed variant (Global Constraints); otherwise the existing on-request lines unchanged. Departs from the spec Technical Approach's `noVerdictLines(attempt, { sha, onRequest })`: `onRequest` would be unused, since only an on-request run reaches the non-head-not-pushed branch (the `noVerdict` finder selects nothing else without the key).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/ci-cli.test.js`. Add a helper `const HNP_FIRST = (suite, sha) => \`verify.js: no verdict yet for suite "${suite}" — CI could not answer (head-not-pushed): HEAD ${sha.slice(0, 9)} is not on the remote; no check ran and no pass stamp was written.\`` and `const headOf = (r) => r.git('rev-parse', 'HEAD').trim();`.
  - `AC1.1, AC1.2: without the key an unpushed HEAD exits 3, runs no check, leaves no report, and names the short sha (#5800)` — `repoWith()`, `fakeGhEnv('unpushed')`, a pre-seeded stale `report.json` (as AC1.1 of #5369 does); assert `code === 3`, marker absent, `report.json` absent, no pass stamp, `stderr.split('\n')[0] === HNP_FIRST('tests', headOf(r))`, line 1 `=== '  Push the branch (commit first if the tree is dirty), then re-run this command,'`, line 2 `=== '  or re-run it with --local to run the suite on this machine.'`.
  - `AC2.1: under the key an unpushed HEAD exits 3 with the same head-not-pushed first line naming the short sha (#5800)` — `repoWith({ declExtra: KEY })`; `code === 3`, line 0 `=== HNP_FIRST(...)`.
  - `AC3.1-AC3.2: without the key a no-open-pr-at-head fallback still runs here, announces it before the check, and keeps the report row (#5800)` — `fakeGhEnv('nopr')`, `--cmd localMarkerCmd(marker)`; assert `code === 0`, marker present, `stderr.split('\n')[0] === 'verify.js: CI could not answer suite "tests" (no-open-pr-at-head) — running it on this machine'` (line 1 of stderr is written before any check starts), and stdout matches `/^CI: tests — ran locally \(no-open-pr-at-head\)$/m`.
  - `AC4.1: without the key two CI suites on an unpushed HEAD exit 3, the second not-consulted and never fetched (#5800)` — copy the keyed two-suite test with `TWO_SUITES` minus `KEY` (build the decl inline: `checks` + `ci` from `TWO_SUITES`, no `localRuns`); `--run runDir`; assert `code === 3`, verify event `noVerdict === true`, `ci` deepEquals `[{ suite: 'tests', used: false, fallback: 'head-not-pushed' }, { suite: 'other', used: false, fallback: 'not-consulted' }]`, `callLines(calls).length === 1`, neither marker exists.
  - `AC5.1: --local on an unpushed HEAD without the key runs here, exits 0, calls no gh and prints no fallback notice (#5800)` — assert `code === 0`, marker present, calls file absent, stderr does not include `CI could not answer`.
  - `without the key a dirty tree still runs here and announces dirty-tree (#5800)` — dirty fixture as in the #4347 dirty-tree test; `code === 0`, marker present, stderr includes `verify.js: CI could not answer suite "tests" (dirty-tree) — running it on this machine`.
  - `without the key a suite that fell back before an unpushed second suite prints no notice and keeps the no-verdict line first (#5800)` — two-suite decl (no key), `fakeGhEnv("unpushed")` but make the first suite fall back first: drive it with the fake gh: add an env switch `FAKE_GH_UNPUSHED_AFTER=1` to `FAKE_GH` that, on a pulls read, counts the `/pulls` lines already in `FAKE_GH_CALLS` (the call is appended before the branch) and answers `[]` (no-open-pr-at-head) when it is the first, the 422 otherwise; run with mode `green`; assert `code === 3`, `lines[0] === HNP_FIRST("other", headOf(r))`, stderr does not include `— running it on this machine`.
  - `under the key no fallback notice is printed (#5800)` — keyed `nopr` run: `code === 3`, stderr does not include `— running it on this machine`.
  - Update existing tests whose behavior this changes:
    - `AC4.1: without the key an unpushed HEAD still runs the suite here and exits 0 (#5369)` — delete (superseded by the #5800 AC1 test).
    - `without the key the stale baseline worktree warning is still stderr line 1 of a CI-declared --scope run (#5369 AC4)` — rewrite as `without the key a stale baseline worktree warning on an unpushed HEAD is printed after the no-verdict lines, never before (#5800)`: same fixture, assert `code === 3`, `lines[0] === HNP_FIRST('tests', headOf(r))`, `lines[3]` matches the stale-warning regex.
    - `NO_VERDICT_FIRST('tests', 'head-not-pushed')` uses in the keyed tests (AC1.1 of #5369, two-suites-first-unanswered, stale-after-no-verdict) — switch to `HNP_FIRST('tests', headOf(r))`; the #5369 AC1.1 test's `second` line becomes the new Push line.
  - The existing `stale baseline warning precedes a --scope usage error and one from an unreadable declaration` test stays unchanged and must stay green.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js`
Expected: FAIL — the new #5800 tests (exit 0 instead of 3 without the key; no notice line; old first line without the sha).

- [ ] **Step 3: Implement in `plugin/bin/verify.js`**
  - `noVerdictLines(attempt, sha)`: head-not-pushed → the three Global Constraints lines; else the current three lines. Update the comment above it (exit 3 now also on head-not-pushed under any declaration, #5800). Pass `startSha` at the call site.
  - Stale-warning hold: hold whenever the declaration has a `ci` block — change L616 to `if (!(decl && decl.ci)) flushStaleWarnings();` and update the two comments (L531-532, L536-538) to say a declaration with a `ci` block can end with no verdict (#5800). Make `scopeUsageExit` call `flushStaleWarnings()` before writing its message, so every `--scope` usage error keeps the stale warning first (Review Focus 2).
  - CI loop: the early notices are held, not written in the loop, so an exit-3 run never prints one (a run whose suite 1 fell back and suite 2 then hit `head-not-pushed` must still have the no-verdict line as stderr line 1). After `fetchCiVerdict` returns `!verdict.used`: `stopped = onRequest || verdict.ci.fallback === HEAD_NOT_PUSHED;`. After the `noVerdict` branch (which returns) and before the slot wait, when `!onRequest`, write one early-notice line per `ciAttempts` entry with `!used` and a fallback other than `LOCAL_REQUESTED`/`NOT_CONSULTED` — this covers `dirty-tree`/`tree-state-unreadable` skips and every fetched fallback from one place. Update the block comment (L960-969) to state head-not-pushed stops the run under any declaration (#5800).
  - `noVerdict` finder: `ciAttempts.find((a) => !a.used && a.fallback !== LOCAL_REQUESTED && a.fallback !== NOT_CONSULTED && (onRequest || a.fallback === HEAD_NOT_PUSHED))`.
  - Import `HEAD_NOT_PUSHED` beside `LOCAL_REQUESTED, NOT_CONSULTED`.

Proof(public-contract): verify.js's exit-3 contract widens only for `head-not-pushed` — the new ci-cli tests prove exit 3 without `localRuns` on an unpushed HEAD, exit 0 with `--local`, exit 0 with a local run for `no-open-pr-at-head`, and the existing keyed exit-3 tests stay green; no flag, verb or report field changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/ci-source.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js plugin/bin/lib/verify/ci-source.js tests/bin-lib/verify/ci-cli.test.js
git commit -m "Stop a scoped verify on an unpushed HEAD under any declaration — refs #5800"
```

### Task 2: Docs state the any-declaration rule, with conformance pins

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/verification.md` (L103 "CI source (#4347)" paragraph; L105 "Push first" paragraph; L121 "Outcome: the call exited 3" paragraph)
- Modify: `plugin/skills/test/ci-source.md` (L52 Fallback reasons lead-in; L57 `head-not-pushed` row; L68 `not-consulted` row)
- Modify: `docs/plugin-structure.md` (L344 verify.js synopsis `localRuns` clause; L103 `ci-source.js (#4347` entry)
- Modify: `docs/journeys/take-the-full-suite-verdict-from-ci-4347.md` (L24 "an unpushed HEAD … runs the suite locally")
- Test: `tests/pipelines-push-first-local-runs-conformance.test.js`
- Test: `tests/verify-local-runs-docs-conformance.test.js`
- No-change (behavior-change prose sweep, classified): `docs/journeys/keep-ci-declared-suites-off-this-machine-5369.md` (describes keyed behavior, still true), `docs/journeys/run-a-pipeline-that-takes-the-suite-from-ci-5370.md` (routing unchanged), `docs/decisions/0032-*.md` (historical decision record). Check B hits for `localRuns`/`head-not-pushed` elsewhere are no-change: `tests/bin-lib/driver/run.test.js` (a fake verify stderr fixture for the driver, which passes `--local`), `tests/bin-lib/timing/derive.test.js` (event-shape fixture), `docs/journeys/merge-a-parked-unattended-pr-3784.md` and `plugin/skills/wrap-up/merge-mode.md` (already pass `--local`), `plugin/skills/_shared/express-lane.md` (passes `--local`), and the remaining `localRuns` mentions describe the keyed mode, which this change leaves as is.

**Interfaces:**
- Consumes: Task 1's behavior (exit 3 on head-not-pushed under any declaration; early notice text).

- [ ] **Step 1: Add the failing pins**
  - `tests/pipelines-push-first-local-runs-conformance.test.js` `PUSH_FACTS`: add `[/exits 3 on `head-not-pushed` under any declaration, and on every other reason CI cannot answer only under `localRuns: "on-request"`/, 'head-not-pushed exits 3 under any declaration']` and `[/including a commit `\/test` itself makes \(flow's story step committing a story file\)/, 'a commit made inside /test needs its own push']`. The existing `exits 3, which is never a test failure` row must still match once.
  - `tests/verify-local-runs-docs-conformance.test.js` `REASON_FACTS`: replace the `not-consulted` row pattern with `/\| `not-consulted` \| An earlier suite already left the run with no verdict \(under `localRuns`, or on `head-not-pushed`\), so CI was not asked about this one\. \|/`; add `[/\| `head-not-pushed` \| GitHub does not know HEAD's commit\. Exits 3 with or without `localRuns`, and never runs the suite here\. \|/, 'the head-not-pushed row']`. `VERIFY_LINE_FACTS`: add `[/`head-not-pushed` exits 3 under any declaration/, 'plugin-structure: head-not-pushed exits 3']`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/verify-local-runs-docs-conformance.test.js`
Expected: FAIL naming the new facts.

- [ ] **Step 3: Edit the prose**
  - `verification.md` CI source (L103): replace "falls back to the local run with a named reason otherwise (under it the run exits 3 or needs `--local`)" with "falls back to the local run with a named reason otherwise, except `head-not-pushed`, which exits 3 under any declaration (under the key every reason exits 3 or needs `--local`)".
  - `verification.md` Push first: after "after any commit or catch-up merge that moves HEAD", add ", including a commit `/test` itself makes (flow's story step committing a story file)".
  - `verification.md` exit-3: replace the opening "Under the declaration's `localRuns: "on-request"` a scoped run CI cannot answer exits 3, which is never a test failure:" with "A scoped run exits 3 on `head-not-pushed` under any declaration, and on every other reason CI cannot answer only under `localRuns: "on-request"`. It exits 3, which is never a test failure: stderr's first line …" (the pinned phrase `exits 3, which is never a test failure` stays, once). Branches unchanged.
  - `ci-source.md` lead-in: "Without `localRuns`, every other reason except `head-not-pushed` runs the suite locally, exactly as selected (its impact subset included), and says so on stderr when it is decided (`verify.js: CI could not answer suite "{suite}" ({reason}) — running it on this machine`); `report.json`'s `ci` entry for that suite names why in `fallback`. `head-not-pushed` exits 3 in both modes, and under `localRuns` every reason does (`## Local runs on request`):" — must not contain the retired sentence `Every other outcome runs the suite locally, exactly as selected` (capital E; the retirement sweep is case-sensitive, keep it lowercase and reworded as above).
  - `ci-source.md` rows: `head-not-pushed` → `GitHub does not know HEAD's commit. Exits 3 with or without `localRuns`, and never runs the suite here.`; `not-consulted` → `An earlier suite already left the run with no verdict (under `localRuns`, or on `head-not-pushed`), so CI was not asked about this one.`
  - `docs/plugin-structure.md` synopsis: after "under `localRuns: "on-request"` a `--scope` run CI cannot answer exits 3 (no verdict yet, never a test failure; no report.json, no pass stamp)" add ", and `head-not-pushed` exits 3 under any declaration (#5800)". `ci-source.js` entry: after "verify.js exits 3 with no verdict" add "; `head-not-pushed` exits 3 under any declaration (#5800)".
  - Journey L24: "an unpushed HEAD ends the run with exit 3 under any declaration (#5800); a dirty tree, or a HEAD that is not the open PR's head, runs the suite locally (without …; under it the run exits 3 …)".

- [ ] **Step 4: Run to verify they pass (AC6.1)**

Run: `node --test tests/pipelines-push-first-local-runs-conformance.test.js tests/verify-local-runs-docs-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md plugin/skills/test/ci-source.md docs/plugin-structure.md docs/journeys/take-the-full-suite-verdict-from-ci-4347.md tests/pipelines-push-first-local-runs-conformance.test.js tests/verify-local-runs-docs-conformance.test.js
git commit -m "Document the any-declaration head-not-pushed exit — refs #5800"
```

### Task 3: Full-suite verification

Folded into `/build` Common Step 5, runner checks only.

- [ ] **Step 1: Run the whole suite (AC7.1)**

Run: `npm test -- --full`
Expected: PASS, 0 failures.
