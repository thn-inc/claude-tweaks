# Code-health below-floor digest findings (#3903) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three unambiguous code-health candidate-generator findings (literal-blind `normalizeBranch`, non-DB `unbounded-pool`, module-scope-object `per-request-db-client`) plus the computed-key half of the `findMany` finding, and record a disposition for all nine promoted digest findings.

**Architecture:** Promote the #3585 literal-aware comment stripper from `tests/helpers/strip-comments.js` into `plugin/bin/lib/strip-comments.js` (the test helper re-exports it), then make experiment-cleanup's `normalizeBranch` call it. In scale-readiness, gate the `unbounded-pool` check on a declared `DATA_DEPS` dependency, replace the brace-depth count behind `per-request-db-client` with a brace-stack classifier that treats object-literal braces as module scope, and let a computed string-literal `['take']` key bound a list query. The needs-human-decision items are staged for the Review Console, not decided.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-28T231420-record-3903/work/3903-spec.md`

Scope keywords: normalizeBranch, strip-comments, unbounded-pool, per-request-db-client, hasTopLevelLimit, braceDepthAt

## Global Constraints

- Plugin code under `plugin/bin/` requires only Node builtins and files inside `plugin/` (`tests/payload-boundary.test.js`); the promoted stripper requires only `node:vm`.
- Governing skill `bin-source-scan-conformance` (verbatim): "`tests/helpers/strip-comments.js` is imported by the source-scan conformance suites. Moving it must keep every existing import path working, or the conformance suites lose their stripper silently." (spec Gotchas) and "Fixing a stripper defect means editing the helper and adding the planted case to `tests/helpers-strip-comments.test.js`. Every scan picks the fix up."
- Governing skill `bin-source-scan-conformance` (verbatim): "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15. `tests/strip-comments-callers-twin.test.js` pins both to the tree". No task adds a new caller suite; the header's caller-list sentence (anchor `by test-file stem:`, ending at its first `.`) must stay byte-identical in its names.
- Governing skill `code-health-focus-vertical` pitfall 1 (verbatim): "Import shared helpers from `./source-scan`, never from a sibling vertical." The stripper is required as `require('../strip-comments')`, not from a sibling `candidates-*.js`.
- Governing skill `code-health-focus-vertical` pitfall 6 (verbatim): "A regex in a generator that can match the same text more than one way must be linear."
- Spec Gotcha (verbatim): "Candidate generators are screens that the judge filters afterwards. A fix that over-narrows a pattern trades a false positive for a missed real finding, so pair every exclusion with a still-flagged positive case."
- Spec Gotcha (verbatim): "Five of the nine items were deferred as needs-human-decision. A headless build must stage those rulings rather than settle them; only the three mechanical fixes are unambiguous."
- `STRIPPER_VERDICT_MESSAGES` text stays byte-identical: `tests/git-status-optional-locks.test.js:121`, `tests/windows-hide-spawn-conformance.test.js:151,153` and `tests/path-guard-conformance.test.js:196` pin it.
- Hand-written commit messages: `{Verb} {what} — {detail}`, reference the record as `refs #3903`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_01CcCLFsxPTfvN6CxgUbjKPy`.

## Review Focus

1. A branch body whose only `//` is inside a URL string (`fetch("https://a.example")` vs `fetch("https://b.example")`) — the realistic way the old stripper produced a false `identical-branches` signal; Task 2's generator-level test pins it.
2. A module-scope object literal passed as a call argument (`app.use(makeRouter({ db: new PrismaClient() }))`) runs once and must not flag, while the same literal inside a handler must still flag; Task 3's AC4.1 test pins both.
3. A repo that declares a DB dependency and also builds an undici `new Pool(` still flags the undici pool (the gate is repo-level); Task 3's Coverage text discloses it rather than a test hiding it.
4. A computed key holding a variable (`{ [key]: 10 }`) must stay unbounded — only a quoted literal `['take']` bounds; Task 4's test pins the variable case.
5. The stripper's own source, now under `plugin/bin/`, is walked by `tests/helpers-strip-comments.test.js`'s AC2.1/AC3.1 plugin/bin sweeps and by every source-scan conformance suite; Task 1's verification runs those suites.

---

### Task 1: Promote the comment stripper into plugin/bin/lib

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/strip-comments.js` (the full implementation, moved from the test helper)
- Modify: `tests/helpers/strip-comments.js` (becomes header comment + re-export)
- Modify: `tests/helpers-strip-comments.test.js:325-333` (AC4.1 reads the implementation file; new re-export test)
- Modify: `.claude/skills/bin-source-scan-conformance/SKILL.md` (lines 36, 105 and 127: point "edit the helper" at the implementation)
- No change (classified): the source-scan suites that `require('./helpers/strip-comments')` (`tests/*-conformance.test.js`, `tests/git-status-optional-locks.test.js`, `tests/hooks-harness-refusal.test.js`, `tests/bin-lib/**`), `tests/strip-comments-callers-twin.test.js`, and the journeys under `docs/journeys/` that cite `tests/helpers/strip-comments.js` — the helper path keeps existing and re-exports, and the verdict messages still point at it
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md:296-299` (item 15's first sentences name where the implementation lives; the caller list from the anchor `by test-file stem:` to its first `.` is untouched)
- Modify: `docs/plugin-structure.md` (one line for the new single-file module, beside the other `plugin/bin/lib/*.js` entries near line 73)

**Interfaces:**
- Produces: `plugin/bin/lib/strip-comments.js` exporting `{ stripComments(src: string, opts?: { literals?: 'keep'|'blank' }): string, stripperVerdict(raw: string, stripped?: string): 'ok'|'misparsed'|'unparseable', STRIPPER_VERDICT_MESSAGES: { misparsed: string, unparseable: string } }` — identical behavior to today's helper.
- Produces: `tests/helpers/strip-comments.js` whose `module.exports` is the very object `require('../../plugin/bin/lib/strip-comments')` returns.

- [ ] **Step 1: Write the failing test** — append to `tests/helpers-strip-comments.test.js`, and change the existing AC4.1 test to read `path.join(REPO_ROOT, 'plugin', 'bin', 'lib', 'strip-comments.js')` instead of `path.join(__dirname, 'helpers', 'strip-comments.js')` and to be named `'AC4.1: the implementation requires only node: built-ins'`:

```js
test('#3903 AC2.1: the test helper re-exports the plugin/bin/lib implementation — one implementation', () => {
  const lib = require('../plugin/bin/lib/strip-comments');
  const helper = require('./helpers/strip-comments');
  assert.equal(helper, lib);
  assert.equal(typeof lib.stripComments, 'function');
  const helperText = readText(path.join(__dirname, 'helpers', 'strip-comments.js'));
  const required = [...helperText.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.deepEqual(required, ['../../plugin/bin/lib/strip-comments']);
  assert.ok(!/function stripComments/.test(helperText), 'the helper must not keep a second copy of the scanner');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="AC2.1: the test helper" tests/helpers-strip-comments.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/lib/strip-comments'`

- [ ] **Step 3: Move the implementation**

Create `plugin/bin/lib/strip-comments.js` holding everything the helper holds today from `const vm = require('node:vm');` through `module.exports`, unchanged. Its header comment keeps the helper's implementation paragraphs (blanking semantics, the left-to-right scanner, regex-vs-division, Known ambiguity) and replaces the caller-list sentences with: callers reach it two ways — the source-scan conformance tests through `tests/helpers/strip-comments.js` (whose header keeps the caller list `tests/strip-comments-callers-twin.test.js` pins), and plugin code by requiring this file directly (today `plugin/bin/lib/code-health/candidates-experiment-cleanup.js`'s `normalizeBranch`, #3903). Rewrite `tests/helpers/strip-comments.js` to `'use strict';`, one contiguous `//` header block, then `module.exports = require('../../plugin/bin/lib/strip-comments');`. The header block keeps today's first five lines verbatim (through "call it in `literals: 'blank'` mode.") and adds: the implementation lives in `plugin/bin/lib/strip-comments.js` (#3903) so plugin code can call the same scanner; this file re-exports it so every test caller keeps its `./helpers/strip-comments` import path; fix a stripper defect there and add its planted case to `tests/helpers-strip-comments.test.js`. In the two `.claude/skills` files and `docs/plugin-structure.md`, change only the sentences that say where the implementation lives or where to edit it.

- [ ] **Step 4: Run the stripper suites and every caller suite**

Run: `node --test tests/helpers-strip-comments.test.js tests/strip-comments-callers-twin.test.js tests/payload-boundary.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/git-status-optional-locks.test.js tests/path-containment-conformance.test.js tests/porcelain-cwd-compare-conformance.test.js tests/raw-markdown-read-conformance.test.js tests/wall-clock-budget-conformance.test.js tests/run-liveness-callers-conformance.test.js tests/phase-exit-call-sites-conformance.test.js tests/hooks-harness-refusal.test.js tests/bin-lib/exit-code-conformance.test.js tests/bin-lib/reconcile/subprocess-timing-conformance.test.js tests/bin-lib/run-liveness/owner-pid-probe.test.js tests/bin-lib/console/staged-id-producers.test.js tests/bin-lib/console/backfill-cli.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/strip-comments.js tests/helpers/strip-comments.js tests/helpers-strip-comments.test.js .claude/skills/bin-source-scan-conformance/SKILL.md .claude/skills/parse-signal-discipline/SKILL.md docs/plugin-structure.md
git commit -m "Promote the literal-aware comment stripper into plugin/bin/lib — tests/helpers re-exports it (refs #3903)"
```

### Task 2: Make experiment-cleanup's normalizeBranch literal-aware

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-experiment-cleanup.js:90-101` (`normalizeBranch` and its comment; one Coverage bullet in the module header)
- Test: `tests/bin-lib/code-health/candidates-experiment-cleanup.test.js` (after the existing `normalizeBranch` tests near line 95, and after the identical-branches test near line 306)

**Interfaces:**
- Consumes: `stripComments` from Task 1, required as `const { stripComments } = require('../strip-comments');`
- Produces: `normalizeBranch(text: string): string` — same signature, comments blanked literal-aware, whitespace runs collapsed to one space, trimmed.

- [ ] **Step 1: Write the failing tests**

```js
test('#3903 AC1.1 AC1.3: normalizeBranch keeps a // inside a string literal, so bodies differing after it stay different', () => {
  assert.notStrictEqual(normalizeBranch('log("a//b");'), normalizeBranch('log("a//c");'));
  assert.strictEqual(normalizeBranch('fetch("https://a.example/v1");'), 'fetch("https://a.example/v1");');
});

test('#3903 AC1.2 AC1.3: normalizeBranch still treats bodies differing only in a real // comment as equal', () => {
  assert.strictEqual(normalizeBranch('doThing(); // one\n'), normalizeBranch('doThing(); // two\n'));
});

test('#3903 AC1.1: a guard whose branches differ only after a // inside a URL string is not identical-branches', () => {
  // build a tmpGitRepo with src/client.js holding:
  //   if (isEnabled('apiV2')) {\n  fetchJson("https://api-v2.example.com/items");\n} else {\n  fetchJson("https://api.example.com/items");\n}\n
  // scanExperimentCleanup(root, { patterns: [CALL_SITE_PATTERN], excludes: [] })
  // assert result.sitesMatched === 1 and result.candidates deep-equals []
});
```

The third test's body follows the existing identical-branches test's fixture shape (lines 289-306); it is the realistic, generator-level reproduction of the false positive (spec: "Use a fixture that reproduces each false positive rather than a hand-built minimal string"), and the two unit tests stay as pins of `normalizeBranch` itself.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3903" tests/bin-lib/code-health/candidates-experiment-cleanup.test.js`
Expected: FAIL after Step 1 — AC1.1 tests fail (both bodies normalize to `log("a` / `fetchJson("https:`); the AC1.2 test passes already (it guards the comment side of the change).

- [ ] **Step 3: Implement `normalizeBranch(text)`** as `stripComments(text)` followed by the existing whitespace collapse and trim. Update its comment to say comments are blanked by the shared literal-aware scanner (`plugin/bin/lib/strip-comments.js`), so a `//` or `/*` inside a string, template or regex literal stays code. Add one Coverage bullet: branch comparison is literal-aware, while the brace match that finds the branches (`matchBrace`) is not — a `}` inside a string can end a branch early.

- [ ] **Step 4: Run tests to verify they pass, and prove AC1.4**

Run: `node --test tests/bin-lib/code-health/candidates-experiment-cleanup.test.js tests/bin-lib/code-health/candidates-require-order.test.js`
Expected: PASS. Then temporarily restore the two old `.replace` comment regexes in `normalizeBranch`, re-run the first command with `--test-name-pattern="#3903 AC1.1"`, see it FAIL, and restore the fix (AC1.4).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-experiment-cleanup.js tests/bin-lib/code-health/candidates-experiment-cleanup.test.js
git commit -m "Make normalizeBranch literal-aware — a // inside a string no longer truncates a compared branch (refs #3903)"
```

### Task 3: Gate unbounded-pool on a DB dependency and skip module-scope object-literal clients

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-scale-readiness.js:131-141` (Coverage bullets for `per-request-db-client` and `unbounded-pool`), `:794-804` (`braceDepthAt` replaced), `:813-842` (`scanPooling`)
- Modify: `plugin/skills/_shared/criteria-scale-readiness.md:49-50` (What NOT to flag bullets reworded; both keep the words `module-scope` and `generic-pool` that `tests/code-health-scale-readiness-wiring.test.js:99-101` pins)
- Test: `tests/bin-lib/code-health/candidates-scale-readiness.test.js` (after the existing pooling tests near line 601)

**Interfaces:**
- Consumes: `DATA_DEPS` (module constant, line 186) and `ctx.deps` (a `Set` of every declared dependency name).
- Produces: `insideNonObjectBrace(text: string, idx: number): boolean` (module-private, replaces `braceDepthAt`) — scans `text[0, idx)` keeping a stack of open braces; a `{` is an object-literal brace when the previous non-whitespace character is one of `=` `(` `,` `:` `[` `?`, or the previous word is `default`; every other `{` (after `)`, `=>`, an identifier, `}` …) is a block brace; `}` pops when the stack is non-empty. Returns true when any brace on the stack is a block brace.

- [ ] **Step 1: Write the failing tests**

```js
test('#3903 AC3.1 AC3.2: unbounded-pool skips non-DB pools when no DB dependency is declared; a pg Pool still flags', () => {
  const nonDb = repoWith({ express: '^4', 'generic-pool': '^3', undici: '^6', workerpool: '^9' }, {
    'routes/health.js': "module.exports = (req, res) => res.send('ok');\n",
    'lib/pools.js': [
      "const genericPool = require('generic-pool');",
      "const { Pool } = require('undici');",
      'const workers = genericPool.createPool(factory, { min: 2 });',
      "const upstream = new Pool('http://localhost:3000');",
      '',
    ].join('\n'),
  });
  assert.equal(ofKind(nonDb, 'unbounded-pool').length, 0);
  assert.match(scanScaleReadiness(nonDb).checklist.find((x) => x.id === 'pooling').evidence, /no database dependency/);
  const pg = repoWith({ express: '^4', pg: '^8' }, {
    'routes/health.js': "module.exports = (req, res) => res.send('ok');\n",
    'lib/db.js': "const { Pool } = require('pg');\nconst pool = new Pool({ connectionString: process.env.DATABASE_URL });\n",
  });
  assert.deepEqual(ofKind(pg, 'unbounded-pool').map((c) => c.file), ['lib/db.js']);
});

test('#3903 AC4.1: a client held in a module-scope object literal is not per-request; one inside a handler still is', () => {
  const root = repoWith({ express: '^4', '@prisma/client': '^5', pg: '^8' }, {
    'routes/users.js': "const { PrismaClient } = require('@prisma/client');\nmodule.exports = { db: new PrismaClient() };\n",
    'routes/orders.js': [
      'const deps = { db: new PrismaClient(), cache: new Map() };',
      'app.use(makeRouter({ db: new PrismaClient() }));',
      'export default { pool: new Pool({ max: 5 }) };',
      '',
    ].join('\n'),
    'routes/items.js': "router.get('/', async (req, res) => {\n  const deps = { db: new PrismaClient() };\n  res.json(await deps.db.item.findMany({ take: 5 }));\n});\n",
  });
  assert.deepEqual(ofKind(root, 'per-request-db-client').map((c) => c.evidence.match(/^(\S+:\d+) /)[1]), ['routes/items.js:2']);
});
```

`repoWith` and `ofKind` are the file's existing helpers. Realistic fixtures (spec: "Use a fixture that reproduces each false positive rather than a hand-built minimal string"; plan review row 5): the implementer may expand each fixture file into a whole realistic module — a `lib/pools.js` setup module shaped like the `generic-pool` and `undici` README examples (factory object with `create`/`destroy`, `module.exports`), and Express router files that `require('express')`, build `express.Router()` and export it — as long as the asserted candidate list (exact `file:line` values, recomputed for the expanded files) and the still-flagged positive cases stay.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3903" tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: FAIL after Step 1 — AC3.1 finds 2 `unbounded-pool` candidates (the `createPool(` and the undici `new Pool(`); AC4.1 also lists `routes/users.js:2`, `routes/orders.js:1`, `routes/orders.js:2` and `routes/orders.js:3`.

- [ ] **Step 3: Implement** `insideNonObjectBrace` per the Interfaces block and call it in `scanPooling` in place of `braceDepthAt(text, m.index) <= 0`. In `scanPooling`, compute once `const dbDep = [...ctx.deps].some((d) => DATA_DEPS.has(d));` and run the `POOL_CHECKS` loop only when it is true; the `pooling` pass evidence then reads `` `${routeChecked} route file(s) checked for per-request clients, ${ctx.sourceTexts.length} source file(s) checked for uncapped pools` `` when `dbDep`, else `` `${routeChecked} route file(s) checked for per-request clients; uncapped-pool check skipped — no database dependency declared` ``. Rewrite the two Coverage bullets to state the new rules and their limits: the brace classifier has no string or comment awareness; a module-scope `if`/`try` block or IIFE reads as a handler; a parameter-default object (`function f(o = { db: new X() })`) reads as module scope; the pool gate is repo-level, so in a repo that declares a database dependency a non-database `Pool` class still matches; and the gate reads only `DATA_DEPS`, so a pool from a database driver that list does not name (`mariadb`, `pg-pool`, `oracledb`) is skipped as non-database (plan review row 3 — keep the spec's `DATA_DEPS` gate, disclose the miss). Reword `criteria-scale-readiness.md` line 49 to: a client built once at module scope inside a block the generator reads as a function body (a top-level `if (!globalThis.prisma) { … }` singleton guard, a module-scope IIFE); a client held in a module-scope object literal is already skipped. Reword line 50 to: a non-database `Pool` class (`generic-pool`, `undici`, `workerpool`) in a repo that also declares a database dependency — with none declared the generator skips the check — plus the existing serverless-pooling clause.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js tests/code-health-scale-readiness-wiring.test.js tests/bin-lib/code-health/candidates-require-order.test.js`
Expected: PASS, 0 failures (the existing `per-request-db-client` tests at lines 516-560 and `unbounded-pool` tests at lines 563-601 included). Then temporarily restore `braceDepthAt(text, m.index) <= 0` and remove the `dbDep` gate, re-run the `#3903` pattern, see both tests FAIL, and restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-scale-readiness.js plugin/skills/_shared/criteria-scale-readiness.md tests/bin-lib/code-health/candidates-scale-readiness.test.js
git commit -m "Gate unbounded-pool on a DB dependency and skip module-scope object-literal clients — scale-readiness false positives (refs #3903)"
```

### Task 4: Let a computed string-literal take/limit key bound a list query

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/code-health/candidates-scale-readiness.js:579-588` (`hasTopLevelLimit`), `:101-110` (Coverage bullet)
- Modify: `plugin/skills/_shared/criteria-scale-readiness.md:44` (What NOT to flag: add a `take` arriving through a spread `{ ...opts }`)
- Test: `tests/bin-lib/code-health/candidates-scale-readiness.test.js` (after the existing `unbounded-list-query` tests near line 329)

**Interfaces:**
- Produces: `hasTopLevelLimit(args: string): boolean` — also true for a top-level segment `[ 'take' ]: …` / `["limit"]: …` / `` [`take`]: … `` (quoted literal inside the brackets, same quote on both sides); a computed identifier key (`[key]: …`) stays false.

- [ ] **Step 1: Write the failing test**

```js
test('#3903 unbounded-list-query: a computed string-literal take/limit key bounds the call; a computed variable key does not', () => {
  const root = repoWith({ express: '^4', '@prisma/client': '^5' }, {
    'routes/posts.js': [
      "const a = await prisma.post.findMany({ ['take']: 10 });",
      'const b = await prisma.post.findMany({ ["limit"]: 10 });',
      'const c = await prisma.post.findMany({ [key]: 10 });',
      '',
    ].join('\n'),
  });
  assert.deepEqual(ofKind(root, 'unbounded-list-query').map((c) => c.evidence.match(/^(\S+:\d+) /)[1]), ['routes/posts.js:3']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="computed string-literal" tests/bin-lib/code-health/candidates-scale-readiness.test.js`
Expected: FAIL after Step 1 — lines 1, 2 and 3 are all flagged.

- [ ] **Step 3: Implement** the computed-literal alternative in `hasTopLevelLimit`'s segment regex — linear, with a backreference for the matching quote (pitfall 6). Add one sentence to the Coverage bullet: a `take`/`limit` key spelled as a computed string literal bounds the call; one arriving through a spread or a computed variable key does not. Add the spread case to fragment line 44's `findMany(args)` clause.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/code-health/candidates-scale-readiness.test.js tests/code-health-scale-readiness-wiring.test.js`
Expected: PASS, 0 failures. Then temporarily revert the regex change, re-run Step 2's command, see it FAIL, and restore.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/code-health/candidates-scale-readiness.js plugin/skills/_shared/criteria-scale-readiness.md tests/bin-lib/code-health/candidates-scale-readiness.test.js
git commit -m "Accept a computed string-literal take key as a list bound — scale-readiness unbounded-list-query (refs #3903)"
```

### Orchestrator step (not dispatched): dispositions for all nine findings (AC5.1)

Run by the `/build` orchestrator after Task 4, from the worktree root. The spec allows a decision item exactly two outcomes — "the build either implements a fix with tests or records a one-line won't-fix or keep-deferred ruling with its reason" — so every staged ruling below is worded as keep-deferred or won't-fix, with any suggested fix carried as a note, never as the ruling itself (plan review row 1). Ratifying one keeps it deferred; a human who wants the noted fix reverses the ruling at the console, which files it as a follow-up.

1. For each needs-human-decision row (6, 7, 8, 9), write a temp `.md` file with the `build/dispatch.md` header block — `Title:` (the one-liner) / `Kind: sdd-ruling` / `Ruling:` (the ruling line) / `Defers: yes` / `Defer-reason: needs-human-decision` / `Staged-at:` (short HEAD sha) — a blank line, then the ruling text, its reason, the suggested-fix note, and the two dispositions (ratify / reverse). Stage it with the sanctioned command, never applied:
   `node "{plugin-root}/bin/stage-item.js" --run "$PIPELINE_RUN_DIR" --id "sdd-ruling-{N}" --file "{tmp}.md" --allocate --ledger "{ledger path}" --label "SDD ruling" --item 'SDD ruling — {one-liner}: ratify or reverse at the Review Console'`
   (`{ledger path}` is the `this-run:` path `hooks.js resolve-ledger --run "$PIPELINE_RUN_DIR"` reports.)
2. Write the settled rulings for rows 2 and 3 as `accepted` ledger rows with their reason.
3. Post the full nine-row table below as one comment on the run's draft PR (`gh pr comment {pr} --body-file {session-tmp path}`), so the closing PR states a disposition for every item (plan review row 2), and log each disposition to `decisions.md`.

| # | Finding | Disposition |
|---|---|---|
| 1 | experiment-cleanup `normalizeBranch` literal-blind | fixed — Task 1 + Task 2 |
| 2 | scale-readiness capitalized-receiver `X.find(value)` / filtered `Model.find` without `.limit` | won't-fix (accepted): telling an in-memory constant from a model needs binding resolution a text screen does not have, and a filtered `Model.find` with no `.limit` on a growing collection is a correct flag; the fragment's What NOT to flag already directs the judge |
| 3 | scale-readiness `findMany(args)` non-literal / spread / computed key | partly fixed — Task 4 (computed string-literal key); won't-fix (accepted) for a variable argument and a spread: the bound is not visible to the screen, flagging keeps recall, and the fragment tells the judge to read where `args` is built |
| 4 | scale-readiness module-scope object-literal client | fixed — Task 3 |
| 5 | scale-readiness `unbounded-pool` on non-DB pools | fixed — Task 3 (the spec names this fix as mechanical) |
| 6 | scale-readiness `window.fetch(` / `globalThis.fetch(` not matched | staged `sdd-ruling-*` — keep-deferred: server route files rarely call fetch through those receivers, and no judge rejection or missed finding has been traced to it. Note: the fix, if wanted, allows `window.`/`globalThis.`/`self.` receivers in the third-party fetch lookbehind |
| 7 | scale-readiness `isRouteFile` naming trap | staged `sdd-ruling-*` — keep-deferred until its trigger (a second caller) fires; today it has no production caller — only `tests/bin-lib/code-health/candidates-scale-readiness.test.js` imports it |
| 8 | scale-readiness Nuxt/h3/@trpc/server/Elysia read as not applicable | staged `sdd-ruling-*` — keep-deferred until its trigger (a user reports a missed framework); the miss is already disclosed as "a dependency this list does not name". Note: the fix, if wanted, adds `h3`, `@trpc/server` and `elysia` to `SERVER_DEPS`, and not `nuxt` (a static Nuxt site, like `next`, has no server work) |
| 9 | criteria fragment severity calibration | staged `sdd-ruling-*` — keep-deferred: the judge already falls back to holistic severity for the unplaced cases. Note: the calibration, if wanted, places `unbounded-pool` off-serverless at low and an AI `inline-slow-work` call on a non-user-facing route at medium, and rewords the low line to "a script whose input is bounded but not fixed-size" so it no longer reads against What NOT to flag |

## Spec coverage map

| AC | Covered by |
|---|---|
| AC1.1, AC1.2 | Task 2 tests |
| AC1.3, AC1.4 | Task 2 Steps 1 and 4 (both pinned in one test file; revert-to-red in Step 4) |
| AC2.1 | Task 1 test |
| AC3.1, AC3.2 | Task 3 test |
| AC4.1 | Task 3 test |
| AC5.1 | Orchestrator step: the nine-row table posted on the draft PR, plus staged `sdd-ruling-*` files (rows 6-9), `accepted` ledger rows (rows 2-3) and `decisions.md` |
| AC6.1 | Already satisfied — see below |
| AC7.1 | `/build` Common Step 5 full-suite run |

AC6.1 is already satisfied: all nine digest lines in #1426 (comments `6286177598` and `6286977084`) end with `→ #3903`, verified with `gh issue view 1426 --json comments` at plan time.

AC7.1: `/build` Common Step 5 runs the full suite through the verification runner.
