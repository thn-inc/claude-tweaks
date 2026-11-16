# Own Origin Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A record's provenance (and its corrective follow-up target) comes only from the record's own `Origin:` line — never from a fenced line or a line under a `## Absorbed: …` section.

**Architecture:** One shared reader, `ownOriginLine(body)`, in `plugin/bin/lib/issues/record-payload.js` (beside the existing fence-aware extractors), re-exported through the `record.js` facade. `provenance.js` (`resolveProvenance`, `hasOriginLine`) and `trust.js` (`correctiveFollowUpTarget`) both read through it, so the class and the follow-up count can never come from different lines.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T065515-record-4502/work/4502-spec.md` (record #4502)

Scope keywords: ORIGIN_LINE, ORIGIN_LINE_RE, hasOriginLine, correctiveFollowUpTarget

## Global Constraints

- Decision (human-approved 2026-10-30): a line inside a fenced code block never counts; a line under a `## Absorbed: …` heading never counts; a line under `## Original request` still counts.
- An `## Absorbed:` section runs from its heading to the next line starting `## `.
- `ownOriginLine` splits lines exactly as `unfencedText` does (CRLF, lone CR, LF) and reuses `fencedLineMask` from `plugin/bin/lib/markdown-blocks.js` — no second fence scanner.
- A bare `Origin:` still resolves to `unstructured:empty-origin`; over-length and `TRAILING_SOURCE` handling unchanged.
- `record-payload.js` must not require `provenance.js` or `trust.js`.
- `record-fingerprint.js` is out of scope. Author trust (`authorTrust`) behaviour from #4577 is unchanged.
- Governing project skill `.claude/skills/record-body-line-addition/SKILL.md`, quoted: "Put the reader in a `plugin/bin/lib/issues/record-*.js` module, re-export it from `record.js`, and have every consumer call it." and "A consumer matching the line with its own regex | Its detection drifts from the reader's". Its "Preamble only" rule does **not** apply here: the spec's human decision keeps `## Original request` counting (170 records hold their only `Origin:` line there), so the reader scans the whole body minus fenced and Absorbed lines.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Decision rule for further gaps (author, 2026-11-16): take the reading that keeps a run on the previous plugin release working, puts the rule in code, stays inside Key Files — in that order — and state the choice in the PR body. Choices this plan makes under it: (a) `hasOriginLine` also reads through `ownOriginLine`, so `author-association.js` selects exactly the records the gate judges (rule in code); (b) the `record.js` re-export (governing skill) and the `markdown-blocks.js` callers-list comment are the only edits outside Key Files; (c) an unclosed fence hides every later line, as `unfencedText` already does (#4368).

## Spec coverage map

| AC | Where |
|---|---|
| AC1.1–AC7.1 | Task 1 and Task 2 test steps (ids in test names) |
| AC8.1, AC8.2 | Task 3 Step 2 (mutation proof) |
| AC9.1, AC9.2 | Task 3 Step 3 (real-data audit, `evidence/audit.txt`) |
| AC10.1 | Waived below (run by `verify.js`) |

## Review Focus

- A `## ` heading line that sits inside a fenced block within an Absorbed section must not end the section (fenced lines neither open nor close a section) — pinned in Task 1.
- An `## Absorbed:` heading that is itself inside a fence opens no section — pinned in Task 1.
- `### ` sub-headings inside an Absorbed section keep it open — pinned in Task 1.
- A bare own `Origin:` line before an absorbed `Origin: … from #7` must not let `trust.js` count the absorbed follow-up (class and follow-up from the same line) — pinned in Task 2.
- Lone-CR bodies resolve like LF — pinned in Task 1.

---

### Task 1: `ownOriginLine` reader

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/markdown-blocks.js` (header comment only: add `ownOriginLine (record-payload.js, #4502)` to the `fencedLineMask` callers list at `:45-47`)
- Modify: `plugin/bin/lib/issues/record-payload.js` (require `fencedLineMask` beside `unfencedText`; add `ownOriginLine`; export it; rewrite the "Still fence-blind" sentence at `:32-34`)
- Modify: `plugin/bin/lib/issues/record.js` (re-export `ownOriginLine` from `./record-payload` in both the destructure at `:30` and `module.exports` at `:52`)
- Test: `tests/bin-lib/issues/record.test.js` (new cases after the `fence-blind metadata (#4368)` block; import `ownOriginLine` through `record` like its siblings)

**Interfaces:**
- Produces: `ownOriginLine(body: unknown) -> string | null` — the text after `Origin:` on the first own line, with leading/trailing spaces and tabs trimmed (`''` for a bare `Origin:`), or `null` when no own line exists or `body` is not a string. An own line matches `/^Origin:/` (column 0), is not masked by `fencedLineMask(lines)` (default options: an unclosed fence hides every later line, the same rule `unfencedText` applies under #4368), and is not inside an `## Absorbed:` section.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/issues/record.test.js`:

```js
// --- ownOriginLine (#4502) ---
test('ownOriginLine: top line read and trimmed; absent and non-string are null', () => {
  assert.strictEqual(ownOriginLine('Origin: ledger resolve gate  \n\n## Current State'), 'ledger resolve gate');
  assert.strictEqual(ownOriginLine('Origin:\n## Current State'), '');
  assert.strictEqual(ownOriginLine('## Current State\nno line'), null);
  assert.strictEqual(ownOriginLine(''), null);
  assert.strictEqual(ownOriginLine(undefined), null);
  assert.strictEqual(ownOriginLine('prose naming Origin: mid-line'), null);
});

test('AC1.1/AC8.1: ownOriginLine skips a line under an ## Absorbed: section', () => {
  const body = ['## Current State', 'x', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.strictEqual(ownOriginLine(body), null);
});

test('AC2.1/AC8.1: ownOriginLine skips a fenced line (backtick and tilde)', () => {
  for (const f of ['```', '~~~']) {
    assert.strictEqual(ownOriginLine(['## Current State', f, 'Origin: quoted', f].join('\n')), null, f);
  }
});

test('AC3.1: ownOriginLine reads a line under ## Original request', () => {
  assert.strictEqual(ownOriginLine(['## Current State', 'x', '## Original request', 'Origin: ledger resolve gate'].join('\n')), 'ledger resolve gate');
});

test('AC4.1: ownOriginLine prefers the own top line over an absorbed one', () => {
  const body = ['Origin: wrap-up leftover', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.strictEqual(ownOriginLine(body), 'wrap-up leftover');
});

test('AC5.1: a line after the absorbed section\'s next ## heading counts again', () => {
  const body = ['## Absorbed: 2026-10-30 — x', 'Origin: absorbed', '## Original request', 'Origin: own'].join('\n');
  assert.strictEqual(ownOriginLine(body), 'own');
});

test('ownOriginLine: ### sub-headings keep an Absorbed section open', () => {
  assert.strictEqual(ownOriginLine(['## Absorbed: d — x', '### Notes', 'Origin: absorbed'].join('\n')), null);
});

test('ownOriginLine: a fenced ## line neither ends an Absorbed section nor opens one', () => {
  assert.strictEqual(ownOriginLine(['## Absorbed: d — x', '```', '## Not a heading', '```', 'Origin: absorbed'].join('\n')), null);
  assert.strictEqual(ownOriginLine(['```', '## Absorbed: quoted', '```', 'Origin: own'].join('\n')), 'own');
});

test('ownOriginLine: an unclosed fence hides every later line, ## Original request included (same rule as #4368)', () => {
  assert.strictEqual(ownOriginLine(['## Current State', '```', 'quoted', '## Original request', 'Origin: own'].join('\n')), null);
});

test('AC7.1: CRLF and lone-CR bodies resolve the same as LF', () => {
  const lines = ['## Absorbed: d — x', 'Origin: absorbed', '## Original request', 'Origin: own  '];
  for (const eol of ['\n', '\r\n', '\r']) assert.strictEqual(ownOriginLine(lines.join(eol)), 'own', JSON.stringify(eol));
  for (const eol of ['\r\n', '\r']) assert.strictEqual(ownOriginLine(['```', 'Origin: quoted', '```'].join(eol)), null, JSON.stringify(eol));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: FAIL (`ownOriginLine is not a function`)

- [ ] **Step 3: Implement `ownOriginLine(body)` in `record-payload.js`**

Split with `body.split(/\r\n|\r|\n/)` (same line boundaries as `unfencedText`), compute `fencedLineMask(lines)`, walk lines tracking `inAbsorbed`: an unfenced line starting `## ` sets `inAbsorbed = line.startsWith('## Absorbed:')`; fenced lines change nothing and are never read. Return the first unfenced, non-absorbed line matching `/^Origin:[ \t]*(.*?)[ \t]*$/`'s capture. Header comment states the three rules (fence, Absorbed, Original request counts) and cites #4502. Replace the "Still fence-blind …" sentence at `:32-34` with one stating that the `Origin:` readers (`provenance.js`, `trust.js`) read through `ownOriginLine` (#4502) and the work-fingerprint reader is out of that scope (it defuses quoted markers at compose time). Add `ownOriginLine` to `module.exports` and to `record.js`'s re-export (destructure and `module.exports`). Add `ownOriginLine (record-payload.js, #4502)` to `markdown-blocks.js`'s `fencedLineMask` callers list (comment only).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/issues/record.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js plugin/bin/lib/issues/record.js plugin/bin/lib/markdown-blocks.js tests/bin-lib/issues/record.test.js
git commit -m "Add ownOriginLine — a record's own Origin: line, skipping fenced and Absorbed lines (refs #4502)"
```

### Task 2: provenance and trust read through `ownOriginLine`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/provenance.js` (replace `ORIGIN_LINE.exec(body)` in `resolveProvenance` and `ORIGIN_LINE.test(body)` in `hasOriginLine` with `ownOriginLine`, imported from `./record.js` alongside `ORIGINS`; delete `ORIGIN_LINE` and move its `.*?` comment onto the call; header comment states the own-line rule)
- Modify: `plugin/bin/lib/issues/trust.js` (`correctiveFollowUpTarget` reads `ownOriginLine(body)`; an empty or null result → `null`; delete `ORIGIN_LINE_RE`; update the `:64-82` comment block so it names `ownOriginLine` instead of the regex pair)
- Test: `tests/bin-lib/issues/provenance.test.js`
- Test: `tests/bin-lib/issues/trust.test.js`
- Test: `tests/bin-lib/issues/author-association.test.js` (one `hasOriginLine` case)
- Read: `plugin/bin/lib/issues/author-association.js` (consumer of `hasOriginLine` only; its selection follows the new rule with no edit — Step 4's suite run covers it)
- Read: `plugin/bin/lib/flow/artifact-overwrite-check.js` (its `ORIGIN_LINE_RE` matches diff-hunk lines for reference preservation, not a record's provenance — no change)
- Read: `docs/superpowers/plans/2026-11-16-origin-author-trust.md` (#4577's shipped plan, history only — no change)

**Interfaces:**
- Consumes: `ownOriginLine(body) -> string | null` from Task 1 (via `require('./record.js')`).
- Produces: no signature changes. `resolveProvenance`, `hasOriginLine`, `trustRows` keep their shapes.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/issues/provenance.test.js`:

```js
test('AC1.1: an Origin line under an ## Absorbed: section is not the record\'s own (#4502)', () => {
  const body = ['## Current State', 'x', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'human', source: 'human' });
});
test('AC2.1: a body whose only Origin line is fenced resolves human (backtick and tilde)', () => {
  for (const f of ['```', '~~~']) {
    assert.deepStrictEqual(resolveProvenance({ labels: [], body: ['## Current State', f, 'Origin: ledger resolve gate', f].join('\n') }), { kind: 'human', source: 'human' }, f);
  }
});
test('AC3.1: an Origin line under ## Original request still resolves its class', () => {
  const body = ['## Current State', 'x', '## Original request', 'Origin: ledger resolve gate (#4368 review)'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'ledger resolve gate (#4368 review)' });
});
test('AC4.1: an own top line beats an absorbed one', () => {
  const body = ['Origin: wrap-up leftover from #3', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'wrap-up leftover' });
});
test('AC5.1: a line after the absorbed section\'s next ## heading counts again', () => {
  const body = ['## Absorbed: 2026-10-30 — x', 'Origin: demo scope-fork', '## Original request', 'Origin: ledger resolve gate'].join('\n');
  assert.deepStrictEqual(resolveProvenance({ labels: [], body }), { kind: 'side-effect', source: 'ledger resolve gate' });
});
test('AC6.1: a bare Origin: line still yields unstructured:empty-origin', () => {
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: 'Origin:\n\n## Current State' }), { kind: 'unstructured', source: 'empty-origin' });
});
test('AC7.1: CRLF bodies resolve the same as LF', () => {
  const lines = ['## Absorbed: 2026-10-30 — x', 'Origin: demo scope-fork', '## Original request', 'Origin: ledger resolve gate'];
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: lines.join('\r\n') }), resolveProvenance({ labels: [], body: lines.join('\n') }));
  const fencedOnly = ['```', 'Origin: ledger resolve gate', '```'];
  assert.deepStrictEqual(resolveProvenance({ labels: [], body: fencedOnly.join('\r\n') }), { kind: 'human', source: 'human' });
});
```

`tests/bin-lib/issues/trust.test.js` (fixtures in the shape of the existing `a follow-up record counts against the record it names` test):

```js
test('AC1.2: an absorbed Origin "from #7" adds no follow-up to #7\'s class (#4502)', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED', closedAt: RECENT },
    { number: 8, labels: [], body: ['## Current State', 'x', '## Absorbed: 2026-10-30 — x', 'Origin: demo changes-requested from #7'].join('\n'), state: 'OPEN' },
  ]);
  assert.equal(rows.find((r) => r.key === 'producer:capture|low').followUps, 0);
});
test('a fenced Origin "from #7" adds no follow-up (#4502)', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED', closedAt: RECENT },
    { number: 8, labels: [], body: ['```', 'Origin: demo changes-requested from #7', '```'].join('\n'), state: 'OPEN' },
  ]);
  assert.equal(rows.find((r) => r.key === 'producer:capture|low').followUps, 0);
});
test('class and follow-up come from the same line: a bare own Origin: hides a later one (#4502)', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED', closedAt: RECENT },
    { number: 8, labels: [], body: 'Origin:\n\n## Original request\nOrigin: demo changes-requested from #7', state: 'OPEN' },
  ]);
  assert.equal(rows.find((r) => r.key === 'producer:capture|low').followUps, 0);
});
test('an own Origin "from #7" under ## Original request still counts (#4502)', () => {
  const rows = trustRows([
    { number: 7, labels: ['by:capture', 'risk:low', 'demo:approved'], body: '', state: 'CLOSED', closedAt: RECENT },
    { number: 8, labels: [], body: '## Current State\nx\n\n## Original request\nOrigin: demo changes-requested from #7', state: 'OPEN' },
  ]);
  assert.equal(rows.find((r) => r.key === 'producer:capture|low').followUps, 1);
});
```

`tests/bin-lib/issues/author-association.test.js`, inside or beside `hasOriginLine matches a line-start Origin: line only`:

```js
test('hasOriginLine ignores fenced and absorbed Origin lines (#4502)', () => {
  assert.equal(hasOriginLine('```\nOrigin: quoted\n```'), false);
  assert.equal(hasOriginLine('## Absorbed: d — x\nOrigin: absorbed'), false);
  assert.equal(hasOriginLine('## Original request\nOrigin: own'), true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/issues/provenance.test.js tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/author-association.test.js`
Expected: FAIL (absorbed/fenced cases resolve side-effect, follow-ups count 1, `hasOriginLine` true)

- [ ] **Step 3: Route both readers through `ownOriginLine`**

`resolveProvenance`: `const line = authorTrust === 'untrusted' ? null : ownOriginLine(body);` then `if (line !== null)` with `truncateAtClauseBoundary(line)` in place of `line[1]`. `hasOriginLine(body)`: `ownOriginLine(body) !== null`. `correctiveFollowUpTarget`: `const line = ownOriginLine(body); if (!line) return null;` then the existing trailing-punctuation strip on `line`.

- [ ] **Step 4: Run to verify they pass, plus the neighbouring suites**

Run: `node --test tests/bin-lib/issues/provenance.test.js tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/author-association.test.js tests/bin-lib/issues/record.test.js`
Expected: PASS

- [ ] **Step 5: Confirm no own-regex `Origin:` reader remains in the two modules**

Run: `git grep -n -E "ORIGIN_LINE|\^Origin:" -- plugin/bin/lib/issues/provenance.js plugin/bin/lib/issues/trust.js`
Expected: no output (exit 1). Control: `git grep -n -E "ORIGIN_LINE|\^Origin:" HEAD~1 -- plugin/bin/lib/issues/provenance.js plugin/bin/lib/issues/trust.js` lists the pre-change regexes.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/provenance.js plugin/bin/lib/issues/trust.js tests/bin-lib/issues/provenance.test.js tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/author-association.test.js
git commit -m "Read provenance and follow-ups from the record's own Origin: line (refs #4502)"
```

### Task 3: Mutation proof and real-data audit (evidence only, no committed code)

**Role:** integration

**Files:**
- Read only: `plugin/bin/lib/issues/record-fingerprint.js` (out of scope per spec Current State; Step 1 confirms it never reads `Origin:`)
- Evidence (uncommitted): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-16T065515-record-4502/evidence/`

**Interfaces:**
- Consumes: the committed branch HEAD after Task 2; `origin/main` as the "before" tree.

- [ ] **Step 1: Confirm `record-fingerprint.js` reads no `Origin:`** — `git grep -n "Origin" -- plugin/bin/lib/issues/record-fingerprint.js` prints nothing.

Waived AC10.1: `npm test` is run by `/build` Common Step 5 and `/claude-tweaks:test` through `verify.js`, not by a plan task.

- [ ] **Step 2: AC8.1/AC8.2 mutation proof (revert the Absorbed skip, then the fence skip, and show which test fails for each).** Extract HEAD into a scratchpad dir with `git archive HEAD` piped to `tar -x -C {scratch}/mut` (never a linked worktree). In the extract, (a) make the Absorbed check never fire (`inAbsorbed` always false) and run `node --test tests/bin-lib/issues/provenance.test.js tests/bin-lib/issues/trust.test.js tests/bin-lib/issues/record.test.js`; record which tests fail; restore; (b) drop the fence-mask check and re-run; record which tests fail. Each mutant must turn at least one AC test red. Write both outputs to `evidence/mutation.txt` with a plain Bash redirect.

- [ ] **Step 3: AC9.1/AC9.2 real-data audit (re-run the 2026-10-30 audit over every record before and after, across all states; report the changed count, expected 0, and name any that changed).** `gh issue list --repo thn-inc/claude-tweaks --state all --limit 10000 --json number,body,labels > {scratch}/records.json`. A scratch Node script loads `resolveProvenance` from an extract of `origin/main` (before) and from the worktree (after), maps label objects to names, calls each with `{ labels, body }` (authorTrust omitted — same in both, so only the line rule differs), and prints the total record count, the changed count, and each changed record's number with before/after. Expected changed count: 0. Write the output to `evidence/audit.txt`; an independent count (`node -e` length of `records.json`) must equal the script's total.

- [ ] **Step 4: Log the AC evidence** — one `log-decision.js --section "/build" --status AUTO --step "AC evidence"` entry per criterion (AC8, AC9) via `--text-file`, naming the command shape, the counts, and the evidence path.
