# #2828 Tidy Shape 4.5 Release-Note Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:tidy` finds every open `ready` record whose only spec-shape gap is a missing or empty `## Release Note` and fills it in place. The fill is one agent-written line, and every label and grant stays as it was. It auto-applies at the default `moderate` tier, with an undo snapshot taken before the write.

**Architecture:** A new tested CLI, `plugin/bin/release-note-repair.js`, sits over two pure modules in `plugin/bin/lib/release-note-repair/` (`detect.js`, `apply.js`). It owns every mechanical step:
- detection, via `compose-record.js --check`'s own exported `run`;
- the Deliverable 2 bounds;
- the insert or fill, and the line-diff proof;
- the snapshot, the post-write verify, and the `AUTO` log entry.

The skill prose owns only three things: the agent-composed line, the `gh` read and write calls, and branching on the CLI's exit codes. The Work Records scan agent runs `scan` and returns one summary row. The full candidate list goes to a session-tmp file that the dispatcher names, which avoids Template A's 15-row cap. The main thread then runs the repair procedure in a new sub-file, `plugin/skills/tidy/release-note-repair.md`.

**Tech Stack:** Node 18+ built-ins only (`fs`, `path`, `os`, `crypto`, `util`), `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-09-29T183057-spec-2827-2828/spec-2828/work/2828-spec.md`

## Global Constraints

- Plugin payload is `plugin/` only; tests go under `tests/`. No new npm dependency.
- CLI wrapper contract: logic in exported `run(argv, deps)`; `require.main === module` sets `process.exitCode` — never `process.exit` (`tests/bin-lib/exit-code-conformance.test.js` scans every `plugin/bin/**/*.js`).
- Skill prose writes plugin paths as `node "${CLAUDE_PLUGIN_ROOT}/bin/…"` / `require('${CLAUDE_PLUGIN_ROOT}/bin/…')` (`docs/skill-authoring.md` § Plugin-root references); skill references in actionable text are fully qualified `/claude-tweaks:{skill}`.
- Every fenced `bash` block added to `plugin/skills/**` is bound to a `node --test` file that extracts and **executes** it (`docs/skill-authoring.md` § Executable snippets). No bare backtick inside a double-quoted `node -e "…"` body (`tests/node-e-snippet-syntax.test.js`).
- The repair never adds or removes a label, never closes a record, never resets retry counters, never restores a lost grant (spec Gotchas).
- The undo snapshot lives at `{run-dir}/snapshots/tidy-release-note-{id}.original.md` — **never** under `{run-dir}/staged/` (see Spec defects below).
- Not modified by this plan: `plugin/bin/compose-record.js`, `plugin/skills/specify/spec-template.md`, `plugin/skills/_shared/reverify-before-write.md` (spec Key Files: cited, not modified).
- Byte budgets (measured 2026-09-29; `CEILING_BYTES = 45 * 1024 = 46,080`, `plugin/bin/lib/skill-audit/context-cost.js:31`, a warning tier since #1990; no tidy file is a compose-context source): `step-6-auto.md` 44,079 → must end ≤ 46,080 (planned ≈ 45,065); `step-1-records.md` 32,280 (planned ≈ 34,700); `SKILL.md` 34,044 (planned ≈ 36,000); `collection-routing.md` 2,431; `_shared/auto-mode-contract.md` 39,935. Measure with `wc -c` at the end of every task that edits one.
- Commit subjects: `{Verb} {what} — {detail} (refs #2828)`, never `closes`/`fixes`. Every commit message ends with a blank line then `Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm`.
- Project maturity `established`: a task that changes pre-existing behavior first runs (or adds) the test that characterizes the current behavior.
- Deliverable 5 (the post-merge `/claude-tweaks:tidy` run on this repo, and posting its repaired list on #2828) is **not** a task here — it runs after merge.

## Review Focus

1. **CRLF bodies.** GitHub web-UI edits commonly store `\r\n`. The inserted section must use the body's own line ending, and the line diff must still prove that only the section was added. (0 of the 130 live `ready` records here are CRLF, so only a fixture covers this.) Pinned in Task 2.
2. **`## Acceptance Criteria` is the last section, with a footer or fingerprint trailer, or no trailing newline.** This is 14 of the 110 live matches: `_Filed by … via specShapedBody._`, `<!-- work-fingerprint: … -->`. The section is appended at the end of the body and the gate must pass. Pinned in Task 2.
3. **A `## Release Note` heading inside the verbatim `## Original request` section.** This must not become the fill target. The authored insert goes before `## Original request`, and the gate's first `indexOf` match then reads the new section. Pinned in Task 2.
4. **MCP-shaped live read when `gh` is absent** (lowercase `state: "open"`, plain-string labels) must not read as a stale premise. Pinned in Task 1 (`labelNames`) and Task 3 (CLI).
5. **A mid-line `## Acceptance Criteria` mention.** The gate's `indexOf`-based `sectionText` accepts it, so the record classifies Release-Note-only, but it gives no line-anchored insert point. This must be a repair failure (exit 6) that writes nothing, never a misplaced insert. Pinned in Task 3.

## Spec defects found (spec text vs codebase)

1. **Snapshot path.** Deliverable 4 and AC 6 put the undo snapshot at `{run-dir}/staged/tidy-release-note-{n}.original.md`. Every consumer of `staged/` reads any file there as a proposal awaiting approval:
   - `plugin/bin/lib/hooks/session-start.js:201-206`: the "staged proposal(s) awaiting approval" banner.
   - `plugin/skills/tidy/approve-mode.md:13-20`: the newest non-empty `staged/` wins `--approve` resolution.
   - `plugin/skills/backlog/attention-mode.md:250-259`: "{count} tidy proposal(s) staged awaiting approval".
   - `plugin/bin/lib/console/resolve.js:153-158`: every `staged/*.md` becomes a console item.

   **Resolved:** snapshots go to `{run-dir}/snapshots/`. This is local-disk durable, the same durability `staged/` has in every consumer project, because `/init`'s gitignore template (`plugin/skills/init/bootstrap/step-04-gitignore-suggestions.md:9-26`) carries no `staged/` carve-out. GitHub's own issue edit history also keeps the prior body.
2. **Auto-applying a body write contradicts the shared contract.** `plugin/skills/_shared/auto-mode-contract.md:143,150` lists "Network calls beyond reads (no API writes, no message sends)" under "auto-FORBIDDEN, regardless of mode". `plugin/skills/tidy/step-6-auto.md:8` restates it ("forbidden at every tier"). The spec's row-level exemption alone would leave the single source of truth false. **Resolved:** Task 7 adds a named `except` clause to that bullet, the same shape as its sibling bullets at lines 148-149, and amends `step-6-auto.md:8`.
3. **The procedure cannot live in `step-1-records.md`.** Key Files puts the "reverify, repair procedure" there, but that file "is read whole and inlined into the Work Records agent's prompt" (`step-1-records.md:8-10`, `SKILL.md:72`). That is a read-only `[Use: Fast]` scan agent. **Resolved:** detection stays in `step-1-records.md`, and the main-thread procedure goes in the new `plugin/skills/tidy/release-note-repair.md`.
4. **Per-record agent rows cannot carry the worklist.** Template A caps an agent at "at most 15 rows … `+N more`" (`scan-execution.md`, Output template). Per-record rows would repair at most 15 of this repo's 110 matches per run, and at `low` severity they would evict other shapes' rows. **Resolved:** the agent returns one summary row. The complete list goes to a candidates file whose absolute path the dispatcher substitutes into the prompt.
5. **The local write path.** Deliverable 3 says write via `writeRecord`, but `writeRecord` re-serializes frontmatter (`local-store.js:188-203`: legacy `effort:`/parent-marker keys migrate on any rewrite). That breaks "leave every other byte of the body unchanged". **Resolved:** the local repair splices the raw file text and writes it with `writeFileAtomic`. `readRecord` then re-reads the file to prove the facets are unchanged.
6. **Minor.** "Register the shape in SKILL.md's shape roster": SKILL.md has no shape roster. The registration site is its Step table's Output prefix cell (`SKILL.md:83`). Deliverable 1's "spawn failure" becomes "`run` threw", because detection calls the CLI's exported `run` in-process.

## Ambiguities resolved

- **"No longer matches Shape 4.5 (edited …)"** means any byte change to the body, detected by comparing sha256 against the scan-time body. It also covers a record that is no longer open or no longer carries `ready`. This mirrors `plugin/skills/backlog/refine-mode.md:301`'s verbatim-body reverify.
- **"Collapsed original-body block"** becomes a fenced ```` ```text ```` block in Step 7.5's verification output. The terminal renders no `<details>`. The no-run-dir case only arises in interactive mode.
- **The "no backtick code span" bound** rejects any backtick. That is stricter and has no false-negative risk.
- **When `## Acceptance Criteria` is the last authored section,** the insert goes at the end of the body (or before `## Original request`), taking the spec literally. Trailing footer and fingerprint lines stay where they are. Their parsers are body-wide regexes (`plugin/bin/lib/issues/record.js:73,86`).
- **Who composes the line, and when:** always the main thread. In the Stage tier (`conservative`, `--dry-run`) it composes at staging, so the approver sees the line. In auto mode it composes in Step 7. In interactive mode it composes in Step 7, after the batch approval.
- **Routing of problem outcomes:**
  - A scan error is a **Yours** row in the `review` group.
  - A repair failure is a **Yours** row keyed `/claude-tweaks:specify` (re-shaping is `/specify`'s job).
  - A stale skip is a `SKIP` entry in `decisions.md` plus a Step 7.5 line.
- **The `conservative` Stage tier still marks the record.** There, the existing Stage-tier convention (`decision-markers.md`, which derives per firing) adds a `needs:decision` comment and label, exactly as it does for every staged record row. That is the opt-down tier's documented behavior, not the repair's: the repair itself never writes a label.
- **Shape 4.5 joins the worklist rule.** The `scan` CLI runs both of its checks itself. The second check matches the fixed staged-action text `Fill Release Note (insert one ## Release Note section; labels unchanged)`.
- **Log statuses:** a verified repair is `AUTO`, appended in-process by the CLI, so the composed line is never shell-quoted. Skips and failures are `SKIP`, per `_shared/auto-decision-log.md`'s outcome-kind shape; `FAILED` is not a loggable status.
- **Mechanical bounds are a tested helper, not prose regexes.** `detect.js`'s `checkReleaseNoteLine`, called by `repair`, is one deterministic implementation. It follows the repo's pattern for the mechanical half of a prose rule (`bin/tidy-report-lint.js`, `compose-record.js --check`). Prose regexes would be re-derived by every executing agent and tested by none.

## Plan-authoring checks (outcomes)

- **Return-shape widening:** no existing function's return shape grows. The lint change (Task 4) widens `checkAligned`'s tolerance only for indented lines under **Applied automatically**. The one existing Aligned red case (`tests/bin-lib/tidy-report-lint/rules.test.js:58-64`, a col-0 mis-padded row) is kept and must still fail. `RULES` keeps 13 entries (the `lintReport` count prose in `step-6-auto.md:236` is unchanged).
- **Blocking-verification downgrade:** none. The live GitHub write (`gh issue edit {n} --body-file`) has no read-only form, so it is **unverified by probe**. It is the same command tidy's Defer action already ships (`actions-github-issues.md`, `## Defer`).
- **Deictic re-resolution:** no text is moved. New rows use "above" only for the Open parent gate row, which Task 7 inserts the new row directly after.
- **Verbatim-command run-once** (run 2026-09-29, read-only):
  - `gh issue list --state open --label ready --json number,title,labels,body,state --limit 300` returned 130 rows with keys `body,labels,number,state,title`.
  - `gh issue view 2823 --json body,labels,state` returned `state: "OPEN"`, and its body's sha256 equals the `issue list` body's sha256 (`list==view: true`).
  - Task 8's `gh issue list --state open --json number,title,labels,body,state,comments --limit 1000` exited 0 with 159 open issues, each carrying a `comments` array.
  - `node plugin/bin/session-tmp-resolve.js TIDY_RECORDS_FACETED=tidy-records-faceted.json` printed `TIDY_RECORDS_FACETED="/var/folders/…/ct-session-<id>/tidy-records-faceted.json"`.
  - The Task 6 dispatcher `node -e` block printed `/var/folders/…/ct-session-<id>/tidy-release-note-1790711777316.json`.
- **Degrade clause:** for gh-absent environments the plan cites `_shared/github-write-transport.md:24,27` (`issue_write` update mode, `issue_read` get mode) rather than restating a transport rule.
- **Copied config:** none.
- **Renumbering completeness** (Task 5 and Task 6 verification steps carry all three greps). Shape lists: the number form `Shapes 1, 2, 3, 4`; the prose range `Shapes 1-5`; and the cardinal words `Shapes 4 and 5`. Backend probe: `Five actions`, `four vary`, and `five`.
- **Batched marker:** not batched. Every task carries its own test cycle.
- **Behavioral claims:**
  - "Staging lets refine un-ready the record": produced by `plugin/skills/backlog/refine-mode.md:216-241` (Step 3.5: "A failing row auto-downgrades to flag-back").
  - "`/sweep` runs `/tidy` first": `plugin/skills/sweep/SKILL.md:9,47-49`.
  - "Label set identical": produced by the CLI's `verify` (github) and its `repair` facet re-read (local), and nothing else.
  - "Snapshot before write": the CLI's `repair` refuses (exit 2) without a destination and writes the snapshot before `--out` or the record file.
- **Byte pins:** see Global Constraints. There is no tidy-file-specific pin: the 40 KB per-file pins were retired by #1997 (`tests/tidy-residue-markers.test.js:166-168`, `tests/deferred-live-verification-ac-class.test.js:45`, `[IL-153]`), and `tests/skill-mode-split-conformance.test.js`'s 30 KB `STUB_CEILING_BYTES` covers `demo`/`feedback` only (lines 25-49). The binding bound is the 46,080 B warning tier. `step-6-auto.md` has the least room (≈1.0 KB after this plan).
- **Consumer timing (the candidates file):**
  - It lives in the session tmp dir at an absolute path the dispatcher chose, and the agent writes to that literal path. It does not depend on the agent seeing `$CLAUDE_CODE_SESSION_ID`.
  - Its consumers (Step 6 staging, Step 7) run after the agent returns.
  - The only freshness step is Step 7's live re-read immediately before each write, which the sha comparison enforces. So the file supplies only the list, the premise sha, and the Deliverables text.
  - A fresh `Date.now()` filename per run means a later tidy run in the same session never reads an earlier run's list.
- **Gate over producers (lint Aligned):** producers of lines inside the **Applied automatically** fence:
  - the template's col-0 verb rows (`step-6-auto.md:129-130`);
  - reconcile skip sub-lines (`step-6-auto.md:38-39`: "a non-actionable skip sub-line under **Applied automatically**", indented);
  - the new indented Release Note sub-lines.

  Skipping indented lines there exempts exactly the two sub-line producers and no row producer.
- **Sole site / producer side:**
  - The Yours rows for scan errors and repair failures, and the Step 7.5 checklist line, are consumers. Their producers are `scan`'s candidates file (Task 3, Task 5) and the repair and verify exits (Tasks 3 and 6). Each is extended in the same plan.
  - Sole-writer claim: `grep -rn "snapshots/tidy-release-note" plugin/` must print only `plugin/bin/release-note-repair.js` and `plugin/skills/tidy/release-note-repair.md` (Task 8 runs it).
- **Real-input probe and independent count:** Task 8 runs `scan` over this repo's live `ready` queue. At plan time an inline `compose-record.js --check` loop over the same 130 records counted:
  - 110 `release-note-only` (all `missing section`);
  - 1 `other-gaps` (#2674: missing Release Note plus `TBD`);
  - 19 conforming;
  - 0 CRLF;
  - 0 matches carrying `needs:*`.

  Invariant: `scan`'s `release-note-only` count must equal the independent loop's count on the same input file. Task 8 also dry-runs `repair` on #2823 (AC-last) and one mid-body record, and diffs the output.

---

### Task 1: Detection module (`detect.js`)

**Files:**
- Create: `plugin/bin/lib/release-note-repair/detect.js`
- Create: `tests/bin-lib/release-note-repair/fixtures.js`
- Test: `tests/bin-lib/release-note-repair/detect.test.js`

**Interfaces:**
- Consumes: `plugin/bin/compose-record.js`'s `run(argv, deps) -> number` (in-process `--check`), `plugin/bin/lib/issues/materialize-format.js`'s `sectionText(body, name) -> string|null`.
- Produces (all exported from `detect.js`):
  - `CHECK_HEADER: string`, `RELEASE_NOTE_GAPS: string[]`, `PROPOSED_ACTION: string`, `BOUNDS: {id, re}[]`
  - `classifyCheckResult({code, stderr}) -> {verdict: 'conforming'|'release-note-only'|'other-gaps'|'scan-error', gaps: string[]}`
  - `checkBody(body, {checkCli?}) -> {verdict, gaps, code: number|null, stderr: string}` — `checkCli(file) -> {code, stderr}` defaults to compose-record's in-process `run`
  - `checkReleaseNoteLine(raw) -> {ok: boolean, line: string, violations: string[]}` — violation ids `empty|multi-line|record-ref|path|backtick|conventional-prefix`
  - `bodySha(body) -> string` (sha256 hex)
  - `labelNames(labels) -> string[]` (accepts `[{name}]` or `['name']`)
  - `scanRecords(records, {driver: 'github-issues'|'local-files', checkCli?}) -> Candidate[]` where `Candidate = {ref, id, title, verdict: 'release-note-only'|'scan-error', sha: string|null, deliverables: string|null, gap?, code?, stderr?}`
  - `summaryLine(candidates, outPath) -> string|null`

- [ ] **Step 1: Write the shared fixtures**

```js
// tests/bin-lib/release-note-repair/fixtures.js
'use strict';

const CS = '## Current State\n\nThe widget lookup is slow.\n';
const DEL = '## Deliverables\n\n1. Cache the widget lookup.\n';
const AC = '## Acceptance Criteria\n\n- [ ] Lookups are cached.\n';
const RN = '## Release Note\n\nMade widget lookups faster.\n';
const TA = '## Technical Approach\n\nUse a Map.\n';
const LINE = 'Made widget lookups faster.';
const join = (...parts) => parts.join('\n');

module.exports = {
  LINE,
  CS, DEL, AC, RN, TA, join,
  MISSING_RN: join(CS, DEL, AC, TA),
  REPAIRED: join(CS, DEL, AC, RN, TA),
  EMPTY_RN: join(CS, DEL, AC, '## Release Note\n', TA),
  MISSING_RN_AND_AC: join(CS, DEL, TA),
  CONFORMING: join(CS, DEL, AC, RN, TA),
  MISSING_RN_WITH_TBD: join(CS, DEL.replace('lookup.', 'lookup. TBD'), AC, TA),
  AC_LAST_WITH_FOOTER: `${join(CS, DEL, AC)}\n_Filed by \`ledger resolve gate\` via specShapedBody._\n`,
  MIDLINE_AC: '## Current State\n\nThe widget lookup is slow.\n\n## Deliverables\n\n1. Cache it. See ## Acceptance Criteria\n- [ ] Lookups are cached.\n',
};
```

- [ ] **Step 2: Write the failing tests**

```js
// tests/bin-lib/release-note-repair/detect.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  CHECK_HEADER, PROPOSED_ACTION, classifyCheckResult, checkBody, checkReleaseNoteLine,
  bodySha, labelNames, scanRecords, summaryLine,
} = require('../../../plugin/bin/lib/release-note-repair/detect');
const F = require('./fixtures');

const gapsStderr = (...gaps) => `${CHECK_HEADER}\n${gaps.map((g) => `  - ${g}`).join('\n')}\n`;

test('classifyCheckResult: exit 0 is conforming', () => {
  assert.equal(classifyCheckResult({ code: 0, stderr: '' }).verdict, 'conforming');
});

test('classifyCheckResult: exactly one Release Note gap (missing or empty) is release-note-only', () => {
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note') }).verdict, 'release-note-only');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('empty section: ## Release Note') }).verdict, 'release-note-only');
});

test('classifyCheckResult: any other gap, alone or alongside the Release Note one, is other-gaps', () => {
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note', 'missing section: ## Acceptance Criteria') }).verdict, 'other-gaps');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Acceptance Criteria') }).verdict, 'other-gaps');
  assert.equal(classifyCheckResult({ code: 4, stderr: gapsStderr('missing section: ## Release Note', 'unresolved placeholder marker: TBD') }).verdict, 'other-gaps');
});

test('classifyCheckResult: an exit other than 0/4, or an unparseable exit-4 stderr, is a scan error, never a match', () => {
  for (const code of [2, 5, 1, null, undefined]) {
    assert.equal(classifyCheckResult({ code, stderr: gapsStderr('missing section: ## Release Note') }).verdict, 'scan-error', `code ${code}`);
  }
  assert.equal(classifyCheckResult({ code: 4, stderr: '  - missing section: ## Release Note\n' }).verdict, 'scan-error', 'no header');
  assert.equal(classifyCheckResult({ code: 4, stderr: `${CHECK_HEADER}\n` }).verdict, 'scan-error', 'header, zero gaps');
});

test('checkBody runs the real compose-record.js --check contract', () => {
  assert.equal(checkBody(F.MISSING_RN).verdict, 'release-note-only');
  assert.equal(checkBody(F.EMPTY_RN).verdict, 'release-note-only');
  assert.equal(checkBody(F.MISSING_RN_AND_AC).verdict, 'other-gaps');
  assert.equal(checkBody(F.CONFORMING).verdict, 'conforming');
  assert.equal(checkBody(F.MISSING_RN_WITH_TBD).verdict, 'other-gaps');
});

test('checkBody: a checker that exits 2 or throws is a scan error', () => {
  const two = checkBody(F.MISSING_RN, { checkCli: () => ({ code: 2, stderr: 'compose-record.js: could not read body file\n' }) });
  assert.equal(two.verdict, 'scan-error');
  assert.equal(two.code, 2);
  const threw = checkBody(F.MISSING_RN, { checkCli: () => { throw new Error('boom'); } });
  assert.equal(threw.verdict, 'scan-error');
  assert.equal(threw.code, null);
  assert.match(threw.stderr, /boom/);
});

test('checkReleaseNoteLine: a plain verb-first sentence passes; one trailing newline is stripped', () => {
  assert.deepEqual(checkReleaseNoteLine('Made widget lookups faster.\n'), { ok: true, line: 'Made widget lookups faster.', violations: [] });
  assert.equal(checkReleaseNoteLine('Improved internal test coverage for the release composer').ok, true);
  assert.equal(checkReleaseNoteLine('Added and/or removed nothing.').ok, true, '"and/or." is not path-shaped');
  assert.equal(checkReleaseNoteLine('Fixed: capitalized words are not a conventional prefix').ok, true);
});

test('checkReleaseNoteLine: every Deliverable 2 bound is checked', () => {
  const v = (s) => checkReleaseNoteLine(s).violations;
  assert.deepEqual(v(''), ['empty']);
  assert.deepEqual(v('First line.\nSecond line.'), ['multi-line']);
  assert.deepEqual(v('Fixed the crash from #2573.'), ['record-ref']);
  assert.deepEqual(v('Updated plugin/bin/compose-record.js to be faster.'), ['path']);
  assert.deepEqual(v('Added a `--check` flag.'), ['backtick']);
  assert.deepEqual(v('fix(tidy)!: repair release notes'), ['conventional-prefix']);
  assert.deepEqual(v('feat: repair release notes'), ['conventional-prefix']);
});

test('bodySha is a stable sha256 hex digest', () => {
  assert.match(bodySha('x'), /^[0-9a-f]{64}$/);
  assert.equal(bodySha(F.MISSING_RN), bodySha(`${F.MISSING_RN}`));
  assert.notEqual(bodySha(F.MISSING_RN), bodySha(`${F.MISSING_RN} `));
});

test('labelNames accepts gh objects and MCP/plain strings', () => {
  assert.deepEqual(labelNames([{ name: 'ready' }, { name: 'auto:build' }]), ['ready', 'auto:build']);
  assert.deepEqual(labelNames(['ready', 'risk:low']), ['ready', 'risk:low']);
  assert.deepEqual(labelNames(undefined), []);
});

const gh = (number, body, extra = {}) => ({
  number, title: `Record ${number}`, state: 'OPEN', labels: [{ name: 'ready' }], body, facets: { stage: 'ready' }, ...extra,
});

test('scanRecords (github-issues): matches only ready, open, Release-Note-only, non-excluded records', () => {
  const pending = { body: `<!-- needs-decision: tidy -->\n## Decision needed\n**Proposed:** ${PROPOSED_ACTION}\n` };
  const resolved = { body: `${pending.body}**Resolved:** keep\n` };
  const records = [
    gh(1, F.MISSING_RN),
    gh(2, F.MISSING_RN_AND_AC),
    gh(3, F.EMPTY_RN),
    gh(4, F.CONFORMING),
    gh(5, F.MISSING_RN, { facets: { stage: null } }),
    gh(6, F.MISSING_RN, { labels: [{ name: 'ready' }, { name: 'needs:decision' }] }),
    gh(7, F.MISSING_RN, { comments: [pending] }),
    gh(8, F.MISSING_RN, { comments: [resolved] }),
    gh(9, F.MISSING_RN, { state: 'CLOSED' }),
    gh(10, F.MISSING_RN_WITH_TBD),
  ];
  const out = scanRecords(records, { driver: 'github-issues' });
  assert.deepEqual(out.map((c) => c.ref), ['#1', '#3', '#8']);
  assert.ok(out.every((c) => c.verdict === 'release-note-only'));
  assert.equal(out[0].sha, bodySha(F.MISSING_RN));
  assert.equal(out[0].deliverables, '1. Cache the widget lookup.');
  assert.equal(out[1].gap, 'empty section: ## Release Note');
});

test('scanRecords: a record with no body field, or a checker failure, is a scan-error candidate', () => {
  const noBody = { number: 11, title: 'x', state: 'OPEN', labels: [{ name: 'ready' }], facets: { stage: 'ready' } };
  const [c] = scanRecords([noBody], { driver: 'github-issues' });
  assert.equal(c.verdict, 'scan-error');
  assert.equal(c.sha, null);
  const [d] = scanRecords([gh(12, F.MISSING_RN)], { driver: 'github-issues', checkCli: () => ({ code: 5, stderr: '' }) });
  assert.equal(d.verdict, 'scan-error');
  assert.equal(d.code, 5);
});

test('scanRecords (local-files): uses path/id, excludes needsDefinition and closed', () => {
  const local = (id, body, facets = {}) => ({ path: `specs/${id}-x.md`, id, title: `L${id}`, body, facets: { stage: 'ready', needsDefinition: false, closed: false, ...facets } });
  const out = scanRecords([
    local(20, F.MISSING_RN),
    local(21, F.MISSING_RN, { needsDefinition: true }),
    local(22, F.MISSING_RN, { closed: true }),
  ], { driver: 'local-files' });
  assert.deepEqual(out.map((c) => [c.ref, c.id]), [['specs/20-x.md', 20]]);
});

test('summaryLine: one Template-A-ready line, or null when nothing matched', () => {
  assert.equal(summaryLine([], '/tmp/c.json'), null);
  const line = summaryLine([{ verdict: 'release-note-only' }, { verdict: 'scan-error' }], '/tmp/c.json');
  assert.equal(line, '—\t[release-note] 1 ready record(s) missing only a Release Note, 1 scan error(s) — Fill Release Note (candidates: /tmp/c.json)');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/release-note-repair/detect.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/release-note-repair/detect'`

- [ ] **Step 4: Write the module**

```js
// plugin/bin/lib/release-note-repair/detect.js — /tidy Shape 4.5's detection half (#2828): which
// `ready` records' only spec-shape gap is `## Release Note`, judged by compose-record.js --check
// (#2827) so tidy's verdict and /flow's Materialization gate never disagree, plus the Deliverable 2
// bounds on an agent-composed Release Note line. checkCli defaults to compose-record.js's own
// exported run() in-process — the CLI's entry point, so the exit/stderr contract is identical and a
// 100+-record scan pays no spawn per record. Pure except checkBody's per-body tmp file.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sectionText } = require('../issues/materialize-format');

const CHECK_HEADER = 'compose-record.js: body is not spec-shaped:';
const RELEASE_NOTE_GAPS = ['missing section: ## Release Note', 'empty section: ## Release Note'];
// The staged action text: decision-markers.md's `Proposed:` line carries it verbatim, and the
// worklist rule's comment check below matches it word for word.
const PROPOSED_ACTION = 'Fill Release Note (insert one ## Release Note section; labels unchanged)';

// Deliverable 2 bounds, one regex per bound. Any backtick is rejected (stricter than "no code span").
const BOUNDS = [
  { id: 'record-ref', re: /#\d+/ },
  { id: 'path', re: /\S*\/\S*\.[A-Za-z0-9]+/ },
  { id: 'backtick', re: /`/ },
  { id: 'conventional-prefix', re: /^[a-z]+(\(.+\))?!?:/ },
];

function classifyCheckResult({ code, stderr } = {}) {
  if (code === 0) return { verdict: 'conforming', gaps: [] };
  if (code !== 4) return { verdict: 'scan-error', gaps: [] };
  const lines = String(stderr || '').split('\n');
  if (lines[0] !== CHECK_HEADER) return { verdict: 'scan-error', gaps: [] };
  const gaps = lines.slice(1).filter((l) => l.startsWith('  - ')).map((l) => l.slice(4));
  if (gaps.length === 0) return { verdict: 'scan-error', gaps };
  if (gaps.length === 1 && RELEASE_NOTE_GAPS.includes(gaps[0])) return { verdict: 'release-note-only', gaps };
  return { verdict: 'other-gaps', gaps };
}

function defaultCheckCli(file) {
  const { run } = require('../../compose-record');
  let stderr = '';
  const code = run(['--check', file], { stdout: () => {}, stderr: (s) => { stderr += s; } });
  return { code, stderr };
}

function checkBody(body, { checkCli = defaultCheckCli } = {}) {
  let dir = null;
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-release-note-'));
    const file = path.join(dir, 'body.md');
    fs.writeFileSync(file, body);
    const { code, stderr } = checkCli(file);
    return { ...classifyCheckResult({ code, stderr }), code, stderr: String(stderr || '') };
  } catch (err) {
    return { verdict: 'scan-error', gaps: [], code: null, stderr: String((err && err.message) || err) };
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}

function checkReleaseNoteLine(raw) {
  const line = String(raw == null ? '' : raw).replace(/\r?\n$/, '').trim();
  const violations = [];
  if (!line) violations.push('empty');
  if (/[\r\n]/.test(line)) violations.push('multi-line');
  for (const { id, re } of BOUNDS) if (re.test(line)) violations.push(id);
  return { ok: violations.length === 0, line, violations };
}

function bodySha(body) {
  return crypto.createHash('sha256').update(String(body), 'utf8').digest('hex');
}

function labelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map((l) => (typeof l === 'string' ? l : (l && l.name) || ''))
    .filter(Boolean);
}

// Worklist rule, second check (step-1-records.md): an UNRESOLVED tidy decision comment whose
// Proposed: line is this shape's own staged action, word for word.
function hasPendingTidyDecision(comments) {
  return (Array.isArray(comments) ? comments : []).some((c) => {
    const text = String((c && c.body) || '');
    if (!text.includes('<!-- needs-decision: tidy -->') || text.includes('**Resolved:**')) return false;
    return text.split(/\r?\n/).some((l) => l.trim() === `**Proposed:** ${PROPOSED_ACTION}`);
  });
}

function excluded(record, driver) {
  if (driver === 'local-files') return record.facets.needsDefinition === true || record.facets.closed === true;
  if (record.state && String(record.state).toUpperCase() !== 'OPEN') return true;
  if (labelNames(record.labels).some((n) => /^needs:/.test(n))) return true;
  return hasPendingTidyDecision(record.comments);
}

function scanRecords(records, { driver, checkCli } = {}) {
  const candidates = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (!record || !record.facets || record.facets.stage !== 'ready') continue;
    if (excluded(record, driver)) continue;
    const local = driver === 'local-files';
    const base = { ref: local ? record.path : `#${record.number}`, id: local ? record.id : record.number, title: String(record.title || '') };
    if (typeof record.body !== 'string') {
      candidates.push({ ...base, verdict: 'scan-error', code: null, stderr: 'record carries no body field', sha: null, deliverables: null });
      continue;
    }
    const check = checkBody(record.body, { checkCli });
    if (check.verdict === 'release-note-only') {
      candidates.push({ ...base, verdict: check.verdict, gap: check.gaps[0], sha: bodySha(record.body), deliverables: sectionText(record.body, 'Deliverables') });
    } else if (check.verdict === 'scan-error') {
      candidates.push({ ...base, verdict: check.verdict, code: check.code, stderr: check.stderr, sha: null, deliverables: null });
    }
  }
  return candidates;
}

function summaryLine(candidates, outPath) {
  if (!candidates.length) return null;
  const matches = candidates.filter((c) => c.verdict === 'release-note-only').length;
  return `—\t[release-note] ${matches} ready record(s) missing only a Release Note, ${candidates.length - matches} scan error(s) — Fill Release Note (candidates: ${outPath})`;
}

module.exports = {
  CHECK_HEADER, RELEASE_NOTE_GAPS, PROPOSED_ACTION, BOUNDS,
  classifyCheckResult, checkBody, checkReleaseNoteLine, bodySha, labelNames, scanRecords, summaryLine,
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/release-note-repair/detect.test.js`
Expected: PASS (all tests)

- [ ] **Step 6: Prove discrimination by reverting one rule**

Temporarily change `RELEASE_NOTE_GAPS.includes(gaps[0])` to `true` in `detect.js`, rerun the test file, confirm the `other-gaps` test FAILS, then restore the line and rerun to PASS. `git diff --stat` must show only the two new files plus fixtures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/release-note-repair/detect.js tests/bin-lib/release-note-repair/fixtures.js tests/bin-lib/release-note-repair/detect.test.js
git commit -m "Add release-note-repair detect module — Release-Note-only classification via compose-record --check, Deliverable 2 line bounds (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 2: Repair module (`apply.js`)

**Files:**
- Create: `plugin/bin/lib/release-note-repair/apply.js`
- Test: `tests/bin-lib/release-note-repair/apply.test.js`

**Interfaces:**
- Consumes (Task 1): `checkBody`, `checkReleaseNoteLine`, `bodySha`, `labelNames` from `detect.js`; `sectionText` from `materialize-format.js`.
- Produces (exported from `apply.js`):
  - `class RepairError extends Error`
  - `applyReleaseNote(body, line) -> {body: string, mode: 'inserted'|'filled'}` — throws `RepairError` when no line-anchored `## Acceptance Criteria` heading precedes `## Original request`, or the existing authored `## Release Note` section is non-empty
  - `onlyReleaseNoteAdded(original, repaired, line) -> boolean`
  - `prepareRepair({liveBody, expectSha, line, checkCli?}) -> {outcome: 'ready', body, mode, line} | {outcome: 'stale'|'failed', reason} | {outcome: 'bounds', violations}`
  - `verifyWritten({before, after, line, checkCli?}) -> string[]` (empty = verified)

- [ ] **Step 1: Write the failing tests**

```js
// tests/bin-lib/release-note-repair/apply.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RepairError, applyReleaseNote, onlyReleaseNoteAdded, prepareRepair, verifyWritten,
} = require('../../../plugin/bin/lib/release-note-repair/apply');
const { bodySha, checkBody } = require('../../../plugin/bin/lib/release-note-repair/detect');
const F = require('./fixtures');

test('applyReleaseNote inserts the section right after Acceptance Criteria, before the next heading', () => {
  assert.deepEqual(applyReleaseNote(F.MISSING_RN, F.LINE), { body: F.REPAIRED, mode: 'inserted' });
});

test('applyReleaseNote fills an empty section in place', () => {
  assert.deepEqual(applyReleaseNote(F.EMPTY_RN, F.LINE), { body: F.REPAIRED, mode: 'filled' });
});

test('applyReleaseNote appends when Acceptance Criteria is last (footer kept above) and passes the gate', () => {
  const out = applyReleaseNote(F.AC_LAST_WITH_FOOTER, F.LINE);
  assert.equal(out.body, `${F.AC_LAST_WITH_FOOTER}\n## Release Note\n\n${F.LINE}\n`);
  assert.equal(checkBody(out.body).verdict, 'conforming');
});

test('applyReleaseNote terminates a body with no trailing newline before appending', () => {
  const noEol = F.join(F.CS, F.DEL, F.AC).trimEnd();
  assert.equal(applyReleaseNote(noEol, F.LINE).body, `${noEol}\n\n## Release Note\n\n${F.LINE}\n`);
});

test('applyReleaseNote keeps a CRLF body CRLF', () => {
  const crlf = F.MISSING_RN.replace(/\n/g, '\r\n');
  const out = applyReleaseNote(crlf, F.LINE);
  assert.equal(out.body, F.REPAIRED.replace(/\n/g, '\r\n'));
  assert.equal(checkBody(out.body).verdict, 'conforming');
  assert.equal(onlyReleaseNoteAdded(crlf, out.body, F.LINE), true);
});

test('applyReleaseNote never fills a Release Note heading inside the verbatim Original request section', () => {
  const body = `${F.join(F.CS, F.DEL, F.AC)}\n## Original request\n\nSee thread.\n\n## Release Note\n`;
  assert.equal(checkBody(body).verdict, 'release-note-only', 'the gate reads the empty original-request heading');
  const out = applyReleaseNote(body, F.LINE);
  assert.equal(out.mode, 'inserted');
  assert.equal(out.body, `${F.join(F.CS, F.DEL, F.AC)}\n## Release Note\n\n${F.LINE}\n\n## Original request\n\nSee thread.\n\n## Release Note\n`);
  assert.equal(checkBody(out.body).verdict, 'conforming');
});

test('applyReleaseNote throws RepairError with no line-anchored AC heading, or a non-empty Release Note', () => {
  assert.throws(() => applyReleaseNote(F.MIDLINE_AC, F.LINE), RepairError);
  assert.throws(() => applyReleaseNote(F.MISSING_RN_AND_AC, F.LINE), RepairError);
  assert.throws(() => applyReleaseNote(F.CONFORMING, F.LINE), RepairError);
});

test('onlyReleaseNoteAdded accepts exactly the section and rejects any other change', () => {
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED, F.LINE), true);
  assert.equal(onlyReleaseNoteAdded(F.EMPTY_RN, F.REPAIRED, F.LINE), true);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED.replace('Use a Map.', 'Use a Set.'), F.LINE), false);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.REPAIRED, 'A different line.'), false);
  assert.equal(onlyReleaseNoteAdded(F.MISSING_RN, F.MISSING_RN.replace('## Technical', `${F.LINE}\n\n## Technical`), F.LINE), false, 'line with no heading above it');
});

test('prepareRepair: happy path returns the repaired body', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: `${F.LINE}\n` });
  assert.deepEqual(out, { outcome: 'ready', body: F.REPAIRED, mode: 'inserted', line: F.LINE });
});

test('prepareRepair: a body edited since the scan is stale, never repaired', () => {
  const out = prepareRepair({ liveBody: `${F.MISSING_RN}edit\n`, expectSha: bodySha(F.MISSING_RN), line: F.LINE });
  assert.equal(out.outcome, 'stale');
  assert.match(out.reason, /changed since the scan/);
});

test('prepareRepair: a line failing a bound is reported, not weakened', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: 'fix: see #12' });
  assert.deepEqual(out, { outcome: 'bounds', violations: ['record-ref', 'conventional-prefix'] });
});

test('prepareRepair: a live body that is no longer Release-Note-only is stale; a mid-line AC is a failure', () => {
  assert.equal(prepareRepair({ liveBody: F.MISSING_RN_WITH_TBD, expectSha: bodySha(F.MISSING_RN_WITH_TBD), line: F.LINE }).outcome, 'stale');
  const midline = prepareRepair({ liveBody: F.MIDLINE_AC, expectSha: bodySha(F.MIDLINE_AC), line: F.LINE });
  assert.equal(midline.outcome, 'failed');
  assert.match(midline.reason, /Acceptance Criteria/);
});

test('prepareRepair: a checker scan error on the live body is a failure, not stale', () => {
  const out = prepareRepair({ liveBody: F.MISSING_RN, expectSha: bodySha(F.MISSING_RN), line: F.LINE, checkCli: () => ({ code: 2, stderr: 'x' }) });
  assert.equal(out.outcome, 'failed');
});

test('verifyWritten: identical labels and a conforming body carrying the line verify clean', () => {
  const before = { body: F.MISSING_RN, labels: [{ name: 'ready' }, { name: 'auto:build' }] };
  const after = { body: F.REPAIRED, labels: [{ name: 'auto:build' }, { name: 'ready' }] };
  assert.deepEqual(verifyWritten({ before, after, line: F.LINE }), []);
});

test('verifyWritten: a changed label set, a missing line, or a failing body is reported', () => {
  const before = { body: F.MISSING_RN, labels: [{ name: 'ready' }, { name: 'auto:build' }] };
  assert.match(verifyWritten({ before, after: { body: F.REPAIRED, labels: [{ name: 'ready' }] }, line: F.LINE })[0], /label set changed/);
  assert.match(verifyWritten({ before, after: { body: F.REPAIRED, labels: before.labels }, line: 'Other line.' })[0], /does not carry the composed line/);
  assert.ok(verifyWritten({ before, after: { body: F.MISSING_RN, labels: before.labels }, line: F.LINE }).length >= 1);
  assert.deepEqual(verifyWritten({ before, after: {}, line: F.LINE }), ['the post-write read carries no body']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/lib/release-note-repair/apply'`

- [ ] **Step 3: Write the module**

```js
// plugin/bin/lib/release-note-repair/apply.js — /tidy Shape 4.5's repair half (#2828): insert (or
// fill) exactly one `## Release Note` section, prove by line diff that nothing else changed, and
// verify a written body. Headings are matched line-anchored and only before the verbatim
// `## Original request` section; every gate verdict goes through detect.js's checkBody, so a body
// the insert gets wrong is caught by the gate's own post-check rather than written.
'use strict';

const { isDeepStrictEqual } = require('util');
const { sectionText } = require('../issues/materialize-format');
const { checkBody, checkReleaseNoteLine, bodySha, labelNames } = require('./detect');

class RepairError extends Error {}

const AC_HEADING = /^## Acceptance Criteria[ \t]*$/;
const RN_HEADING = /^## Release Note[ \t]*$/;
const ORIGINAL_REQUEST = /^## Original request[ \t]*$/;
const H2 = /^## /;

// Lines keep their own terminators so every untouched byte round-trips exactly.
const splitKeepingEol = (text) => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const bare = (line) => line.replace(/\r?\n$/, '');

function applyReleaseNote(body, rawLine) {
  const text = String(body);
  const line = String(rawLine).trim();
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = splitKeepingEol(text);
  const originalAt = lines.findIndex((l) => ORIGINAL_REQUEST.test(bare(l)));
  const authoredEnd = originalAt === -1 ? lines.length : originalAt;
  const nextH2 = (from) => {
    for (let k = from; k < lines.length; k += 1) if (H2.test(lines[k])) return k;
    return lines.length;
  };
  const terminate = (k) => { if (k >= 0 && !lines[k].endsWith('\n')) lines[k] += eol; };

  const rn = lines.slice(0, authoredEnd).findIndex((l) => RN_HEADING.test(bare(l)));
  if (rn !== -1) {
    const end = nextH2(rn + 1);
    if (lines.slice(rn + 1, end).some((l) => bare(l).trim() !== '')) {
      throw new RepairError('the existing ## Release Note section is not empty');
    }
    terminate(rn);
    const fill = end < lines.length ? [eol, line + eol, eol] : [eol, line + eol];
    lines.splice(rn + 1, end - (rn + 1), ...fill);
    return { body: lines.join(''), mode: 'filled' };
  }
  const ac = lines.slice(0, authoredEnd).findIndex((l) => AC_HEADING.test(bare(l)));
  if (ac === -1) throw new RepairError('no line-anchored ## Acceptance Criteria heading to insert after');
  const at = nextH2(ac + 1);
  if (at < lines.length) {
    lines.splice(at, 0, `## Release Note${eol}`, eol, line + eol, eol);
  } else {
    terminate(lines.length - 1);
    lines.push(eol, `## Release Note${eol}`, eol, line + eol);
  }
  return { body: lines.join(''), mode: 'inserted' };
}

// Common prefix + common suffix; the removed middle must be blank-only, and the added middle's
// non-blank lines must be exactly [heading, line] (insert) or [line] under an existing heading (fill).
function onlyReleaseNoteAdded(original, repaired, rawLine) {
  const line = String(rawLine).trim();
  const a = String(original).split(/\r?\n/);
  const b = String(repaired).split(/\r?\n/);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  if (a.slice(p, a.length - s).some((l) => l.trim() !== '')) return false;
  const added = b.slice(p, b.length - s).filter((l) => l.trim() !== '');
  if (added.length === 2) return RN_HEADING.test(added[0]) && added[1] === line;
  if (added.length !== 1 || added[0] !== line) return false;
  for (let k = p - 1; k >= 0; k -= 1) if (b[k].trim() !== '') return RN_HEADING.test(b[k]);
  return false;
}

function prepareRepair({ liveBody, expectSha, line, checkCli } = {}) {
  if (typeof liveBody !== 'string') return { outcome: 'stale', reason: 'the live read carries no body' };
  if (bodySha(liveBody) !== expectSha) return { outcome: 'stale', reason: 'the record body changed since the scan' };
  const bounds = checkReleaseNoteLine(line);
  if (!bounds.ok) return { outcome: 'bounds', violations: bounds.violations };
  const pre = checkBody(liveBody, { checkCli });
  if (pre.verdict === 'scan-error') return { outcome: 'failed', reason: `compose-record.js --check could not judge the live body (${pre.stderr.trim() || `exit ${pre.code}`})` };
  if (pre.verdict !== 'release-note-only') return { outcome: 'stale', reason: `the live body is no longer Release-Note-only (${pre.verdict})` };
  let applied;
  try {
    applied = applyReleaseNote(liveBody, bounds.line);
  } catch (err) {
    if (err instanceof RepairError) return { outcome: 'failed', reason: err.message };
    throw err;
  }
  const post = checkBody(applied.body, { checkCli });
  if (post.verdict !== 'conforming') {
    return { outcome: 'failed', reason: `the repaired body still fails compose-record.js --check (${post.gaps.join('; ') || post.stderr.trim() || post.verdict})` };
  }
  if (!onlyReleaseNoteAdded(liveBody, applied.body, bounds.line)) {
    return { outcome: 'failed', reason: 'the line diff shows more than the Release Note section' };
  }
  return { outcome: 'ready', body: applied.body, mode: applied.mode, line: bounds.line };
}

function verifyWritten({ before, after, line, checkCli } = {}) {
  const body = after && typeof after.body === 'string' ? after.body : null;
  if (body === null) return ['the post-write read carries no body'];
  const problems = [];
  if (checkBody(body, { checkCli }).verdict !== 'conforming') problems.push('the live body fails compose-record.js --check');
  if (sectionText(body, 'Release Note') !== String(line).trim()) problems.push('the live ## Release Note section does not carry the composed line');
  const was = labelNames(before && before.labels).sort();
  const now = labelNames(after.labels).sort();
  if (!isDeepStrictEqual(was, now)) problems.push(`the label set changed: before [${was.join(', ')}], after [${now.join(', ')}]`);
  return problems;
}

module.exports = { RepairError, applyReleaseNote, onlyReleaseNoteAdded, prepareRepair, verifyWritten };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/release-note-repair/apply.test.js tests/bin-lib/release-note-repair/detect.test.js`
Expected: PASS

- [ ] **Step 5: Prove discrimination**

Temporarily replace `const authoredEnd = originalAt === -1 ? lines.length : originalAt;` with `const authoredEnd = lines.length;`, rerun `apply.test.js`, and confirm the Original-request test FAILS. Restore and rerun: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/release-note-repair/apply.js tests/bin-lib/release-note-repair/apply.test.js
git commit -m "Add release-note-repair apply module — one-section insert/fill with line-diff proof and post-write verify (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 3: `release-note-repair.js` CLI

**Files:**
- Create: `plugin/bin/release-note-repair.js` (mode `0755`, like `compose-record.js`)
- Modify: `docs/plugin-structure.md` (two inserted lines)
- Test: `tests/bin-lib/release-note-repair/cli.test.js`

**Interfaces:**
- Consumes: Task 1 `detect.js`, Task 2 `apply.js`; `plugin/bin/lib/stage-item/write.js`'s `resolveTarget({runDir, cwd, mainRoot}) -> {ok, dir} | {ok:false, reason:'missing'|'not-anchored'}`; `plugin/bin/lib/issues/local-store.js`'s `readRecord(path) -> {path,id,title,body,facets}`; `plugin/bin/lib/atomic-write.js`'s `writeFileAtomic(path, content)`; `plugin/bin/log-decision.js`'s `run(argv, deps) -> 0|2|3`.
- Produces (the contract Tasks 5-6's prose branches on):
  - `scan --driver <d> --records <faceted-json> --out <file>`: writes `{generatedAt, driver, candidates}` JSON to `--out` and prints `summaryLine` (or nothing). Exit 0 / 2.
  - `repair --driver github-issues --ref <n> --live-json <file> --expect-sha <sha> --line-file <file> --out <body-file> (--run <dir> | --snapshot-file <file>)`: on 0, prints `{"ref":"#n","mode","line","snapshot","out"}`.
  - `repair --driver local-files --ref <id> --record-file <path> --expect-sha <sha> --line-file <file> (--run <dir> | --snapshot-file <file>)`: on 0, writes the record file, verifies it, and prints `{"ref","mode","line","snapshot","written":true,"logged"}`.
  - `verify --ref <n> --before-json <file> --after-json <file> --line-file <file> [--run <dir>]`: on 0, prints `{"ref":"#n","verified":true,"logged"}`.
  - Exit codes: 0 done; 2 malformed or unreadable input; 3 run dir missing or not anchored, or a snapshot, `--out` or record write failed; 4 bound violation (stderr `  - {id}` lines); 5 stale premise; 6 repair failure (nothing written; local: original restored); 7 post-write verification failed.
  - Snapshot path under `--run`: `{run}/snapshots/tidy-release-note-{ref}.original.md`. `AUTO` entry: step `Step 7 Fill Release Note`, reversibility `high`, text `filled the Release Note on {ref} with "{line}"; snapshot {relative path}`.

- [ ] **Step 1: Write the failing CLI tests**

```js
// tests/bin-lib/release-note-repair/cli.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/release-note-repair');
const { bodySha } = require('../../../plugin/bin/lib/release-note-repair/detect');
const { onlyReleaseNoteAdded } = require('../../../plugin/bin/lib/release-note-repair/apply');
const { writeRecord, readRecord } = require('../../../plugin/bin/lib/issues/local-store');
const F = require('./fixtures');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-cli-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-09-29T120000-tidy-standalone');
  const shadow = path.join(main, '.claude', 'worktrees', 'wt', '.claude-tweaks', 'pipelines', '2026-09-29T120000-tidy-standalone');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'wt', '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  const write = (name, content) => { const p = path.join(root, name); fs.writeFileSync(p, content); return p; };
  return { root, main, runDir, shadow, write };
}

function deps(cwd) {
  const out = []; const err = [];
  return {
    d: { cwd: () => cwd, mainRoot: undefined, now: () => Date.UTC(2026, 8, 29, 12, 0, 0), stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
    out: () => out.join(''), err: () => err.join(''),
  };
}

const liveJson = (body, extra = {}) => JSON.stringify({ body, labels: [{ name: 'ready' }, { name: 'auto:build' }], state: 'OPEN', ...extra });

test('scan: writes every candidate to --out and prints one summary line', () => {
  const fx = fixture();
  const records = fx.write('recs.json', JSON.stringify([
    { number: 1, title: 'A', state: 'OPEN', labels: [{ name: 'ready' }], body: F.MISSING_RN, facets: { stage: 'ready' } },
    { number: 2, title: 'B', state: 'OPEN', labels: [{ name: 'ready' }], body: F.CONFORMING, facets: { stage: 'ready' } },
  ]));
  const outFile = path.join(fx.root, 'cands.json');
  const t = deps(fx.main);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', records, '--out', outFile], t.d), 0);
  const payload = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  assert.equal(payload.driver, 'github-issues');
  assert.deepEqual(payload.candidates.map((c) => c.ref), ['#1']);
  assert.equal(t.out(), `—\t[release-note] 1 ready record(s) missing only a Release Note, 0 scan error(s) — Fill Release Note (candidates: ${outFile})\n`);
});

test('scan: no match writes an empty list and prints nothing; bad input is exit 2', () => {
  const fx = fixture();
  const outFile = path.join(fx.root, 'cands.json');
  const empty = fx.write('empty.json', '[]');
  const t = deps(fx.main);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', empty, '--out', outFile], t.d), 0);
  assert.equal(t.out(), '');
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates, []);
  assert.equal(run(['scan', '--driver', 'nope', '--records', empty, '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', path.join(fx.root, 'missing.json'), '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['scan', '--driver', 'github-issues', '--records', fx.write('obj.json', '{}'), '--out', outFile], deps(fx.main).d), 2);
  assert.equal(run(['bogus'], deps(fx.main).d), 2);
});

function githubRepair(fx, { body = F.MISSING_RN, sha = bodySha(F.MISSING_RN), line = `${F.LINE}\n`, extra = {}, dest } = {}) {
  const live = fx.write('live.json', liveJson(body, extra));
  const lineFile = fx.write('line.txt', line);
  const out = path.join(fx.root, 'repaired.md');
  const t = deps(fx.main);
  const argv = ['repair', '--driver', 'github-issues', '--ref', '7', '--live-json', live, '--expect-sha', sha, '--line-file', lineFile, '--out', out, ...(dest || ['--run', fx.runDir])];
  return { code: run(argv, t.d), out, t };
}

test('repair (github-issues): snapshots first, writes the repaired body, never touches staged/', () => {
  const fx = fixture();
  const { code, out, t } = githubRepair(fx);
  assert.equal(code, 0, t.err());
  const snap = path.join(fx.runDir, 'snapshots', 'tidy-release-note-7.original.md');
  assert.equal(fs.readFileSync(snap, 'utf8'), F.MISSING_RN);
  assert.equal(fs.readFileSync(out, 'utf8'), F.REPAIRED);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'staged')), false);
  const json = JSON.parse(t.out());
  assert.equal(json.ref, '#7');
  assert.equal(json.mode, 'inserted');
  assert.equal(json.line, F.LINE);
  assert.equal(fs.realpathSync(json.snapshot), fs.realpathSync(snap));
});

test('repair: a repair with no snapshot destination, or both, is refused (exit 2)', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { dest: [] }).code, 2);
  assert.equal(githubRepair(fx, { dest: ['--run', fx.runDir, '--snapshot-file', path.join(fx.root, 's.md')] }).code, 2);
});

test('repair: --snapshot-file writes the snapshot there (interactive, no run dir)', () => {
  const fx = fixture();
  const snap = path.join(fx.root, 'snap', 'tidy-release-note-7.original.md');
  assert.equal(githubRepair(fx, { dest: ['--snapshot-file', snap] }).code, 0);
  assert.equal(fs.readFileSync(snap, 'utf8'), F.MISSING_RN);
});

test('repair: a worktree-local shadow run dir is exit 3 and writes nothing there', () => {
  const fx = fixture();
  const { code, out } = githubRepair(fx, { dest: ['--run', fx.shadow] });
  assert.equal(code, 3);
  assert.equal(fs.existsSync(path.join(fx.shadow, 'snapshots')), false);
  assert.equal(fs.existsSync(out), false);
});

test('repair: a line failing a bound is exit 4 with the violations, nothing written', () => {
  const fx = fixture();
  const { code, out, t } = githubRepair(fx, { line: 'feat: fixes #12\n' });
  assert.equal(code, 4);
  assert.match(t.err(), /  - record-ref/);
  assert.match(t.err(), /  - conventional-prefix/);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair: an edited body, a closed record, or a lost ready label is a stale premise (exit 5)', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { body: `${F.MISSING_RN}edited\n` }).code, 5);
  assert.equal(githubRepair(fx, { extra: { state: 'CLOSED' } }).code, 5);
  assert.equal(githubRepair(fx, { extra: { labels: [{ name: 'auto:build' }] } }).code, 5);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair: an MCP-shaped live read (lowercase state, string labels) is not stale', () => {
  const fx = fixture();
  assert.equal(githubRepair(fx, { extra: { state: 'open', labels: ['ready', 'auto:build'] } }).code, 0);
});

test('repair: a mid-line Acceptance Criteria mention the gate accepts is a repair failure (exit 6), nothing written', () => {
  const fx = fixture();
  const { code, out } = githubRepair(fx, { body: F.MIDLINE_AC, sha: bodySha(F.MIDLINE_AC) });
  assert.equal(code, 6);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

function localFixture(facets = {}) {
  const fx = fixture();
  const recordFile = path.join(fx.main, 'specs', '42-widget-cache.md');
  writeRecord(recordFile, { title: 'Widget cache', body: F.MISSING_RN, facets: { type: 'task', risk: 'low', size: 'small', stage: 'ready', grants: { build: true }, ...facets } });
  return { ...fx, recordFile };
}

test('repair (local-files): writes the file, keeps facets and every other byte, logs AUTO, snapshots the raw file', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const before = readRecord(fx.recordFile);
  const lineFile = fx.write('line.txt', F.LINE);
  const t = deps(fx.main);
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(before.body), '--line-file', lineFile, '--run', fx.runDir], t.d);
  assert.equal(code, 0, t.err());
  const rawAfter = fs.readFileSync(fx.recordFile, 'utf8');
  const after = readRecord(fx.recordFile);
  assert.deepEqual(after.facets, before.facets);
  assert.equal(after.title, before.title);
  assert.equal(onlyReleaseNoteAdded(rawBefore, rawAfter, F.LINE), true);
  assert.equal(fs.readFileSync(path.join(fx.runDir, 'snapshots', 'tidy-release-note-42.original.md'), 'utf8'), rawBefore);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /- AUTO \d\d:\d\d:\d\d — Step 7 Fill Release Note: filled the Release Note on \S*42-widget-cache\.md with /);
  assert.ok(decisions.includes(`"${F.LINE}"`));
  assert.match(decisions, /Reversibility: high\./);
  const json = JSON.parse(t.out());
  assert.equal(json.written, true);
  assert.equal(json.logged, true);
});

test('repair (local-files): a record edited between scan and write is skipped (exit 5), file byte-unchanged', () => {
  const fx = localFixture();
  const rawBefore = fs.readFileSync(fx.recordFile, 'utf8');
  const lineFile = fx.write('line.txt', F.LINE);
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(F.CONFORMING), '--line-file', lineFile, '--run', fx.runDir], deps(fx.main).d);
  assert.equal(code, 5);
  assert.equal(fs.readFileSync(fx.recordFile, 'utf8'), rawBefore);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'snapshots')), false);
});

test('repair (local-files): a record no longer ready is stale (exit 5)', () => {
  const fx = localFixture({ stage: 'parked' });
  const body = readRecord(fx.recordFile).body;
  const code = run(['repair', '--driver', 'local-files', '--ref', '42', '--record-file', fx.recordFile, '--expect-sha', bodySha(body), '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], deps(fx.main).d);
  assert.equal(code, 5);
});

test('verify: identical labels + conforming body carrying the line is exit 0 and logs AUTO', () => {
  const fx = fixture();
  const before = fx.write('before.json', liveJson(F.MISSING_RN));
  const after = fx.write('after.json', JSON.stringify({ body: F.REPAIRED, labels: [{ name: 'auto:build' }, { name: 'ready' }], state: 'OPEN' }));
  const t = deps(fx.main);
  assert.equal(run(['verify', '--ref', '7', '--before-json', before, '--after-json', after, '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], t.d), 0, t.err());
  assert.deepEqual(JSON.parse(t.out()), { ref: '#7', verified: true, logged: true });
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.ok(decisions.includes(`filled the Release Note on #7 with "${F.LINE}"; snapshot snapshots/tidy-release-note-7.original.md`));
});

test('verify: a changed label set is exit 7 and logs nothing', () => {
  const fx = fixture();
  const before = fx.write('before.json', liveJson(F.MISSING_RN));
  const after = fx.write('after.json', JSON.stringify({ body: F.REPAIRED, labels: [{ name: 'ready' }], state: 'OPEN' }));
  const t = deps(fx.main);
  assert.equal(run(['verify', '--ref', '7', '--before-json', before, '--after-json', after, '--line-file', fx.write('line.txt', F.LINE), '--run', fx.runDir], t.d), 7);
  assert.match(t.err(), /label set changed/);
  assert.equal(fs.existsSync(path.join(fx.runDir, 'decisions.md')), false);
});

test('--help prints usage and exits 0', () => {
  const t = deps(process.cwd());
  assert.equal(run(['--help'], t.d), 0);
  assert.match(t.out(), /usage: release-note-repair\.js scan/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/release-note-repair/cli.test.js`
Expected: FAIL — `Cannot find module '../../../plugin/bin/release-note-repair'`

- [ ] **Step 3: Write the CLI**

```js
#!/usr/bin/env node
// bin/release-note-repair.js — /tidy Shape 4.5 (#2828): a `ready` record whose only spec-shape gap
// is its `## Release Note` gets one composed line inserted in place, labels untouched. Consumed by
// skills/tidy/step-1-records.md (scan) and skills/tidy/release-note-repair.md (repair, verify).
//   scan   --driver github-issues|local-files --records <faceted-json> --out <candidates-json>
//   repair --driver github-issues --ref <n> --live-json <file> --expect-sha <sha256> --line-file <file> --out <body-file> (--run <run-dir> | --snapshot-file <file>)
//   repair --driver local-files --ref <id> --record-file <path> --expect-sha <sha256> --line-file <file> (--run <run-dir> | --snapshot-file <file>)
//   verify --ref <n> --before-json <file> --after-json <file> --line-file <file> [--run <run-dir>]
// Exit codes: Sanctioned-writer base (0 done / 2 malformed invocation or unreadable input / 3 run
// dir missing or not anchored under the main checkout, or a snapshot/--out/record write failed) plus
// domain codes, each branched on by release-note-repair.md: 4 the composed line fails a bound —
// recompose once; 5 stale premise — skip, nothing written; 6 repair failure — nothing written
// (local-files: original restored); 7 post-write verification failed. The snapshot is always
// written before any output body or record file, and a repair without a snapshot destination is
// refused — the undo copy precedes the write by construction.
'use strict';

const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const detect = require('./lib/release-note-repair/detect');
const apply = require('./lib/release-note-repair/apply');
const { resolveTarget } = require('./lib/stage-item/write');
const { readRecord } = require('./lib/issues/local-store');
const { writeFileAtomic } = require('./lib/atomic-write');
const logDecision = require('./log-decision');

const USAGE = [
  'usage: release-note-repair.js scan --driver github-issues|local-files --records <faceted-json> --out <candidates-json>',
  '       release-note-repair.js repair --driver github-issues --ref <n> --live-json <file> --expect-sha <sha256> --line-file <file> --out <body-file> (--run <run-dir> | --snapshot-file <file>)',
  '       release-note-repair.js repair --driver local-files --ref <id> --record-file <path> --expect-sha <sha256> --line-file <file> (--run <run-dir> | --snapshot-file <file>)',
  '       release-note-repair.js verify --ref <n> --before-json <file> --after-json <file> --line-file <file> [--run <run-dir>]',
  'exit: 0 done | 2 malformed or unreadable input | 3 run dir missing/not anchored, or a write failed',
  '      4 line fails a bound | 5 stale premise, skipped | 6 repair failure, nothing written | 7 post-write verification failed',
].join('\n') + '\n';

const FLAGS = {
  scan: ['driver', 'records', 'out'],
  repair: ['driver', 'ref', 'live-json', 'record-file', 'expect-sha', 'line-file', 'out', 'run', 'snapshot-file'],
  verify: ['ref', 'before-json', 'after-json', 'line-file', 'run'],
};
const DRIVERS = ['github-issues', 'local-files'];
const REF_RE = /^[1-9]\d*$/;
const SHA_RE = /^[0-9a-f]{64}$/;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h') return { help: true };
  if (!Object.prototype.hasOwnProperty.call(FLAGS, cmd)) return { error: `unknown subcommand: ${cmd}` };
  const o = { cmd };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a === '--help' || a === '-h') return { help: true };
    const key = a.startsWith('--') ? a.slice(2) : null;
    if (!key || !FLAGS[cmd].includes(key)) return { error: `unknown argument for ${cmd}: ${a}` };
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${a} needs a value` };
    o[key] = value;
    i += 1;
  }
  return o;
}

const realDeps = {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: () => process.cwd(),
  mainRoot: undefined,
  now: () => Date.now(),
  checkCli: undefined,
};

function readText(p) { return fs.readFileSync(p, 'utf8'); }

function outcomeExit(prep, deps) {
  if (prep.outcome === 'bounds') {
    deps.stderr(`release-note-repair.js: the composed line fails a bound:\n${prep.violations.map((v) => `  - ${v}`).join('\n')}\n`);
    return 4;
  }
  if (prep.outcome === 'stale') { deps.stderr(`release-note-repair.js: stale premise — ${prep.reason}\n`); return 5; }
  deps.stderr(`release-note-repair.js: repair failed — ${prep.reason}\n`);
  return 6;
}

function logAuto(deps, runDir, text) {
  const code = logDecision.run(
    ['--run', runDir, '--status', 'AUTO', '--step', 'Step 7 Fill Release Note', '--text', text, '--reversibility', 'high'],
    { now: deps.now, cwd: deps.cwd, mainRoot: deps.mainRoot, stdout: () => {}, stderr: deps.stderr },
  );
  return code === 0;
}

// -> { file, runDir } | { usage } | { anchor }
function snapshotTarget(o, deps) {
  if (o.run && o['snapshot-file']) return { usage: 'pass --run or --snapshot-file, not both' };
  if (!o.run && !o['snapshot-file']) return { usage: 'a repair needs a pre-write snapshot destination: --run <run-dir> or --snapshot-file <file>' };
  if (o['snapshot-file']) return { file: o['snapshot-file'], runDir: null };
  let target;
  try { target = resolveTarget({ runDir: o.run, cwd: deps.cwd(), mainRoot: deps.mainRoot }); } catch (err) { return { anchor: (err && err.message) || String(err) }; }
  if (!target.ok) {
    return { anchor: target.reason === 'missing' ? `run dir does not exist: ${o.run}` : `run dir is not anchored under the main checkout (a worktree-local shadow): ${o.run}` };
  }
  return { file: path.join(target.dir, 'snapshots', `tidy-release-note-${o.ref}.original.md`), runDir: target.dir };
}

function writeSnapshot(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function cmdScan(o, deps, usage) {
  if (!DRIVERS.includes(o.driver)) return usage('--driver must be github-issues or local-files');
  if (!o.records || !o.out) return usage('--records and --out are required');
  let records;
  try { records = JSON.parse(readText(o.records)); } catch (err) { return usage(`could not read --records ${o.records} (${err.message})`); }
  if (!Array.isArray(records)) return usage('--records must hold a JSON array');
  const candidates = detect.scanRecords(records, { driver: o.driver, checkCli: deps.checkCli });
  const payload = { generatedAt: new Date(deps.now()).toISOString(), driver: o.driver, candidates };
  try { fs.writeFileSync(o.out, `${JSON.stringify(payload, null, 2)}\n`); } catch (err) { return usage(`could not write --out ${o.out} (${err.message})`); }
  const line = detect.summaryLine(candidates, o.out);
  if (line) deps.stdout(`${line}\n`);
  return 0;
}

function repairGithub(o, deps, usage, rawLine, dest) {
  if (!o['live-json'] || !o.out) return usage('github-issues repair needs --live-json and --out');
  let live;
  try { live = JSON.parse(readText(o['live-json'])); } catch (err) { return usage(`could not read --live-json (${err.message})`); }
  if (!live || typeof live.body !== 'string') return usage('--live-json carries no body string');
  if (String(live.state || '').toUpperCase() !== 'OPEN') return outcomeExit({ outcome: 'stale', reason: `the record is ${live.state || 'in an unknown state'}` }, deps);
  if (!detect.labelNames(live.labels).includes('ready')) return outcomeExit({ outcome: 'stale', reason: 'the record no longer carries ready' }, deps);
  const prep = apply.prepareRepair({ liveBody: live.body, expectSha: o['expect-sha'], line: rawLine, checkCli: deps.checkCli });
  if (prep.outcome !== 'ready') return outcomeExit(prep, deps);
  try { writeSnapshot(dest.file, live.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write snapshot ${dest.file} (${err.message})\n`); return 3; }
  try { fs.writeFileSync(o.out, prep.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write --out ${o.out} (${err.message})\n`); return 3; }
  deps.stdout(`${JSON.stringify({ ref: `#${o.ref}`, mode: prep.mode, line: prep.line, snapshot: dest.file, out: o.out })}\n`);
  return 0;
}

function repairLocal(o, deps, usage, rawLine, dest) {
  if (!o['record-file']) return usage('local-files repair needs --record-file');
  const file = o['record-file'];
  let raw;
  let live;
  try { raw = readText(file); live = readRecord(file); } catch (err) {
    return outcomeExit({ outcome: 'stale', reason: `could not read ${file} (${err.message})` }, deps);
  }
  if (live.facets.closed) return outcomeExit({ outcome: 'stale', reason: 'the record is closed' }, deps);
  if (live.facets.stage !== 'ready') return outcomeExit({ outcome: 'stale', reason: 'the record is no longer ready' }, deps);
  const prep = apply.prepareRepair({ liveBody: live.body, expectSha: o['expect-sha'], line: rawLine, checkCli: deps.checkCli });
  if (prep.outcome !== 'ready') return outcomeExit(prep, deps);
  // Splice the raw file, not writeRecord: re-serializing frontmatter can rewrite bytes outside the section.
  let applied;
  try { applied = apply.applyReleaseNote(raw, prep.line); } catch (err) {
    if (err instanceof apply.RepairError) return outcomeExit({ outcome: 'failed', reason: err.message }, deps);
    throw err;
  }
  if (!apply.onlyReleaseNoteAdded(raw, applied.body, prep.line)) {
    return outcomeExit({ outcome: 'failed', reason: 'the record-file line diff shows more than the Release Note section' }, deps);
  }
  try { writeSnapshot(dest.file, raw); } catch (err) { deps.stderr(`release-note-repair.js: could not write snapshot ${dest.file} (${err.message})\n`); return 3; }
  try { writeFileAtomic(file, applied.body); } catch (err) { deps.stderr(`release-note-repair.js: could not write ${file} (${err.message}) — unchanged\n`); return 3; }
  let after = null;
  try { after = readRecord(file); } catch { after = null; }
  const verified = after !== null
    && isDeepStrictEqual(after.facets, live.facets)
    && after.title === live.title
    && detect.checkBody(after.body, { checkCli: deps.checkCli }).verdict === 'conforming';
  if (!verified) {
    try { writeFileAtomic(file, raw); } catch (err) {
      deps.stderr(`release-note-repair.js: re-read verification failed and restoring ${file} failed (${err.message}); original at ${dest.file}\n`);
      return 7;
    }
    return outcomeExit({ outcome: 'failed', reason: 'the written record failed re-read verification; the original was restored' }, deps);
  }
  const logged = dest.runDir
    ? logAuto(deps, dest.runDir, `filled the Release Note on ${file} with "${prep.line}"; snapshot ${path.relative(dest.runDir, dest.file)}`)
    : false;
  deps.stdout(`${JSON.stringify({ ref: file, mode: applied.mode, line: prep.line, snapshot: dest.file, written: true, logged })}\n`);
  return 0;
}

function cmdRepair(o, deps, usage) {
  if (!DRIVERS.includes(o.driver)) return usage('--driver must be github-issues or local-files');
  if (!REF_RE.test(o.ref || '')) return usage('--ref must be a positive record number');
  if (!SHA_RE.test(o['expect-sha'] || '')) return usage('--expect-sha must be a sha256 hex digest');
  if (!o['line-file']) return usage('--line-file is required');
  let rawLine;
  try { rawLine = readText(o['line-file']); } catch (err) { return usage(`could not read --line-file (${err.message})`); }
  const dest = snapshotTarget(o, deps);
  if (dest.usage) return usage(dest.usage);
  if (dest.anchor) { deps.stderr(`release-note-repair.js: ${dest.anchor} — resolve $RUN_ROOT per _shared/pipeline-run-dir.md\n`); return 3; }
  return o.driver === 'github-issues' ? repairGithub(o, deps, usage, rawLine, dest) : repairLocal(o, deps, usage, rawLine, dest);
}

function cmdVerify(o, deps, usage) {
  if (!REF_RE.test(o.ref || '')) return usage('--ref must be a positive record number');
  if (!o['before-json'] || !o['after-json'] || !o['line-file']) return usage('--before-json, --after-json and --line-file are required');
  let before;
  let after;
  let rawLine;
  try {
    before = JSON.parse(readText(o['before-json']));
    after = JSON.parse(readText(o['after-json']));
    rawLine = readText(o['line-file']);
  } catch (err) { return usage(`could not read an input file (${err.message})`); }
  const line = detect.checkReleaseNoteLine(rawLine).line;
  const problems = apply.verifyWritten({ before, after, line, checkCli: deps.checkCli });
  if (problems.length) {
    deps.stderr(`release-note-repair.js: post-write verification failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 7;
  }
  const logged = o.run
    ? logAuto(deps, o.run, `filled the Release Note on #${o.ref} with "${line}"; snapshot snapshots/tidy-release-note-${o.ref}.original.md`)
    : false;
  deps.stdout(`${JSON.stringify({ ref: `#${o.ref}`, verified: true, logged })}\n`);
  return 0;
}

function run(argv, deps = realDeps) {
  const o = parseArgs(argv);
  if (o.help) { deps.stdout(USAGE); return 0; }
  const usage = (message) => { deps.stderr(`release-note-repair.js: ${message}\n${USAGE}`); return 2; };
  if (o.error) return usage(o.error);
  if (o.cmd === 'scan') return cmdScan(o, deps, usage);
  if (o.cmd === 'repair') return cmdRepair(o, deps, usage);
  return cmdVerify(o, deps, usage);
}

module.exports = { run, parseArgs };

if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);
```

- [ ] **Step 4: Make it executable and run the tests**

Run: `chmod 0755 plugin/bin/release-note-repair.js`
Run: `node --test tests/bin-lib/release-note-repair/*.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS. (The local-files `AUTO` assertion matches on `42-widget-cache.md` alone because the logged path is whatever `--record-file` was passed; macOS tmp paths differ between `/var` and `/private/var`. If it fails, fix the assertion, never the CLI's log text.)

- [ ] **Step 5: Register the CLI and module in `docs/plugin-structure.md`**

Insert, as a new whole line immediately after the line that begins `plugin/bin/lib/compose-record/    →`:

```text
plugin/bin/lib/release-note-repair/ → detect.js — /tidy Shape 4.5's detection half (#2828): classifyCheckResult over compose-record.js --check's exit/stderr contract (run in-process via its exported run), checkReleaseNoteLine (the Deliverable 2 bounds), scanRecords (ready + worklist rule + Release-Note-only), summaryLine; apply.js — applyReleaseNote (line-anchored insert/fill, CRLF-preserving, scoped before ## Original request), onlyReleaseNoteAdded (line-diff proof), prepareRepair, verifyWritten. Consumed by plugin/bin/release-note-repair.js.
```

Insert, as a new whole line immediately after the line that begins `node plugin/bin/compose-record.js --check <body-file>`:

```text
node plugin/bin/release-note-repair.js scan|repair|verify ...   # Release-note-repair CLI (#2828) — /tidy Shape 4.5: scan writes the uncapped candidate list; repair re-verifies the live body by sha256, checks the line's bounds, snapshots to {run-dir}/snapshots/ first, and inserts one ## Release Note section (local-files: writes and re-verifies the file); verify checks a written GitHub body and its unchanged label set. Exit 0 / 2 / 3 / 4 bounds / 5 stale / 6 repair failure / 7 verification failed.
```

- [ ] **Step 6: Run the tests again and commit**

Run: `node --test tests/bin-lib/release-note-repair/*.test.js`
Expected: PASS

```bash
git add plugin/bin/release-note-repair.js tests/bin-lib/release-note-repair/cli.test.js docs/plugin-structure.md
git commit -m "Add release-note-repair.js CLI — scan, snapshot-first repair, and post-write verify for tidy Shape 4.5 (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 4: Lint — indented Applied sub-lines carry no trailing column

**Files:**
- Modify: `plugin/bin/lib/tidy-report-lint/rules.js` (`checkAligned`, lines 183-208)
- Test: `tests/bin-lib/tidy-report-lint/rules.test.js` (append)

**Interfaces:**
- Consumes: `headerAbove(text, block)` and `alignedFences(text)` (same file).
- Produces: `checkAligned` skips lines with leading whitespace inside the **Applied automatically** fence. Task 6's Release Note sub-lines, and the existing reconcile skip sub-lines, rely on this.

- [ ] **Step 1: Write the characterization + failing test**

Append to `tests/bin-lib/tidy-report-lint/rules.test.js`:

```js
test('Aligned: an indented detail sub-line under an Applied row is not a mis-aligned row', () => {
  const lines = conformantReport().split('\n');
  const idx = lines.findIndex((l) => l.startsWith('deleted'));
  lines.splice(idx + 1, 0, '   Made widget lookups faster for every dashboard that reads them.');
  assert.equal(RULES.find((r) => r.name === 'Aligned').check(lines.join('\n')), null);
});

test('Aligned: a mis-padded col-0 Applied row is still flagged when a sub-line sits beside it', () => {
  const lines = conformantReport().split('\n');
  const idx = lines.findIndex((l) => l.startsWith('deleted'));
  lines[idx] = lines[idx].replace(/\s+commit/, ' commit');
  lines.splice(idx + 1, 0, '   Made widget lookups faster.');
  assert.match(RULES.find((r) => r.name === 'Aligned').check(lines.join('\n')), /^Aligned: line \d+ trailing column starts at \d+, expected \d+$/);
});
```

(`conformantReport` and `RULES` are already imported at the top of that file. Confirm with `sed -n 1,15p tests/bin-lib/tidy-report-lint/rules.test.js`, and add the import only if it is missing.)

- [ ] **Step 2: Run the new test and see it fail (characterizes current behavior)**

Run: `node --test tests/bin-lib/tidy-report-lint/rules.test.js`
Expected: the first new test FAILS with `Aligned: line N trailing column starts at 3, expected …`. The second passes.

- [ ] **Step 3: Implement**

In `checkAligned`, replace:

```js
  for (const block of alignedFences(text)) {
    const isYours = /\*\*Yours \(\d+\)\*\*/.test(headerAbove(text, block));
```

with:

```js
  for (const block of alignedFences(text)) {
    const header = headerAbove(text, block);
    const isYours = /\*\*Yours \(\d+\)\*\*/.test(header);
    const isApplied = header === '**Applied automatically**';
```

and, directly after the existing `if (isYours && (line[0] !== ' ' || COMMAND_LINE.test(trimmed))) return;` line, add:

```js
      // Applied rows start at column 0 (a verb); an indented line is a detail sub-line — a
      // reconcile skip reason or a filled Release Note (tidy/release-note-repair.md) — with no
      // trailing column of its own.
      if (isApplied && line[0] === ' ') return;
```

- [ ] **Step 4: Run the lint suites**

Run: `node --test tests/bin-lib/tidy-report-lint/rules.test.js tests/tidy-report-rules.test.js`
Expected: PASS (including the pre-existing `flags a mis-padded Applied-automatically row`)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/tidy-report-lint/rules.js tests/bin-lib/tidy-report-lint/rules.test.js
git commit -m "Exempt indented Applied sub-lines from the Aligned lint — skip reasons and filled Release Notes carry no trailing column (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 5: Shape 4.5 in `step-1-records.md`

**Files:**
- Modify: `plugin/skills/tidy/step-1-records.md` (worklist-rule heading at line 51; new section inserted after Shape 4, which ends at line 119)
- Modify: `tests/tidy-needs-worklist-rule.test.js:16,17,23` (the pinned scope string)
- Test: `tests/tidy-release-note-shape.test.js` (new)

**Interfaces:**
- Consumes: Task 3's `scan` CLI contract. The `{release-note-candidates-file}` placeholder is substituted by the dispatcher, per Task 6's SKILL.md note.
- Produces: the Shape 4.5 detection text, and the fenced scan block that the test executes.

- [ ] **Step 1: Baseline the pinned suites (characterization)**

Run: `node --test tests/tidy-needs-worklist-rule.test.js tests/needs-worklist-rule-cross-consumer.test.js tests/materiality-floor-conformance.test.js tests/tidy-residue-markers.test.js`
Expected: PASS (record the counts)

- [ ] **Step 2: Write the failing test**

```js
// tests/tidy-release-note-shape.test.js
'use strict';
// #2828: step-1-records.md's Shape 4.5 — placement, worklist scope, and the fenced scan block
// extracted and executed against a fixture (docs/skill-authoring.md § Executable snippets).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sessionTmpPath } = require('../plugin/bin/lib/session-tmp');
const F = require('./bin-lib/release-note-repair/fixtures');

const ROOT = path.join(__dirname, '..');
const PLUGIN_ROOT = path.join(ROOT, 'plugin');
const DOC = fs.readFileSync(path.join(ROOT, 'plugin/skills/tidy/step-1-records.md'), 'utf8');
const FLAT = DOC.replace(/\s+/g, ' ');

function shapeBlock() {
  const start = DOC.indexOf('### Shape 4.5 — ');
  assert.notEqual(start, -1, 'Shape 4.5 heading missing');
  const m = /```bash\n([\s\S]*?)\n```/.exec(DOC.slice(start));
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  return m[1];
}

test('Shape 4.5 sits between Shape 4 and Shape 5', () => {
  const s4 = DOC.indexOf('### Shape 4 — ');
  const s45 = DOC.indexOf('### Shape 4.5 — ');
  const s5 = DOC.indexOf('### Shape 5 — ');
  assert.ok(s4 !== -1 && s4 < s45 && s45 < s5);
});

test('Shape 4.5 joins the worklist rule and names its contract', () => {
  assert.ok(FLAT.includes('Worklist rule (Shapes 1, 2, 3, 4, 4.5, 5, 7, 8)'));
  const section = DOC.slice(DOC.indexOf('### Shape 4.5 — '), DOC.indexOf('### Shape 5 — ')).replace(/\s+/g, ' ');
  assert.ok(section.includes('`missing section: ## Release Note`'));
  assert.ok(section.includes('`empty section: ## Release Note`'));
  assert.ok(section.includes('any other exit is a scan error'));
  assert.ok(section.includes('`Fill Release Note (insert one ## Release Note section; labels unchanged)`'));
  assert.ok(section.includes('`release-note-repair.md`'));
  assert.ok(section.includes('[release-note]'));
});

function runBlock(driver, records) {
  const sessionId = `rn-shape-${process.pid}-${Date.now()}-${driver}`;
  const facetedPath = sessionTmpPath(sessionId, 'tidy-records-faceted.json');
  fs.writeFileSync(facetedPath, JSON.stringify(records));
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-shape-')), 'cands.json');
  const script = shapeBlock()
    .split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT)
    .split('{work-backend}').join(driver)
    .split('{release-note-candidates-file}').join(outFile);
  try {
    const stdout = execFileSync('bash', ['-c', script], { env: { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId }, encoding: 'utf8' });
    return { stdout, candidates: JSON.parse(fs.readFileSync(outFile, 'utf8')).candidates, outFile };
  } finally {
    fs.rmSync(path.dirname(facetedPath), { recursive: true, force: true });
  }
}

test('the Shape 4.5 block runs (github-issues) and writes the uncapped list', () => {
  const rec = (number, body, stage = 'ready') => ({ number, title: `R${number}`, state: 'OPEN', labels: [{ name: 'ready' }], body, facets: { stage } });
  const { stdout, candidates, outFile } = runBlock('github-issues', [rec(1, F.MISSING_RN), rec(2, F.CONFORMING), rec(3, F.MISSING_RN, 'backlog')]);
  assert.equal(stdout, `—\t[release-note] 1 ready record(s) missing only a Release Note, 0 scan error(s) — Fill Release Note (candidates: ${outFile})\n`);
  assert.deepEqual(candidates.map((c) => c.ref), ['#1']);
});

test('the Shape 4.5 block runs (local-files)', () => {
  const { candidates } = runBlock('local-files', [{ path: 'specs/9-x.md', id: 9, title: 'L9', body: F.EMPTY_RN, facets: { stage: 'ready', needsDefinition: false, closed: false } }]);
  assert.deepEqual(candidates.map((c) => [c.ref, c.gap]), [['specs/9-x.md', 'empty section: ## Release Note']]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/tidy-release-note-shape.test.js`
Expected: FAIL — `Shape 4.5 heading missing`

- [ ] **Step 4: Edit the worklist-rule heading**

In `plugin/skills/tidy/step-1-records.md` line 51, replace `**Worklist rule (Shapes 1, 2, 3, 4, 5, 7, 8).**` with `**Worklist rule (Shapes 1, 2, 3, 4, 4.5, 5, 7, 8).**`.

In `tests/tidy-needs-worklist-rule.test.js`, replace every `Shapes 1, 2, 3, 4, 5, 7, 8` (three occurrences: lines 16, 17, 23) with `Shapes 1, 2, 3, 4, 4.5, 5, 7, 8`.

- [ ] **Step 5: Insert the Shape 4.5 section**

Insert immediately after line 119 (`→ Collect each as: \`[scoring]\` …`), preceded by one blank line, before `### Shape 5 — \`bot:blocked\` needing re-triage`:

````markdown
### Shape 4.5 — `ready` record missing only its Release Note

Both drivers. Numbered 4.5 rather than appended, for the same reason as Shape 5.5 — Shapes 5, 6,
7, and 8 keep the numbers other files already cite.

`facets.stage === 'ready'` and the body's **only** spec-shape gap is `## Release Note`, judged by
`compose-record.js --check` (#2827) — the Materialization gate's own checker, so this shape and
`/flow`'s gate never disagree. Exit 4 with exactly one gap line reading `missing section: ##
Release Note` or `empty section: ## Release Note` matches; exit 0, or any other gap alone or
alongside it, does not (`/claude-tweaks:backlog refine`'s flag-back owns those); any other exit is
a scan error for that record, never a match. `release-note-repair.js scan` applies the whole rule
— both worklist-rule checks above included, the second against the fixed staged-action text
`Fill Release Note (insert one ## Release Note section; labels unchanged)` — so do not re-filter
its output:

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" TIDY_RECORDS_FACETED=tidy-records-faceted.json)"
node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" scan --driver {work-backend} --records "$TIDY_RECORDS_FACETED" --out "{release-note-candidates-file}"
```

`{work-backend}` is the driver this step resolved; `{release-note-candidates-file}` is the absolute
path the dispatcher substituted into this prompt (`SKILL.md`'s Step 1 note). The scan writes every
candidate there — this agent's 15-row table cap never truncates the repair list — and prints at
most one summary line. Exit 2 (an unusable records file or `--out`): report one
`[release-note] scan failed` row, severity `medium`.

→ Collect the summary line as one row, Path:Line `—`, severity `info`. Composing and writing the
Release Note are the main thread's (`release-note-repair.md`), never this agent's.
````

- [ ] **Step 6: Run the tests**

Run: `node --test tests/tidy-release-note-shape.test.js tests/tidy-needs-worklist-rule.test.js tests/needs-worklist-rule-cross-consumer.test.js tests/materiality-floor-conformance.test.js tests/tidy-residue-markers.test.js tests/node-e-snippet-syntax.test.js`
Expected: PASS

- [ ] **Step 7: Renumbering sweep (three forms) and byte check**

```bash
grep -rn "Shapes 1, 2, 3, 4" plugin/ docs/ tests/
grep -rn "Shapes 1-5\|Shapes 1–5" plugin/ docs/ tests/
grep -rn "Shapes 4 and 5\|Shape 4 and\|four shapes\|five shapes" plugin/ docs/ tests/
wc -c plugin/skills/tidy/step-1-records.md
```

Expected: the first grep prints only the updated `4, 4.5` forms. `docs/skill-graph.md:74`'s `Shapes 1-5, 7, 8` is a range that already includes 4.5, so leave it; note it in the task report. `step-1-records.md:158`'s "exactly like Shapes 4 and 5" is about the no-mutation Yours rows and stays true. `wc -c` is ≤ 46,080 (expected ≈ 34,700).

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/tidy/step-1-records.md tests/tidy-needs-worklist-rule.test.js tests/tidy-release-note-shape.test.js
git commit -m "Add tidy Shape 4.5 — Release-Note-only ready records detected via compose-record --check, candidates written uncapped (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 6: The Fill Release Note action — sub-file, SKILL.md, collection routing

**Files:**
- Create: `plugin/skills/tidy/release-note-repair.md`
- Modify: `plugin/skills/tidy/SKILL.md`: line 72 (dispatcher note after it), line 83 (Step table prefixes), line 104 (label-writes paragraph), line 106 (Backend probe), after line 117 (Action Vocabulary row), after line 183 (Step 7.5 checklist line)
- Modify: `plugin/skills/tidy/collection-routing.md` (first table row)
- Modify: `docs/plugin-structure.md:92` (tidy sub-file row)
- Test: `tests/tidy-release-note-repair-conformance.test.js` (new)

**Interfaces:**
- Consumes: Task 3's CLI exits (0/2/3/4/5/6/7), its JSON stdout, and its snapshot path; Task 5's candidates file; Task 4's lint exemption for the sub-line.
- Produces: the `Fill Release Note` action name, which Task 7's routing row must spell identically; the `filled-note` Applied verb; the `{release-note-candidates-file}` dispatcher resolution.

- [ ] **Step 1: Baseline the pinned suites**

Run: `node --test tests/tidy-subfile-table-completeness.test.js tests/sweep-backstop.test.js tests/sweep-orchestrator.test.js tests/materiality-floor-conformance.test.js tests/bin-lib/skill-audit/*.test.js`
Expected: PASS

- [ ] **Step 2: Write the failing conformance test**

```js
// tests/tidy-release-note-repair-conformance.test.js
'use strict';
// #2828: the Fill Release Note action's registration sites and its main-thread procedure.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');
const SKILL = read('plugin/skills/tidy/SKILL.md');
const SUB = read('plugin/skills/tidy/release-note-repair.md');
const ROUTING = read('plugin/skills/tidy/collection-routing.md');
const STRUCTURE = read('docs/plugin-structure.md');

test('release-note-repair.md cites its contracts instead of restating them', () => {
  for (const cite of ['_shared/reverify-before-write.md', '_shared/auto-decision-log.md', 'specify/spec-template.md',
    '_shared/github-write-transport.md', '_shared/record-queue-fetch.md', '_shared/session-tmp-root.md', '_shared/pipeline-run-dir.md']) {
    assert.ok(SUB.includes(cite), `missing citation: ${cite}`);
  }
});

test('release-note-repair.md drives the CLI and branches on every exit', () => {
  const f = flat(SUB);
  assert.ok(f.includes('release-note-repair.js" repair --driver github-issues'));
  assert.ok(f.includes('release-note-repair.js" repair --driver local-files'));
  assert.ok(f.includes('release-note-repair.js" verify'));
  for (const exit of ['0:', '4:', '5:', '6:', '3:', '2:', 'Exit 7']) assert.ok(f.includes(exit), `missing exit branch ${exit}`);
  assert.ok(f.includes('never a weaker line'));
  assert.ok(f.includes('`/claude-tweaks:specify {ref}`'));
});

test('the undo snapshot is under snapshots/, never staged/', () => {
  assert.ok(SUB.includes('{run-dir}/snapshots/tidy-release-note-{id}.original.md'));
  assert.ok(!/staged\/tidy-release-note-[^\s`]*\.original/.test(SUB));
  assert.ok(!/staged\/tidy-release-note-[^\s`]*\.original/.test(read('plugin/bin/release-note-repair.js')));
});

test('SKILL.md registers the tag, the action, the backend probe count, and the Step 7.5 line', () => {
  const f = flat(SKILL);
  assert.ok(f.includes('`[release-note]` (Shape 4.5'));
  assert.match(SKILL, /^\| \*\*Fill Release Note\*\* \| .*release-note-repair\.md.* \| No — one body section added, labels unchanged \|$/m);
  assert.ok(f.includes('Six actions read `work-backend` first'));
  assert.ok(!f.includes('Five actions read'));
  assert.ok(f.includes('`Fill Release Note` writes one body section and never a label.'));
  assert.ok(f.includes('- [x] Filled Release Note: "{title}"'));
});

test('SKILL.md dispatcher block resolves a fresh session-scoped candidates path per run', () => {
  const start = SKILL.indexOf('**Before dispatching the Work Records agent,**');
  assert.notEqual(start, -1, 'dispatcher note missing');
  const m = /```bash\n([\s\S]*?)\n```/.exec(SKILL.slice(start));
  assert.ok(m, 'extraction pattern is out of sync with the doc');
  const script = m[1].split('${CLAUDE_PLUGIN_ROOT}').join(path.join(ROOT, 'plugin'));
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: `rn-dispatch-${process.pid}` };
  const a = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }).trim();
  const b = execFileSync('bash', ['-c', script], { env, encoding: 'utf8' }).trim();
  assert.match(a, /ct-session-rn-dispatch-\d+\/tidy-release-note-\d+\.json$/);
  assert.notEqual(a, b, 'each run must get a fresh name');
  fs.rmSync(path.dirname(a), { recursive: true, force: true });
});

test('collection-routing.md routes [release-note] with the Approve/Applied tags and names its Yours outcomes', () => {
  const row = ROUTING.split('\n').find((l) => l.startsWith('| `[backlog]`'));
  assert.ok(row.includes('`[release-note]`'));
  assert.ok(row.includes('`[release-note]` scan errors and repair failures land in **Yours ({N})**'));
});

test('docs/plugin-structure.md lists the sub-file, the module, and the CLI', () => {
  assert.match(STRUCTURE, /^\| tidy \| [^|]*release-note-repair\.md/m);
  assert.ok(STRUCTURE.includes('plugin/bin/lib/release-note-repair/ → detect.js'));
  assert.ok(STRUCTURE.includes('node plugin/bin/release-note-repair.js scan|repair|verify'));
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `node --test tests/tidy-release-note-repair-conformance.test.js`
Expected: FAIL — `ENOENT … release-note-repair.md`

- [ ] **Step 4: Create `plugin/skills/tidy/release-note-repair.md`**

````markdown
# Tidy — Fill Release Note (Shape 4.5's action)

Execution procedure for `SKILL.md`'s **Fill Release Note** action: a `ready` record whose only
spec-shape gap is its `## Release Note` (`step-1-records.md`'s Shape 4.5) gets one composed line
inserted in place, labels untouched — the line is scope-neutral, so every grant stands (#2786).
Main thread only (Step 6 staging, Step 7 execution), never a scan agent's prompt. Both drivers run
the same steps; only the live read and the write differ. Every mechanical step is
`release-note-repair.js`'s; the only judgment here is the line itself.

## Worklist

The candidates file Shape 4.5's scan wrote — the absolute path substituted for
`{release-note-candidates-file}` at dispatch — is the list in every mode: the report's
`[release-note]` rows and Step 7's loop both come from its `candidates` array, never from the Work
Records agent's summary row. Each entry carries `ref`, `id`, `title`, `verdict`, `sha` (the
scan-time body's sha256) and `deliverables`. A missing or unparseable file, or a Work Records agent
that did not return `DONE`, means the scan did not complete: repair nothing and list one
`[release-note] scan did not complete` row under **Yours ({N})**'s `review` group. A `verdict:
scan-error` entry is never repaired — it is a `review`-group row whose trailing column names the
`--check` exit.

## Compose the line

One verb-first sentence summarizing the entry's `deliverables` as a release-notes reader would
notice it, per `specify/spec-template.md`'s Release Note guidance (its "no user-visible change"
phrasing included). Write it to the session-tmp file `tidy-release-note-{id}.txt`
(`_shared/session-tmp-root.md`). `release-note-repair.js` checks every bound mechanically — single
line, no `#\d+`, no path-shaped token, no backtick, no conventional-commit prefix. On its exit 4,
recompose once from the violations on stderr; a second exit 4 is a repair failure, never a weaker
line.

## Stage tier (`conservative`, or `--dry-run`)

Compose the line, then stage one item per record with `stage-item.js` (`step-6-auto.md`'s Staging
section), `--id tidy-release-note-{id}`. The `.md` holds the record ref, `Proposed line: {line}`
and `Premise sha256: {sha}`. The sidecar is `[{"tag": "[release-note]", "record": {n, or null on
local-files}, "title": …, "action": "Fill Release Note (insert one ## Release Note section; labels
unchanged)", "command": "insert one ## Release Note section into {ref} — release-note-repair.md"}]`;
`action` is exactly the `Proposed:` text `decision-markers.md` writes and Shape 4.5's comment check
matches. An approved item runs the Auto path with that line and sha.

## Auto path (one record at a time)

1. **Re-read live, then repair** — immediately before the write, never from the scan's snapshot
   (`_shared/reverify-before-write.md`):
   - `github-issues`: `gh issue view {n} --json body,labels,state > {live-json}` (gh absent: the
     `issue_read` row of `_shared/github-write-transport.md`, saved as the same three fields), then
     `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver github-issues --ref {n} --live-json {live-json} --expect-sha {sha} --line-file {line-file} --out {repaired-body} {dest}`.
   - `local-files`: `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" repair --driver local-files --ref {id} --record-file {path} --expect-sha {sha} --line-file {line-file} {dest}`,
     `{path}` resolved in Step 7's working tree (the scratch worktree under `worktree-always`);
     this one call writes the record file and re-verifies it.
   - `{dest}` is `--run "{run-dir}"` whenever a run directory resolved (`step-6-auto.md`,
     `_shared/pipeline-run-dir.md`): the pre-write snapshot lands at
     `{run-dir}/snapshots/tidy-release-note-{id}.original.md` — never `staged/`, which the
     SessionStart banner, `--approve`, and `backlog attention` all read as awaiting approval. With
     no run directory (interactive mode), `{dest}` is `--snapshot-file` with the session-tmp path
     `tidy-release-note-{id}.original.md`. The CLI refuses a repair with neither.
2. **Branch on the exit.**
   - 0: continue.
   - 4: recompose (above).
   - 5: stale premise (body edited, record closed, `ready` gone) — skip, nothing written.
   - 6: repair failure — nothing written, the record stays `ready` and still fails the gate, no
     label touched; list it under **Yours** as `/claude-tweaks:specify {ref}` (re-shaping is
     `/specify`'s job).
   - 3: re-resolve `$RUN_ROOT` and retry; never write without the snapshot.
   - 2: fix the call.

   With a run directory, log each 5 and 6: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status SKIP --step "Step 7 Fill Release Note (skipped)" --text "{ref}: {stderr reason} → not written"`.
3. **Write and verify** (`github-issues`; the local call already did both):
   `gh issue edit {n} --body-file {repaired-body}` (gh absent: `issue_write` update mode, same
   body), then `gh issue view {n} --json body,labels,state > {after-json}` and
   `node "${CLAUDE_PLUGIN_ROOT}/bin/release-note-repair.js" verify --ref {n} --before-json {live-json} --after-json {after-json} --line-file {line-file} [--run "{run-dir}"]`.
   Exit 0: the live body passes `compose-record.js --check`, its Release Note is the composed
   line, and its label set equals the pre-write read. Exit 7: report a failure naming the snapshot
   — `gh issue edit {n} --body-file {snapshot}` restores the original.
4. After the batch, invalidate the session record snapshot once (`_shared/record-queue-fetch.md`'s
   Session-scoped record snapshot).

## Audit and report

With a run directory, each verified repair's `AUTO` entry (`_shared/auto-decision-log.md`) is
appended by the CLI itself, naming the line and the snapshot path. In auto mode each repaired
record is an **Applied automatically** row — verb `filled-note`, trailing column `snapshot saved`
(`commit {hash}` on `local-files`), then one three-space-indented sub-line carrying its composed
line, truncated to 97 characters plus `…`. In every mode, Step 7.5's checklist carries a `Filled
Release Note` line per repaired record, and with no run directory it is followed by a ```text
fence headed `Original body {ref}` holding the snapshot file's contents — the undo copy.
````

- [ ] **Step 5: Edit `plugin/skills/tidy/SKILL.md`**

(a) After the line-72 paragraph that begins `**Step 1 is a separate file.**`, insert one blank line and then:

````markdown
**Before dispatching the Work Records agent,** resolve Shape 4.5's candidates path — a fresh name
per run, so a later tidy run in the same session never reads an earlier run's list — and
substitute the printed absolute path for `{release-note-candidates-file}` in the inlined prompt;
Step 6 and Step 7 read the same file (`release-note-repair.md`):

```bash
node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const name = 'tidy-release-note-' + Date.now() + '.json';
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, name) || require('path').join(require('os').tmpdir(), name));
"
```
````

(b) Line 83 (Step table, Step 1 row, Output prefix cell): replace `` `[scoring]` / `[blocked]` `` with `` `[scoring]` / `[release-note]` (Shape 4.5 — Release-Note-only repair, both drivers) / `[blocked]` ``.

(c) Line 104: after `See \`_shared/work-record.md\`'s permission matrix.`, append ` \`Fill Release Note\` writes one body section and never a label.`

(d) Line 106: replace

```text
**Backend probe.** Five actions read `work-backend` first (`_shared/work-record.md`'s Config keys table): four vary by driver (`Delete`, `Defer`, `Absorb`, `Open parent gate` — both `actions-*.md` files carry a matching section), one is `github-issues`-only with no `local-files` counterpart (`Sync to GitHub`).
```

with

```text
**Backend probe.** Six actions read `work-backend` first (`_shared/work-record.md`'s Config keys table): four vary by driver (`Delete`, `Defer`, `Absorb`, `Open parent gate` — both `actions-*.md` files carry a matching section), one is `github-issues`-only with no `local-files` counterpart (`Sync to GitHub`), and `Fill Release Note` branches on the driver inside its own `release-note-repair.md`.
```

(e) After line 117 (the `| **Open parent gate** |` row), insert this row:

```text
| **Fill Release Note** | A `ready` record's only spec-shape gap is its `## Release Note` (`step-1-records.md`'s Shape 4.5) — insert one composed line in place | Both backends: `release-note-repair.md` in this skill's directory — only its live read and write differ by `work-backend`; `release-note-repair.js` checks the line's bounds, snapshots the original first, and verifies the write | No — one body section added, labels unchanged |
```

(f) After line 183 (the `local-files` `Opened parent gate` checklist line), insert:

```text
- [x] Filled Release Note: "{title}" — {ref}'s live body passes `compose-record.js --check`, carries the composed line, and keeps its label set (`release-note-repair.js verify` exit 0 on `github-issues`, `repair` exit 0 on `local-files`); snapshot at {snapshot path}
```

(g) Line 201: replace `outward-facing GitHub writes still stage,` with `outward-facing GitHub writes still stage (bar the additive Release Note repair, \`step-6-auto.md\`'s Fill Release Note row),`.

- [ ] **Step 6: Edit `collection-routing.md` and `docs/plugin-structure.md`**

`plugin/skills/tidy/collection-routing.md`, first data row:
- Replace `` `[parent-gate]`, `[claim]` | `` with `` `[parent-gate]`, `[claim]`, `[release-note]` | ``.
- Replace the row's closing `never the tag alone. |` with `never the tag alone. \`[release-note]\` scan errors and repair failures land in **Yours ({N})** (\`release-note-repair.md\`). |`.

`docs/plugin-structure.md:92`: replace `| tidy | scan-procedures.md, step-1-records.md, ` with `| tidy | scan-procedures.md, step-1-records.md, release-note-repair.md, `.

- [ ] **Step 7: Run the tests**

Run: `node --test tests/tidy-release-note-repair-conformance.test.js tests/tidy-subfile-table-completeness.test.js tests/sweep-backstop.test.js tests/sweep-orchestrator.test.js tests/materiality-floor-conformance.test.js tests/node-e-snippet-syntax.test.js tests/bin-lib/skill-audit/*.test.js`
Expected: PASS

- [ ] **Step 8: Renumbering sweep for the Backend probe (three forms) and bytes**

```bash
grep -rn "Five actions\|Six actions" plugin/ docs/ tests/
grep -rn "four vary\|five vary" plugin/ docs/ tests/
grep -rn "five actions\|six actions" plugin/ docs/ tests/
wc -c plugin/skills/tidy/SKILL.md plugin/skills/tidy/collection-routing.md plugin/skills/tidy/release-note-repair.md
```

Expected: only `SKILL.md`'s `Six actions` line, and `four vary` unchanged there. `actions-github-issues.md`'s header ("four whose execution diverges") describes that file's own sections and stays true. `SKILL.md` must be ≤ 46,080 (expected ≈ 36,000).

- [ ] **Step 9: Commit**

```bash
git add plugin/skills/tidy/release-note-repair.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/collection-routing.md docs/plugin-structure.md tests/tidy-release-note-repair-conformance.test.js
git commit -m "Add the tidy Fill Release Note action — main-thread procedure, SKILL.md and collection-routing registration (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 7: Tier row, contract carve-out, and the docs that restate them

**Files:**
- Modify: `plugin/skills/tidy/step-6-auto.md`: line 8 (preamble), after line 32 (new row), line 163 (Column shape)
- Modify: `plugin/skills/_shared/auto-mode-contract.md:150`
- Modify: `plugin/skills/sweep/SKILL.md:49`
- Modify: `docs/journeys/tidy-standalone-auto-report.md` (`files:`, lines 28, 37, Origin)
- Modify: `docs/skill-graph.md:68` (the `/backlog` section's `/tidy` row)
- Test: `tests/tidy-release-note-repair-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 6's action name `Fill Release Note` and the `snapshots/` path.
- Produces: the Stage / Auto-apply / Auto-apply routing that `SKILL.md:147` says is applied "as written".

- [ ] **Step 1: Baseline**

Run: `node --test tests/tidy-report-rules.test.js tests/tidy-residue-markers.test.js tests/deferred-live-verification-ac-class.test.js tests/reverify-before-write-conformance.test.js tests/sweep-orchestrator.test.js`
Expected: PASS

- [ ] **Step 2: Append the failing assertions**

```js
// appended to tests/tidy-release-note-repair-conformance.test.js
const STEP6 = read('plugin/skills/tidy/step-6-auto.md');
const CONTRACT = read('plugin/skills/_shared/auto-mode-contract.md');

test('step-6-auto.md: Fill Release Note is Stage / Auto-apply / Auto-apply with its stated exemption', () => {
  const row = STEP6.split('\n').find((l) => l.startsWith('| **Fill Release Note** ('));
  assert.ok(row, 'routing row missing');
  assert.match(row, /\| Stage \| Auto-apply \| Auto-apply — /);
  assert.ok(row.includes('exemption from the reversibility floor'));
  assert.ok(row.includes('`{run-dir}/snapshots/`'));
  assert.ok(row.includes('Open parent gate row above'));
  const parentGate = STEP6.indexOf('| **Open parent gate** (');
  assert.ok(parentGate !== -1 && STEP6.indexOf(row) > parentGate, 'row must follow the Open parent gate row');
});

test('step-6-auto.md: the preamble names the carve-out and Column shape allows the sub-line', () => {
  assert.ok(flat(STEP6).includes('bar that contract\'s one named carve-out, the **Fill Release Note** row below'));
  assert.ok(flat(STEP6).includes('An Applied row may carry one three-space-indented detail sub-line'));
});

test('auto-mode-contract.md names the carve-out inside the Never-reversible section', () => {
  const start = CONTRACT.indexOf('### Never-reversible (auto-FORBIDDEN, regardless of mode)');
  const section = CONTRACT.slice(start, CONTRACT.indexOf('## What `auto` silences', start));
  assert.match(section, /Network calls beyond reads \(no API writes, no message sends\) — except `\/claude-tweaks:tidy`'s Release Note repair/);
  assert.ok(section.includes('**Fill Release Note**'));
});

test('sweep, the tidy journey, and the skill graph restate the new tier truthfully', () => {
  assert.ok(read('plugin/skills/sweep/SKILL.md').includes('Arm-ready-PR, and Fill-Release-Note'));
  const journey = read('docs/journeys/tidy-standalone-auto-report.md');
  assert.ok(journey.includes('the additive Release Note repair (`[release-note]`, snapshot first) auto-apply'));
  assert.ok(journey.includes('  - plugin/skills/tidy/release-note-repair.md'));
  assert.ok(journey.includes('Updated during build of #2828'));
  const graphRow = read('docs/skill-graph.md').split('\n').find((l) => l.startsWith('| `/tidy` | Folds `unsynced: true`'));
  assert.ok(graphRow.includes('Shape 4.5'));
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `node --test tests/tidy-release-note-repair-conformance.test.js`
Expected: FAIL — `routing row missing`

- [ ] **Step 4: Edit `step-6-auto.md`**

(a) Line 8: replace `forbidden at every tier (\`_shared/auto-mode-contract.md\`); their disposition` with `forbidden at every tier (\`_shared/auto-mode-contract.md\`) bar that contract's one named carve-out, the **Fill Release Note** row below; their disposition`.

(b) Insert immediately after line 32 (the `| **Open parent gate** (` row):

```text
| **Fill Release Note** (Shape 4.5 — a `ready` record whose only spec-shape gap is its `## Release Note`; inserts one composed line, labels untouched — `release-note-repair.md`) | Stage | Auto-apply | Auto-apply — this row's stated exemption from the reversibility floor that stages every other outward GitHub body write (the Open parent gate row above): the write is additive (exactly one section inserted, proven by `release-note-repair.js`'s post-write diff and label-set check) and undoable (the pre-write body is snapshotted to `{run-dir}/snapshots/` first). Staging would leave the record failing `/flow`'s gate for `/claude-tweaks:backlog refine`'s flag-back to un-ready before anyone approved. A scan-error or repair-failure row is Auto (no-op, always surfaced) |
```

(c) Line 163 (Column shape): after `so the only trailing column is the reversibility token.`, insert ` An Applied row may carry one three-space-indented detail sub-line (a skip reason, a filled Release Note) with no trailing column.`

- [ ] **Step 5: Edit the shared contract**

`plugin/skills/_shared/auto-mode-contract.md:150`: replace the whole line

```text
- Network calls beyond reads (no API writes, no message sends)
```

with

```text
- Network calls beyond reads (no API writes, no message sends) — except `/claude-tweaks:tidy`'s Release Note repair (`tidy/step-6-auto.md`'s **Fill Release Note** row): one additive `## Release Note` section on a `ready` record, the pre-write body snapshotted first and the post-write diff and label set verified (#2828)
```

- [ ] **Step 6: Edit sweep, journey, skill graph**

`plugin/skills/sweep/SKILL.md:49`: replace `plus Mark-as-specified and Arm-ready-PR,` with `plus Mark-as-specified, Arm-ready-PR, and Fill-Release-Note (the Release-Note-only repair),`.

`docs/journeys/tidy-standalone-auto-report.md`:
- In `files:`, after `  - plugin/skills/tidy/scan-procedures.md`, add `  - plugin/skills/tidy/release-note-repair.md` and `  - plugin/bin/release-note-repair.js`.
- Line 28: replace `reversible git-tracked cleanups auto-apply, outward-facing GitHub writes stage, no-op findings` with `reversible git-tracked cleanups and the additive Release Note repair (\`[release-note]\`, snapshot first) auto-apply, every other outward-facing GitHub write stages, no-op findings`.
- Line 37: replace `forbidden at every tier by the auto-mode contract.` with `forbidden at every tier by the auto-mode contract bar its one named carve-out (the Fill Release Note row).`
- Under `## Origin`, after the #2252 line, add: `- Updated during build of #2828 (tidy Release-Note repair): Steps 2 and 4 name the Fill Release Note carve-out; \`plugin/skills/tidy/release-note-repair.md\` and \`plugin/bin/release-note-repair.js\` added to \`files:\``

`docs/skill-graph.md:68` (the row beginning `| \`/tidy\` | Folds \`unsynced: true\``): replace its closing `independently of the ranked needs-you table above it. |` with `independently of the ranked needs-you table above it. \`/tidy\`'s Shape 4.5 repairs a \`ready\` record whose only spec-shape gap is its Release Note, in place with its grants kept, so \`refine\` Step 3.5's body-shape flag-back (\`refine-mode.md\`) does not un-ready it; \`/sweep\` runs \`/tidy\` first. |`

- [ ] **Step 7: Run the tests and measure**

Run: `node --test tests/tidy-release-note-repair-conformance.test.js tests/tidy-report-rules.test.js tests/tidy-residue-markers.test.js tests/deferred-live-verification-ac-class.test.js tests/reverify-before-write-conformance.test.js tests/sweep-orchestrator.test.js tests/sweep-backstop.test.js`
Expected: PASS

Run: `wc -c plugin/skills/tidy/step-6-auto.md plugin/skills/_shared/auto-mode-contract.md plugin/skills/sweep/SKILL.md`
Expected: `step-6-auto.md` ≤ 46,080 (planned ≈ 45,065). If it is over, shorten only the row's aggressive-cell rationale. Never drop "additive", "snapshotted … first", or "Open parent gate row above", which the test pins.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/tidy/step-6-auto.md plugin/skills/_shared/auto-mode-contract.md plugin/skills/sweep/SKILL.md docs/journeys/tidy-standalone-auto-report.md docs/skill-graph.md tests/tidy-release-note-repair-conformance.test.js
git commit -m "Route Fill Release Note Stage/Auto/Auto — named auto-mode contract carve-out, stated exemption in the tidy tier table (refs #2828)" -m "Claude-Session: https://claude.ai/code/session_01DMuab2XkEUVKUYMn3Yigpm"
```

---

### Task 8: Real-input probe and full suite (no commit)

**Files:** none modified. Probe output goes to the session scratchpad, never the repo.

- [ ] **Step 1: Build a faceted file from the live queue (read-only)**

```bash
P="$(mktemp -d)"
gh issue list --state open --json number,title,labels,body,state,comments --limit 1000 > "$P/open.json"
node -e "
  const { parseRecordFacets } = require('./plugin/bin/lib/issues/record.js');
  const issues = require(process.argv[1]);
  console.log(JSON.stringify(issues.map((i) => ({ ...i, facets: parseRecordFacets(i.labels) }))));
" "$P/open.json" > "$P/faceted.json"
printf '%s\n' "$P"
```

- [ ] **Step 2: Run `scan` and an independent count over the same file**

```bash
P=<the path printed above>
node plugin/bin/release-note-repair.js scan --driver github-issues --records "$P/faceted.json" --out "$P/cands.json"; echo "exit=$?"
node -e "
  const c = require(process.argv[1]).candidates;
  console.log('scan release-note-only:', c.filter((x) => x.verdict === 'release-note-only').length, 'scan-error:', c.filter((x) => x.verdict === 'scan-error').length);
" "$P/cands.json"
node -e "
  const fs = require('fs'); const { run } = require('./plugin/bin/compose-record.js');
  const recs = require(process.argv[1]).filter((r) => r.labels.some((l) => l.name === 'ready') && !r.labels.some((l) => /^needs:/.test(l.name)));
  let n = 0;
  for (const r of recs) { fs.writeFileSync(process.argv[2], r.body); let e = ''; const code = run(['--check', process.argv[2]], { stdout() {}, stderr(s) { e += s; } });
    const gaps = e.split('\n').filter((l) => l.startsWith('  - ')); if (code === 4 && gaps.length === 1 && /Release Note$/.test(gaps[0])) n++; }
  console.log('independent release-note-only:', n, 'of', recs.length, 'ready');
" "$P/faceted.json" "$P/b.md"
```

Expected: `exit=0`, and the two release-note-only counts are **identical**. At plan time both were 110 of 130 `ready`, with 0 scan errors. If they differ, stop: the worklist exclusions (the `Proposed:` comment check) are the only intended difference, and any difference must be explained record by record before continuing. Record the exact numbers in the task report.

- [ ] **Step 3: Dry-run `repair` on two real bodies (no GitHub write)**

For `#2823` (AC is the last section) and `#2802` (`## Technical Approach` follows AC; at plan time #2800-#2802 all qualified — substitute any `cands.json` entry of that shape if #2802 has since been repaired). Run the block once per record, setting `N` accordingly:

```bash
N=2823
gh issue view "$N" --json body,labels,state > "$P/live-$N.json"
SHA=$(node -e "console.log(require(process.argv[1]).candidates.find((c) => c.id === Number(process.argv[2])).sha)" "$P/cands.json" "$N")
printf '%s\n' 'Restored the categorization labels lost to a dispatch failure.' > "$P/line.txt"
node plugin/bin/release-note-repair.js repair --driver github-issues --ref "$N" --live-json "$P/live-$N.json" --expect-sha "$SHA" --line-file "$P/line.txt" --out "$P/out-$N.md" --snapshot-file "$P/snap-$N.md"; echo "exit=$?"
node -e "process.stdout.write(require(process.argv[1]).body)" "$P/live-$N.json" > "$P/orig-$N.md"
diff "$P/orig-$N.md" "$P/out-$N.md"
node plugin/bin/compose-record.js --check "$P/out-$N.md"; echo "check=$?"
```

Expected: `exit=0`; `diff` shows only added lines (the blank line, `## Release Note`, the blank line, and the sentence); `check=0`. Do **not** run `gh issue edit`. If the record's body changed since Step 1, expect `exit=5` and rerun from Step 1.

- [ ] **Step 4: Sole-writer grep**

Run: `grep -rn "snapshots/tidy-release-note" plugin/`
Expected: hits only in `plugin/bin/release-note-repair.js` and `plugin/skills/tidy/release-note-repair.md`.

- [ ] **Step 5: Full suite**

```bash
npm test > "$P/npm-test.log" 2>&1; echo "exit=$?" >> "$P/npm-test.log"
tail -40 "$P/npm-test.log"
```

Expected: `exit=0`. Quote the `# pass` / `# fail` lines verbatim in the report. Re-run any failing file in isolation (`node --test <file>`) before treating a load-dependent count as real (CLAUDE.md § Commands).

- [ ] **Step 6: Report**

Report the probe numbers (scan count, independent count, total ready), the two dry-run diffs' added-line counts, the grep output, and the verbatim `npm test` summary. Nothing is committed in this task.
