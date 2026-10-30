# Tidy Acceptance Scan Server-Side Filter Implementation Plan (#4469)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/tidy`'s `acceptance-gap` and `parent-gate` scans from hitting `backlog-fetch-limit` on a large repo. Narrow both unbounded fetches on the server side, keep every client-side check and truncation warning, and make every searched or label-filtered warning honour GitHub search's 1000-result ceiling.

**Architecture:** This is a prose and fence change to one shared contract, `plugin/skills/_shared/github-pr-scan-acceptance.md`.
- **acceptance-gap.** The closed-record fetch gains a `--search` string. It holds the 30-day cutoff (`$SINCE`, a literal substituted from `{since-date}`) and excludes records that already carry an acceptance disposition, plus not-planned and duplicate closures. These are the cases `needsBackstop` already rejects. The client-side filters stay as they are, and so does the oversight floor.
- **parent-gate.** Under `work-links: native`, the state map narrows to `has:parent-issue`, which is exactly the native sub-issue population. Under `body-text` it stays unfiltered.
- **Search cap.** A searched fetch, and a label-filtered `gh issue list`, is capped at 1000 by GitHub, whatever `--limit` says. Every such warning therefore compares against `Math.min(LIMIT, 1000)` with `>=`.

**Tech Stack:** Markdown skill prose, bash fences, `gh` CLI search qualifiers, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-30T045550-spec-4469-4466/spec-4469/work/4469-spec.md`

**Provenance:** ported from the prior attempt's plan (branch `worktree-dispatch-record-4469`, PR #4547). That attempt stopped at plan review on two spec gaps, which the user has since decided in the record body (2026-10-30):
- The oversight floor stays client-side. The example query is illustrative only.
- The parent-gate state map is in scope.

This plan adds Task 3, which the amended Deliverable 3 requires, plus live evidence steps for the two live ACs.

## Global Constraints

- Keep the truncation warning for the narrowed fetch (spec Deliverables: "Keep the truncation warning for the narrowed fetch.").
- The oversight floor stays client-side (spec Deliverable 1). No `-label:risk:*` or `-label:size:*` qualifier may appear in any search string.
- `{resolved-limit}`, `{since-date}` and `{state-map-search}` are substituted as literals per block. They are never carried across Bash calls in a shell variable (the file's existing "Fetch limit" discipline). Inside a block, a literal assigned to a variable (`SINCE="{since-date}"`) is fine. That is the existing `LIMIT="{resolved-limit}"` pattern, and the fence-guard detector treats such names as static.
- No fence may add a shape that `tests/skill-fence-guard-shapes.test.js` flags, and no new allowlist entry may be added.
- `plugin/skills/_shared/github-pr-scan-acceptance.md` stays under `RAIL_BYTES` (52500). It is 41783 bytes at the merge base. Record #4466, built next on this same branch, also edits this file, so this plan's net growth must stay at or below 3000 bytes.
- Governing skill `skill-prose-conformance-tests` (quoted verbatim):
  - "Read live prose only when the prose is the declared contract". Here it is: the fence is the command tidy's scan agent runs.
  - "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
  - "For an adjacency or ordering claim, build the control so it carries the anchor and lacks only the thing being pinned, and run the *same* extraction over both".

## Acceptance-criteria map

| AC | Covered by |
|---|---|
| AC1: on this repo a tidy run's acceptance-gap fetch returns fewer rows than backlog-fetch-limit and reports no truncation warning. | Task 1 (fence), Task 4 Step 1 (live evidence) |
| AC2: under `work-links: native`, the parent-gate state-map fetch on this repo reports no truncation warning. | Task 2 (fence), Task 4 Step 2 (live evidence) |
| AC3: with `backlog-fetch-limit` above 1000, a searched fetch returning 1000 rows still reports its truncation warning. | Task 1 `searched fetches warn at the search ceiling`, Task 2 `state-map warning honours the search ceiling`, Task 3 `label-filtered parent fetches warn at the search ceiling`, Task 3 `ceiling arithmetic` |

## Probes run at plan time (prior attempt, 2026-10-29, re-cited)

- Resolver values on this machine (`plugin/bin/resolve-policy.js --values backlog-fetch-limit work-links`): `1000`, `native`.
- The `{since-date}` one-liner `node -e "console.log(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))"` prints a `YYYY-MM-DD` date.
- `gh issue list --state closed --limit 1000 --search 'closed:>={date} -reason:"not planned" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending' --json stateReason` returned 743 rows, all `COMPLETED`. Without the disposition and reason qualifiers it returned 866. The unfiltered `--state closed --limit 1000` returns exactly 1000, which is today's warning.
- `closed:>=@today-30d` returned 0, so relative dates are unsupported. An empty `{since-date}` (`closed:>=`) also returned 0, which fails in the quiet direction. The node block therefore throws unless `SINCE` matches `^\d{4}-\d{2}-\d{2}$`.
- `gh issue list --state all --search "has:parent-issue" --limit 1000` returned 254 rows. These included every sub-issue of the open parents.
- Search API ceiling: `--search "sort:created-desc" --limit 1500` returned 1000. An empty `--search "" --limit 1500` returned 1500, because the ordinary listing is used, with no ceiling.
- Label-filtered ceiling: `--label risk:low --state all --limit 1500` returned 1000 of 1513.
- An unsubstituted `{state-map-search}` literal would search for that text and return 0, so every sub-issue would read OPEN. The node block therefore throws unless `STATE_SEARCH` is `''` or `has:parent-issue`.

## Review Focus

- **Search's 1000-result ceiling.** Suppose `backlog-fetch-limit` is set above 1000 and a searched or label-filtered fetch returns exactly 1000 rows. It must still warn, because the old `=== LIMIT` test would stay silent. Pinned by Tasks 1-3.
- **Server filter drops a real gap.** Each negated label must be one `dispositionState` classifies as a disposition. Otherwise the server would hide a record that `needsBackstop` reports. Pinned by Task 1's `negated labels are exactly needsBackstop dispositions`.
- **Null `stateReason`.** A closed record with no recorded reason must stay in the result set. Negated `-reason:` qualifiers keep it, and a positive `reason:completed` would drop it. Pinned by Task 1's `never filters on a positive reason`.
- **Oversight floor stays client-side.** No search string may name a `risk:` or `size:` label. Pinned by Task 1's `oversight floor is not in the search string`.
- **Unsubstituted or empty placeholder.** An empty `{since-date}`, or a placeholder left unsubstituted, silently returns 0 rows and therefore 0 gaps. Pinned by Task 1's `since-date is validated` and Task 2's `state-map search is validated`.
- **body-text state map.** Under `work-links: body-text`, task-list children are not native links. The state map must stay unfiltered, or every sub-issue defaults to OPEN. Pinned by Task 2's `state map search is branch-resolved`.

---

### Task 1: Server-filter the acceptance-gap closed-record fetch

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, in two places:
  - the `acceptance-gap` scope's "Record set" paragraph and closed-record fetch fence (lines 53-75);
  - the "Fetch limit" paragraph beginning "A 30-day window does not bound…" (lines 119-126).
  The scope's two parent-fetch blocks belong to Task 3.
- Create: `tests/acceptance-scan-server-filter.test.js`

**Interfaces:**
- Consumes:
  - `dispositionState(labels: string[]) -> 'approved'|'changes-requested'|'pending'|'none'` from `plugin/bin/lib/issues/acceptance.js`;
  - the `read(rel)` helper pattern of `tests/fetch-sub-issues-prose-conformance.test.js` (via `tests/helpers/read-skill`).
- Produces two helpers in the test file, which Tasks 2 and 3 reuse:
  - `section(text: string, startHeading: string, endHeading: string|null) -> string`;
  - `assertClaimPinned(live: string, frozen: string, pattern: RegExp, msg: string)`.

- [ ] **Step 1: Write the failing test** in `tests/acceptance-scan-server-filter.test.js`.
  - **Setup.** `GAP = section(liveText, '## Scope: \`acceptance-gap\`', '## Scope: \`parent-gate\`')`. Freeze `PRE_CHANGE_GAP_FETCH` as a string constant holding the replaced lines verbatim: `gh issue list --state closed --limit "$LIMIT" \` / `  --json number,title,state,labels,closedAt,stateReason \` / `  > "$RAW"`, followed by `  if (raw.length === LIMIT) {`. Every positive pattern goes through `assertClaimPinned(GAP, PRE_CHANGE_GAP_FETCH, …)`.
  - `closed-record fetch is server-filtered`: pattern `/gh issue list --state closed --limit "\$LIMIT" \\\n\s+--search "closed:>=\$SINCE -reason:\\"not planned\\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending"/`. Also assert:
    - every `gh issue list --state closed` occurrence in `GAP` is followed within 120 chars by `--search`;
    - `GAP` contains at least one such occurrence, so the anchor is present.
  - `negated labels are exactly needsBackstop dispositions`: extract every `-label:(\S+?)(?="|\s)` from the live search string. Assert `assert.deepEqual(sorted, ['demo:approved','demo:changes-requested','demo:pending'])`, and assert `dispositionState([l]) !== 'none'` for each one.
  - `never filters on a positive reason`: the live search string has no `/(?<!-)reason:/` match.
  - `oversight floor is not in the search string`: the live search string has no `/label:(risk|size):/` match.
  - `searched fetches warn at the search ceiling`: `assertClaimPinned` on `/const CAP = Math\.min\(LIMIT, 1000\);\s*if \(raw\.length >= CAP\)/`. Also assert that `GAP`'s closed-record node block no longer contains `raw.length === LIMIT`.
  - `since-date is validated`: `assertClaimPinned` on `/SINCE="\{since-date\}"/` and on `/\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(process\.env\.SINCE/`. Also assert that `GAP` names the one-liner text `new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acceptance-scan-server-filter.test.js`
Expected: FAIL — `closed-record fetch is server-filtered` fails because there is no `--search` in the live fence.

- [ ] **Step 3: Edit the acceptance-gap scope.**
  - **"Record set" paragraph.** State three things:
    - the 30-day window and the disposition, not-planned and duplicate exclusions are applied server-side through `--search`;
    - the client-side cutoff, `needsBackstop` and the oversight floor still run on the narrowed set, unchanged;
    - `{since-date}` is resolved first, as its own call, with the one-liner above, and its `YYYY-MM-DD` output is substituted literally.
  - **Explanatory sentences.** Negated `-reason:` qualifiers are used rather than `reason:completed`, so that a closed record with a null `stateReason` stays in. The oversight floor stays client-side because it passes a record meeting either the risk or the size axis and fails closed on unscored records, which negated `-label:` qualifiers cannot express.
  - **Fence.** Add `SINCE="{since-date}"` and `export SINCE`. Insert `--search "closed:>=$SINCE -reason:\"not planned\" -reason:duplicate -label:demo:approved -label:demo:changes-requested -label:demo:pending" \` as the line after `gh issue list --state closed --limit "$LIMIT" \`. Keep the `--json` fields and the redirect.
  - **Node block, first statement.** Throw unless `/^\d{4}-\d{2}-\d{2}$/.test(process.env.SINCE || '')`. The message says `{since-date}` was not substituted and that an empty date returns zero rows.
  - **Node block, warning.** Replace `if (raw.length === LIMIT)` with `const CAP = Math.min(LIMIT, 1000); if (raw.length >= CAP)`. The message says:
    - the server-filtered fetch reached its cap, which is the smaller of `backlog-fetch-limit` and GitHub search's 1000-result ceiling;
    - records past the cap are invisible, so raise `backlog-fetch-limit` when it is below 1000;
    - at 1000 or above, the 30-day undisposed set itself exceeds the search ceiling and the scope cannot be complete.

    Keep the `closedAt > cutoff` filter and the write.
  - **"A 30-day window…" paragraph.** Rewrite its closed-record half to say the fetch is now bounded on the server by the window and the disposition filter. Keep the "971 closed issues in 30 days" observation, because it is why the cap and warning still matter. Leave the parent-fetch half to Task 3.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/acceptance-scan-server-filter.test.js tests/skill-fence-guard-shapes.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS (all five files, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance-scan-server-filter.test.js plugin/skills/_shared/github-pr-scan-acceptance.md
git commit -m "Server-filter tidy acceptance-gap closed fetch — refs #4469"
```

### Task 2: Narrow the parent-gate state map under native work-links

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, in the `parent-gate` scope:
  - move its `### \`work-links\` resolution` section (currently lines 424-442) to sit directly above its `### Fetch limit` section (currently line 363);
  - edit the Fetch-limit paragraph (lines 365-377), the state-map fence (lines 381-413), and the paragraph after the fence (lines 415-417).

  This task touches only the state-map half of the node block's warnings. The parent-fetch `f.length === LIMIT` warning belongs to Task 3.
- Modify: `tests/acceptance-scan-server-filter.test.js`

**Deictic re-resolution (reorder):** no reference needs flipping after the move, but re-read all four afterwards:
- the moved section's "the two branches below" still points down to `### Sub-issue enumeration`'s branches;
- the Fetch-limit text's "every fetch below" still points down to the fence;
- `### Sub-issue enumeration`'s "the state map just fetched above" stays correct;
- the oversight pre-filter's "this scope's own Fetch-limit and `work-links` resolutions state above" stays correct.

**Interfaces:**
- Consumes: `section`, `assertClaimPinned` from Task 1's test file.
- Produces: the `{state-map-search}` placeholder (literal `has:parent-issue` under `native`, empty under `body-text`) and the `STATE_SEARCH` env var.

- [ ] **Step 1: Write the failing test** by appending to `tests/acceptance-scan-server-filter.test.js`.
  - **Setup.** `PG = section(liveText, '## Scope: \`parent-gate\`', null)`. Freeze `PRE_CHANGE_PG` as a constant holding these replaced bytes, in order:
    1. the old `### Fetch limit` heading line;
    2. `gh issue list --state all --json number,state,labels --limit "$LIMIT" \`;
    3. `  if (states.length === LIMIT) {`;
    4. the old `### \`work-links\` resolution` heading line.

    The control therefore carries both ordering anchors in the pre-change order.
  - `state map search is branch-resolved`: `assertClaimPinned(PG, PRE_CHANGE_PG, …)` on `/STATE_SEARCH='\{state-map-search\}'/`, `/export STATE_SEARCH/`, and `/gh issue list --state all --search "\$STATE_SEARCH" --json number,state,labels --limit "\$LIMIT"/`. Plain asserts check that `PG` names `has:parent-issue` and `body-text` within 400 chars of `{state-map-search}`.
  - `work-links resolved before the state-map fetch`: an `orderOk(text)` helper returns true when both anchors are found and `text.indexOf('### \`work-links\` resolution') < text.indexOf('### Fetch limit')`. Assert `assert.ok(orderOk(PG))` and `assert.ok(!orderOk(PRE_CHANGE_PG))`. The same extraction runs on both, and the control carries both anchors.
  - `state-map warning honours the search ceiling`: `assertClaimPinned` on `/const STATE_CAP = process\.env\.STATE_SEARCH \? Math\.min\(LIMIT, 1000\) : LIMIT;\s*if \(states\.length >= STATE_CAP\)/`.
  - `state-map search is validated`: `assertClaimPinned` on `/\['', 'has:parent-issue'\]\.includes\(process\.env\.STATE_SEARCH\)/`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acceptance-scan-server-filter.test.js`
Expected: FAIL — `state map search is branch-resolved` fails because there is no `STATE_SEARCH` yet. Task 1's tests still pass.

- [ ] **Step 3: Edit the parent-gate scope.**
  - **Move.** Move the `work-links` resolution section above "Fetch limit". Add one sentence to it: its value also selects the state map's `{state-map-search}` value below.
  - **Fetch-limit paragraph.** Scope "`--state all` over the repo's entire lifetime with no recency bound" to `body-text`. Under `native` the map is searched, so the 1000-result ceiling also applies.
  - **Fence.** Add `STATE_SEARCH='{state-map-search}'` and `export STATE_SEARCH`. Change the state-map call to `gh issue list --state all --search "$STATE_SEARCH" --json number,state,labels --limit "$LIMIT" \`.
  - **Node block, first statement.** Throw unless `['', 'has:parent-issue'].includes(process.env.STATE_SEARCH)`. The message says the placeholder was not substituted.
  - **Node block, state-map warning.** The warning becomes `const STATE_CAP = process.env.STATE_SEARCH ? Math.min(LIMIT, 1000) : LIMIT; if (states.length >= STATE_CAP)`. Its message names three things:
    - the cap;
    - the default-to-OPEN consequence;
    - that raising `backlog-fetch-limit` past 1000 does not help a searched map.
  - **Prose after the fence.**
    - Under `native`, substitute `has:parent-issue`, because it is exactly the native sub-issue population. Verified live, it returned 254 rows that included every sub-issue of the open parents.
    - Under `body-text`, substitute the empty string, because task-list children are not native links. An empty `--search` keeps `gh issue list` on the ordinary listing rather than the search API, so there is no 1000 ceiling. Verified live, `--limit 1500` returned 1500 rows.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/acceptance-scan-server-filter.test.js tests/skill-fence-guard-shapes.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS (all five files, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance-scan-server-filter.test.js plugin/skills/_shared/github-pr-scan-acceptance.md
git commit -m "Narrow tidy parent-gate state map to native sub-issues — refs #4469"
```

### Task 3: Label-filtered parent fetches warn at the search ceiling

**Role:** integration

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-acceptance.md`, at three label-filtered parent-fetch warnings, all currently `f.length === LIMIT` (or `=== Number(process.env.FETCH_LIMIT)`):
  - the `acceptance-gap` scope's `body-text` parent fetch (line 152);
  - the `acceptance-gap` scope's `native` parent fetch (line 183);
  - the `parent-gate` scope's parent fetch (line 406).

  Also edit the parent-fetch half of the `acceptance-gap` "A 30-day window…" Fetch-limit paragraph.
- Modify: `tests/acceptance-scan-server-filter.test.js`

**Interfaces:**
- Consumes: `section`, `assertClaimPinned` from Task 1's test file.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test** by appending to `tests/acceptance-scan-server-filter.test.js`.
  - **Setup.** Freeze `PRE_CHANGE_PARENT_WARN` as a constant holding the three replaced lines verbatim, in file order:
    - `  if (fetched.some((f) => f.length === LIMIT)) {`
    - `  if (fetched.some((f) => f.length === Number(process.env.FETCH_LIMIT))) {`
    - `  if (fetched.some((f) => f.length === LIMIT)) {`
  - `label-filtered parent fetches warn at the search ceiling`:
    - count the matches of `/if \(fetched\.some\(\(f\) => f\.length >= Math\.min\((?:LIMIT|Number\(process\.env\.FETCH_LIMIT\)), 1000\)\)\)/g` in the live text. Assert exactly 3 matches, and assert 0 matches in `PRE_CHANGE_PARENT_WARN`;
    - assert that the live text no longer contains `f.length === LIMIT` or `f.length === Number(process.env.FETCH_LIMIT)`;
    - assert that `PRE_CHANGE_PARENT_WARN` does contain them, so the control carries the anchor.
  - `ceiling arithmetic`: a pure-JS table test of the predicate shape used in every rewritten warning, with `cap = (limit) => Math.min(limit, 1000)`:
    - `limit = 1500, rows = 1000` → warns (AC3);
    - `limit = 1000, rows = 743` → silent (AC1's live count);
    - `limit = 500, rows = 500` → warns;
    - `limit = 500, rows = 499` → silent.

    This guards the `>=` direction against a later `>` slip.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/acceptance-scan-server-filter.test.js`
Expected: FAIL — `label-filtered parent fetches warn at the search ceiling` finds 0 matches. Tasks 1-2 tests still pass. `ceiling arithmetic` passes on its own (append-shaped, pure).

- [ ] **Step 3: Edit the three warnings.**
  - Replace each `f.length === LIMIT` / `f.length === Number(process.env.FETCH_LIMIT)` with `f.length >= Math.min(LIMIT, 1000)` / `f.length >= Math.min(Number(process.env.FETCH_LIMIT), 1000)` respectively.
  - Each warning message's "returned exactly N records (the configured backlog-fetch-limit)" becomes "reached its cap of N records (the smaller of backlog-fetch-limit and GitHub's 1000-result ceiling for label-filtered lists)". N is the computed cap.
  - Add one sentence to the parent-fetch half of the "A 30-day window…" paragraph. It says a label-filtered `gh issue list` is capped at 1000 by GitHub whatever `--limit` says (verified live: `--label risk:low --limit 1500` returned 1000 of 1513), so raising `backlog-fetch-limit` past 1000 does not widen these fetches.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/acceptance-scan-server-filter.test.js tests/skill-fence-guard-shapes.test.js tests/fetch-sub-issues-prose-conformance.test.js tests/session-tmp-root-migration.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS (all five files, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add tests/acceptance-scan-server-filter.test.js plugin/skills/_shared/github-pr-scan-acceptance.md
git commit -m "Cap tidy label-filtered parent-fetch warnings at the search ceiling — refs #4469"
```

### Task 4: Live AC evidence (orchestrator, after Task 3's commit — scratch, never committed)

- [ ] **Step 1: AC1.** Run the shipped acceptance-gap fence's `gh` call and node warning block, with `{since-date}` from the one-liner and `{resolved-limit}` from the resolver.
  - Write the full output to `$PIPELINE_RUN_DIR/evidence/ac-acceptance-gap-fetch.txt` with a plain Bash redirect, after a `mkdir -p` of that absolute directory.
  - Log one `decisions.md` entry via `log-decision.js --section "/build" --status AUTO --step "AC evidence" --text-file {file}`. The entry gives the AC wording, the command shape, the row count against the limit, and whether a WARNING line was printed, and cites the evidence path.
  - Expected: a row count below 1000 and no WARNING line.
- [ ] **Step 2: AC2.** Do the same for the parent-gate state-map fence with `{state-map-search}` = `has:parent-issue` (`work-links: native`), writing to `$PIPELINE_RUN_DIR/evidence/ac-parent-gate-state-map.txt`.
  - Expected: a row count below 1000 and no state-map WARNING line.
