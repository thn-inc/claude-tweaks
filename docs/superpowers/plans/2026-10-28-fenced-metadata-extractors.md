# Fenced Metadata Extractors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `extractPremiseCheck`, `extractVerifiedAsOf` and `extractTemplateStamp` read their body-metadata line only from lines outside fenced code blocks, so a command quoted in a fence is never run as the record's own premise check.

**Architecture:** One private helper in `record-payload.js` blanks every line `fencedLineRanges` marks as fenced (keeping the line count and each unfenced line byte-for-byte, CR included). The three extractors run their existing, unchanged regexes over that text. `materialize.js` needs no change because it already reads the command through `extractPremiseCheck`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T075946-record-4368/work/4368-spec.md` (record #4368)

Scope keywords: extractPremiseCheck, extractVerifiedAsOf, extractTemplateStamp, fencedLineRanges

## Global Constraints

- Use the shared fence rule `fencedLineRanges` (record-payload.js). Never add a second fence parser.
- An extractor's absence value is unchanged: `null` for all three (the existing `null when absent` tests stay green unmodified).
- Every non-fenced input reads exactly as before: same regexes (`VERIFIED_AS_OF_RE`, `TEMPLATE_STAMP_RE`, `PREMISE_CHECK_RE`), same first-match semantics, same CRLF behaviour on unfenced lines.
- No new export. The helper stays module-private.

## Review Focus

1. **Unclosed fence before the real line:** `fencedLineRanges` treats an unclosed fence as running to EOF, so a real metadata line after a stray opener is hidden and the extractor returns `null`. That is the safer direction (nothing runs) and matches #4169's section readers. Pinned by `fence-blind metadata (#4368): an unclosed fence hides every later metadata line` in Task 1.
2. **Tilde fences and longer backtick fences (````, `~~~`):** these must hide a line the same way ``` does. Pinned by the tilde case in the same Task 1 test group.
3. **CRLF bodies:** a CRLF body with a fenced `Premise-check:` before the real one must still yield the real command, trimmed. `\r` must not stop the fence closer from matching (`\s*$` already covers it). Pinned in Task 1.
4. **The materialize executor itself:** with a trusted author, a fenced-only body must not invoke `runPremiseCheck` at all. The default throwing runner degrades to `premise: null` too, so the test counts calls and asserts zero rather than relying on `premise: null`. Pinned in Task 1.
5. **Bare-CR line endings (plan review):** CommonMark, and so GitHub's renderer, treats a lone `\r` as a line ending, and JS `/m` lets `^` match after one. A body split only on `'\n'` would hide a `\r`-separated fence from `fencedLineRanges` while `PREMISE_CHECK_RE` still read the quoted line. `unfencedText` therefore splits on every CommonMark line ending (`\r\n`, `\r`, `\n`). Pinned by `fence-blind metadata (#4368): bare-CR line endings` in Task 1.
6. **Indented fences (plan review):** CommonMark accepts a fence opener and closer indented 0–3 spaces, but the shared rule only recognised column 0. A column-0 `Premise-check:` line inside a 1–3-space-indented fence would still run, which breaks the record's Release Note promise. Task 2 widens `fencedLineRanges` itself, so every #4169 consumer gets the fix too, not just the extractors. Pinned in Task 2.

---

### Task 1: Metadata extractors skip fenced lines

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (the extractor block ~lines 204-237; the `fencedLineRanges` header comment ~lines 92-99, which lists the fence rule's consumers)
- Modify: `docs/plugin-structure.md:28` (the `fencedLineRanges` parenthetical names its consumers, so add the three extractors)
- Test: `tests/bin-lib/issues/record.test.js` (new group right after the `extractTemplateStamp: null when absent…` test, ~line 1137)
- Test: `tests/materialize-premise-check.test.js` (two new tests after `premise: the runner receives the resolved checkout root as cwd`)
- No change (read only), classified from the Check B scope-keyword sweep and the behaviour-change prose sweep:
  - `plugin/bin/materialize.js` calls `extractPremiseCheck(record.body)` (~line 449), plus `extractVerifiedAsOf` (~433) and `extractTemplateStamp` (~583). It runs nothing when the premise extractor returns `null`. The new materialize tests prove this.
  - `plugin/bin/lib/issues/record.js` is a re-export aggregator. Its signatures are unchanged.
  - `plugin/bin/lib/issues/materialize-format.js` is another `fencedLineRanges` consumer. It is untouched.
  - `plugin/skills/flow/materialize.md`, `plugin/skills/_shared/work-record.md` and `plugin/skills/wrap-up/claude-md-curation.md` describe *producing* or reading the record's own top-level metadata line. Those sentences stay true, because a fenced line is quoted content, not the record's own line.
  - `tests/bin-lib/{code,docs,harness,journey}-health/issue-payload.test.js` read metadata back off `specShapedBody`-composed bodies, which emit the lines at top level, outside any fence. They are unaffected and are run in Step 4 as a regression check.

**Interfaces:**
- Consumes: `fencedLineRanges(lines: string[]) -> Array<[start, end]>` (same module, inclusive line indices).
- Produces: no new export. `extractVerifiedAsOf(body) -> string|null`, `extractPremiseCheck(body) -> string|null` and `extractTemplateStamp(body) -> {path, version}|null` keep their signatures.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`, add after the `extractTemplateStamp: null when absent…` test:

```js
// --- fence-blind metadata (#4368) ---

const fenced = (line, fence = '```') => [fence, line, fence].join('\n');

test('AC1.1: extractPremiseCheck — fenced command before the record\'s own yields the unfenced one', () => {
  const body = [fenced('Premise-check: echo QUOTED'), '', 'Premise-check: echo REAL', '', '## Current State', 'x'].join('\n');
  assert.strictEqual(extractPremiseCheck(body), 'echo REAL');
});

test('AC2.1: extractPremiseCheck — a body whose only command line is fenced yields null', () => {
  const body = ['## Current State', fenced('Premise-check: echo QUOTED'), 'x'].join('\n');
  assert.strictEqual(extractPremiseCheck(body), null);
});

test('extractPremiseCheck — real-only body is unchanged', () => {
  assert.strictEqual(extractPremiseCheck('Premise-check: echo REAL\n\n## Current State\nx'), 'echo REAL');
});

test('AC3.1: extractVerifiedAsOf — fenced-before-real, fenced-only, real-only', () => {
  assert.strictEqual(extractVerifiedAsOf([fenced('Verified-as-of: aaaaaaa'), 'Verified-as-of: bbbbbbb'].join('\n')), 'bbbbbbb');
  assert.strictEqual(extractVerifiedAsOf(['## Current State', fenced('Verified-as-of: aaaaaaa')].join('\n')), null);
  assert.strictEqual(extractVerifiedAsOf('Verified-as-of: bbbbbbb\n\n## Current State'), 'bbbbbbb');
});

test('AC3.1: extractTemplateStamp — fenced-before-real, fenced-only, real-only', () => {
  assert.deepStrictEqual(
    extractTemplateStamp([fenced('Template: quoted.md @ 1.0.0'), 'Template: real.md @ 2.0.0'].join('\n')),
    { path: 'real.md', version: '2.0.0' },
  );
  assert.strictEqual(extractTemplateStamp(['## Current State', fenced('Template: quoted.md @ 1.0.0')].join('\n')), null);
  assert.deepStrictEqual(extractTemplateStamp('Template: real.md @ 2.0.0\n'), { path: 'real.md', version: '2.0.0' });
});

test('fence-blind metadata (#4368): tilde and longer backtick fences hide the line too', () => {
  assert.strictEqual(extractPremiseCheck(fenced('Premise-check: echo QUOTED', '~~~')), null);
  assert.strictEqual(extractPremiseCheck(fenced('Premise-check: echo QUOTED', '````')), null);
});

test('fence-blind metadata (#4368): an unclosed fence hides every later metadata line', () => {
  assert.strictEqual(extractPremiseCheck('```\nquoted\n\nPremise-check: echo REAL'), null);
});

test('fence-blind metadata (#4368): CRLF body — fenced line skipped, real command read and trimmed', () => {
  const body = ['```', 'Premise-check: echo QUOTED', '```', 'Premise-check: echo REAL', '## Current State'].join('\r\n');
  assert.strictEqual(extractPremiseCheck(body), 'echo REAL');
});

test('fence-blind metadata (#4368): bare-CR line endings — a CR-separated fence hides its line too', () => {
  assert.strictEqual(extractPremiseCheck('intro\r```\rPremise-check: echo QUOTED\r```'), null);
  assert.strictEqual(extractPremiseCheck('```\rPremise-check: echo QUOTED\r```\rPremise-check: echo REAL\r'), 'echo REAL');
  assert.strictEqual(extractVerifiedAsOf('```\rVerified-as-of: aaaaaaa\r```'), null);
});
```

In `tests/materialize-premise-check.test.js`, add after `premise: the runner receives the resolved checkout root as cwd`, reusing that file's `gitRepo`, `withCwd`, `fakeDeps` and `runDirFor` (`fakeDeps`' default `authorAssociation` is the trusted `OWNER`):

- `test('AC2.1 (#4368): a trusted record whose only Premise-check: line is fenced runs nothing — runner never called, premise null', …)`. The body is `SHAPED_BODY_NO_PREMISE_CHECK` with a ```` ```\nPremise-check: echo QUOTED\n``` ```` block inserted under `## Current State`. `runPremiseCheck` is a spy that pushes its command into an array and returns 0. Assert `exitCode === 0`, `envelope.premise === null` and `seen.length === 0`.
- `test('AC1.1 (#4368): a trusted record with a fenced command before its own runs only its own', …)`. The body is the fenced `echo QUOTED` block, a blank line, then `shapedBodyWithPremiseCheck('echo REAL')`, so the fence comes first in the body, ahead of the real `Premise-check: echo REAL` line. The spy records commands and returns 0. Assert `seen` deep-equals `['echo REAL']` and `envelope.premise.command === 'echo REAL'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js`
Expected: FAIL. The fenced-before-real cases return `echo QUOTED` / `aaaaaaa` / `quoted.md`, and the fenced-only cases return a value instead of `null`. Real-only cases pass.

- [ ] **Step 3: Implement fence-blind extraction in `plugin/bin/lib/issues/record-payload.js`**

Add a private `unfencedText(body: string) -> string`, placed just after `fencedLineRanges`. It splits on every CommonMark line ending while keeping the separators (`body.split(/(\r\n|\r|\n)/)`: even indices are lines, odd indices are separators). It runs `fencedLineRanges` over the separator-free lines, replaces every line inside a range with `''`, and re-joins lines and original separators. Every unfenced line and every separator therefore stays byte-identical, and today's CRLF behaviour is unchanged. Each of the three extractors keeps its existing type guard and runs its unchanged regex over `unfencedText(body)` instead of `body`. Extend the `fencedLineRanges` header comment's consumer list ("The one fence rule shared by stripCodeSpans …, sectionText and extractSection (#4169)") to name the three metadata extractors (#4368). Add one sentence to the extractor block saying fenced lines are quoted content and never match.

In `docs/plugin-structure.md:28`, extend the parenthetical "fencedLineRanges — the one fence rule extractSection, materialize-format.js's sectionText and stripCodeSpans share, so a heading inside a fenced block is never read as a section, #4169". Add the three metadata extractors, so that a Premise-check/Verified-as-of/Template line quoted in a fence is never read as the record's own (#4368).

- [ ] **Step 4: Run tests to verify they pass, and prove each fix discriminates**

Run: `node --test tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/code-health/issue-payload.test.js tests/bin-lib/docs-health/issue-payload.test.js tests/bin-lib/journey-health/issue-payload.test.js`
Expected: PASS (all).

Guard discrimination: temporarily revert each extractor to `body` one at a time and re-run `tests/bin-lib/issues/record.test.js`. Reverting `extractPremiseCheck` must turn AC1.1/AC2.1/tilde/unclosed/CRLF red. Reverting `extractVerifiedAsOf` must turn its AC3.1 red, and reverting `extractTemplateStamp` must turn its AC3.1 red. Restore each before the next. Then temporarily change `unfencedText`'s split to `'\n'` only: the bare-CR test must go red. Restore it. Run all discrimination edits in a scratch copy (`git worktree add`) or restore them before committing. Never use `git stash`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js docs/plugin-structure.md tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js
git commit -m "Read record metadata lines only outside fenced blocks — refs #4368"
```

### Task 2: The shared fence rule accepts CommonMark's 0–3-space indentation

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/record-payload.js` (`fencedLineRanges`, ~lines 92-119: header comment and the opener/closer regexes)
- Test: `tests/bin-lib/issues/record.test.js` (append to Task 1's `fence-blind metadata (#4368)` group, and to the `extractSection skips fenced headings (#4169)` group, ~line 1244)
- Test: `tests/bin-lib/issues/materialize-format.test.js` (append to the `sectionText skips fenced headings (#4169)` group, ~line 548)
- No change: `plugin/bin/lib/issues/materialize-format.js`. Its `sectionText`/`stripCodeSpans` consume `fencedLineRanges` unchanged and pick up the widened rule automatically. `stripCodeSpans` maps ranges to character offsets from line starts (~line 88), and those offsets are unaffected by indentation inside a line.

**Interfaces:**
- Consumes: Task 1's `unfencedText` (unchanged).
- Produces: `fencedLineRanges(lines)`, with the same signature and return shape. An opener is now a line of 0–3 spaces followed by a run of 3+ backticks or tildes. A closer is 0–3 spaces, then the opener's character at least the opener's length, then only trailing whitespace. 4+ spaces is an indented code block in CommonMark, not a fence, and stays unrecognised.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/issues/record.test.js`'s `fence-blind metadata (#4368)` group:

```js
test('fence-blind metadata (#4368): a fence indented 1–3 spaces hides its line; 4 spaces is not a fence', () => {
  for (const pad of [' ', '  ', '   ']) {
    assert.strictEqual(extractPremiseCheck(`${pad}\`\`\`\nPremise-check: echo QUOTED\n${pad}\`\`\``), null, `pad ${pad.length}`);
  }
  // An indented opener closed by a column-0 closer still pairs.
  assert.strictEqual(extractPremiseCheck('  ```\nPremise-check: echo QUOTED\n```\nPremise-check: echo REAL'), 'echo REAL');
  // A column-0 opener closed by an indented closer still pairs (pins the closer's indent allowance).
  assert.strictEqual(extractPremiseCheck('```\nPremise-check: echo QUOTED\n  ```\nPremise-check: echo REAL'), 'echo REAL');
  // Four spaces is an indented code block, not a fence opener — the following column-0 line is read.
  assert.strictEqual(extractPremiseCheck('    ```\nPremise-check: echo REAL'), 'echo REAL');
});
```

In the `extractSection skips fenced headings (#4169)` group:
`test('extractSection: a heading inside a 3-space-indented fence is not a section (#4368)', …)`. A body of `'## Current State', 'x', '   ```', '## Deliverables', 'quoted', '   ```', '', '## Release Note', 'n'` gives `extractSection(body, 'Deliverables') === ''`.

In `materialize-format.test.js`'s `sectionText skips fenced headings (#4169)` group:
`test('sectionText: an indented (1–3 space) fence hides quoted headings; a 4-space one does not (#4368)', …)`. With the same body shape, `sectionText(body, 'Deliverables') === null` for 1-, 2- and 3-space pads. With a 4-space pad the heading is the record's own, as before. Assert `sectionText(body, 'Deliverables')` is non-null and starts with `'quoted'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js`
Expected: FAIL. The 1–3-space cases read the quoted line or heading. The 4-space cases already pass.

- [ ] **Step 3: Widen `fencedLineRanges` in `plugin/bin/lib/issues/record-payload.js`**

Opener regex: `/^ {0,3}(`{3,}|~{3,})/`. The closer regex is built as today but with a ` {0,3}` prefix: `` new RegExp(`^ {0,3}${fenceChar}{${fenceLen},}\\s*$`) ``. Update the header comment's "an opener is a column-0 run of 3+ backticks or tildes" to say up to three leading spaces (CommonMark), for the closer too, and to say four is an indented code block. Leave `fenceFor`/`fencedBlock` unchanged: they write column-0 fences, which still match.

Also update `docs/plugin-structure.md:28` only if Task 1's wording there claims column-0. Otherwise leave it.

- [ ] **Step 4: Run tests to verify they pass, and prove the discrimination**

Run: `node --test tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js tests/materialize-premise-check.test.js`
Expected: PASS (all, including every pre-existing #4169 test).

Discrimination: drop ` {0,3}` from the opener only, and the 1–3-space cases go red. Drop it from the closer only, and the column-0-opener/indented-closer assertion goes red, because the fence runs to EOF and the result is `null`. Run the mutations in a scratch worktree or restore them before commit. Never use `git stash`.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/materialize-format.test.js
git commit -m "Accept CommonMark's 0-3-space fence indentation in the shared fence rule — refs #4368"
```

Waived AC4.1: `npm test` passes. Covered by `/build` Common Step 5's verification run, not a task step.
