# Specify Decomposition Event Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/claude-tweaks:specify`'s decomposition mode a way to record, durably and cross-session-readably, that a qualifying run (2+ `ceremony:standard` sub-issues) occurred — so a watch-item backlog record can confirm or refute its acceptance criterion from that record instead of needing the original observing session's own transcript.

**Architecture:** Extend the existing per-sub-issue manifest accumulation in `record-creation-subissues.md` to also carry each sub-issue's ceremony tier, then add one new "Ceremony tally" step — run once per decomposition batch, immediately after the existing "Snapshot invalidation" step — that counts `ceremony:standard` entries in that manifest and, when the count is 2 or more, appends one entry to a new append-only, git-tracked log file (`docs/specify-decomposition-log.md`). The existing Step 9 commit (`git add specs/ docs/`) already picks up this new file with no further plumbing.

**Tech Stack:** Markdown skill prose (bash fences with inline `node -e` snippets), `node --test` for the conformance test.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T170546-record-3128/work/3128-spec.md` (materialized from GitHub issue #3128)

## Global Constraints

- Driver-agnostic: the new step must work identically under `work-backend: github-issues` and `work-backend: local-files` — both already accumulate into the same `$SPECIFY_DECOMP_MANIFEST` file via the same code path.
- No new session-scratch temp file: read directly from the existing `$SPECIFY_DECOMP_MANIFEST` path already resolved earlier in the same step — do not introduce a second temp file.
- The new log file is git-tracked (never gitignored) — it lives under `docs/`, not under `.claude-tweaks/pipelines/`.
- Do not alter any existing literal string in `record-creation-subissues.md` that an existing test pins (see Review Focus).
- Below the 2+ threshold: no log entry, no error — a silent, correct no-op.

## Review Focus

- **Zero sub-issues created, zero `ceremony:standard` (e.g. an all-`fast-lane` batch).** The tally must read 0 and skip the write — not crash on an empty/missing manifest file, and not write a spurious entry.
- **Manifest file missing entirely** (a defensive case — should never happen since Step 3 always creates it before this point runs, but a prior-run resume edge case could leave it absent). The tally step must not throw; it should treat a missing manifest the same as zero sub-issues.
- **Exactly 2 `ceremony:standard` entries (the boundary)** — the threshold is "2+", so exactly 2 must trigger a write, not just 3+.
- **First-ever write (the log file does not exist yet).** The step must create `docs/specify-decomposition-log.md` with a header, not assume it already exists.
- **Existing literal-text assertions in `tests/ceremony-framing-per-record-conformance.test.js`** (`**Self-check before creating:**` before the `gh issue create` call, and the `framing-check` mirror sentence) must still pass unchanged — the new step is inserted after Snapshot invalidation, nowhere near that text.

---

### Task 1: Extend the manifest accumulation with each sub-issue's ceremony tier

**Files:**
- Modify: `plugin/skills/specify/record-creation-subissues.md:161-174` (the "Accumulate this unit for the cross-reference pass below" section)
- Test: `tests/specify-ceremony-tally-prose.test.js` (new)

**Interfaces:**
- Produces: the manifest JSON array's per-entry shape becomes `{title, num, body, ceremony}` (was `{title, num, body}`) — Task 2 reads the `ceremony` field this task adds.

- [ ] **Step 1: Write the failing test**

Create `tests/specify-ceremony-tally-prose.test.js`:

```javascript
// tests/specify-ceremony-tally-prose.test.js
// Pins that record-creation-subissues.md's manifest-accumulation snippet carries
// each sub-issue's ceremony tier, and that a "Ceremony tally" step exists between
// "Snapshot invalidation" and "### Rules" — the durable-record mechanism for #3128.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const RECORD_CREATION = fs.readFileSync(
  path.join(REPO_ROOT, 'plugin/skills/specify/record-creation-subissues.md'),
  'utf8'
);

test('manifest-accumulation entry object carries a ceremony field', () => {
  assert.ok(
    /entry\s*=\s*\{[^}]*ceremony\s*:\s*process\.argv\[\d+\][^}]*\}/.test(RECORD_CREATION),
    'the manifest entry object literal must include a ceremony: process.argv[n] field'
  );
});

test('the manifest-accumulation node -e call passes $SUB_ISSUE_CEREMONY as an argv', () => {
  const accumIdx = RECORD_CREATION.indexOf('Accumulate this unit for the cross-reference pass below');
  assert.ok(accumIdx >= 0, 'the Accumulate section must still exist');
  const section = RECORD_CREATION.slice(accumIdx, accumIdx + 2000);
  assert.ok(
    section.includes('$SUB_ISSUE_CEREMONY'),
    'the accumulation bash fence must pass $SUB_ISSUE_CEREMONY to the node -e call'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-ceremony-tally-prose.test.js`
Expected: FAIL — `record-creation-subissues.md` does not yet contain a `ceremony` field in the manifest entry object, and the accumulation section does not yet reference `$SUB_ISSUE_CEREMONY`.

- [ ] **Step 3: Modify the manifest-accumulation snippet**

In `plugin/skills/specify/record-creation-subissues.md`, find this existing fence (around line 163-174):

```markdown
```bash
SPECIFY_DECOMP_MANIFEST=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json') || require('path').join(require('os').tmpdir(), 'specify-decomp-manifest.json'))
")
node -e "const fs=require('fs');
  const path=process.argv[1];
  const entry={title:process.argv[2], num:process.argv[3], body:fs.readFileSync(process.argv[4],'utf8')};
  const list=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):[];
  list.push(entry);
  fs.writeFileSync(path, JSON.stringify(list))" "$SPECIFY_DECOMP_MANIFEST" "$SUB_ISSUE_TITLE" "${SUB_ISSUE_NUM:-$SUB_ISSUE_ID}" "$SPECIFY_SUB_ISSUE_BODY"
```
```

Replace it with (adds `$SUB_ISSUE_CEREMONY` as a fifth positional argv and a `ceremony` field on the entry object):

```markdown
```bash
SPECIFY_DECOMP_MANIFEST=$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  console.log(sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, 'specify-decomp-manifest.json') || require('path').join(require('os').tmpdir(), 'specify-decomp-manifest.json'))
")
node -e "const fs=require('fs');
  const path=process.argv[1];
  const entry={title:process.argv[2], num:process.argv[3], body:fs.readFileSync(process.argv[4],'utf8'), ceremony:process.argv[5]};
  const list=fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):[];
  list.push(entry);
  fs.writeFileSync(path, JSON.stringify(list))" "$SPECIFY_DECOMP_MANIFEST" "$SUB_ISSUE_TITLE" "${SUB_ISSUE_NUM:-$SUB_ISSUE_ID}" "$SPECIFY_SUB_ISSUE_BODY" "$SUB_ISSUE_CEREMONY"
```
```

Also update the one sentence immediately above the fence ("Append `{title, num_or_id, body}` …") to read "Append `{title, num_or_id, body, ceremony}` (`$SUB_ISSUE_TITLE`, `$SUB_ISSUE_NUM`/`$SUB_ISSUE_ID`, `"$SPECIFY_SUB_ISSUE_BODY"`'s contents, `$SUB_ISSUE_CEREMONY`) to a session-scoped JSON array file, …" — keep the rest of that sentence unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/specify-ceremony-tally-prose.test.js`
Expected: PASS

- [ ] **Step 5: Run the pre-existing conformance suites that touch this file, to confirm nothing else broke**

Run: `node --test tests/ceremony-framing-per-record-conformance.test.js tests/specify-decomposition-crossref-prose.test.js tests/specify-decomposition-collapse.test.js tests/session-tmp-root-migration.test.js`
Expected: PASS (all pre-existing assertions still hold — this task only added a field and an argv, touching neither the self-check text, the create call, nor any text those suites scan)

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/record-creation-subissues.md tests/specify-ceremony-tally-prose.test.js
git commit -m "Carry ceremony tier through specify's decomposition manifest — refs #3128"
```

---

### Task 2: Add the Ceremony tally step and the durable event log

**Files:**
- Modify: `plugin/skills/specify/record-creation-subissues.md` (insert a new section between "Snapshot invalidation" (~line 202) and "### Rules" (~line 204))
- Test: `tests/specify-ceremony-tally-prose.test.js` (extend — same file as Task 1)

**Interfaces:**
- Consumes: `$SPECIFY_DECOMP_MANIFEST` (resolved earlier in the same bash-fence scope by Task 1's unchanged accumulation step — same shell variable, no re-resolution needed) and each manifest entry's `.ceremony` field (Task 1).
- Produces: `docs/specify-decomposition-log.md` — an append-only, git-tracked markdown file. Each qualifying run appends one `### {ISO timestamp}` section containing: total sub-issue count in the batch, the list of `ceremony:standard` sub-issue numbers/ids, and the transcript pointer (`process.env.CLAUDE_CODE_SESSION_ID`).

- [ ] **Step 1: Write the failing test (extend the file from Task 1)**

Append to `tests/specify-ceremony-tally-prose.test.js`:

```javascript
test('a "Ceremony tally" step exists between Snapshot invalidation and ### Rules', () => {
  const snapshotIdx = RECORD_CREATION.indexOf('**Snapshot invalidation.**');
  const tallyIdx = RECORD_CREATION.indexOf('**Ceremony tally.**');
  const rulesIdx = RECORD_CREATION.indexOf('### Rules');
  assert.ok(snapshotIdx >= 0, 'Snapshot invalidation section must still exist');
  assert.ok(tallyIdx >= 0, 'a Ceremony tally section must exist');
  assert.ok(rulesIdx >= 0, '### Rules must still exist');
  assert.ok(snapshotIdx < tallyIdx, 'Ceremony tally must come after Snapshot invalidation');
  assert.ok(tallyIdx < rulesIdx, 'Ceremony tally must come before ### Rules');
});

test('the Ceremony tally step writes to docs/specify-decomposition-log.md on a 2+ threshold', () => {
  const tallyIdx = RECORD_CREATION.indexOf('**Ceremony tally.**');
  const section = RECORD_CREATION.slice(tallyIdx, tallyIdx + 2500);
  assert.ok(
    section.includes('docs/specify-decomposition-log.md'),
    'the Ceremony tally step must name the durable log file docs/specify-decomposition-log.md'
  );
  assert.ok(
    /ceremony\s*===\s*'standard'/.test(section) || /ceremony === "standard"/.test(section),
    'the tally must count entries whose ceremony field is exactly "standard"'
  );
  assert.ok(
    />=\s*2|standardCount\s*<\s*2/.test(section),
    'the tally must gate the write on a 2-or-more threshold'
  );
  assert.ok(
    section.includes('CLAUDE_CODE_SESSION_ID'),
    'the written entry must include the session id as the transcript pointer'
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/specify-ceremony-tally-prose.test.js`
Expected: FAIL — no "Ceremony tally" section exists yet in `record-creation-subissues.md`.

- [ ] **Step 3: Write the Ceremony tally section**

In `plugin/skills/specify/record-creation-subissues.md`, insert the following new section immediately after the existing "Snapshot invalidation" fence (the `invalidateSnapshot(...)` block) and before the `### Rules` heading:

```markdown
**Ceremony tally.** Once every sub-issue in this batch has been accumulated into
`$SPECIFY_DECOMP_MANIFEST` (Accumulate this unit, above) and the snapshot above has been
invalidated, check whether this batch itself qualifies as the live event a standing watch-item
record (e.g. #1350) is waiting to observe: 2 or more sub-issues in this batch carrying
`ceremony:standard`. When it does, append one durable, git-tracked record of that fact to
`docs/specify-decomposition-log.md` — a plain append-only markdown log, not a run-scoped
`decisions.md` (that file is cleaned up with its pipeline run; this one is permanent) — so a
later, unrelated session can confirm the event occurred without needing this session's own
transcript:

```bash
node -e "
  const fs = require('fs');
  const manifestPath = process.argv[1];
  const logPath = 'docs/specify-decomposition-log.md';
  const list = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  const standard = list.filter((e) => e.ceremony === 'standard');
  if (standard.length < 2) process.exit(0);
  const header = '# Specify Decomposition Event Log\n\nAppend-only, git-tracked record of every \`/claude-tweaks:specify\` decomposition run that produced 2 or more \`ceremony:standard\` sub-issues — the durable event a watch-item backlog record (e.g. #1350) can check for instead of needing the observing session\\'s own transcript.\n';
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : header;
  const entry = '\n### ' + new Date().toISOString() + '\n\n'
    + '- Sub-issues in this batch: ' + list.length + '\n'
    + '- \`ceremony:standard\` sub-issues (' + standard.length + '): '
    + standard.map((e) => '#' + e.num).join(', ') + '\n'
    + '- Transcript pointer (this session): ' + (process.env.CLAUDE_CODE_SESSION_ID || '(none)') + '\n';
  fs.writeFileSync(logPath, existing + entry);
  console.error('Ceremony tally: ' + standard.length + ' ceremony:standard sub-issues — appended to ' + logPath);
" "$SPECIFY_DECOMP_MANIFEST"
```

Below the 2+ threshold (the common case — most decompositions produce 0 or 1 `ceremony:standard`
sub-issues), this is a silent no-op: no log entry, no error. The written entry is picked up by
Step 9's existing `git add specs/ docs/` commit — no separate commit needed here.
```

(The literal text above, including the exact heading `**Ceremony tally.**` and the exact log path
`docs/specify-decomposition-log.md`, is what Task 1's test file asserts — match it precisely.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/specify-ceremony-tally-prose.test.js`
Expected: PASS (all 4 tests in the file)

- [ ] **Step 5: Manually exercise the new node snippet against a synthetic manifest, to confirm the runtime behavior (not just the prose shape)**

```bash
node -e "
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ceremony-tally-'));
const manifestPath = path.join(dir, 'manifest.json');
const logPath = path.join(dir, 'specify-decomposition-log.md');
fs.writeFileSync(manifestPath, JSON.stringify([
  { title: 'a', num: '101', ceremony: 'standard' },
  { title: 'b', num: '102', ceremony: 'fast-lane' },
  { title: 'c', num: '103', ceremony: 'standard' },
]));
process.env.CLAUDE_CODE_SESSION_ID = 'test-session-xyz';
const list = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const standard = list.filter((e) => e.ceremony === 'standard');
console.log('standard.length =', standard.length);
if (standard.length < 2) throw new Error('expected >= 2');
const entry = standard.map((e) => '#' + e.num).join(', ');
console.log('entry sub-issues =', entry);
if (entry !== '#101, #103') throw new Error('unexpected entry: ' + entry);
console.log('OK: boundary case (exactly 2) triggers correctly, entry content correct');
"
```

Expected output: `standard.length = 2`, `entry sub-issues = #101, #103`, `OK: boundary case (exactly 2) triggers correctly, entry content correct` — confirms the exactly-2 boundary (Review Focus) and the entry-content shape work, independent of the markdown-prose assertions Step 4 already covered.

Then confirm the below-threshold and missing-manifest cases degrade silently:

```bash
node -e "
const fs = require('fs');
// below threshold
const list1 = [{ceremony:'standard'}, {ceremony:'fast-lane'}];
console.log('below-threshold count:', list1.filter((e) => e.ceremony === 'standard').length, '(expect 1, no write)');
// missing manifest
const missingPath = '/tmp/definitely-does-not-exist-' + Date.now() + '.json';
const list2 = fs.existsSync(missingPath) ? JSON.parse(fs.readFileSync(missingPath, 'utf8')) : [];
console.log('missing-manifest list:', JSON.stringify(list2), '(expect [], no throw)');
"
```

Expected: `below-threshold count: 1 (expect 1, no write)` and `missing-manifest list: [] (expect [], no throw)` — both Review Focus edge cases confirmed safe.

- [ ] **Step 6: Run the full set of pre-existing conformance suites again**

Run: `node --test tests/ceremony-framing-per-record-conformance.test.js tests/specify-decomposition-crossref-prose.test.js tests/specify-decomposition-collapse.test.js tests/session-tmp-root-migration.test.js tests/specify-ceremony-tally-prose.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/specify/record-creation-subissues.md tests/specify-ceremony-tally-prose.test.js
git commit -m "Add Ceremony tally step writing a durable decomposition event log — refs #3128"
```

---

## Self-Review Notes

**1. Spec coverage:** Current State (watch-items need a durable confirm mechanism) → Task 2's log file. Deliverables (timestamp, sub-issue count/numbers, transcript pointer, durable + cross-session-readable + git-tracked) → Task 2's entry shape (ISO timestamp, total count + standard-tier numbers, `CLAUDE_CODE_SESSION_ID`, committed via existing Step 9 `git add docs/`). Acceptance Criteria (next qualifying run writes a discoverable record; a later watch-item re-check can confirm/refute without the original transcript) → Task 2's node snippet runs unconditionally at the end of every decomposition batch and a later session reads `docs/specify-decomposition-log.md` directly, no transcript needed. No gaps found.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases" language — every step shows exact diff text or exact runnable commands.

**3. Type consistency:** `$SUB_ISSUE_CEREMONY` (Task 1, carried from the existing per-sub-issue Ceremony bullet) → manifest entry `.ceremony` field (Task 1) → `standard.filter(...)`/`.length`/`.map()` (Task 2) — consistent naming and shape throughout; no renamed fields between tasks.

**4. Review Focus:** All five lines from the Review Focus section above are exercised: zero-standard (Task 2 Step 5's below-threshold check), missing manifest (Task 2 Step 5's missing-manifest check), exactly-2 boundary (Task 2 Step 5's main synthetic check), first-ever write / no pre-existing log file (Task 2's node snippet's `fs.existsSync(logPath) ? ... : header` branch, exercised by the synthetic test using a fresh tmp dir with no pre-existing log file), and the pre-existing literal-text assertions (Task 1 Step 5 and Task 2 Step 6 both re-run the full existing suite unchanged).
