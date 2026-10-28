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
5. **A fence closer that is a prefix of a longer run:** an inner ```` ``` ```` inside a ```` ```` ```` fence must not close it early. That is `fencedLineRanges`' own rule and is not re-tested here. Waived: covered by #4169's existing `fencedLineRanges` tests.

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
```

In `tests/materialize-premise-check.test.js`, add after `premise: the runner receives the resolved checkout root as cwd`, reusing that file's `gitRepo`, `withCwd`, `fakeDeps` and `runDirFor` (`fakeDeps`' default `authorAssociation` is the trusted `OWNER`):

- `test('AC2.1 (#4368): a trusted record whose only Premise-check: line is fenced runs nothing — runner never called, premise null', …)`. The body is `SHAPED_BODY_NO_PREMISE_CHECK` with a ```` ```\nPremise-check: echo QUOTED\n``` ```` block inserted under `## Current State`. `runPremiseCheck` is a spy that pushes its command into an array and returns 0. Assert `exitCode === 0`, `envelope.premise === null` and `seen.length === 0`.
- `test('AC1.1 (#4368): a trusted record with a fenced command before its own runs only its own', …)`. The body is the fenced `echo QUOTED` block, a blank line, then `shapedBodyWithPremiseCheck('echo REAL')`, so the fence comes first in the body, ahead of the real `Premise-check: echo REAL` line. The spy records commands and returns 0. Assert `seen` deep-equals `['echo REAL']` and `envelope.premise.command === 'echo REAL'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js`
Expected: FAIL. The fenced-before-real cases return `echo QUOTED` / `aaaaaaa` / `quoted.md`, and the fenced-only cases return a value instead of `null`. Real-only cases pass.

- [ ] **Step 3: Implement fence-blind extraction in `plugin/bin/lib/issues/record-payload.js`**

Add a private `unfencedText(body: string) -> string`, placed just after `fencedLineRanges`. It splits on `'\n'` (not CRLF-normalized, so each unfenced line keeps any `\r` it had and today's CRLF behaviour is byte-identical), replaces every line inside a `fencedLineRanges` range with `''`, and re-joins with `'\n'`. Each of the three extractors keeps its existing type guard and runs its unchanged regex over `unfencedText(body)` instead of `body`. Extend the `fencedLineRanges` header comment's consumer list ("The one fence rule shared by stripCodeSpans …, sectionText and extractSection (#4169)") to name the three metadata extractors (#4368). Add one sentence to the extractor block saying fenced lines are quoted content and never match.

In `docs/plugin-structure.md:28`, extend the parenthetical "fencedLineRanges — the one fence rule extractSection, materialize-format.js's sectionText and stripCodeSpans share, so a heading inside a fenced block is never read as a section, #4169". Add the three metadata extractors, so that a Premise-check/Verified-as-of/Template line quoted in a fence is never read as the record's own (#4368).

- [ ] **Step 4: Run tests to verify they pass, and prove each fix discriminates**

Run: `node --test tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js tests/bin-lib/harness-health/issue-payload.test.js tests/bin-lib/code-health/issue-payload.test.js tests/bin-lib/docs-health/issue-payload.test.js tests/bin-lib/journey-health/issue-payload.test.js`
Expected: PASS (all).

Guard discrimination: temporarily revert each extractor to `body` one at a time and re-run `tests/bin-lib/issues/record.test.js`. Reverting `extractPremiseCheck` must turn AC1.1/AC2.1/tilde/unclosed/CRLF red. Reverting `extractVerifiedAsOf` must turn its AC3.1 red, and reverting `extractTemplateStamp` must turn its AC3.1 red. Restore each before the next.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-payload.js docs/plugin-structure.md tests/bin-lib/issues/record.test.js tests/materialize-premise-check.test.js
git commit -m "Read record metadata lines only outside fenced blocks — refs #4368"
```

Waived AC4.1: `npm test` passes. Covered by `/build` Common Step 5's verification run, not a task step.
