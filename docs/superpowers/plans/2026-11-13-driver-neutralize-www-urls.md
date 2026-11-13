# Driver neutralize: www. and bare github.com URLs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `neutralize()` removes `www.`-prefixed (any host) and bare `github.com` issue/PR URLs from worker text, in linear time.

**Architecture:** Widen the one `URL_REF` constant in `plugin/bin/lib/driver/events.js` to three host alternatives sharing the existing path and tail grammar. Linearity comes from two choices. First, the `www.`/bare-host left boundary admits a digit, so back-to-back references go in one pass. Second, a `www.` domain cannot run past a later valid start. `removeKeywordsBeforeReferences` and the fixed-point loop are unchanged.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T093429-spec-5352/work/5352-spec.md` (record #5352)

## Global Constraints

- `neutralize('Closes www.github.com/o/r/issues/5 now')` returns `now`; `neutralize('see github.com/o/r/pull/7')` returns `see`.
- Every case in `perf/driver-neutralize-linearity.test.js` passes its budget under `npm run test:perf`, including new cases of at least 100k characters for each added URL form.
- `node --test tests/bin-lib/driver/*.test.js` passes.
- Wall-clock assertions live only in `perf/`, never `tests/` (`tests/wall-clock-budget-conformance.test.js`).
- Long perf outputs are asserted with `assert.ok(value === expected, …)` and a length-only message.

Governing skills, quoted verbatim:

- `regex-scan-linearity` (Project Conventions): "The file header names the record, says it is deliberately not part of `npm test`, gives `Run with: npm run test:perf`, and lists each shape found with its pre-fix time." / "Assert the verdict as well as the time, as the #3412 and #4581 files do, so a fix that changes the answer is caught." / "Each case goes red when its fix is reverted. Prove it once by reverting."
- `regex-scan-linearity` (Key Patterns): "Any rule that refuses a match until the previous removal has run makes that loop quadratic."
- `fact-validated-narration`: "Test a neutralizer against each hostile shape glued to every allowed neighbouring character (`-`, `.`, `_`, `(`, a letter, the start of the string), not only after a space. The test must go red when the boundary is narrowed back." / "Test each removal against an input built so that removing it forms the next shape (the `#5269 AC2` rebuilt-reference …)"
- `driver-step-addition` and `headless-worker-launch` name `neutralize` only as the filter that consumers must call. This change keeps its signature and adds no step, so none of their rules apply.

## Review Focus

1. `Closes xhttps://github.com/o/r/issues/5 now`. The bare-host alternative must not match the `github.com` inside a scheme URL that GitHub does not link, so the output is still `xhttps://github.com/o/r/issues/5 now`. This is pinned already in AC2; it must stay green.
2. A host that is not exactly `github.com` with no `www.` stays: `gist.github.com/o/r/issues/5` and `notgithub.com/o/r/issues/5` are unchanged.
3. Text right before the host that GitHub does not autolink stays: `x.www.github.com/o/r/issues/5` and `a-github.com/o/r/issues/5` are unchanged.
4. Sentence punctuation around the URL is kept: `(www.github.com/o/r/issues/5)` becomes `()`, and `www.github.com/o/r/issues/5.` becomes `.`.
5. Case: `WWW.GitHub.com/o/r/issues/5 x` becomes `x`. The regex is `i`, the safe side.

---

### Task 1: Remove www. and bare github.com URL references

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/events.js:101-106` (the `URL_REF` comment and constant)
- Modify: `tests/bin-lib/driver/run.test.js:86-102` (AC2), `:131-154` (AC3)
- Modify: `perf/driver-neutralize-linearity.test.js` (header lines 33-47, the `www.` shapes test, the keyword-chain test, and new cases)
- Modify: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md`, step 3. Its sentence "A `www.` or bare `github.com` issue URL stays in the subject, though a keyword before it still goes." becomes a statement that these URLs are removed too.

Behavior-change prose sweep (`git grep -i -E "bare .?github\.com|www\.(github|ghe|g/)|URL_REF"`). Everything it finds outside the files above needs no change:
- `.claude/skills/regex-scan-linearity/SKILL.md:45` gives #5269's pre-fix history; wrap-up's skill curation adds #5352's shapes.
- `tests/bin-lib/driver/run.test.js:25` (`LEFTOVER_KEYWORD_REFERENCE`) already covers `github.com/`.
- `docs/superpowers/plans/2026-11-13-driver-neutralize-keyword.md` is #5269's historical plan.
- The hits in `gh-api-module-pattern` and `repo-resolve` are about repo slugs, not neutralize.

**Interfaces:**
- Consumes: nothing new.
- Produces: `URL_REF` keeps its name and its `gi` flags; `neutralize(text: string) => string` keeps its signature.

- [ ] **Step 1: Flip the AC2/AC3 assertions and add the Review Focus pins in `tests/bin-lib/driver/run.test.js`**

In `#5269 AC2: a closing keyword before a reference loses both`, replace the "Non-scheme URL forms stay as backlinks" comment and its three assertions, and the three chain assertions, with:

```js
  // www. URLs on any host and bare github.com URLs go too (#5352).
  assert.equal(neutralize('Closes www.github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Closes github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Closes www.ghe.example.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('see github.com/o/r/pull/7'), 'see');
```

and the chain block (the assertions between the two blocks stay as they are):

```js
  assert.equal(neutralize('Fixes fixes: www.github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Fix the fix www.github.com/o/r/issues/5 now'), 'Fix the now');
  assert.equal(neutralize('fix fix the www.github.com/o/r/issues/5'), 'fix fix the');
```

Add a new test, `#5352: www. and bare github.com URLs go only where GitHub links them`, covering Review Focus 2-5:

```js
  for (const s of ['gist.github.com/o/r/issues/5', 'notgithub.com/o/r/issues/5',
    'x.www.github.com/o/r/issues/5', 'a-github.com/o/r/issues/5']) assert.equal(neutralize(s), s);
  assert.equal(neutralize('(www.github.com/o/r/issues/5)'), '()');
  assert.equal(neutralize('www.github.com/o/r/issues/5.'), '.');
  assert.equal(neutralize('WWW.GitHub.com/o/r/issues/5 x'), 'x');
  assert.equal(neutralize('see www.github.com/o/r/issues/5#issuecomment-1 x'), 'see x');
  // Back-to-back references go in the first pass: the boundary admits a digit.
  assert.equal(neutralize('www.g/o/r/issues/5www.g/o/r/issues/6'), '');
  assert.equal(neutralize('github.com/o/r/issues/5github.com/o/r/pull/6'), '');
  // Glued to each neighbour: GitHub's www-autolink boundary (plus a digit) goes, anything else stays.
  for (const ref of ['www.github.com/o/r/issues/5', 'github.com/o/r/issues/5']) {
    for (const n of ['_', '(', '*', '~', '1']) assert.equal(neutralize(`x ${n}${ref} y`), `x ${n} y`, n + ref);
    for (const n of ['-', '.', 'a', '/', ':']) assert.equal(neutralize(`x ${n}${ref} y`), `x ${n}${ref} y`, n + ref);
  }
  // A removal that rebuilds one of these forms is removed too.
  assert.equal(neutralize('Add Closes w#7ww.github.com/o/r/issues/5 now'), 'Add now');
  assert.equal(neutralize('Add Closes gith#7ub.com/o/r/pull/5 now'), 'Add now');
```

In AC3, delete the `www.`/`github.com` branch of `expected` (line 147) and update the comment on lines 144-145: every reference goes, and `_https://…` keeps its `_`.

- [ ] **Step 2: Run and see the flipped assertions fail**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL in AC2, AC3 and the new #5352 test (for example, actual `'www.github.com/o/r/issues/5 now'` against expected `'now'`).

- [ ] **Step 3: Widen `URL_REF` in `plugin/bin/lib/driver/events.js`**

The regex is the design, so it is given exactly. Line breaks are only for display; use one literal:

```js
const URL_REF = /(?:(?<![A-Za-z])https?:\/\/[^\s/]+|(?<![^\s*_~(\d])(?:www\.(?:[A-Za-z.-]|[\d_](?!www\.))+|github\.com))\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/\d+(?:[/#?]\S*[^\s)\].,;:!?'">])?/gi;
```

Rewrite the comment above it. Keep the scheme sentences, and replace "Other URL forms … are not removed here" with these four points:

- A `www.` URL on any host, and a bare `github.com` URL, start where GitHub's www-autolink does: at the start, after whitespace, or after `*`, `_`, `~` or `(`. A digit is admitted too, as the scheme boundary admits one: it is where the previous reference ended, so back-to-back references go in one pass instead of one per loop pass.
- A `www.` domain cannot run across a later `www.` start (`[\d_](?!www\.)`). Without that, every `_www.` or `1www.` in a long run rescans the run to its end.
- A bare host is exactly `github.com`: it follows the same boundary, so `gist.github.com` and `xhttps://github.com/…` are not matched.
- Each alternative scans at most its host and the three path segments that follow, so the scan stays linear.

- [ ] **Step 4: Run the driver suites**

Run: `node --test tests/bin-lib/driver/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Update `perf/driver-neutralize-linearity.test.js`**

- Header. Replace the `www.` bullet (lines 33-35), the chain bullet's "survives the reference passes" wording (lines 39-42) and the "Dropped as no longer testing anything" paragraph (lines 45-47). The new text should say that the `www.`/bare-host alternatives are back (#5352), and give the probed pre-fix times:
  - without the `[\d_](?!www\.)` guard: `'_www.'.repeat(40000)` about 74 s, `'1www.'.repeat(40000)` about 36 s, `'_www.a'.repeat(35000)` about 11 s;
  - without the digit boundary: `'www.g/o/r/issues/5'.repeat(11000)` about 95 s, `'github.com/o/r/issues/5'.repeat(9000)` about 23 s.
- In `www. and keyword runs that match nothing stay linear and unchanged`, take out the `'www.g/o/r/issues/5'` shape and add `'1www.': '1www.'.repeat(40000)` and `'_www.a': '_www.a'.repeat(35000)`. Also add these, all of which still come back unchanged: `` `www.${'a'.repeat(200000)}` ``, `` `github.com/${'a/'.repeat(100000)}` ``, `'_www.g/o/r/'.repeat(20000)` and `'_github.com/o/r/'.repeat(15000)`.
- Add a test, `neutralize: back-to-back www. and bare github.com references are all removed in one pass`. It asserts `value === ''` with `elapsed < 500` for both `'www.g/o/r/issues/5'.repeat(11000)` and `'github.com/o/r/issues/5'.repeat(9000)`.
- Keyword-chain test: the expected value becomes `''`, and its name becomes `neutralize: a keyword chain before a marker token goes in one pass`.

- [ ] **Step 6: Prove each new perf case goes red with its guard reverted**

Run: `npm run test:perf` → PASS.
Then revert the guards one at a time, re-run, and restore the file in the same step:
- `[\d_](?!www\.)` becomes `[\d_]`: expect the `_www.`, `1www.` and `_www.a` shapes to blow their budget.
- `\d` is removed from the boundary class: expect the new back-to-back test to blow its budget.

Quote the timings in the commit body.

- [ ] **Step 7: Update the 5218 journey's step 3 sentence (Files list above)**

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/driver/events.js tests/bin-lib/driver/run.test.js perf/driver-neutralize-linearity.test.js docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md
git commit -m "Remove www. and bare github.com issue URLs in neutralize — linear boundary and domain guard (refs #5352)"
```
