# Route github-pr-scan current-pr item 3 and repo-wide item 1 through pr-checks.js --pr (#3658) Implementation Plan

**Goal:** Two display-only CI readers in `plugin/skills/_shared/github-pr-scan.md` (`current-pr` item 3 → /help's Current PR row; `repo-wide` item 1 → /tidy's awaiting-review rows and CI failing/pending finding) still summarize CI from `gh pr checks` (the rollup alone), so a green rollup over a head run still in progress reads passing; route both through `bin/pr-checks.js --pr`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T011735-record-3658/work/3658-spec.md` (materialized from GitHub issue #3658)

**Byte-pin:** `plugin/skills/_shared/github-pr-scan.md` is 47,482 B against `RAIL_BYTES` 52,500 B (≈5,000 B headroom, already past the 90% soft flag). Keep the net growth under ~2,500 B; `tests/skill-size-single-source.test.js` fails over the rail.

**Verbatim-command probe (run once, read-only, 2026-10-21):** `node plugin/bin/pr-checks.js --pr 3849` printed `{"failing":[],"pending":["test"],"headRefOid":"14a21ce9…","localHead":null,"pr":3849,"state":"pending"}` — the `--pr` mode, its JSON shape and the `pending` name list are as `pr-checks.js`'s header states.

---

### Task 1: Route both display CI readers through `pr-checks.js --pr` and pin them

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md`
- Test: `tests/display-ci-readers-conformance.test.js` (existing — the #3469 suite for exactly these display readers; extend it, do not create a new file)
- Reuse (do not modify): `plugin/bin/pr-checks.js`

**What to change in `github-pr-scan.md`:**

1. **`current-pr` item 3** (currently: `` `gh pr checks {number}` → count failing / pending / passing. Exit code 8 … ``). Replace with a `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-checks.js" --pr {number}` read (one JSON line, exit 0 in every state) and an explicit state → count mapping, written as backticked pairings in the same arrow style `dispatch/settle-parked.md`'s CI status bullet uses, e.g.: `` `red`/`inherited-red` → failing (`failing.length`) ``, `` `pending` → pending (`pending.length`) ``, `` `green`/`no-ci` → passing (0 failing, 0 pending) ``, `` `read-failed`/`gh-absent` → `CI unavailable` `` — never rendered as passing. Say in one clause why (the rollup alone reads a partial head run as passing). Drop the now-irrelevant exit-code-8 sentence (pr-checks.js exits 0 in every state).
2. **`repo-wide` item 1.** Add `statusCheckRollup` to its `gh pr list --json` field list. Add a short bash fence (same shape as item 9's CI filter: `PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e "…"`, plugin root through the environment, never interpolated into JS; session-scoped temp file via `bin/session-tmp-resolve.js` per `_shared/session-tmp-root.md`, e.g. `PR_SCAN_OPEN=pr-scan-open.json`) whose script, per open PR:
   - rollup reads green (every entry's `conclusion || state` in item 9's `NON_BLOCKING` set `SUCCESS`/`SKIPPED`/`NEUTRAL`, or an empty rollup) → **only these PRs** get `pr-checks.js --pr {n}` (the call-budget narrowing the spec asks for); map `green`/`no-ci` → `passing`, `pending` → `pending`, `red`/`inherited-red` → `failing`, anything else or a thrown call → `unavailable`;
   - rollup not green → no per-PR call; `failing` when any entry's `conclusion || state` is a failure value (`FAILURE`, `ERROR`, `CANCELLED`, `TIMED_OUT`, `ACTION_REQUIRED`, `STARTUP_FAILURE`), else `pending`;
   - prints one line per PR (e.g. `#{n} CI {status}`) that the prose then uses as `CI {status}`.
   Then update item 1's prose so both findings key off that status instead of `gh pr checks`: the awaiting-review finding requires CI `passing` (a PR whose CI read is `unavailable` is not called passing — state in one clause which finding, if any, it lands in, and render `CI unavailable`); the CI failing/pending finding fires on `failing` or `pending`. **Keep these literals byte-identical** (pinned by `tests/tidy-report-rules.test.js:236-243` and `tests/sweep-backstop.test.js:261`): `awaiting review — last updated {age} ago, CI {status}, 0 unresolved threads — gh pr view {n} --web`, `Open PR awaiting review, nothing wrong (item 1's first finding)`, and the Findings-table row text.
3. Update the two Transport mentions that list `gh pr checks` among PR-backed calls (the `## Transport` bullet and the `repo-wide` **Transport split** paragraph) so they name `pr-checks.js --pr` instead — still PR-backed, still degrades per item on `gh`-absent (pr-checks.js reports `gh-absent`, which maps to `unavailable`). After the change `grep -n "gh pr checks" plugin/skills/_shared/github-pr-scan.md` should print nothing.

Do not touch item 9 (already routed, #3469) or any other file's prose.

- [ ] **Step 1: Failing test** — in `tests/display-ci-readers-conformance.test.js`, add tests named with the AC clause id `AC1.1`:
  - `AC1.1: pr-scan current-pr item 3 reads CI through pr-checks.js --pr and maps its states` — slice from `3. **CI checks**` to `4. **Repo-wide stale count`; assert it includes `pr-checks.js" --pr {number}`, does not include `gh pr checks`, and pins each state → count pairing via a factored `assert…Pairings(slice)` helper; add a go-red negative control that doctors `pending` to map to passing and asserts the same helper throws (the settle-parked test's pattern).
  - `AC1.1: pr-scan repo-wide item 1 calls pr-checks.js --pr only for rollup-green PRs` — slice item 1 (from `1. **Open PRs**` to `2. **Unresolved threads per open PR**`); assert `statusCheckRollup` is in its `gh pr list --json` list, the fence uses `PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT}" node -e "`, and `gh pr checks` is absent.
  - `AC1.1: item 1 CI script maps a pending head run under a green rollup to pending` — extract item 1's `node -e` body (reuse/generalize `item9Scripts`' regex extraction), substitute the temp-file token with a fixture path, run it against a fake `bin/pr-checks.js` (as the item-9 test does) that logs each `--pr` call to a file and returns per-PR states. Fixture PRs: rollup-green + fake `pending` → `pending` (the AC's exact case); rollup-green + `green` → `passing`; empty rollup + `no-ci` → `passing`; rollup-green + `red` → `failing`; rollup-green + fake exit 1 → `unavailable`; rollup with an in-progress entry (`conclusion: ''`) → `pending` **with no pr-checks call**; rollup with a `FAILURE` entry → `failing` **with no pr-checks call**. Assert the per-PR output lines and that the call log names exactly the rollup-green PRs.
  Run `node --test tests/display-ci-readers-conformance.test.js` — the new tests FAIL (prose not yet changed).
- [ ] **Step 2: Implement** — the three edits above in `github-pr-scan.md`.
- [ ] **Step 3: Run** `node --test tests/display-ci-readers-conformance.test.js tests/tidy-report-rules.test.js tests/sweep-backstop.test.js tests/skill-size-single-source.test.js` — PASS. `wc -c plugin/skills/_shared/github-pr-scan.md` stays under 52,500. Real-input probe: run item 1's fence once against this repo's live `gh pr list` and record the printed lines; independently count the open PRs (`gh pr list --state open --json number --limit 100 -q length`) and confirm the script printed one line per PR.
- [ ] **Step 4: Commit** — one commit, `Route github-pr-scan current-pr item 3 and repo-wide item 1 through pr-checks.js --pr — refs #3658`.

---

## Self-review

- **Spec coverage:** Deliverable 1 (current-pr item 3 → pr-checks.js + state mapping) = edit 1; Deliverable 2 (repo-wide item 1 with rollup-green narrowing) = edit 2; Deliverable 3 (conformance tests sliced per procedure) = Step 1's three tests. AC1.1 (partial run under green rollup shows pending in /help Current PR row and /tidy awaiting-review + CI findings) = current-pr pairing test + item-1 script test's rollup-green/pending case.
- **Placeholders:** none.
