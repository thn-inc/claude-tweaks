# Driver neutralize: www. URLs and host-free issue paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `neutralize()` removes every issue/PR reference GitHub renders from a URL or path, in linear time. That covers `www.` URLs on any host, with or without a port; bare `github.com/` URLs; and the host-free `owner/repo/issues/N` (or `/pull/N`) path that GitHub reads as a reference whatever precedes it.

**Architecture:** `plugin/bin/lib/driver/events.js` changes in two places.
- `URL_REF` gains two host alternatives, `www.` and bare `github.com`, which share its path and tail grammar.
- A new `PATH_REF` runs once after the fixed-point loop and before the comment-opener escape. Run inside the loop, it would take the path out of a URL that the next pass removes whole: `h#7ttps://…` would leave `https://github.com/`.

Linearity rests on three guards:
- the `www.`/bare-host and path boundaries admit a digit, so back-to-back references go in one pass;
- a `www.` domain cannot run past a later `www.` start;
- the `PATH_REF` owner and repo are length-bounded (39 and 100, GitHub's own limits), so each start scans a bounded span.

`removeKeywordsBeforeReferences` is unchanged: its `/issues/N` marker already covers every new form.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-13T093429-spec-5352/work/5352-spec.md` (record #5352). Its `## Plan Review Clarifications` section records the GitHub-renderer probe this plan rests on.

## Global Constraints

- `neutralize('Closes www.github.com/o/r/issues/5 now')` returns `now`; `neutralize('see github.com/o/r/pull/7')` returns `see`.
- Every case in `perf/driver-neutralize-linearity.test.js` passes its budget under `npm run test:perf`, including new cases of at least 100k characters for each added URL form.
- `node --test tests/bin-lib/driver/*.test.js` passes.
- Wall-clock assertions live only in `perf/`, never `tests/` (`tests/wall-clock-budget-conformance.test.js`).
- Long perf outputs are asserted with `assert.ok(value === expected, …)` and a length-only message.
- Mutation proofs (reverting a guard to watch a test go red) run in a scratch extraction (`git archive HEAD plugin perf tests package.json | tar -x -C {scratch}`), never by editing the worktree.

Governing skills, quoted verbatim:

- `regex-scan-linearity` (Project Conventions): "The file header names the record, says it is deliberately not part of `npm test`, gives `Run with: npm run test:perf`, and lists each shape found with its pre-fix time." / "Assert the verdict as well as the time, as the #3412 and #4581 files do, so a fix that changes the answer is caught." / "Each case goes red when its fix is reverted. Prove it once by reverting."
- `regex-scan-linearity` (Key Patterns): "Any rule that refuses a match until the previous removal has run makes that loop quadratic."
- `fact-validated-narration`: "Test a neutralizer against each hostile shape glued to every allowed neighbouring character (`-`, `.`, `_`, `(`, a letter, the start of the string), not only after a space. The test must go red when the boundary is narrowed back." / "Test each removal against an input built so that removing it forms the next shape (the `#5269 AC2` rebuilt-reference …)"
- `driver-step-addition` and `headless-worker-launch` name `neutralize` only as the filter that consumers must call. This change keeps its signature and adds no step, so none of their rules apply.

## Review Focus

1. A path inside a scheme URL that GitHub does not autolink, `Closes xhttps://github.com/o/r/issues/5 now`. GitHub still renders its path as a reference on a real repo, so the output is `xhttps://github.com/ now`. This flips a #5269 pin that was probed against a repo that does not exist.
2. A rebuilt URL loses the whole URL, not only its path: `Add the loop, Closes h#7ttps://github.com/o/r/issues/5 now` stays `Add the loop, now`. This is why `PATH_REF` runs after the loop.
3. The length bounds track GitHub's limits. A 39-character owner or a 100-character repo is removed; a 40-character owner or a 101-character repo stays.
4. An `_` before the owner stops the path reference, as GitHub does: `x _o/r/issues/5 y` is unchanged.
5. A `PATH_REF` removal never splices a comment opener: `a <!o/r/issues/5-- hidden` becomes `a <! -- hidden`.

---

### Task 1: Remove www. URLs and host-free issue paths

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/driver/events.js:101-106` (the `URL_REF` comment and constant, plus a new `PATH_REF` right after it), `:168-177` (the fixed-point loop comment), `:191-205` (`neutralize`)
- Modify: `tests/bin-lib/driver/run.test.js:84-102` (AC2), `:131-154` (AC3), plus two new tests after AC3
- Modify: `perf/driver-neutralize-linearity.test.js` (header lines 33-47, the `www.` shapes test, the keyword-chain test, and one new test)
- Modify: `docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md`, step 3. Its sentence "A `www.` or bare `github.com` issue URL stays in the subject, though a keyword before it still goes." becomes: "A `www.` issue or PR URL, a bare `github.com/` one, and any `owner/repo/issues/N` or `/pull/N` path go too."

Behavior-change prose sweep (`git grep -i -E "bare .?github\.com|www\.(github|ghe|g/)|URL_REF"`). Everything it finds outside the files above needs no change:
- `.claude/skills/regex-scan-linearity/SKILL.md:45` gives #5269's pre-fix history; wrap-up's skill curation adds #5352's shapes.
- `tests/bin-lib/driver/run.test.js:25` (`LEFTOVER_KEYWORD_REFERENCE`) already covers `github.com/`.
- `docs/superpowers/plans/2026-11-13-driver-neutralize-keyword.md` is #5269's historical plan.
- The hits in `gh-api-module-pattern` and `repo-resolve` are about repo slugs, not neutralize.
- `tests/bin-lib/driver/settle.test.js:729-737` pins `reduceDetail`'s `www.` split for non-issue URLs, which this change does not touch.

**Interfaces:**
- Consumes: nothing new.
- Produces: `URL_REF` keeps its name and its `gi` flags. A new module-private `PATH_REF` (flags `gi`). `neutralize(text: string) => string` keeps its signature.

- [ ] **Step 1: Write the failing tests (AC1.1) in `tests/bin-lib/driver/run.test.js`**

In `#5269 AC2: a closing keyword before a reference loses both`, make three changes:
- Line 90's `xhttps` assertion expects `'xhttps://github.com/ now'`. In the comment above it (lines 86-87), add that GitHub reads the `owner/repo/issues/N` path inside a scheme URL it does not autolink as a reference, so the path goes.
- Replace the "Non-scheme URL forms stay as backlinks" comment and its three assertions with:

```js
  // www. URLs on any host and bare github.com URLs go too (#5352).
  assert.equal(neutralize('Closes www.github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Closes github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Closes www.ghe.example.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('see github.com/o/r/pull/7'), 'see');
```

- Make the three chain assertions:

```js
  assert.equal(neutralize('Fixes fixes: www.github.com/o/r/issues/5 now'), 'now');
  assert.equal(neutralize('Fix the fix www.github.com/o/r/issues/5 now'), 'Fix the now');
  assert.equal(neutralize('fix fix the www.github.com/o/r/issues/5'), 'fix fix the');
```

In AC3, add `'o/r/issues/5'` to `refs`. Then delete the `www.`/`github.com` branch of `expected` (line 147) and update the comment on lines 144-145: every reference goes, and `_https://…` keeps its `_`.

After AC3, add `#5352: www. and bare github.com URLs go where GitHub links them`:

```js
  assert.equal(neutralize('(www.github.com/o/r/issues/5)'), '()');
  assert.equal(neutralize('www.github.com/o/r/issues/5.'), '.');
  assert.equal(neutralize('x WWW.GitHub.com/o/r/issues/5 y'), 'x y');
  assert.equal(neutralize('see www.github.com/o/r/issues/5#issuecomment-1 x'), 'see x');
  assert.equal(neutralize('x www.github.com:443/o/r/issues/5 y'), 'x y');
  // Back-to-back references go in the first pass: the boundary admits a digit.
  assert.equal(neutralize('www.g/o/r/issues/5www.g/o/r/issues/6'), '');
  assert.equal(neutralize('github.com/o/r/issues/5github.com/o/r/pull/6'), '');
  // Glued to each neighbour: the whole URL goes after GitHub's www-autolink boundary (plus a digit);
  // anywhere else only its path goes.
  for (const host of ['www.github.com', 'github.com']) {
    const ref = `${host}/o/r/issues/5`;
    for (const n of ['_', '(', '*', '~', '1']) assert.equal(neutralize(`x ${n}${ref} y`), `x ${n} y`, n + ref);
    for (const n of ['-', '.', 'a', '/', ':']) assert.equal(neutralize(`x ${n}${ref} y`), `x ${n}${host}/ y`, n + ref);
  }
  // A removal that rebuilds one of these forms is removed too.
  assert.equal(neutralize('Add Closes w#7ww.github.com/o/r/issues/5 now'), 'Add now');
  assert.equal(neutralize('Add Closes gith#7ub.com/o/r/pull/5 now'), 'Add now');
```

and `#5352: a host-free owner/repo/issues/N path goes whatever precedes it`:

```js
  assert.equal(neutralize('x o/r/issues/5 y'), 'x y');
  assert.equal(neutralize('x thn-inc/claude-tweaks/pull/5285 y'), 'x y');
  for (const host of ['example.com', 'gist.github.com', 'github.com:443', 'xhttps://github.com']) {
    assert.equal(neutralize(`x ${host}/o/r/issues/5 y`), `x ${host}/ y`, host);
  }
  for (const n of ['-', '.', '/', ':', '(']) assert.equal(neutralize(`x ${n}o/r/issues/5 y`), `x ${n} y`, n);
  // A letter or digit before the owner joins it; an underscore stops the reference, as on GitHub.
  for (const n of ['a', '1']) assert.equal(neutralize(`x ${n}o/r/issues/5 y`), 'x y', n);
  assert.equal(neutralize('x _o/r/issues/5 y'), 'x _o/r/issues/5 y');
  // GitHub's length limits: an owner of at most 39 characters, a repo of at most 100.
  assert.equal(neutralize(`x ${'a'.repeat(39)}/r/issues/5 y`), 'x y');
  assert.equal(neutralize(`x ${'a'.repeat(40)}/r/issues/5 y`), `x ${'a'.repeat(40)}/r/issues/5 y`);
  assert.equal(neutralize(`x a/${'r'.repeat(100)}/issues/5 y`), 'x y');
  assert.equal(neutralize(`x a/${'r'.repeat(101)}/issues/5 y`), `x a/${'r'.repeat(101)}/issues/5 y`);
  assert.equal(neutralize('x o/r/issues/5o/r/pull/6 y'), 'x y');
  assert.equal(neutralize('Closes o/r/issues/5 now'), 'now');
  // Run after the loop, the path pass neither eats a rebuilt URL's path nor splices a comment opener.
  assert.equal(neutralize('Add the loop, Closes h#7ttps://github.com/o/r/issues/5 now'), 'Add the loop, now');
  assert.equal(neutralize('a <!o/r/issues/5-- hidden'), 'a <! -- hidden');
```

- [ ] **Step 2: Run and see the new assertions fail**

Run: `node --test tests/bin-lib/driver/run.test.js`
Expected: FAIL in AC2, AC3 and both #5352 tests (for example, actual `'www.github.com/o/r/issues/5 now'` against expected `'now'`).

- [ ] **Step 3: Widen `URL_REF`, add `PATH_REF`, and run it after the loop in `plugin/bin/lib/driver/events.js`**

The regexes are the design, so they are given exactly. Each is one literal:

```js
const URL_REF = /(?:(?<![A-Za-z])https?:\/\/[^\s/]+|(?<![^\s*_~(\d])(?:www\.(?:[A-Za-z.-]|[\d_](?!www\.))+(?::\d+)?|github\.com))\/[^\s/]+\/[^\s/]+\/(?:issues|pull)\/\d+(?:[/#?]\S*[^\s)\].,;:!?'">])?/gi;
const PATH_REF = /(?<![A-Za-z_])[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}\/(?:issues|pull)\/\d+/gi;
```

In `neutralize`, insert `.replace(PATH_REF, ' ')` between `removeReferencesToFixedPoint(firstPass)` and `.replace(COMMENT_OPENER, …)`. Both removal chains stay as they are.

Rewrite the comment above `URL_REF`. Keep the scheme sentences, and replace "Other URL forms … are not removed here" with:
- A `www.` URL (any host, optional port) and a bare `github.com` URL start where GitHub's www-autolink does: at the start, after whitespace, or after `*`, `_`, `~` or `(`. A digit is admitted too, as for the scheme: it is where the previous reference ended, so back-to-back references go in one pass instead of one per loop pass.
- A `www.` domain cannot run across a later `www.` start (`[\d_](?!www\.)`). Without that guard, every `_www.` or `1www.` in a long run rescans the run to its end.
- Each alternative scans at most its host and the path segments that follow it.

Add a comment above `PATH_REF`:
- GitHub renders `owner/repo/issues/N` (or `/pull/N`) as a reference whatever precedes it: no host, any host, or a scheme URL it does not autolink. It refuses only a word character before the owner.
- The boundary refuses letters and `_` but admits a digit, for the back-to-back reason above.
- The owner (at most 39 characters) and the repo (at most 100) are bounded at GitHub's own limits, so a long `a-a-…` or digit run is scanned a bounded span from each start.
- It runs once, after the loop. Inside the loop it would take the path out of a rebuilt URL that the next pass removes whole. Its replacement is a space, which no pattern spans, so it splices nothing; the comment opener is escaped after it.

In the fixed-point loop comment, the sentence about back-to-back URLs not peeling also covers the `www.` and `github.com` boundaries.

- [ ] **Step 4: Run the driver test suites to verify they pass (AC3.1)**

Run: `node --test tests/bin-lib/driver/*.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Update `perf/driver-neutralize-linearity.test.js`**

- Header. Replace the `www.` bullet (lines 33-35), the chain bullet's "survives the reference passes" wording (lines 39-42) and the "Dropped as no longer testing anything" paragraph (lines 45-47). The new text should say that #5352 brought back the `www.` and bare-host alternatives and added `PATH_REF`, and list each guard with its probed time when reverted:
  - no `[\d_](?!www\.)` guard: `'_www.'.repeat(40000)` about 74 s, `'1www.'.repeat(40000)` about 71 s, `'_www.a'.repeat(35000)` about 37 s;
  - no digit in the `www.`/bare-host boundary: `'www.g/o/r/issues/5'.repeat(11000)` about 16 s, `'github.com/o/r/issues/5'.repeat(9000)` about 12.5 s;
  - no `PATH_REF` length bounds: `'a-'.repeat(100000)` about 17.5 s, `'1'.repeat(200000)` about 32 s;
  - no digit in the `PATH_REF` boundary: the verdict breaks rather than the time, leaving 96,000 characters of `'o/r/issues/5'.repeat(16000)`.
  - (These are the figures re-measured against the final implementation, under load, and recorded in the perf header. The planning-time probes differed.)
- In `www. and keyword runs that match nothing stay linear and unchanged`, take out the `'www.g/o/r/issues/5'` shape. Add these, every one of which comes back unchanged: `'1www.'.repeat(40000)`, `'_www.a'.repeat(35000)`, `'_www.a:1'.repeat(25000)`, `` `www.${'a'.repeat(200000)}` ``, `` `github.com/${'a/'.repeat(100000)}` ``, `'_www.g/o/r/'.repeat(20000)`, `'_github.com/o/r/'.repeat(15000)`, `'a-'.repeat(100000)`, `'a/'.repeat(100000)` and `'o/r/issues/'.repeat(18000)`.
- Add `neutralize: back-to-back www., bare github.com and host-free references are all removed in one pass`. It asserts `value === ''` with `elapsed < 500` for `'www.g/o/r/issues/5'.repeat(11000)`, `'github.com/o/r/issues/5'.repeat(9000)` and `'o/r/issues/5'.repeat(16000)`.
- Keyword-chain test: the expected value becomes `''`, and its name becomes `neutralize: a keyword chain before a marker token goes in one pass`.
- The existing `a long digit run stays linear` case (`'1'.repeat(200000)`) is now also the `PATH_REF` length-bound guard. Add that to the case's message.

- [ ] **Step 6: Run the perf tests and verify each guard's case goes red when reverted (AC2.1)**

Run: `npm run test:perf` → PASS.
Then, in a scratch extraction (Global Constraints), revert one guard at a time and re-run the perf file there:
- `[\d_](?!www\.)` becomes `[\d_]`: the `_www.`, `1www.` and `_www.a` shapes blow their budget.
- `\d` is dropped from the `www.`/bare-host boundary class: the back-to-back test blows its budget.
- `{0,38}` and `{1,100}` become `*` and `+`: the `a-` shape and the long-digit-run case blow their budget.
- `(?<![A-Za-z_])` becomes `(?<![A-Za-z0-9_])`: the back-to-back test fails its verdict.

Quote the timings in the commit body.

- [ ] **Step 7: Update the 5218 journey's step 3 sentence (Files list above)**

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/driver/events.js tests/bin-lib/driver/run.test.js perf/driver-neutralize-linearity.test.js docs/journeys/drive-a-named-record-to-a-draft-pr-5218.md
git commit -m "Remove www. URLs and host-free issue paths in neutralize — linear boundaries, domain guard, length bounds (refs #5352)"
```
