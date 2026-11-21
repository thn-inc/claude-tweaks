# Cost Report Driver Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `funnel` section of `tools/pipeline-cost-report.js` reports, over the report window, how many driver runs happened (dispatch-routed vs standalone, and the last one), how many dispatch firings ran and reached the driver route (by plugin version), and one flag line when records were admitted while nothing routed any.

**Architecture:** `scanTranscript` (spend.js) records three more facts in its one pass: the first timestamp, the `claude-tweaks v{X.Y.Z} @` version, and whether a Bash `tool_use` ran the driver route. `funnel.js` gains `collectDriverRuns` (over `listRuns`' entries) and `collectDispatchFirings` (over main transcripts under the de-duplicated roots), and `collectFunnel` returns both. The CLI passes the run listing, roots, window and spend scope to `collectFunnel`, renders two rows plus the flag line, and adds the two sub-figures' `unreadable` to the section's `unreadable` total.

**Tech Stack:** Node 18+ CommonJS, `node:test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-21T183551-record-6012/work/6012-spec.md` (record #6012)

## Global Constraints

- No file under `plugin/` changes (spec Non-Goals, AC7). Tests may `require` plugin modules.
- Do not change the admission verdicts or the existing funnel rows; `funnel.unreadable` keeps its meaning (checks that threw or printed no verdict — `docs/journeys/measure-pipeline-spend-and-the-driver-funnel-5914.md` step 2 pins it). Scan failures of the new figures go in `driverRuns.unreadable` and `dispatchFirings.unreadable`, and the section's `unreadable(d)` accessor sums all three into the report's `Unreadable:` total.
- The flag line's exact copy (spec Deliverable 3): `Admitted records were not driven: {dispatchFirings.total} dispatch firings in the window, {dispatchFirings.reachedRoute} reached the driver route.`
- Route evidence is strict (spec Gotchas): only a Bash `tool_use` input counts, never prose; only main-session transcripts count, never `/subagents/`.
- Window rule: a run directory by its name's date; a session by its first timestamped line. Window bounds are the report's `--since`/`--until` UTC days, inclusive.
- Dispatch firings use the same scope as spend (`--match`/`--all-projects`, default the main checkout and its worktrees). A path scope that cannot resolve makes `dispatchFirings` `{ error }`, not an unscoped count.
- Governing skills: `.claude/skills/transcript-payload-verification/SKILL.md` names `spend.js` only for its `<synthetic>`-line rule ("Before chaining on \"the previous call\", or counting calls, grep a real store for `\"model\":\"<synthetic>\"` and decide which tallies such a line belongs in."). This change counts sessions and Bash inputs, not calls, so that rule does not apply; its real-payload procedure is honored by Task 3 Step 7's probe, run against real transcripts. `.claude/skills/gh-api-module-pattern/batching-failure-posture.md` names the tool only about `gh pr view --json files` truncation, which this change does not call.
- Commit subjects: `{Verb} {what} — {detail}`, body line `refs #6012`; never `closes`/`fixes`.

## Review Focus

1. A session whose first timestamped line is before `--since` but which ran on into the window is not a firing in it (Task 2 test `firing window is the first timestamped line`).
2. A driver run directory whose `manifest.json` does not parse counts as `standalone` and adds 1 to `driverRuns.unreadable` (Task 2 test `corrupt manifest`).
3. A dispatch session from another project (cwd outside the main checkout) is not counted under the default scope (Task 3 test `foreign dispatch session`).
4. An unresolvable pipelines directory prints `Driver runs: unavailable — ...`, no flag line, and leaves the exit code alone (Task 3 test `pipelines unavailable`).
5. A driver run dated before `--since` is not counted and does not set `last` (Task 2 test `out-of-window run`).

---

### Task 1: scanTranscript records route evidence, plugin version and first timestamp

**Files:**
- Modify: `tools/pipeline-cost-report/spend.js` (`scanTranscript`, header comment, exports)
- Test: `tests/pipeline-cost-report/spend.test.js`

**Interfaces:**
- Produces: `scanTranscript(file, { fsImpl })` result gains `firstTs: string|null` (the first parsed line's string `timestamp`), `pluginVersion: string|null` (first match of `/claude-tweaks v(\d+\.\d+\.\d+) @/` over the raw line text, any line, first match wins), `reachedRoute: boolean`. New export `isRouteCommand(command: string): boolean` — true when the command contains `drive.js` and a standalone `--check` token (`/(^|\s)--check(\s|$)/`), or contains `log-decision.js` and `Driver route (skipped)`.
- `reachedRoute` is true when any `assistant` line has a `tool_use` content block with `name === 'Bash'` and `isRouteCommand(block.input.command)`.

- [ ] **Step 1: Write the failing tests** (in `spend.test.js`, using its existing `fixture` helper)

```js
test('scanTranscript: a Bash drive.js --check call is route evidence; prose and other tools are not', async () => {
  const bash = (command) => ({ type: 'assistant', timestamp: '2026-11-19T09:00:00Z', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command } }] } });
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/drive.js" --check 5270')]))).reachedRoute, true);
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/log-decision.js" --run "/r" --status SKIP --step "Driver route (skipped)" --text x')]))).reachedRoute, true);
  assert.strictEqual((await scanTranscript(fixture([bash('node "/p/bin/drive.js" #5270')]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([{ type: 'user', message: { content: 'run `drive.js --check #5270` first' } }]))).reachedRoute, false);
  assert.strictEqual((await scanTranscript(fixture([{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/x/drive.js --check' } }] } }]))).reachedRoute, false);
});

test('scanTranscript: pluginVersion is the first claude-tweaks v{X.Y.Z} @ match in the raw text, else null', async () => {
  const hook = (v) => ({ type: 'attachment', attachment: { content: `rules...\n\nclaude-tweaks v${v} @ /cache/claude-tweaks/${v}` } });
  assert.strictEqual((await scanTranscript(fixture([hook('6.175.0'), hook('6.170.0')]))).pluginVersion, '6.175.0');
  assert.strictEqual((await scanTranscript(fixture([{ type: 'user', message: { content: 'claude-tweaks v{X.Y.Z} @' } }]))).pluginVersion, null);
});

test('scanTranscript: firstTs is the first line carrying a timestamp', async () => {
  assert.strictEqual((await scanTranscript(fixture([{ type: 'last-prompt' }, { type: 'user', timestamp: '2026-11-15T23:06:00Z', message: { content: 'x' } }, { type: 'user', timestamp: '2026-11-16T00:00:00Z', message: { content: 'y' } }]))).firstTs, '2026-11-15T23:06:00Z');
  assert.strictEqual((await scanTranscript(fixture([{ type: 'last-prompt' }]))).firstTs, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pipeline-cost-report/spend.test.js`
Expected: FAIL — `reachedRoute`/`pluginVersion`/`firstTs` are `undefined`.

- [ ] **Step 3: Implement in `spend.js`**: add `isRouteCommand`, track the three fields in the existing line loop (the version regex runs on `raw` before `JSON.parse`, only while `pluginVersion` is still null), return them, export `isRouteCommand`, and extend the header comment by one paragraph naming the three fields and the strictness rule.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/pipeline-cost-report/spend.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/spend.js tests/pipeline-cost-report/spend.test.js
git commit -m "Record driver-route evidence in scanTranscript — first timestamp, plugin version, Bash route call" -m "refs #6012"
```

---

### Task 2: funnel.js collects driverRuns and dispatchFirings

**Files:**
- Modify: `tools/pipeline-cost-report/funnel.js`
- Test: `tests/pipeline-cost-report/funnel.test.js`

**Interfaces:**
- Consumes: `scanTranscript` result fields from Task 1; `isUnderRoot` from spend.js; `listRuns` entry shape `{ name, date, dir, archived, members }` (runs.js).
- Produces:
  - `collectDriverRuns({ runs, since, until }, { fsImpl = fs } = {}) -> { total, dispatchRouted, standalone, last, unreadable }` — `runs` is `listRuns(...).runs`; `since`/`until` are `YYYY-MM-DD`. For each run with `since <= date <= until`: `readdirSync(dir)`; a throw adds 1 to `unreadable` and skips it. A run is a driver run when the listing holds `driver-events.jsonl`. Name matching `/-drive-\d+$/` → `standalone`. Otherwise read `manifest.json`: `lane === 'driver'` → `dispatchRouted`; missing → `standalone`; present but unreadable or not JSON → `standalone` and `unreadable += 1`; any other lane → `standalone`. `last` is the greatest driver-run date, or `null`.
  - `collectDispatchFirings({ roots, since, until, match = null, root = null }, { fsImpl = fs } = {}) -> { total, reachedRoute, byPluginVersion, unreadable }` — main transcripts only: `{root}/{slug}/*.jsonl` (never anything under `{slug}/{session}/`). Skip a file whose `mtimeMs` is before the `since` day's start (stat failure → `unreadable`). Scan each with `scanTranscript`; a reject → `unreadable`. Count it when `firstSkill === 'dispatch'`, `Date.parse(firstTs)` is within `[since 00:00Z, until+1 day 00:00Z)`, and the scope holds (same rule as `collectSpend`'s `wanted`: `match` substring of `cwd || slug`; `root` → `isUnderRoot(cwd, root)`). `byPluginVersion[pluginVersion || 'unknown'] += 1`; `reachedRoute` counts `reachedRoute === true`. An unreadable root or slug directory adds 1 to `unreadable`.
  - `collectFunnel({ repo, simulate = [], runs = { runs: [] }, roots = [], since, until, match = null, root = null, scopeError = null }, { gh, check, now, pluginVersion, fsImpl = fs })` result gains `driverRuns` (`{ error: runs.error }` when `runs.error`, else `collectDriverRuns`) and `dispatchFirings` (`{ error: scopeError }` when `scopeError`, else `collectDispatchFirings`). `since`/`until` default to `runDate`.

- [ ] **Step 1: Write the failing tests** (in `funnel.test.js`; build fixture dirs under `fs.mkdtempSync`, list them with the real `listRuns`, and write the routed run's manifest with the real writer: `require(path.join(ROOT, 'plugin', 'bin', 'lib', 'run-manifest', 'write.js')).fillRunManifest(dir, { lane: 'driver' })`)

```js
// AC1 fixture: top-level 2026-11-12T190721-drive-4351/driver-events.jsonl; archive/2026-11-19T090000-record-5270/
// driver-events.jsonl + manifest lane driver (via fillRunManifest); archive/2026-11-15T090000-record-5300/driver-events.jsonl, no manifest.
test('AC1.1: driverRuns counts standalone and dispatch-routed runs in the window', ...
  assert.deepStrictEqual(collectDriverRuns({ runs: listRuns(pipes).runs, since: '2026-11-08', until: '2026-11-21' }),
    { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 }));

test('out-of-window run: a driver run dated before since is not counted and does not set last', ...
  // add 2026-11-01T000000-drive-1/driver-events.jsonl to the AC1 fixture → same result as AC1.1

test('corrupt manifest: counts standalone and adds one to unreadable', ...
  // record-5270's manifest.json overwritten with '{' → { total: 3, dispatchRouted: 0, standalone: 3, last: '2026-11-19', unreadable: 1 }

test('a run directory without driver-events.jsonl is not a driver run', ...
  // a 2026-11-18T000000-spec-1 dir with manifest lane driver but no events file → total 0

// AC2 fixture: projects/{slug}/a.jsonl = dispatch session (Skill tool_use claude-tweaks:dispatch, timestamp 2026-11-19T09:00:00Z)
// with a Bash `node "/p/bin/drive.js" --check 5270` tool_use and an attachment line holding `claude-tweaks v6.175.0 @ /x`;
// projects/{slug}/b.jsonl = dispatch session with neither.
test('AC2.1: dispatchFirings counts dispatch sessions, the route reached, and plugin versions', async () => {
  assert.deepStrictEqual(await collectDispatchFirings({ roots: [projects], since: '2026-11-08', until: '2026-11-21' }),
    { total: 2, reachedRoute: 1, byPluginVersion: { '6.175.0': 1, unknown: 1 }, unreadable: 0 });
});

test('a subagent transcript and a non-dispatch session are not dispatch firings', ...
  // add {slug}/a/subagents/agent-x.jsonl (dispatch skill + drive.js --check) and {slug}/c.jsonl (flow session) → same as AC2.1

test('firing window is the first timestamped line', ...
  // a dispatch session whose first line is 2026-11-07T23:00:00Z and a later line 2026-11-09 → not counted (total stays 2)

test('AC5.1: a run directory that vanishes or a transcript that fails to parse adds to unreadable and is not counted', ...
  // collectDriverRuns with an fsImpl whose readdirSync throws ENOENT for one run dir → unreadable 1, that run absent;
  // collectDispatchFirings with a '{}'-free garbage file 'not json\n' → unreadable 1, total unchanged

test('collectFunnel returns driverRuns and dispatchFirings, or { error } when given one', ...
  // runs: { error: 'x' } → driverRuns { error: 'x' }; scopeError: 'y' → dispatchFirings { error: 'y' }; existing figures unchanged
```

Each `...` body follows the comment's fixture and asserts the stated object with `assert.deepStrictEqual`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pipeline-cost-report/funnel.test.js`
Expected: FAIL — `collectDriverRuns is not a function`.

- [ ] **Step 3: Implement** `collectDriverRuns`, `collectDispatchFirings` and the `collectFunnel` widening in `funnel.js`; export both new functions; extend the header comment with what each figure counts and the standalone-by-default rule ("so the flag errs toward speaking").

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/pipeline-cost-report/funnel.test.js tests/pipeline-cost-report/spend.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline-cost-report/funnel.js tests/pipeline-cost-report/funnel.test.js
git commit -m "Collect driver runs and dispatch firings in the funnel — counted from run dirs and main transcripts" -m "refs #6012"
```

---

### Task 3: the CLI renders driver activity and the flag line

**Files:**
- Modify: `tools/pipeline-cost-report.js` (funnel section `collect`/`unreadable`/`render`, scope computed for funnel too, header comment's funnel paragraph)
- Modify: `docs/plugin-structure.md:286` (the funnel clause of the CLI line gains "plus driver runs and dispatch firings over the window")
- Test: `tests/pipeline-cost-report/funnel.test.js`

**Interfaces:**
- Consumes: `collectFunnel` widening from Task 2.
- `run()` computes `scope` when `wants('spend') || wants('funnel')`. Funnel `collect` passes `runs: ctx.runs`, `roots: ctx.roots`, `since`, `until`, `match` (substring scope), `root` (path scope), and `scopeError: 'cannot resolve the main checkout ({scope.error}); pass --match <substring> or --all-projects'` when the path scope has no value; `fsImpl: ctx.deps.fs`.
- `unreadable(d)` = `d.unreadable + ((d.driverRuns && d.driverRuns.unreadable) || 0) + ((d.dispatchFirings && d.dispatchFirings.unreadable) || 0)`.
- `render(d)`, right after the `Checked:` line and before the refusal table, only when `d.driverRuns` is present (older render tests pass objects without it):
  - `Driver runs: {total} ({dispatchRouted} dispatch-routed, {standalone} standalone); last {last or 'none'}; unreadable: {unreadable}.` — or `Driver runs: unavailable — {error}`
  - `Dispatch firings: {total}; reached the driver route: {reachedRoute}; by plugin version: {'v n' pairs sorted by version text, ', '-joined, or 'none'}; unreadable: {unreadable}.` — or `Dispatch firings: unavailable — {error}`
  - the flag line (Global Constraints copy) when `d.admitted > 0`, neither figure has `error`, and `d.driverRuns.dispatchRouted === 0`
  - then one blank line.

- [ ] **Step 1: Write the failing tests** (in `funnel.test.js`, driving `run()` from `tools/pipeline-cost-report.js` with a fake `gh` listing N records, `check` admitting all, `now` 2026-11-21, `git: () => path.join(main, '.git')`, transcripts' `cwd` = `main`, argv `--since 2026-11-08 --until 2026-11-21 --projects {p} --pipelines {pipes} --section funnel`)

```js
const FLAG = (t, r) => `Admitted records were not driven: ${t} dispatch firings in the window, ${r} reached the driver route.`;

test('AC3.1: admitted records with only standalone runs print the flag line with the fixture counts', ...
  // 15 admitted; pipelines: 2026-11-12T190721-drive-4351/driver-events.jsonl; projects: AC2's two sessions
  assert.ok(md.includes(FLAG(2, 1)));
test('AC3.2: one dispatch-routed run in the window silences the flag line', ...
  // add archive/2026-11-19T090000-record-5270 (events + fillRunManifest lane driver) → !md.includes('Admitted records were not driven')
test('AC4.1: --json carries driverRuns and dispatchFirings with the Markdown figures', ...
  // AC1 + AC2 fixtures: json.funnel.driverRuns deepEqual { total: 3, dispatchRouted: 1, standalone: 2, last: '2026-11-19', unreadable: 0 },
  // json.funnel.dispatchFirings deepEqual { total: 2, reachedRoute: 1, byPluginVersion: { '6.175.0': 1, unknown: 1 }, unreadable: 0 };
  // Markdown includes 'Driver runs: 3 (1 dispatch-routed, 2 standalone); last 2026-11-19; unreadable: 0.'
  // and 'Dispatch firings: 2; reached the driver route: 1; by plugin version: 6.175.0 1, unknown 1; unreadable: 0.'
test('AC5.1: an unparseable transcript adds to the report unreadable figure and the run exits 0', ...
  // projects gains bad.jsonl = 'not json\n' → exit 0, json.funnel.dispatchFirings.unreadable 1, json.unreadable 1, json.funnel.unreadable 0
test('AC6.1: admitted records with no run dirs and no transcripts print the zero flag line', ...
  // 15 admitted, empty pipelines and projects dirs → md.includes(FLAG(0, 0))
test('foreign dispatch session: one outside the main checkout is not counted under the default scope', ...
  // add a dispatch session with cwd `${main}-marketplace` → dispatchFirings.total stays 2; with --all-projects it is 3
test('dispatch firings are counted once when a projects root is passed twice through a symlink', ...
  // --projects p --projects link-to-p → total 2
test('pipelines unavailable: prints Driver runs: unavailable, no flag line, exit unchanged', ...
  // one git call serves both the pipelines lookup and the path scope, so: omit --pipelines, pass --all-projects,
  // and a deps.git that throws → exit 0, md includes 'Driver runs: unavailable — cannot resolve the pipelines directory',
  // and no 'Admitted records were not driven'
```

Each `...` body builds the fixture its comment names and asserts what it states.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/pipeline-cost-report/funnel.test.js`
Expected: FAIL — no `Driver runs:` line / `driverRuns` undefined in `--json`.

- [ ] **Step 3: Implement** the CLI changes listed under Interfaces; update the header comment's `funnel` paragraph (two more figures, the flag line, the scope they share with spend) and `docs/plugin-structure.md:286`'s funnel clause.

- [ ] **Step 4: Run to verify they pass, with the neighbouring suites**

Run: `node --test tests/pipeline-cost-report/`
Expected: PASS, every test (cli.test.js's funnel render tests still pass: their objects carry no `driverRuns`).

- [ ] **Step 5: AC7 check**

Run: `git diff --stat origin/main -- plugin`
Expected: no output.

Waived AC7.1: a diff-level criterion with no unit test; this step's `git diff --stat` verifies it.

- [ ] **Step 6: Commit**

```bash
git add tools/pipeline-cost-report.js tests/pipeline-cost-report/funnel.test.js docs/plugin-structure.md
git commit -m "Render driver activity in the cost report funnel — driver runs, dispatch firings and the not-driven flag" -m "refs #6012"
```

- [ ] **Step 7: Real-input probe (no commit; record the result in the run's decisions.md)**

Run: `node tools/pipeline-cost-report.js --section funnel --since 2026-11-08 --until 2026-11-21 --json` from the worktree, then the same without `--json`.
Independent counts over the same inputs: `find "<main checkout>/.claude-tweaks/pipelines" -maxdepth 3 -name driver-events.jsonl` (expected today: the three `archive/2026-11-12T*-drive-*` runs → `driverRuns` total 3, standalone 3, dispatchRouted 0, last 2026-11-12), and a grep for `"skill":"claude-tweaks:dispatch"` over the main transcripts under the project's roots to bound `dispatchFirings.total`. Reconcile each printed figure with its independent count; a mismatch is a bug to fix in Task 2 or 3 before review. Log one `AUTO` line with both sets of numbers.
