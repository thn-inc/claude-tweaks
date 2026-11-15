# Driver neutralize: strip a closing keyword only before an issue reference — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `neutralize` in `plugin/bin/lib/driver/events.js` removes a closing keyword only when an issue reference follows it, so driver commit titles keep their leading verb (`Fix the loop` stays `Fix the loop`).

**Architecture:** Replace the bare-keyword regex `CLOSING_KEYWORDS` with one keyword-before-reference regex: keyword, optional whitespace/colon/whitespace, then a lookahead for a reference (issue/PR URL, `owner/name#N`, `#N`). It runs first in the `neutralize` chain — before `URL_REF` — because `URL_REF`'s removal would otherwise strand the keyword with nothing after it (`Closes https://…/issues/5` → `Closes`). The lookahead leaves the reference in place; the existing `URL_REF`/`QUALIFIED_REF`/`BARE_REF` passes still remove every reference, with or without a keyword. The keyword set comes from `plugin/bin/lib/issue-branch-tracking.js`'s exported `CLOSING_KEYWORD_ALTERNATION` (its comment: "exported so a caller with a different grammar … shares the keyword set instead of hand-rolling a second copy that could silently drift").

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T000404-record-5269/work/5269-spec.md`

## Global Constraints

- Reference shapes that make a keyword removable (spec Deliverable 1, verbatim): "`#N`, `owner/name#N` or a GitHub issue or pull request URL" — "optionally after a colon and whitespace". `GH-N` is not in this list: it is still removed unconditionally by `GH_REF`, but does not make a preceding keyword removable.
- "It keeps removing every such reference, with or without a keyword before it."
- Deliverable 2: "The tests in `tests/bin-lib/driver/run.test.js` that asserted a bare keyword's removal are updated to the new rule; the rest are unchanged."
- Governing project skill `driver-step-addition` ("Worker-controlled text is neutralized before it leaves"), verbatim: "Each such string goes through `events.js`'s `neutralize` before it reaches an event `detail`, a commit message, a PR body or a log line (AC14.3)." — unchanged: every caller keeps calling `neutralize`; only what it removes narrows. `headless-worker-launch`'s "What the consumer owes" rule (neutralize every worker string before a command, commit message, comment or log line) likewise holds.
- `neutralize`'s other passes (newline collapse, `GH_REF`, `<!--` escape, backtick → `'`, `@` → `@​`, whitespace collapse) are unchanged, and so are their order relative to each other.
- Commit message style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_01CcCLFs7dJ3CoDp6dxFRQgU`.

## Review Focus

1. **Keyword glued to a reference, no space** (`closes#5 x`) — the safe direction is removal: expect `x`. Pinned in Task 1.
2. **Keyword and reference split by a newline** (`Fixes\n#5 x`) — `neutralize` collapses newlines first, so this is keyword + reference: expect `x`. Pinned in Task 1.
3. **Keyword before something that is not a reference** (`Fix #abc`, `Closes (#4) now`) — the keyword stays; `#abc` is no reference and stays; `(#4)` loses `#4` (expect `Fix #abc`, `Closes () now`). No closing link can survive since the reference is gone. Pinned in Task 1.
4. **A keyword as a URL path segment** (`x https://github.com/o/fix/issues/5 y`) — the whole URL still goes: expect `x y` (existing assertion, unchanged — it now also guards that the keyword-first pass cannot cut into a URL).
5. **Words containing a keyword** (`prefixes and fixture`) — untouched (existing assertion, unchanged).

---

### Task 1: Remove a closing keyword only before an issue reference

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/events.js:56-81` (`CLOSING_KEYWORDS`, `neutralize`, the `URL_REF` comment at 59-61)
- Test: `tests/bin-lib/driver/run.test.js:29-56` (the `neutralize` and `AC3.4` unit tests)
- No-change (classified): the `AC3.4, AC3.5` commit-step test (`run.test.js:1383`), the `AC14.3` hostile-field test (`run.test.js:1672`), and every other `neutralize(...)` expectation in `run.test.js` (lines 1819, 1851, 1941, 2037, 2168) — each feeds a keyword followed by a reference, or computes its expected value with `neutralize` itself, so the new rule gives the same result. `.claude/skills/driver-step-addition/SKILL.md` and `.claude/skills/headless-worker-launch/SKILL.md` describe *that* text is neutralized, not the keyword rule — no change.

**Interfaces:**
- Consumes: `CLOSING_KEYWORD_ALTERNATION` (string, `'(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)'`) from `plugin/bin/lib/issue-branch-tracking.js`.
- Produces: `neutralize(text: unknown) -> string` and `normalizeTitle(raw: unknown) -> string`, signatures and exports unchanged. `CLOSING_KEYWORDS` is not exported today and its replacement is not exported either.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/driver/run.test.js`

Replace the `'x CLOSED y Resolved z'` assertion (line 34) with `assert.equal(neutralize('x CLOSED y Resolved z'), 'x CLOSED y Resolved z');`. Rename the `AC3.4: normalizeTitle keeps first line, drops period and keywords` test to `AC3.4: normalizeTitle keeps first line, drops period and keyword-reference pairs` (its three assertions stay). Add after it:

```js
test('#5269 AC1: normalizeTitle keeps a leading closing keyword with no reference after it', () => {
  assert.equal(normalizeTitle('Fix the loop'), 'Fix the loop');
  assert.equal(normalizeTitle('Resolves the race in the sink'), 'Resolves the race in the sink');
});

test('#5269 AC2: a closing keyword before a reference loses both', () => {
  assert.equal(normalizeTitle('Add the loop. Resolves #9.\nsecond line'), 'Add the loop');
  assert.equal(normalizeTitle('Closes #4'), '');
  assert.equal(neutralize('Fixes: #12'), '');
  assert.equal(neutralize('fixes owner/repo#3'), '');
  assert.equal(neutralize('Closes https://github.com/o/r/issues/5'), '');
  assert.equal(neutralize('a Fixed https://github.com/o/r/pull/7 b'), 'a b');
  // Review Focus 1-3.
  assert.equal(neutralize('closes#5 x'), 'x');
  assert.equal(neutralize('Fixes\n#5 x'), 'x');
  assert.equal(neutralize('Fix #abc'), 'Fix #abc');
  assert.equal(neutralize('Closes (#4) now'), 'Closes () now');
});

test('#5269 AC3: no keyword is ever left followed by a reference, in any case or shape', () => {
  const { CLOSING_KEYWORD_ALTERNATION } = require(path.join(LIB, 'issue-branch-tracking'));
  const keywords = ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
  const refs = ['#12', 'owner/repo#3', 'https://github.com/o/r/issues/5', 'https://github.com/o/r/pull/5'];
  // No empty separator: `closehttps://…` has no word boundary, under either rule (the glued
  // `closes#5` form is pinned in AC2 above).
  const separators = [' ', ':', ': ', ' : '];
  const leftover = new RegExp(`\\b${CLOSING_KEYWORD_ALTERNATION}\\s*:?\\s*(?:#\\d|\\S*\\/\\S*#\\d|\\S*github\\.com\\/)`, 'i');
  for (const kw of keywords) {
    for (const cased of [kw, kw[0].toUpperCase() + kw.slice(1), kw.toUpperCase()]) {
      for (const ref of refs) {
        for (const sep of separators) {
          const out = neutralize(`Add ${cased}${sep}${ref} now`);
          assert.doesNotMatch(out, leftover, JSON.stringify([cased, sep, ref, out]));
          assert.equal(out, 'Add now', JSON.stringify([cased, sep, ref]));
        }
      }
    }
  }
});
```

(`LIB` is the test file's existing lib-root constant, already used at line 20.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="neutralize|#5269|AC3.4" tests/bin-lib/driver/run.test.js`
Expected: FAIL — `#5269 AC1` (`'the loop' !== 'Fix the loop'`) and the `'x CLOSED y Resolved z'` assertion fail. `#5269 AC2` and `#5269 AC3` also fail on their colon forms (the old rule removes the keyword but strands the colon: `Fixes: #12` → `:`); their `doesNotMatch` safety half passes on both old and new code — it is the guard that must not regress.

- [ ] **Step 3: Implement in `plugin/bin/lib/driver/events.js`**

- `require` `CLOSING_KEYWORD_ALTERNATION` from `../issue-branch-tracking`.
- Replace `CLOSING_KEYWORDS` with `KEYWORD_BEFORE_REF`, built after `URL_REF`/`QUALIFIED_REF`/`BARE_REF` are defined:
  `new RegExp('\\b' + CLOSING_KEYWORD_ALTERNATION + '\\b\\s*:?\\s*(?=' + [URL_REF, QUALIFIED_REF, BARE_REF].map((r) => r.source).join('|') + ')', 'gi')` — the lookahead keeps the reference for its own pass.
- In `neutralize`, run `.replace(KEYWORD_BEFORE_REF, '')` immediately after the `[\r\n\t]+` collapse (before `URL_REF`), and drop the old `.replace(CLOSING_KEYWORDS, '')` line.
- Reword the `URL_REF` comment's "Removed before the keywords, which could otherwise cut a path segment out of it" to say the keyword pass runs first, removes a keyword only when a reference starts right after it, and so never cuts into a URL path.
- Update the file header bullet (lines 10-12) only if it now misdescribes the rule — it says the text "cannot close an issue", which still holds; leave it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: PASS, 0 failures — including `AC3.4, AC3.5` (commit step) and `AC14.3` (hostile fields).

- [ ] **Step 5: Prove the AC2 exact-equality assertions discriminate**

Temporarily delete the `.replace(KEYWORD_BEFORE_REF, '')` line, run `node --test --test-name-pattern="#5269" tests/bin-lib/driver/run.test.js`, and confirm `#5269 AC2` fails (e.g. `'Closes' !== ''` for the URL case) and `#5269 AC3` fails its `'Add now'` equality. Restore the line and re-run Step 4's command (PASS). Quote both raw outputs in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/driver/events.js tests/bin-lib/driver/run.test.js
git commit -m "Keep the verb in driver commit titles — strip a closing keyword only before an issue reference (refs #5269)" -m "Claude-Session: https://claude.ai/code/session_01CcCLFs7dJ3CoDp6dxFRQgU"
```
