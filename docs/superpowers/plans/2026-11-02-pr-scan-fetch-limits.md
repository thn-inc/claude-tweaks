# PR-Scan Fetch Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `gh issue list`/`gh pr list` fetch in the PR-scan contract is sized from `backlog-fetch-limit` instead of a fixed `--limit 50/100/200`, and a fetch that reaches its cap says so instead of silently truncating.

**Architecture:** `plugin/skills/_shared/github-pr-scan.md` is prose an agent executes: a dispatcher inlines one scope section into a scan agent's prompt, so every rule must live inside the scope that needs it. Each scope gains a **Fetch limit** paragraph (resolve `backlog-fetch-limit`, substitute `{resolved-limit}` literally — the house pattern already used by `_shared/trust-table.md` and `_shared/github-pr-scan-acceptance.md`), every fixed `--limit` becomes `--limit {resolved-limit}`, and the fenced `node -e` blocks that consume a capped fetch print a mechanical `WARNING:`. The file sits at 52,073 B against the 52,500 B Read rail and the change needs ~2,250 B, so Task 1 first moves the `triage-queue` scope (read only by `/help` Stage 4.6) into a new sibling `_shared/github-pr-scan-triage.md` behind a pointer stub — a headroom-forced split, the same remedy #204 applied for the acceptance scopes.

**Tech Stack:** Markdown skill prose, bash + `node -e` fences, `node --test` conformance suites.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T231622-record-4820/work/4820-spec.md`

## Global Constraints

- Release note (spec): "Stop tidy's PR scan silently truncating results on large repositories."
- AC (spec): "A test reproduces the behavior above and passes after the change."
- Read rail: `RAIL_BYTES` = 52,500 B (`plugin/bin/lib/skill-audit/budgets.js`). Measured at authoring: `github-pr-scan.md` 52,073 B; a scratch application of Task 2's edits without the split landed at 54,323 B (over); with the triage section moved out (5,036 B post-edit) it lands near 49.9 KB including the stub. `tidy/scan-procedures.md` is at 52,416 B (84 B headroom) — its Task 1 edit must shrink it, never grow it. `plan-audit.js` at the base reports the rail-measured (marker lines stripped) `github-pr-scan.md` at 51,944 B and the composed `pr-scan` bundle (`tidy/scan-procedures.md:294`) at 52,091 B max — Task 1's move takes the triage section out of that bundle too, so it must land before Task 2 grows the file; the `rail:` suite checks both the file and the bundle.
- No per-file byte pin in any test (`tests/skill-size-single-source.test.js` fails a byte assertion outside `budgets.js`; the `rail:` suite holds the ceiling).
- Placeholder discipline (verbatim, `_shared/trust-table.md`): "Substitute the literal number independently in each block — do **not** rely on a `${BACKLOG_FETCH_LIMIT:-1000}` expansion reading an `export` from an earlier step". Never resolve the limit with `LIMIT=$(node …resolve-policy.js…)` inside a fence that also runs `gh` — `tests/skill-fence-guard-shapes.test.js`'s `gh-computed-input` detector flags that shape and its allowlist only shrinks.
- GitHub caps a `--label`-filtered `gh issue list` at 1000 rows whatever `--limit` says (`_shared/github-pr-scan-acceptance.md`'s Fetch limit section: "`--label risk:low --limit 1500` returned 1000 of 1513"); an unfiltered `gh issue list --state open` / `gh pr list --state all` paginates past 1000. Label-filtered checks compare against `Math.min(LIMIT, 1000)`, unfiltered ones against `LIMIT`; both use `>=`.
- Live probes run read-only at authoring with the resolver's own value (`resolve-policy.js --values backlog-fetch-limit` → `1000`): `gh issue list --state open … --limit 1000` → 354 rows (the old `--limit 200` truncated it); `gh issue list --label ready --state open … --limit 1000` → 324 (old cap 200 truncated it); `gh issue list --label bot:in-progress … --limit 1000` → 27; `gh pr list --state all --json number,url,closingIssuesReferences --limit 1000` → 1000 (at cap — item 10's qualifier will fire on this repo); `gh pr list --state merged --limit 1000 --json number,headRefName` → 1000 (at cap).
- Scope and edit discipline (`build/SKILL.md`, verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Governing skill `skill-prose-conformance-tests` (verbatim rules this plan's tests must follow):
  - "Read governed markdown through `tests/helpers/read-skill.js`'s `readText()`, never a private `fs.readFileSync(p, 'utf8')`."
  - "freeze the bytes the change *replaced* as a fixture constant inside the test, then assert every pattern twice — it matches the live file, and it does **not** match the frozen excerpt."
  - "When the pinned prose is added in the same change, there is no frozen excerpt to use as a control. Prove each assertion on a mutated copy of the live text instead: delete or alter only the pinned clause, then assert the shared assertion helper throws **with that assertion's own message** — `assert.throws(() => assertBlock(mutated), { message }, …)` — preceded by `assert.notEqual(mutated, original)` so a replace that matched nothing cannot pass as a control."
  - "**A fence that calls `gh` runs against a shell-function stub, not a PATH shim.** Prepend a `gh() { … }` definition to the extracted fence inside the same `bash -c`. … pass the fixture paths through the spawn env, forward-slashed, never into the script text."
  - "**Run a snippet the Bash tool executes under both `bash --noprofile --norc` and `zsh -f`.** … Skip the zsh case with a visible reason when zsh is not on PATH (ubuntu CI), never silently".
  - "**Anchor the extraction on structure, not on a sentence.** A heading, a fence delimiter, or a table-row prefix survives ordinary editing".
  - "When the assertion is a count, prove the counter — with a synthetic minimal pair, not a frozen excerpt."
- Governing skill `shared-contract-extraction` (verbatim): "a **pointer-stub split** — move a whole section into a new sibling `_shared/*.md` file, leave a short pointer paragraph in the original naming the new file, and retarget any test that pins the moved text itself (a byte-pinned snippet, a prose-literal assertion — not a prose-citation pin, which survives the stub untouched)"; and "State in the record that the split was headroom-forced, so the next reader does not mistake the new file's boundary for a designed one."

## Review Focus

- A block carrying `{resolved-limit}` twice (the `gh` line and the `node` check) substituted only once — `String.prototype.replace` with a string pattern replaces the first occurrence — leaves `const LIMIT = {resolved-limit};`, a SyntaxError. Every fence-running helper uses `replaceAll` and asserts exit 0 (Task 2, Task 3).
- A `--label` fetch configured above 1000 that returns exactly 1000 rows is truncated and must warn; Task 2's `bot:in-progress` case and Task 3's `ready` case run limit 1500 with 1000 rows.
- An unfiltered fetch configured above 1000 that returns 1000 rows is complete and must not warn; Task 2's item 8 case runs limit 1500 with 1000 rows and asserts no `WARNING:`.
- Item 10's PR-join qualifier must ride only on a `no PR found` row and only when the PR fetch hit the cap; Task 2 asserts it present at the cap and absent one row under it.
- A `triage-queue` citation elsewhere (`_shared/pr-first-merge.md`, `wrap-up/auto-merge-short-circuit.md` cite "`_shared/github-pr-scan.md` `triage-queue` item 3") must still resolve in one hop through the stub; Task 1 pins the stub naming the new file.

## Out of scope (Build Common Step 4 files these via `/claude-tweaks:capture`, Key Files named)

- `plugin/skills/wrap-up/unblocked-records.md` lines 10 and 37 fetch `--limit 200` open/all issues with no truncation check (354 open issues measured) — same defect class, different contract.
- `github-pr-scan.md` item 10's second fence reads `process.env.UNSETTLED_AGE`, which its first fence sets as an unexported shell variable in a separate Bash call, so `AGE_HOURS` is `NaN` and the age threshold never filters. Pre-existing; Task 2's test sets `UNSETTLED_AGE` in the spawn env and its header comment names the defect.
- `triage-queue` item 3's `gh api …/commits?since=…&per_page=100` reads one unpaginated page — a busy week over 100 commits undercounts. Not a `gh issue/pr list` fetch.

---

### Task 1: Move the `triage-queue` scope into `_shared/github-pr-scan-triage.md`

**Role:** integration

**Files:**
- Create: `plugin/skills/_shared/github-pr-scan-triage.md`
- Modify: `plugin/skills/_shared/github-pr-scan.md` (line 3 consumer list; lines 389-441 → stub)
- Modify: `plugin/skills/help/status-scan.md:280`
- Modify: `plugin/skills/tidy/scan-procedures.md:294` (shrinks)
- Modify: `docs/skill-graph.md:78` and a new row under `## help`
- Modify: `docs/plugin-structure.md:116`
- Modify: `docs/journeys/compose-a-per-run-context-bundle-1988.md:100`
- Modify: `plugin/bin/lib/issues/pending-authorization.js:5-7` (comment only)
- Test: `tests/pr-first-merge.test.js:399-403`, `tests/plan-review-dispatch-relay-conformance.test.js:164`, `tests/issue-claims-pr-scan-composition.test.js` (retargets — moved-prose pin grep at authoring found these three content pins: `'3. **Auto-merged this week**'`, `'Render as three lines:'`, `TRIAGE_ITEM3`), and `tests/skill-fence-guard-shapes.test.js:98` (plan review: its ratchet entry for triage item 3's `SINCE=$(node -e …)` fence is keyed by file, so the move would leave it stale and the moved fence unallowlisted)
- No change (classified): `plugin/skills/_shared/pr-first-merge.md:324` and `plugin/skills/wrap-up/auto-merge-short-circuit.md:242` cite "`_shared/github-pr-scan.md` `triage-queue` item 3" — a citation the stub resolves in one hop, and `tests/pr-first-merge.test.js:64` pins that citation shape (`/github-pr-scan\.md.*triage-queue.*item 3/s`, which `github-pr-scan-triage.md` would not satisfy).

**Interfaces:**
- Produces: `plugin/skills/_shared/github-pr-scan-triage.md` holding the heading `## Scope: \`triage-queue\` (consumed by /help Stage 4.6)` and its items 1-3 plus the render line, moved byte-for-byte except the one transport cross-reference below. Task 3 edits this file.

- [ ] **Step 1: Retarget the three pins and add the stub pin**

  - `tests/pr-first-merge.test.js:399`: `read('plugin', 'skills', '_shared', 'github-pr-scan.md')` → `read('plugin', 'skills', '_shared', 'github-pr-scan-triage.md')` (the `scan` variable feeding both `item3` and `jq`).
  - `tests/plan-review-dispatch-relay-conformance.test.js:164`: the `'Render as three lines:'` row's path → `path.join('plugin', 'skills', '_shared', 'github-pr-scan-triage.md')`.
  - `tests/skill-fence-guard-shapes.test.js:98`: rekey `ratchet('_shared/github-pr-scan.md', 'gh-computed-input', 'SINCE=$(node -e …')` to `ratchet('_shared/github-pr-scan-triage.md', 'gh-computed-input', …)` — same detector, same anchor, so the allowlist does not grow.
  - `tests/issue-claims-pr-scan-composition.test.js`: drop `TRIAGE_ITEM3` from both `github-pr-scan.md` presence maps (mcp and gh/unresolved); add `const TRIAGE_FILE = 'plugin/skills/_shared/github-pr-scan-triage.md';` read through `readText`, and these tests:

```js
test('github-pr-scan-triage.md: triage-queue item 3 is transport=gh-fenced (absent under mcp, present under gh and unresolved)', () => {
  assert.equal(bundleFor(TRIAGE_FILE, 'mcp', triageContent).includes(TRIAGE_ITEM3), false);
  for (const transport of ['gh', UNRESOLVED]) {
    assert.equal(bundleFor(TRIAGE_FILE, transport, triageContent).includes(TRIAGE_ITEM3), true, `transport=${transport}`);
  }
});

test('github-pr-scan.md keeps a triage-queue stub that names the new file, and carries none of the moved body', () => {
  const stub = prScanContent.split('## Scope: `triage-queue` (consumed by /help Stage 4.6)')[1].split('\n## ')[0];
  assert.match(stub, /`_shared\/github-pr-scan-triage\.md`/);
  assert.equal(prScanContent.includes(TRIAGE_ITEM3), false, 'the moved item 3 must not remain in github-pr-scan.md');
  assert.equal(prScanContent.includes('TRIAGE_QUEUE_READY'), false, 'the moved item 1 fence must not remain in github-pr-scan.md');
});
```

- [ ] **Step 2: Run the retargeted suites to verify they fail**

Run: `node --test tests/pr-first-merge.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/issue-claims-pr-scan-composition.test.js`
Expected: FAIL — `ENOENT` on `github-pr-scan-triage.md` (and the stub test failing on `github-pr-scan.md` still carrying `TRIAGE_QUEUE_READY`).

- [ ] **Step 3: Move the section and write the stub**

Create `plugin/skills/_shared/github-pr-scan-triage.md` = this header, a blank line, then the section from `## Scope: \`triage-queue\` (consumed by /help Stage 4.6)` through the render line `Render as three lines: … — omit any line whose count is 0.` (cut from `github-pr-scan.md`, `<!-- when: transport=gh -->`/`<!-- /when -->` markers included), with exactly one in-section edit: `**Transport split (see Transport above):**` → `**Transport split (see \`_shared/github-pr-scan.md\`'s Transport section):**`.

```markdown
# GitHub PR Scan — Triage-Queue Scope

Split from `_shared/github-pr-scan.md` (#4820) when that file reached the Read-limit rail (`RAIL_BYTES`) — a headroom-forced split, not a designed boundary. That file's Detection Ladder and Transport rule still govern the scope below. Consumed by `/claude-tweaks:help` Stage 4.6 (`help/status-scan.md`) only — subagents cannot read this file, so the dispatcher inlines the scope section below whole, its Fetch limit rule and render line included, into the scan agent's prompt.
```

In `github-pr-scan.md`, the stub that replaces the cut section (heading unchanged):

```markdown
## Scope: `triage-queue` (consumed by /help Stage 4.6)

Extracted to `_shared/github-pr-scan-triage.md` (#4820, headroom-forced). This heading stays as a stub so existing section and item references (`triage-queue` item 3) still resolve in one hop: read that file's scope section, which runs behind this file's Detection Ladder and Transport rule.
```

Line 3: `Stage 4.6, **\`triage-queue\`** scope;` → `Stage 4.6, **\`triage-queue\`** scope, held in \`_shared/github-pr-scan-triage.md\`;`.

- [ ] **Step 4: Sweep the prose that describes the old location**

  - `help/status-scan.md:280`: `Scan per \`_shared/github-pr-scan.md\`, **\`triage-queue\`** scope.` → `Scan per \`_shared/github-pr-scan-triage.md\`, **\`triage-queue\`** scope (split from \`_shared/github-pr-scan.md\`, #4820).` — the rest of the sentence ("plus that file's `triage-queue` scope section and the three-line render format") now reads against the new file, unchanged.
  - `tidy/scan-procedures.md:294`: `(item 9's, \`triage-queue\` item 3)` → `(items 9's and 11's)`. Confirm `wc -c` drops below 52,416.
  - `docs/plugin-structure.md:116`: `(item 9's, item 11's — the \`pending-review\` PR staleness check, #2367 — \`triage-queue\` item 3)` → `(item 9's and item 11's — the \`pending-review\` PR staleness check, #2367)`.
  - `docs/skill-graph.md:78`: `plus the \`repo-wide\`/\`triage-queue\` scopes` → `plus the \`repo-wide\` scope and, in \`_shared/github-pr-scan-triage.md\` (#4820), the \`triage-queue\` scope,`; `(item 9's, \`triage-queue\` item 3) carry` → `(item 9's and item 11's here, \`triage-queue\` item 3 in the triage file) carry`.
  - `docs/skill-graph.md`, new last row of the `## help` table: `| \`_shared/github-pr-scan-triage.md\` | Stage 4.6's \`triage-queue\` scope — split from \`_shared/github-pr-scan.md\` (#4820) when that file reached the Read rail, so the split is headroom-forced, not a designed boundary. Inlined whole into the Stage 4.6 scan agent's prompt; read raw, never composed. |`
  - `docs/journeys/compose-a-per-run-context-bundle-1988.md:100`: `(item 9's body, \`triage-queue\` item 3 with its unconditional "omit the line" instruction)` → `(item 9's and item 11's bodies; \`triage-queue\` item 3 moved to \`_shared/github-pr-scan-triage.md\` in #4820)`. Leave the dated byte measurements and line 147 (history).
  - `plugin/bin/lib/issues/pending-authorization.js:6-7` comment: `(both in\n// _shared/github-pr-scan.md)` → `(in\n// _shared/github-pr-scan.md and _shared/github-pr-scan-triage.md)`.

- [ ] **Step 5: Run the suites to verify they pass**

Run: `node --test tests/pr-first-merge.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/issue-claims-pr-scan-composition.test.js tests/skill-fence-guard-shapes.test.js tests/skill-graph-dangling-pointer.test.js tests/skill-graph-table-structure.test.js`
Expected: PASS. Then `wc -c plugin/skills/_shared/github-pr-scan.md plugin/skills/_shared/github-pr-scan-triage.md plugin/skills/tidy/scan-procedures.md` — all three under 52,500.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan-triage.md plugin/skills/_shared/github-pr-scan.md plugin/skills/help/status-scan.md plugin/skills/tidy/scan-procedures.md docs/skill-graph.md docs/plugin-structure.md docs/journeys/compose-a-per-run-context-bundle-1988.md plugin/bin/lib/issues/pending-authorization.js tests/pr-first-merge.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/issue-claims-pr-scan-composition.test.js tests/skill-fence-guard-shapes.test.js
git commit -m "Move the triage-queue scope into its own pr-scan file — headroom for #4820's fetch limits

refs #4820"
```

---

### Task 2: Size `current-pr` and `repo-wide` fetches from `backlog-fetch-limit`, warn at the cap

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan.md` (line 5 preamble; `current-pr` scope; `repo-wide` scope items 1, 3, 4, 5, 6, 7, 8, 9, 10; Output Contract's `[queue]` bullet)
- Create: `tests/github-pr-scan-fetch-limit.test.js`
- Modify: `tests/display-ci-readers-conformance.test.js:176` (plan review: it pins item 1's `--limit 100`; the pin becomes `/gh pr list --state open --json [^\n]*statusCheckRollup[^\n]*--limit \{resolved-limit\}/`)

**Interfaces:**
- Consumes: Task 1's moved file (this task never edits it).
- Produces (in `tests/github-pr-scan-fetch-limit.test.js`, for Task 3): `fenceAfter(text, label, nth = 0) -> string` (the body of the `nth` ```` ```bash ```` fence after the first occurrence of `label`; asserts both found — "extraction pattern is out of sync" on a miss); `runFence(fence, { limit, ghRows = [], files = {}, env = {}, shell = 'bash' }) -> { status, stdout, stderr }` (substitutes every `{resolved-limit}` with `replaceAll`; writes `ghRows` as JSON to a temp file and prepends `gh() { cat "$FAKE_GH_OUT"; }`, passing that path forward-slashed in the spawn env; sets `CLAUDE_PLUGIN_ROOT` (forward-slashed `plugin/`) and a fresh `CLAUDE_CODE_SESSION_ID`; writes each `files` entry `{ name: rows }` — `rows` an array written as JSON, or a string written as-is — to `path.join(sessionTmpRoot(sessionId), name)` before the run (`tests/acceptance-scan-server-filter.test.js`'s `runClosedFence` is the shape to copy); `shell: 'zsh'` runs `zsh -f -c`, otherwise `bash --noprofile --norc -c`; removes the temp dir and session root after); `limitSites(text) -> string[]` (joins `\`-continued lines, then returns the captured limit token of every match of `` /gh (?:issue|pr) list\b[^`\n]*?--limit\s+([^\s`]+)/g `` — one match per call, two on item 4's line; `` [^`] `` keeps a match inside one code span, so line 5's prose naming `` `gh pr list` `` and `` `--limit {resolved-limit}` `` in separate spans is no match, and the capture stops before a closing backtick or trailing `.`. Run at authoring over the base file outside the triage scope it returns `["100","100","100","50","50","100","100","100","200","100","200","200"]`, inside it `["200","200"]`); `fixedLimitSites(text)` = `limitSites(text).filter((t) => /^\d+$/.test(t))`; `assertRule(scopeText)` — throws `AssertionError` with a message containing `Fetch limit` unless `scopeText.includes(RULE)`; `RULE` — the exact Fetch limit paragraph below, as a string.

The Fetch limit paragraph (`RULE`), byte-exact, used in three places (current-pr here, repo-wide here, triage-queue in Task 3):

```markdown
**Fetch limit.** `{resolved-limit}` is the number `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values backlog-fetch-limit` prints, substituted literally into each command and block below, every occurrence; shell state does not survive between Bash calls. A fetch returning that many rows, or 1000 for a `--label` fetch (GitHub's cap), may be truncated: a block that checks prints a `WARNING:` line, and any other count at the cap is a floor, never a final count. Report every `WARNING:` line verbatim beside this scope's rows, never suppressed, and render a floor count as `{N}+`.
```

(Plan review added the last sentence: a stderr warning the scan agent drops would leave `/tidy`'s report showing bare capped counts — the spec's observed symptom. It follows `_shared/github-pr-scan-acceptance.md`'s "Report its two `WARNING:` lines verbatim beside the rows; never suppress them.")

- [ ] **Step 1: Write the failing tests**

Header comment: cite #4820, the carve-out (the prose is the declared contract — an agent runs these fences), and the `UNSETTLED_AGE` cross-fence defect (out of scope, captured). Tests, each a separate `test()`:

1. `no gh list call in github-pr-scan.md carries a fixed --limit` — `assert.deepEqual(fixedLimitSites(LIVE), [])`. Prove the helper: `fixedLimitSites(PRE_CHANGE_ITEM8)` has length 1; `fixedLimitSites('gh pr list --state all --json number \\\n  --limit 200 > "$X"')` has length 1 (continuation join); `fixedLimitSites('gh issue list --state open --limit {resolved-limit}')` is `[]`; `fixedLimitSites('#    across \`--state all --limit 200\` exceed')` is `[]` (no `gh … list` on the line — item 10's node-budget comment stays).
2. `every gh list call in github-pr-scan.md is sized from {resolved-limit}` — `limitSites(LIVE).filter((t) => t === '{resolved-limit}').length === 12` and `limitSites(LIVE).length === 12` (current-pr item 4; repo-wide items 1, 3, 4 ×2, 5, 6, 7, 8, 9, 10 ×2 — 12 `--limit` matches measured at the plan's base, outside the moved triage scope). Prove the counter on a synthetic pair: `` '`gh pr list --state merged --limit {resolved-limit}` AND `gh pr list --state closed --limit {resolved-limit}`' `` yields 2 sized tokens; the same string with `--limit 50` yields 0 sized and 2 fixed; `` 'Every `gh pr list` call takes `--limit {resolved-limit}`' `` yields 0 matches.
3. `current-pr and repo-wide each carry the Fetch limit rule` — `assertRule(scopeText)` checks `scopeText.includes(RULE)` for the `## Scope: \`current-pr\`` and `## Scope: \`repo-wide\`` sections (sliced heading-to-next-`\n## `). Go-red: `assert.notEqual` then `assert.throws(() => assertRule(mutated), { message: /Fetch limit/ })` with `RULE` removed from the live repo-wide slice. Because `RULE` is matched whole, this also pins its "Report every `WARNING:` line verbatim … render a floor count as `{N}+`" sentence; prove that by stripping only that sentence from the live slice and asserting the same message-matched throw.
3a. `the Output Contract's [queue] row renders a floor count` — the Output Contract bullet starting `` - `[queue]` `` contains `{N}+` (Step 3's exact addition). Go-red by mutating it out in memory, message-matched.
4. `item 8 reproduces #4820: the pre-change fence reports capped counts silently` (AC1.1, with test 5 — "A test reproduces the behavior above and passes after the change.") — freeze `PRE_CHANGE_ITEM8` = the current item 8 fence body verbatim (from `PR_SCAN_RECORDS="$(node` through the closing `"` of its `node -e`, with `--limit 200`). Run it via `runFence` with `limit` irrelevant and the stub serving 200 rows `{ number, title, labels: [] }`: `status === 0`, `stdout` parses to `{ pending: 0, blocked: 0, backlog: 200 }`, and `stderr` contains no `WARNING:`.
5. `item 8 warns when the open-issue fetch reaches the limit` — `fenceAfter(REPO_WIDE, '8. **Grant-queue counts**')`; limit 200, 200 rows → `status 0`, same stdout JSON, `stderr` matches `/^WARNING: \[queue\] fetched 200 open issues, the backlog-fetch-limit cap — these counts are a floor$/m`; limit 200, 199 rows → no `WARNING:`; limit 1500, 1000 rows → no `WARNING:` (unfiltered fetch, no 1000 cap). Run the 200-row case under `bash --noprofile --norc` and `zsh -f` (skip zsh with `t.skip('zsh not on PATH')` when `spawnSync('zsh', ['-f', '-c', 'true']).error`).
6. `item 10 warns at the bot:in-progress cap and qualifies no-PR rows at the PR-join cap` — `fenceAfter(REPO_WIDE, '10. **Unsettled run**', 1)` (the second bash fence, the `node -e` join); `files`: `pr-scan-unsettled-claims.jsonl` empty, `pr-scan-unsettled-labelled.json` 2 rows `{ number, updatedAt: <48h ago> }`, `pr-scan-unsettled-prs.json` N rows `{ number: 9000+i, url, closingIssuesReferences: [] }`; `env: { UNSETTLED_AGE: '24' }`. Limit 2, N=2 → stderr matches `/^WARNING: \[unsettled\] the bot:in-progress fetch reached its cap — issues past it are unchecked$/m`, and both stdout rows match `/no PR found \d+h after claim \(the PR fetch hit backlog-fetch-limit — an older PR may exist\) — resume:/`. Limit 3, N=2 → no `WARNING:`, no `(the PR fetch hit` in stdout. Limit 1500, labelled 1000 rows, N=2 → the `bot:in-progress` warning fires (label cap), the PR qualifier does not.

`PRE_CHANGE_ITEM8` is the fence exactly as it reads at this plan's base (`github-pr-scan.md` lines 96-108). Copy it out of the file before Step 3 edits it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/github-pr-scan-fetch-limit.test.js`
Expected: FAIL — tests 1, 2, 3, 3a, 5 and 6 red (fixed limits present, rule absent, no floor render, no warnings); test 4 passes (it pins the pre-change behavior).

- [ ] **Step 3: Edit `github-pr-scan.md`**

Each edit replaces exactly one occurrence:

- Line 5, whole paragraph → `Every \`gh issue list\`/\`gh pr list\` call below takes \`--limit {resolved-limit}\` (\`backlog-fetch-limit\`), never a fixed number: \`gh\`'s implicit 30, or any fixed cap, truncates silently once the repo outgrows it (#4820). Each scope states its own Fetch limit rule, since a scope is inlined without this preamble.`
- `current-pr`: insert `RULE` as its own paragraph after the scope's intro paragraph (the one ending "…a blanket \"GitHub scan skipped\" at check 2: item 1 emits … as a consequence (each depends on item 1's PR number or is the same class of call)."). Item 4: `--limit 100` → `--limit {resolved-limit}`.
- `repo-wide`: insert `RULE` as its own paragraph directly after the `> **Parallel execution:**` note. Then `--limit 100` → `--limit {resolved-limit}` in items 1 (fence), 3, 5, 6, 7 and 9 (fence); item 4's two `--limit 50` → `--limit {resolved-limit}`; item 8's `--limit 200` → `--limit {resolved-limit}`; item 10's two `--limit 200` (the `bot:in-progress` and `--state all` fetches) → `--limit {resolved-limit}`. Leave item 10's `# … across \`--state all --limit 200\` exceed GitHub's` comment (it records #2853's measured incident).
- Item 8's `node -e`, directly after `const issues = require('$PR_SCAN_RECORDS');`:
  `if (issues.length >= {resolved-limit}) console.error('WARNING: [queue] fetched ' + issues.length + ' open issues, the backlog-fetch-limit cap — these counts are a floor');`
- Item 10's second fence, directly after `const claimedNumbers = new Set(claimed.map((c) => c.number));`:
  `const LIMIT = {resolved-limit};`
  `if (require('$PR_SCAN_UNSETTLED_LABELLED').length >= Math.min(LIMIT, 1000)) console.error('WARNING: [unsettled] the bot:in-progress fetch reached its cap — issues past it are unchecked');`
  directly after `const prs = require('$PR_SCAN_UNSETTLED_PRS');`:
  `const PR_CAPPED = prs.length >= LIMIT ? ' (the PR fetch hit backlog-fetch-limit — an older PR may exist)' : '';`
  and in the no-PR row, `'h after claim — resume: node` → `'h after claim' + PR_CAPPED + ' — resume: node` (the rest of that `console.log` unchanged; keep the line's existing `\"`/`\${…}` escaping). Each inserted line takes its fence's existing indentation.
- Output Contract, the `[queue]` bullet: after `` `[queue] {N} pending authorization, {M} bot:blocked, {K} backlog` `` append ` — each count rendered \`{N}+\` when item 8's block warned that the fetch hit its cap`.
- `tests/display-ci-readers-conformance.test.js:176`: `--limit 100/` → `--limit \{resolved-limit\}/` in that one regex.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/github-pr-scan-fetch-limit.test.js tests/github-pr-scan-unsettled-node-budget.test.js tests/issue-claims-pr-scan-composition.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js tests/display-ci-readers-conformance.test.js`
Expected: PASS. Then `wc -c plugin/skills/_shared/github-pr-scan.md` — under 52,500.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan.md tests/github-pr-scan-fetch-limit.test.js tests/display-ci-readers-conformance.test.js
git commit -m "Size the PR scan's fetches from backlog-fetch-limit — warn instead of truncating silently

refs #4820"
```

---

### Task 3: Size the `triage-queue` fetches and render capped counts as floors

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/_shared/github-pr-scan-triage.md`
- Test: `tests/github-pr-scan-fetch-limit.test.js`

**Interfaces:**
- Consumes: Task 1's file; Task 2's `fenceAfter`, `runFence`, `limitSites`, `fixedLimitSites`, `assertRule`, `RULE`.

- [ ] **Step 1: Write the failing tests** (append to `tests/github-pr-scan-fetch-limit.test.js`)

1. `no gh list call in github-pr-scan-triage.md carries a fixed --limit` — `fixedLimitSites(TRIAGE) → []`, and `limitSites(TRIAGE)` is exactly `['{resolved-limit}', '{resolved-limit}']` (items 1 and 2).
2. `triage-queue carries the Fetch limit rule and the floor render` — `assertRule(TRIAGE)` (`TRIAGE` = `readText` of `github-pr-scan-triage.md`; Task 2's helper; `RULE` already carries the `{N}+` floor-render sentence); go-red by removing `RULE` from the live text in memory, message-matched as in Task 2 test 3.
3. `triage item 1 warns at the ready-fetch cap` — `fenceAfter(TRIAGE, '1. **Pending authorization**')`; stub rows `{ number, labels: [{ name: 'ready' }] }`. Limit 2, 2 rows → `stdout.trim() === '2'`, stderr matches `/^WARNING: \[triage\] the ready fetch reached its cap — the pending count is a floor$/m`; limit 3, 2 rows → no `WARNING:`; limit 1500, 1000 rows → warns (label cap); limit 1500, 999 rows → no `WARNING:`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/github-pr-scan-fetch-limit.test.js`
Expected: FAIL — the three triage tests red; Task 2's tests stay green.

- [ ] **Step 3: Edit `github-pr-scan-triage.md`**

- Insert `RULE` as its own paragraph directly after the scope's intro paragraph ("Three cheap counts for the dashboard's Triage Queue section. … on the same dashboard.").
- Item 1: `--limit 200` → `--limit {resolved-limit}`; directly after `const issues = require('$TRIAGE_QUEUE_READY');` insert `if (issues.length >= Math.min({resolved-limit}, 1000)) console.error('WARNING: [triage] the ready fetch reached its cap — the pending count is a floor');`
- Item 2: `--limit 200 -q 'length'` → `--limit {resolved-limit} -q 'length'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/github-pr-scan-fetch-limit.test.js tests/pr-first-merge.test.js tests/plan-review-dispatch-relay-conformance.test.js tests/issue-claims-pr-scan-composition.test.js tests/skill-fence-guard-shapes.test.js tests/session-tmp-placeholder-quoting-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/github-pr-scan-triage.md tests/github-pr-scan-fetch-limit.test.js
git commit -m "Size the triage-queue fetches from backlog-fetch-limit — render a capped count as a floor

refs #4820"
```
