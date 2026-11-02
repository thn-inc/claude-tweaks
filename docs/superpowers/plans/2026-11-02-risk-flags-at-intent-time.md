# Risk Flags at Intent Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/claude-tweaks:specify` classifies work against invisible-risk categories, records the flags on the record through one sanctioned writer, and `plan-audit` fails a plan that carries no specific proof for a kept flag.

**Architecture:** One pure module (`record-risk-flags.js`) owns the `Risk-flags:` line grammar, reader and writers. A deterministic classifier plus a thin CLI (`bin/risk-flags.js`) give `/specify` its floor and its settle step; a new gating Check G in `plan-audit` reads the same line from the materialized spec. Skill prose calls the CLI and never edits the line by hand.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T092333-record-4618/work/4618-spec.md`

## Global Constraints

- Line grammar, verbatim from the spec: `Risk-flags: migrations, auth` (comma-separated lowercase slugs from the built-in set `migrations`, `auth`, `public-contract`, `irreversible-side-effect` plus policy `risk-categories`) or `Risk-flags: none` (classified, nothing flagged). Absent line = unclassified legacy record, read as no flags. A present line that is malformed or names an unknown slug is read as **unknown = all four built-in categories flagged**. Optional `Risk-flags-unconfirmed: true` marks a headless-kept flag set.
- `parseRiskFlags` is the single shared parse function returning `{ flags, status: 'ok' | 'unknown' | 'unclassified' }`, which every reader uses.
- Headless means no human is reachable: `/specify --chained`, a headless `/backlog refine`, a dispatch-bound or Routine run, or any `AskUserQuestion` that errors, times out or is auto-answered. The fail direction is always keep.
- Plan proof: one plan step contains a line `Proof(<slug>): <text>` with `<text>` at least 20 characters and not merely restating the category name.
- Removal log text, verbatim (#4619 reads it): `Risk flag {slug} removed by the maintainer during shaping`.
- `risk:low|medium|high` is the scoring axis. Never reuse that label namespace or call a flag a "risk tier".
- Control mode: `_shared/policy-schema.md` states every Control-mode key "is consulted only when it is `on`", so `risk-categories` and `risk-path-globs` are read only when `isControlModeOn` (`plugin/bin/lib/policy.js`) is true. The built-in categories, the line, the writers and Check G work regardless of control mode (spec AC1, AC4 carry no such condition); forcing the acceptance target is out of scope here (spec: "Until the consumers ship").
- `plan-audit-check-addition`, verbatim: "A check is not shipped until every row below lands in the same change." "Absent input versus unreadable input. An optional input left off the command line is a `skipped` result (`checkE: {ok: true, skipped: 'no-spec'}`). A named input that cannot be read exits 2, the same as an unreadable plan. Never fall back from the second to the first." "Normalize every text input once, at the check's entry." "A read-only verb (`--bytes`, `--count-tasks`) never runs the new check, so refuse its flag beside them." "Run `git grep -nE 'Checks? A/B' -- plugin docs` before calling the change done".
- `bin-source-scan-conformance`, verbatim: "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`". "Assert the exact flagged line numbers, not just a count". "Walking `plugin/bin` with `fs.readdirSync(dir, { recursive: true })`" is banned: use the manual `withFileTypes` walk and a floor on files walked.
- `gh-api-module-pattern/cli-wrapper-contract.md`, verbatim: "Logic lives in an exported `run(argv, deps)`; every side effect ... goes through `deps`". "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`...)". "An existence or type check goes through `plugin/bin/lib/path-guard`'s `lstatType`, never a bare `fs.existsSync`". "A file the CLI is about to read is read directly with `ENOENT`/`ENOTDIR` caught as "absent"".
- `skill-prose-conformance-tests`: read live skill text through `readText`; a negative control runs the same assertion function as the positive test against mutated text and expects it to throw.
- `plugin/skills/build/plan-authoring-checks.md` is 52,497 B, 3 B under the rail, so this plan adds no paragraph there: the `## Gotchas` bullet `appendRiskProofGotcha` writes is what tells the planner, and Check G enforces it.
- Byte headroom against `RAIL_BYTES` (52,500) at the merge base: `plugin/skills/build/SKILL.md` 52,235 (265 left); `plugin/skills/_shared/policy-schema.md` 52,198 (302 left); `plugin/skills/backlog/refine-mode.md` 43,379; `plugin/skills/_shared/work-record.md` 40,023; `plugin/skills/build/plan-audit.md` 28,567; `plugin/skills/specify/record-creation-subissues.md` 28,300; `plugin/skills/specify/spec-template.md` 28,391; `plugin/skills/specify/shaping-mode-stamping.md` 23,993; `plugin/skills/build/micro-plan.md` 7,809.
- Implementers run only the targeted suites named in their task. The full suite runs centrally. Commit messages say `refs #4618`, never `closes`.

Waived AC7.1: the full suite runs centrally at Common Step 5 and through `/claude-tweaks:test`, never inside a task.
Waived `_shared/auto-mode-contract.md`: read by Task 7's step 2 of the Risk flags section; it is cited, not changed.

## Review Focus

1. A materialized spec (YAML frontmatter, then `# {n}: title`, then metadata lines) must read the same as a raw record body: Task 1's `materialized spec shape` test.
2. CRLF bodies from GitHub: Task 1's CRLF test and Task 5's CRLF plan and spec test.
3. A later section quoting `Risk-flags: none` (a `## Original request` block, a fenced example) must not defeat a real line or read as the record's own: Task 1's section-scope and fence tests.
4. A `Proof(auth): ...` line in a fenced code block, or outside any task, must not satisfy Check G: Task 5's tests.
5. A flagged record must not bypass the audit through the trivial-plan or fast-lane skip gate, the micro-plan path, or the express lane: Task 5's `--risk-proofs` tests and Task 6's express and micro-plan tests.

## Decisions the spec leaves to the builder

- **A dropped policy slug versus an unknown slug.** The spec says a flag whose category was later dropped from policy stays flagged, and that an unknown slug reads as all four built-ins. They cannot be told apart without history, so `status: 'unknown'` returns `flags` = all four built-ins plus every well-formed slug the line named, in that order. Both spec sentences hold. `reason` is `'malformed'` or `'unknown-slug'`.
- **Unknown-slug versus could-not-parse in Check G.** A malformed flag line is `couldNotParse` and fails however many proofs exist. A well-formed line naming an unknown slug parsed fine: it requires a proof per flag in the widened list and is satisfiable.
- **The skip gate.** Check G is gating, so unlike Checks E and F it must not share Common Step 1.5's skip gate: a trivial plan or a fast-lane record would otherwise skip the proof. A new read-only verb `--risk-proofs` (requires `--spec`) runs Check G alone on that path. The micro-plan path and the express lane write no audited plan, so a flagged record is ineligible for both.
- **Logging.** `bin/risk-flags.js settle --run` appends the removal through `require('./log-decision').run` in-process (the best-effort audit-line shape `dream-scan.js` uses), reporting `logged: false` in its envelope on failure. It does not join the self-logging roster, because it never reads `append.js` directly and the skill owns the fallback.

---

### Task 1: The line grammar, reader and sanctioned writers

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/record-risk-flags.js`
- Modify: `plugin/bin/lib/issues/record.js`
- Modify: `plugin/bin/lib/issues/local-store.js`
- Test: `tests/bin-lib/issues/record-risk-flags.test.js`

**Interfaces:**
- Produces, re-exported from `record.js`:
  - `parseRiskFlags(body, { extraCategories = [] } = {}) -> { flags: string[], status: 'ok'|'unknown'|'unclassified', reason: null|'malformed'|'unknown-slug', unconfirmed: boolean, raw: string|null }`
  - `addRiskFlags(body, slugs, { unconfirmed = false, extraCategories = [] } = {}) -> string`
  - `removeRiskFlag(body, slug, { humanConfirmed, extraCategories = [] } = {}) -> string`; throws `Error` whose message starts `removeRiskFlag refused` unless `humanConfirmed === true`
  - `confirmRiskFlags(body, { humanConfirmed } = {}) -> string`; same refusal; drops the unconfirmed line; returns the body byte-identical when no marker exists
  - `appendRiskProofGotcha(body, slugs) -> string`
  - `RISK_FLAGS_NONE = 'none'`
- The scope rule: the reader looks only at the preamble: after an optional leading `---` frontmatter block, the lines before the first `## ` heading, ignoring fenced lines (`fencedLineMask` from `plugin/bin/lib/markdown-blocks.js`). Normalize `\r\n?` to `\n` on entry.
- Detection is deliberately wider than the grammar so a misspelling is malformed, never absent: any preamble line matching `/^\s*risk[-_ ]?flags\s*:/i` is a flag line. Only exactly `Risk-flags: {value}` at column 0 parses; every other spelling, an empty value, `none` beside a slug, a slug failing `/^[a-z0-9][a-z0-9-]*$/`, or two flag lines reads `status: 'unknown', reason: 'malformed'`.
- Marker: a preamble line matching `/^\s*risk[-_ ]?flags[-_ ]unconfirmed\s*:/i` sets `unconfirmed: true`, whatever its value other than exactly `Risk-flags-unconfirmed: false` (a misspelled marker fails toward caution).

- [ ] **Step 1: Write the failing test**

Tests in `tests/bin-lib/issues/record-risk-flags.test.js`:

```js
const { parseRiskFlags, addRiskFlags, removeRiskFlag, confirmRiskFlags, appendRiskProofGotcha } = require('../../../plugin/bin/lib/issues/record');
const ALL = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];
test('AC5.1: a malformed line reads all four, never no flags', () => {
  for (const line of ['Risk-flags: Auth', 'Risk-flags:', 'Risk-flags: none, auth', 'risk-flags: none', 'Risk-Flags: none', 'Risk_flags: auth', 'Risk-flags : auth']) {
    const r = parseRiskFlags(`Surface: infra\n${line}\n\n## Overview\n`);
    assert.deepStrictEqual(r.flags.slice(0, 4), ALL, line);
    assert.strictEqual(r.status, 'unknown', line);
    assert.strictEqual(r.reason, 'malformed', line);
  }
});
test('AC5.1: a line naming an unknown slug reads all four plus the named slug', () => {
  const r = parseRiskFlags('Risk-flags: auth, pii\n');
  assert.deepStrictEqual(r, { flags: [...ALL, 'pii'], status: 'unknown', reason: 'unknown-slug', unconfirmed: false, raw: 'Risk-flags: auth, pii' });
});
test('AC5.2: an absent line reads unclassified with no flags', () => {
  assert.deepStrictEqual(parseRiskFlags('Surface: infra\n\n## Overview\n').flags, []);
  assert.strictEqual(parseRiskFlags('Surface: infra\n').status, 'unclassified');
});
test('AC5.3: Risk-flags none reads ok with an empty list', () => {
  const r = parseRiskFlags('Risk-flags: none\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', []]);
});
test('AC5.4: each of the three states is pinned by name', () => {
  assert.deepStrictEqual(['Risk-flags: Bad\n', '', 'Risk-flags: none\n'].map((b) => parseRiskFlags(b).status), ['unknown', 'unclassified', 'ok']);
});
test('a policy slug is known only when passed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: pii\n', { extraCategories: ['pii'] }).status, 'ok');
});
test('materialized spec shape: frontmatter and H1 ahead of the metadata lines', () => {
  const r = parseRiskFlags('---\nrecord: 1\n---\n# 1: t\n\nSurface: infra\nRisk-flags: migrations\n\n## Overview\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', ['migrations']]);
});
test('section scope: a line under a later heading is not the record line', () => {
  assert.strictEqual(parseRiskFlags('Surface: x\n\n## Original request\n\nRisk-flags: none\n').status, 'unclassified');
});
test('fence: a fenced line in the preamble is not the record line', () => {
  assert.strictEqual(parseRiskFlags('```\nRisk-flags: none\n```\n\n## Overview\n').status, 'unclassified');
});
test('CRLF: a CRLF body parses and a writer round-trips it', () => {
  const body = 'Surface: x\r\nRisk-flags: auth\r\n\r\n## Overview\r\n';
  assert.deepStrictEqual(parseRiskFlags(body).flags, ['auth']);
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags(body, ['migrations'])).flags, ['migrations', 'auth']);
});
test('two flag lines read malformed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags: none\n').reason, 'malformed');
});
test('addRiskFlags only adds: built-in order, then extras; preserves a kept flag', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Risk-flags: auth\n', [])).flags.join(), 'auth');
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', ['auth', 'migrations'])).flags, ['migrations', 'auth']);
});
test('addRiskFlags on an unclassified body with no slugs writes Risk-flags none', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', [])).status, 'ok');
});
test('addRiskFlags never narrows a malformed line: it widens to all four', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: Auth\n', [])).flags, ALL);
});
test('addRiskFlags on Risk-flags none replaces it', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: none\n', ['auth'])).flags, ['auth']);
});
test('addRiskFlags inserts inside the metadata block, above the first heading', () => {
  assert.strictEqual(addRiskFlags('Surface: x\nUi-stack: y\n\n## O\n', ['auth']), 'Surface: x\nUi-stack: y\nRisk-flags: auth\n\n## O\n');
  assert.strictEqual(addRiskFlags('## O\n', ['auth']), 'Risk-flags: auth\n\n## O\n');
});
test('addRiskFlags unconfirmed writes the marker right below the flag line', () => {
  assert.strictEqual(addRiskFlags('Surface: x\n\n## O\n', ['auth'], { unconfirmed: true }), 'Surface: x\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n');
});
test('AC5.5: removeRiskFlag without humanConfirmed true refuses', () => {
  for (const opts of [undefined, {}, { humanConfirmed: false }, { humanConfirmed: 'true' }, { humanConfirmed: 1 }]) {
    assert.throws(() => removeRiskFlag('Risk-flags: auth\n', 'auth', opts), /removeRiskFlag refused/);
  }
});
test('removeRiskFlag drops one flag, writes none for the last, clears the marker', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', 'auth', { humanConfirmed: true }), 'Risk-flags: migrations\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n', 'auth', { humanConfirmed: true }), 'Risk-flags: none\n');
});
test('confirmRiskFlags refuses without humanConfirmed, clears the marker with it', () => {
  assert.throws(() => confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n'), /refused/);
  assert.strictEqual(confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n', { humanConfirmed: true }), 'Risk-flags: auth\n');
});
test('local-files parity: the flag lines survive writeRecord and readRecord', () => {
  // writeRecord + readRecord in a tmp dir; parseRiskFlags(readRecord(p).body) deep-equals parseRiskFlags(body).
});
test('appendRiskProofGotcha names each slug, is idempotent, widens in place, creates the section', () => {
  const once = appendRiskProofGotcha('## Gotchas\n\n- a\n', ['auth']);
  assert.match(once, /Proof\(auth\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth']), once);
  assert.match(appendRiskProofGotcha(once, ['auth', 'migrations']), /Proof\(migrations\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth', 'migrations']).match(/Risk proof required/g).length, 1);
  assert.match(appendRiskProofGotcha('## Overview\n\nx\n', ['auth']), /## Gotchas\n\n- Risk proof required/);
  assert.match(appendRiskProofGotcha('## Gotchas\n\n- a\n\n## Original request\n\nb\n', ['auth']), /Risk proof required[^\n]*\n\n## Original request/);
  assert.strictEqual(appendRiskProofGotcha('## O\n', []), '## O\n');
});
```

Write the local-files parity test body, using `local-store.js`'s `writeRecord` and `readRecord` in an `fs.mkdtempSync` dir.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/record-risk-flags.test.js`
Expected: FAIL with `parseRiskFlags is not a function`

- [ ] **Step 3: Implement `record-risk-flags.js` and re-export it from `record.js`**

The bullet `appendRiskProofGotcha` writes starts with the literal `- Risk proof required:` and reads: `- Risk proof required: this record carries kept risk flags, so one plan step must contain, per slug, a line \`Proof(<slug>): <text>\` with a specific proof of at least 20 characters. Slugs: \`auth\`, \`migrations\`.` It is one bullet, replaced in place when the slug list grows. Placement: end of the `## Gotchas` section; when none exists, a new `## Gotchas` section before `## Breaking Change` or `## Original request`, else at the end of the body. Builtins come from `BUILTIN_RISK_CATEGORIES` in `plugin/bin/lib/policy-schema.js`. Writers preserve the body's line ending when it is uniformly CRLF. `record.js` keeps its aggregator shape; add the sub-module to its header list. Add one sentence to `local-store.js`'s header comment naming `Risk-flags:` as a body line carried in `body`, never a `facets` key, because `parseRiskFlags` reads it for both backends.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/record-risk-flags.test.js tests/bin-lib/issues/record.test.js tests/bin-lib/issues/local-store.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/record-risk-flags.js plugin/bin/lib/issues/record.js plugin/bin/lib/issues/local-store.js tests/bin-lib/issues/record-risk-flags.test.js
git commit -m "Add Risk-flags line grammar and sanctioned writers — refs #4618"
```

### Task 2: The one-writer source scan

**Role:** integration

**Files:**
- Create: `tests/risk-flags-writer-conformance.test.js`
- Modify: `tests/helpers/strip-comments.js`
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md`

**Interfaces:**
- Consumes: Task 1's module path. Exports `findWriterOffenders(relPath, rawSource) -> [{line, reason}]` for the self-test, inside the test file.
- The scan's rules, over keep-mode `stripComments` text, walking `plugin/bin/**/*.js` with `withFileTypes`:
  - A string, template or regex literal holding `Risk-flags` (case-insensitive) is a `line-literal` offender anywhere except `plugin/bin/lib/issues/record-risk-flags.js`.
  - A call or reference to `removeRiskFlag` or `confirmRiskFlags` is a `remover` offender except in `record-risk-flags.js`, `record.js` (re-export) and `plugin/bin/risk-flags.js` (the CLI, Task 4).
  - `stripperVerdict` other than `ok` is an offender.

- [ ] **Step 1: Write the failing test**

```js
test('AC5.6: the tree has one writer of the Risk-flags line', () => {
  const { offenders, files, sites } = scanTree();
  assert.deepStrictEqual(offenders, []);
  assert.ok(files > 300, `walked only ${files} files: the walk broke`);
  assert.ok(sites >= 3, `matched only ${sites} sites: the matcher stopped matching`);
});
test('AC5.6: a planted second writer is flagged at its exact line', () => {
  const planted = "const a = 1;\nconst body2 = `Risk-flags: ${x}`;\n";
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', planted).map((o) => [o.line, o.reason]), [[2, 'line-literal']]);
});
test('AC5.6: a planted remover call is flagged', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/accept/x.js', "const b = 1;\nremoveRiskFlag(body, 's', { humanConfirmed: true });\n").map((o) => [o.line, o.reason]), [[2, 'remover']]);
});
test('a comment naming the line is not a writer', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '// writes Risk-flags: a\nconst a = 1;\n'), []);
});
test('a planted mis-parse is an offender', () => {
  assert.ok(findWriterOffenders('plugin/bin/lib/x.js', "if (b) /'/.test(b);\nconst c = 'x';\nnot valid(((").length > 0);
});
```

Set the `files` and `sites` floors to the counts observed at landing, per the skill.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-writer-conformance.test.js`
Expected: FAIL with `findWriterOffenders is not defined`

- [ ] **Step 3: Implement the scan and add the stem `risk-flags-writer` to both caller lists**

The two lists are the header of `tests/helpers/strip-comments.js` and item 15 of `.claude/skills/parse-signal-discipline/SKILL.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-writer-conformance.test.js tests/strip-comments-callers-twin.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/risk-flags-writer-conformance.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md
git commit -m "Pin one writer of the Risk-flags line with a source scan — refs #4618"
```

### Task 3: The deterministic classifier floor

**Role:** judgment

**Files:**
- Create: `plugin/bin/lib/issues/risk-flag-classify.js`
- Modify: `plugin/bin/lib/policy-schema.js`
- Test: `tests/bin-lib/issues/risk-flag-classify.test.js`

**Interfaces:**
- Consumes: `extractSection` (`plugin/bin/lib/markdown-blocks.js`), `isSensitivePath` (`plugin/bin/lib/issues/blast-radius.js`), `resolvePolicyKeys`, `BUILTIN_RISK_CATEGORIES` (`plugin/bin/lib/policy-schema.js`), `isControlModeOn` (`plugin/bin/lib/policy.js`).
- Produces:
  - `classifyRiskFlags(body, { extraCategories = [], pathGlobs = {} } = {}) -> { flags: [{ slug, evidence, via: 'keyword'|'path'|'path-glob' }], missingSections: string[] }`: one entry per slug (first match wins), built-ins first, then extras.
  - `inertEvidence(text) -> string`: collapses whitespace including newlines, drops control bytes, escapes `[`, `]`, `` ` ``, `<`, `>` with a backslash, and caps at 300 characters.
  - `readRiskPolicy(repoRoot, { readFile = fs.readFileSync } = {}) -> { controlMode: boolean, extraCategories: string[], pathGlobs: {}, globsInvalid: boolean }`: `.claude-tweaks/policy.yml` under `repoRoot`; `ENOENT`/`ENOTDIR` reads as control mode off; any other read error throws. Control mode off returns empty extras and globs without resolving them.
- Sections read: `## Deliverables`, `## Acceptance Criteria`, `### Key Files`. Keyword matching is word-bounded and case-insensitive over each line of the first two plus the Key Files line text. Path matching reads backticked paths from Key Files only. A missing section lands in `missingSections`; it is never read as "nothing matched" silently.
- Keyword tables, the floor (these decide the AC1 outcome; wider phrasing is the agent's job, per the spec's "agent may add"):
  - `migrations`: `migrations?`, `schema changes?`, `alter table`, `drop (table|column)`, `database schema`; path `(^|/)migrations?/` or `\.sql$`
  - `auth`: `auth(n|z|entication|orization)?`, `permissions?`, `access control`, `rbac`, `login`, `session tokens?`
  - `public-contract`: `public (api|contract)s?`, `hook payloads?`, `file formats?`, `wire format`, `breaking changes?`, `openapi`
  - `irreversible-side-effect`: `irreversibl\w*`, `permanently delet\w*`, `outbound (sends?|emails?|messages?)`, `sends? (an? )?(emails?|sms|notifications?)`, `payments?`, `refunds?`
  - A policy extra matches its own slug, hyphen or space (`data-export` matches `data export`).
  - `pathGlobs[slug]` matches Key Files paths through `isSensitivePath`, `via: 'path-glob'`.

- [ ] **Step 1: Write the failing test**

```js
const spec = (o) => `Surface: infra\n\n## Deliverables\n\n${o.d || '- [ ] x'}\n\n## Acceptance Criteria\n\n${o.a || '1. y'}\n\n## Technical Approach\n\n### Key Files\n\n${o.k || '- `a/b.js` — z'}\n`;
test('AC1.1: a Key Files migrations path yields the migrations flag', () => {
  const r = classifyRiskFlags(spec({ k: '- `db/migrations/001_add.sql` — add' }));
  assert.deepStrictEqual(r.flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
});
test('AC1.1: a Deliverable mentioning a schema change yields the migrations flag with its sentence', () => {
  const r = classifyRiskFlags(spec({ d: '- [ ] Apply a schema change to users' }));
  assert.strictEqual(r.flags[0].slug, 'migrations');
  assert.match(r.flags[0].evidence, /schema change to users/);
});
test('each built-in floor has a positive and a word-bounded negative', () => {
  for (const [text, slug] of [['Refuse an unauthenticated login', 'auth'], ['Change a hook payload field', 'public-contract'], ['Send an email to the owner', 'irreversible-side-effect']]) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.map((f) => f.slug), [slug], text);
  }
  assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. the author wrote authority notes about emigration' })).flags, []);
});
test('a section other than the three is not read', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Overview\n\nschema change\n\n## Deliverables\n\n- a\n\n## Acceptance Criteria\n\n1. b\n\n### Key Files\n\n- `a/b.js`\n').flags, []);
});
test('a missing section is reported, not silent', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Deliverables\n\n- a\n').missingSections, ['Acceptance Criteria', 'Key Files']);
});
test('a policy extra and a path glob classify', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({ d: '- [ ] Add a data export' }), { extraCategories: ['data-export'] }).flags.map((f) => f.slug), ['data-export']);
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `src/secure/a.js`' }), { pathGlobs: { auth: ['src/secure/**'] } }).flags.map((f) => [f.slug, f.via]), [['auth', 'path-glob']]);
});
test('inertEvidence neutralizes hostile text', () => {
  const out = inertEvidence('a\n## Forged [x](https://evil.example) <!-- m --> `c`');
  assert.ok(!out.includes('\n'));
  assert.match(out, /\\\[x\\\]/);
  assert.match(out, /\\<!-- m --\\>/);
  assert.ok(inertEvidence('z'.repeat(500)).length <= 300);
});
test('readRiskPolicy: control mode off consults neither extra key', () => {
  const read = () => 'risk-categories: pii\nrisk-path-globs:\n  auth: [a/**]\n';
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: read }), { controlMode: false, extraCategories: [], pathGlobs: {}, globsInvalid: false });
});
test('readRiskPolicy: control mode on resolves both, a malformed block is flagged', () => {
  const on = (rest) => () => `control-mode: on\n${rest}`;
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: on('risk-categories: pii\nrisk-path-globs:\n  pii: [a/**]\n') }), { controlMode: true, extraCategories: ['pii'], pathGlobs: { pii: ['a/**'] }, globsInvalid: false });
  assert.strictEqual(readRiskPolicy('/r', { readFile: on('risk-path-globs: x\n') }).globsInvalid, true);
});
test('readRiskPolicy: an absent file is control mode off, another error throws', () => {
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.strictEqual(readRiskPolicy('/r', { readFile: err('ENOENT') }).controlMode, false);
  assert.throws(() => readRiskPolicy('/r', { readFile: err('EACCES') }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/risk-flag-classify.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement `risk-flag-classify.js`**

Evidence is `inertEvidence` of the matched line, list markers and checkboxes stripped. `risk-path-globs` is read through `resolvePolicyKeys` only, per `policy-schema.md`'s "Read it only through the resolver". A `null` value with `invalid` sets `globsInvalid: true`, `pathGlobs: {}`. No literal `Risk-flags` in this file (Task 2's scan). Add one header line to `plugin/bin/lib/policy-schema.js`'s control-mode comment (line 178) narrowing "Nothing reads them yet" to the twelve flat keys, naming `risk-flag-classify.js` as the reader of the two risk keys.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/risk-flag-classify.test.js tests/resolve-policy-control-mode.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/risk-flag-classify.js plugin/bin/lib/policy-schema.js tests/bin-lib/issues/risk-flag-classify.test.js
git commit -m "Add the risk-flag classifier floor — refs #4618"
```

### Task 4: The `risk-flags.js` CLI: classify, settle, confirm

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/risk-flags.js`
- Test: `tests/risk-flags-cli.test.js`
- Modify: `docs/plugin-structure.md`

**Interfaces:**
- Consumes: Tasks 1 and 3. `require('./log-decision').run(argv, deps)` for the removal line.
- Exit codes, *Payload-1/Invocation-2* plus 3 for a caller-named write, per `qa-report.js`: 0 success, 1 an unreadable body or prior-body file, 2 malformed invocation, 3 the body file could not be written. State them in the header and `USAGE`.
- Produces `run(argv, deps)` with deps `{ stdout, stderr, readFile, writeFile, cwd, policy }`, and three verbs:
  - `classify --body-file <f> [--repo-root <dir>]` prints `{ flags, missingSections, controlMode, extraCategories, globsInvalid, known }`. `flags` is the floor only (`known` is the built-ins plus the policy extras). Writes nothing.
  - `settle --body-file <f> [--prior-body-file <f>] [--add a,b] (--headless | --answers-file <f>) [--run <dir>] [--repo-root <dir>]` computes the kept set: the prior body's flags ∪ the body's own existing flags ∪ the floor ∪ `--add` (an `unknown` line contributes its widened list). Rewrites `--body-file` in place through `addRiskFlags`, `removeRiskFlag`, `confirmRiskFlags` and `appendRiskProofGotcha`. Prints `{ flags, removed, unconfirmed, status, logged, logFailures }` (`logged` is `null` with no `--run`). Exactly one of `--headless`/`--answers-file`, else exit 2.
  - `confirm --body-file <f> --answers-file <f> [--run <dir>] [--repo-root <dir>]` is the human batch for `/backlog refine`: applies answers to the body's existing flags only, runs no classifier, adds nothing. A body with no flag line stays byte-identical, reporting `status: 'unclassified'`.
- Answers file: JSON object `{ "<slug>": "keep" | "remove" }`.
- Settle semantics:
  - `--headless`: nothing removed. `unconfirmed: true` when the kept set is non-empty.
  - `--answers-file`: for each flag in the kept set, `remove` calls `removeRiskFlag(..., { humanConfirmed: true })`, `keep` keeps. A flag with no answer, or an unreadable, unparseable or non-object answers file, or a value other than `keep`/`remove`, leaves the flag kept and sets `unconfirmed: true` with one stderr warning, exit 0: that is the fail direction, not a usage error. Only when every flag was answered is the marker cleared (`confirmRiskFlags`).
  - An empty kept set writes `Risk-flags: none`, no marker, no Gotcha.
  - A non-empty kept set after removals gets `appendRiskProofGotcha`.
  - Each removal with `--run` logs `--status AUTO --section /specify --step "Risk flags" --text "Risk flag {slug} removed by the maintainer during shaping" --reversibility low`. A non-zero return or throw pushes the slug to `logFailures` and sets `logged: false`; never changes the exit code.
- `--repo-root` defaults to `git rev-parse --show-toplevel` through deps, with the `windowsHide` option, falling back to `cwd`.

- [ ] **Step 1: Write the failing test**

```js
// run(argv, deps) in-process over tmp files; helper `settle(body, args)` returns { out, body, code }.
test('AC3.1: headless shaping never drops a detected flag and writes the marker', () => {
  const { out, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--headless']);
  assert.deepStrictEqual(out.flags, ['migrations']);
  assert.match(body, /^Risk-flags: migrations$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.match(body, /Proof\(migrations\):/);
});
test('AC3.1: headless never removes a prior flag the new text no longer implies', () => {
  const { out } = settle(CLEAN_SPEC, ['--headless', '--prior-body-file', priorWith('auth')]);
  assert.deepStrictEqual(out.flags, ['auth']);
});
test('AC2.1: a remove answer drops the flag and writes the removal entry to decisions.md', () => {
  const run = realAnchoredRunDirFixture();
  const { out, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', run]);
  assert.deepStrictEqual([out.flags, out.removed, out.logged], [[], ['migrations'], true]);
  assert.match(body, /^Risk-flags: none$/m);
  assert.match(readDecisions(run), /Risk flag migrations removed by the maintainer during shaping/);
});
test('AC2.2: a keep answer leaves the flag and clears the marker', () => {
  const { out, body } = settle(withUnconfirmed(SPEC_WITH_MIGRATIONS_PATH), ['--answers-file', answers({ migrations: 'keep' })]);
  assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], false]);
  assert.doesNotMatch(body, /Risk-flags-unconfirmed/);
});
test('AC5.7: an unanswered, unreadable or malformed answer keeps the flag and marks it unconfirmed', () => {
  for (const a of [answers({}), answers({ migrations: 'perhaps' }), '/nope/missing.json', rawFile('not json'), rawFile('null'), rawFile('[]')]) {
    const { out, body, code } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', a]);
    assert.strictEqual(code, 0, a);
    assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], true], a);
    assert.match(body, /^Risk-flags-unconfirmed: true$/m, a);
  }
});
test('a removal with an unanchored --run is logged:false and still exits 0', () => {
  const { out, code } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', '/not/a/run']);
  assert.deepStrictEqual([code, out.logged, out.logFailures], [0, false, ['migrations']]);
});
test('AC6.1: confirm runs no classifier: a record with no flag lines stays byte-identical', () => {
  const { body, out } = confirm(SPEC_WITH_MIGRATIONS_PATH, answers({}));
  assert.strictEqual(body, SPEC_WITH_MIGRATIONS_PATH);
  assert.strictEqual(out.status, 'unclassified');
});
test('confirm applies a remove and a keep to existing flags only', () => {
  const { out } = confirm('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', answers({ auth: 'remove', migrations: 'keep' }));
  assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], false]);
});
test('settle needs exactly one of --headless and --answers-file; a missing body exits 1', () => {
  assert.strictEqual(runCli(['settle', '--body-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', tmp, '--headless', '--answers-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', '/nope', '--headless']).code, 1);
  assert.strictEqual(runCli(['nope']).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file']).code, 2);
});
test('control mode on: settle recognises a policy slug and a path glob; off, neither is consulted', () => {
  // A repo-root fixture with .claude-tweaks/policy.yml; assert out.flags both ways.
});
test('a real spawn of the bin returns the JSON envelope on stdout', () => { /* execFileSync(process.execPath, [bin, 'classify', ...]) */ });
```

`realAnchoredRunDirFixture` builds a git repo under `tests/helpers/git-fixtures.js` with `.claude-tweaks/pipelines/{run}` and passes `cwd`/`mainRoot` through the deps `log-decision.js`'s `run` reads. Implementer finishes the two stubbed bodies.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-cli.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement `plugin/bin/risk-flags.js`**

Validate each value flag inside `parseArgs` (`typeof v !== 'string' || !v.trim() || v.startsWith('--')` is a usage error; look flags up with `Object.hasOwn`). The body read and body write are both through deps and try/caught into the exit codes. Add a `docs/plugin-structure.md` command line after the `plan-audit.js` line, and a clause in the `plugin/bin/lib/issues/` paragraph naming `record-risk-flags.js` and `risk-flag-classify.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-cli.test.js tests/risk-flags-writer-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/risk-flags.js tests/risk-flags-cli.test.js docs/plugin-structure.md
git commit -m "Add the risk-flags CLI: classify, settle, confirm — refs #4618"
```

### Task 5: Plan-audit Check G and the `--risk-proofs` verb

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js`
- Modify: `plugin/bin/lib/plan-audit/checks.js`
- Modify: `plugin/bin/lib/plan-audit/args.js`
- Modify: `plugin/bin/plan-audit.js`
- Modify: `plugin/skills/build/plan-audit.md`
- Modify: `plugin/skills/build/SKILL.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/plan-audit/parser.test.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`
- Test: `tests/bin-lib/plan-audit/cli.test.js`
- Test: `tests/plan-audit-check-g-prose.test.js`

**Interfaces:**
- Consumes: `parseRiskFlags` (Task 1), `readRiskPolicy` (Task 3).
- Produces:
  - `extractProofLines(planText) -> { proofs: [{ slug, text, task }], nearMisses: [{ task, raw }] }` in `parser.js`. Only lines inside `extractTaskBlocks`' task bodies, outside fences. Strict form: `/^[ \t]*(?:[-*+][ \t]+)?(?:\[[ xX]?\][ \t]+)?(?:\*\*)?Proof\(([a-z0-9][a-z0-9-]*)\):(?:\*\*)?[ \t]*(.*)$/`. A line whose start case-insensitively resembles `proof(` or `proof (` but fails the strict form is a near-miss.
  - `isSubstantiveProof(slug, text) -> null | 'too-short' | 'restates-category'` in `checks.js`: under 20 characters is `too-short`; empty after dropping the slug's hyphen-split words and the fillers `category proof risk flag the a an for of this is and covered handled` is `restates-category`.
  - `checkG(specText, planText, { extraCategories = [], planPath = null } = {})`, gating, returning one of:
    - `{ ok: true, skipped: 'unclassified' | 'no-flags' }`
    - `{ ok, status, required: string[], unconfirmed: boolean, proofs: [{slug, task}], missing: [{slug, plan, reason}], couldNotParse: [{source: 'flag-line'|'plan'|'proof-line', raw}] }`, with `ok === (missing.length === 0 && couldNotParse.length === 0)`, `reason` being `no-proof-line`, `too-short` or `restates-category`.
  - Normalize `\r\n?` in both inputs once, at `checkG`'s entry. `countTasks(plan).tasks === 0` gives `couldNotParse: [{source: 'plan', raw: 'no parseable tasks'}]`. A `status: 'unknown'` line with `reason: 'malformed'` gives `{source: 'flag-line', raw}`. A near-miss gives `{source: 'proof-line', raw}`.
  - Envelope key `checkG`; `pass` conjunction gains `report.checkG.ok`; without `--spec`, `{ ok: true, skipped: 'no-spec' }`.
  - `summaryLine` parts: `Check G: missing proof for {slugs joined ', '} in {planPath}` and `Check G: could-not-parse {N} ({sources})`.
  - `--risk-proofs`: read-only verb, requires `--spec` (else `UsageError`), refused beside `--count-tasks`, `--bytes`, `--task-markers`. Prints `{"checkG": {...}}` plus a newline, exit 1 when `ok` is false, 2 on an unreadable plan or spec. `--spec` is allowed beside this verb only.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/plan-audit/checks.test.js`, appended (Expected: FAIL after Step 1):

```js
const G_SPEC = (line) => `---\nrecord: 1\n---\n# 1: t\n\nSurface: infra\n${line}\n\n## Overview\n`;
const G_PLAN = (body) => `### Task 1: x\n\n- [ ] **Step 1: y**\n\n${body}\n`;
const GOOD = 'Rehearse the migration against a copy of production data and diff row counts.';
test('AC4.1: a kept flag with no proof line fails, naming the slug and the plan', () => {
  const r = checkG(G_SPEC('Risk-flags: migrations'), G_PLAN('nothing'), { planPath: 'p.md' });
  assert.deepStrictEqual([r.ok, r.missing], [false, [{ slug: 'migrations', plan: 'p.md', reason: 'no-proof-line' }]]);
});
test('AC4.1: a proof shorter than 20 characters fails', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN('Proof(auth): too short')).missing[0].reason, 'too-short');
});
test('AC4.1: one proof per kept slug passes', () => {
  const r = checkG(G_SPEC('Risk-flags: migrations, auth'), G_PLAN(`Proof(migrations): ${GOOD}\n- Proof(auth): An unauthenticated request to the route still returns 401.`));
  assert.deepStrictEqual([r.ok, r.missing, r.couldNotParse], [true, [], []]);
});
test('AC4.1: a proof for only one of two slugs still fails on the other', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: migrations, auth'), G_PLAN(`Proof(migrations): ${GOOD}`)).missing.map((m) => m.slug), ['auth']);
});
test('AC4.1: an unparseable flag line reports could-not-parse, however many proofs exist', () => {
  const all = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'].map((s) => `Proof(${s}): ${GOOD}`).join('\n');
  const r = checkG(G_SPEC('Risk-flags: Auth'), G_PLAN(all));
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.couldNotParse, [{ source: 'flag-line', raw: 'Risk-flags: Auth' }]);
});
test('AC4.1: an unparseable plan reports could-not-parse', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: auth'), 'no tasks here').couldNotParse, [{ source: 'plan', raw: 'no parseable tasks' }]);
});
test('AC4.1: a near-miss proof line reports could-not-parse', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN(`proof (auth): ${GOOD}`)).couldNotParse[0].source, 'proof-line');
});
test('AC4.1: a record with no flags or unclassified does nothing', () => {
  assert.deepStrictEqual(checkG(G_SPEC('Risk-flags: none'), 'no tasks here'), { ok: true, skipped: 'no-flags' });
  assert.deepStrictEqual(checkG(G_SPEC(''), 'no tasks here'), { ok: true, skipped: 'unclassified' });
});
test('an unknown slug needs a proof for every widened flag, and can be satisfied', () => {
  const r = checkG(G_SPEC('Risk-flags: pii'), G_PLAN(`Proof(pii): ${GOOD}`));
  assert.deepStrictEqual(r.missing.map((m) => m.slug), ['migrations', 'auth', 'public-contract', 'irreversible-side-effect']);
  assert.deepStrictEqual(r.couldNotParse, []);
});
test('a policy slug passed in reads ok and needs only its own proof', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: pii'), G_PLAN(`Proof(pii): ${GOOD}`), { extraCategories: ['pii'] }).ok, true);
});
test('a proof that restates the category fails', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: public-contract'), G_PLAN('Proof(public-contract): public contract proof for the public contract')).missing[0].reason, 'restates-category');
});
test('a proof in a fence, or outside any task, does not satisfy', () => {
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), G_PLAN(`\`\`\`\nProof(auth): ${GOOD}\n\`\`\``)).ok, false);
  assert.strictEqual(checkG(G_SPEC('Risk-flags: auth'), `Proof(auth): ${GOOD}\n\n${G_PLAN('x')}`).ok, false);
});
test('CRLF plan and spec read the same as LF', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.strictEqual(checkG(crlf(G_SPEC('Risk-flags: auth')), crlf(G_PLAN(`Proof(auth): ${GOOD}`))).ok, true);
});
test('an unconfirmed flag still requires its proof', () => {
  const r = checkG(G_SPEC('Risk-flags: auth\nRisk-flags-unconfirmed: true'), G_PLAN('x'));
  assert.deepStrictEqual([r.ok, r.unconfirmed], [false, true]);
});
```

`tests/bin-lib/plan-audit/cli.test.js`, appended: exit 1 and a summary naming the slug on a missing proof; exit 0 with `Proof` present; with no `--spec` `checkG` is `{ok: true, skipped: 'no-spec'}`. Update the existing `Object.keys(restA)` assertion at line 750 by destructuring `checkG` out in the same way as `checkE`/`checkF`. `--risk-proofs`: exit 0/1 by proof presence, prints only `checkG`, exit 2 without `--spec`, exit 2 beside each other verb, exit 2 on an unreadable spec. `control-mode: on` in a fixture repo's `.claude-tweaks/policy.yml` makes `Risk-flags: pii` with `risk-categories: pii` need only its own proof; `control-mode` off makes it widen.

`tests/bin-lib/plan-audit/parser.test.js`, appended: `extractProofLines` returns slug, text and task; ignores fences; reports the near-miss.

`tests/plan-audit-check-g-prose.test.js`: one assertion function, a positive and a go-red negative (same function against text with each literal removed), pinning in `plan-audit.md` the literals `Check G`, `checkG.missing`, `checkG.couldNotParse`, `--risk-proofs`, `could-not-parse`, `Proof(<slug>)`, and `**Check G does not share that gate**`; in `build/SKILL.md`, `--risk-proofs`. Assert every restated invocation (`plan-audit.md`, `build/SKILL.md`, `docs/plugin-structure.md`) names exactly `USAGE`'s flags, as `tests/plan-audit-check-e-prose.test.js` does; extend that file's expected set if it pins `USAGE`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 with `checkG is not a function`

- [ ] **Step 3: Implement Check G at every registration site**

`plan-audit.js` reads `readRiskPolicy(repoRoot)` only when a spec is present; a thrown policy read exits 2. `checks.js` header and `plan-audit.js` header name Check G. `plan-audit.md`: opening enumeration; Invocation line; envelope key list; `--risk-proofs` paragraph; two `Result interpretation` bullets (`checkG.missing`: amend the plan with a real proof per slug and re-run once, in auto with an `AUTO` `Common Step 1.5 (Check G)` log line, then stop if it still fails, since this is a plan-validation HARD-GATE, never the `scope-creep` policy; `checkG.couldNotParse`: stop, name each `source` and `raw`); a `What each check covers` bullet stating gating and why; the skip-gate paragraph gains `**Check G does not share that gate**` with its reason: a trivial plan or a fast-lane record is exactly where a skipped proof would pass silently, so the skip path also runs `--risk-proofs` when a materialized spec exists. `plan-audit.md`'s claim "`Exit code is 0 iff every check's ok`" stays true. `build/SKILL.md` Common Step 1.5: invocation line gains `[--risk-proofs]`; one bullet for Check G; the skip sentence gains the `--risk-proofs --spec {spec-file}` call and its stop. SKILL.md has 265 B of rail headroom: stay under the rail, and if needed trim the parenthetical restating why a NUL is fatal at any size (plan-audit.md line 5 keeps it). `docs/plugin-structure.md`: `plan-audit.js` line and `build` table row. Then run the skill's anti-pattern sweep.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-g-prose.test.js tests/plan-audit-check-e-prose.test.js`
Expected: PASS. Also `git grep -nE 'Checks? A/B' -- plugin docs` lists no enumeration that omits a check it should name.

- [ ] **Step 5: Corpus probe**

Run `plan-audit.js {plan} --risk-proofs --spec {spec}` over every committed plan and its spec pair (`git ls-files '*/work/*-spec.md'`) with a scratch script. Expected: every pair reports `skipped: 'unclassified'`, because no record carries the line yet. Write the output to `$PIPELINE_RUN_DIR/evidence/check-g-corpus.txt` (`mkdir -p` first, plain redirect) and log one `AC evidence` entry citing the count.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js plugin/bin/lib/plan-audit/checks.js plugin/bin/lib/plan-audit/args.js plugin/bin/plan-audit.js plugin/skills/build/plan-audit.md plugin/skills/build/SKILL.md docs/plugin-structure.md tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js tests/bin-lib/plan-audit/cli.test.js tests/plan-audit-check-g-prose.test.js
git commit -m "Add plan-audit Check G: a kept risk flag needs a Proof line — refs #4618"
```

### Task 6: Close the bypasses and produce the packet facts

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/issues/risk-flag-facts.js`
- Modify: `plugin/bin/lib/express/eligibility.js`
- Modify: `plugin/skills/build/micro-plan.md`
- Modify: `plugin/skills/_shared/express-lane.md`
- Modify: `docs/plugin-structure.md`
- Test: `tests/bin-lib/issues/risk-flag-facts.test.js`
- Test: `tests/bin-lib/express/eligibility.test.js`
- Test: `tests/risk-flags-prose-conformance.test.js`

**Interfaces:**
- Consumes: `parseRiskFlags` (Task 1), `inertEvidence` (Task 3), `extractProofLines` (Task 5).
- Produces `riskFacts(specText, planText, { extraCategories = [] } = {}) -> Fact[]`, the shape #4611 pins (`{ id, kind, status, reason?, source }`) plus fields:
  - `{ id: 'flag:{slug}', kind: 'flag', status: 'not-run', source: 'record', slug, unconfirmed }`; `reason: 'unreadable flag line'` when the line read `unknown`.
  - `{ id: 'proof:{slug}', kind: 'proof', status: 'not-run', source: 'plan', slug, text, task }`, `text` through `inertEvidence`. No fact for a slug with no proof, or one failing `isSubstantiveProof`. `status` is `not-run` because a planned proof is not a passed check: #4611's "verified" claims may cite only `passed` facts.
  - `[]` for `unclassified` or a clean `none`.
- `REASONS.riskFlags = 'record carries a kept risk flag'` in `eligibility.js`, pushed when `parseRiskFlags(body).flags.length > 0`.

- [ ] **Step 1: Write the failing test**

`tests/bin-lib/issues/risk-flag-facts.test.js`:

```js
test('a flag fact carries unconfirmed, a proof fact its neutralized text', () => {
  const spec = 'Risk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n';
  const plan = '### Task 1: x\n\nProof(auth): An unauthenticated request [still](x) returns 401.\n';
  const [flag, proof] = riskFacts(spec, plan);
  assert.deepStrictEqual(flag, { id: 'flag:auth', kind: 'flag', status: 'not-run', source: 'record', slug: 'auth', unconfirmed: true });
  assert.deepStrictEqual([proof.id, proof.kind, proof.status, proof.task], ['proof:auth', 'proof', 'not-run', 1]);
  assert.match(proof.text, /\\\[still\\\]/);
});
test('an unclassified or clean record produces no facts', () => {
  assert.deepStrictEqual(riskFacts('Surface: x\n', ''), []);
  assert.deepStrictEqual(riskFacts('Risk-flags: none\n', ''), []);
});
test('an unknown line produces a flag fact per widened flag with a reason', () => {
  const facts = riskFacts('Risk-flags: Bad\n', '');
  assert.strictEqual(facts.length, 4);
  assert.strictEqual(facts[0].reason, 'unreadable flag line');
});
test('a slug with a too-short proof has no proof fact', () => {
  assert.strictEqual(riskFacts('Risk-flags: auth\n', '### Task 1: x\n\nProof(auth): short\n').length, 1);
});
```

`tests/bin-lib/express/eligibility.test.js`, appended (Expected: FAIL after Step 1): an otherwise-eligible fixture with `Risk-flags: auth` in its body is `eligible: false` and names the reason; `Risk-flags: none` stays eligible; a malformed line is ineligible; no line stays eligible.

`tests/risk-flags-prose-conformance.test.js` (Task 7 extends this file): `micro-plan.md`'s applicability gate names `parseRiskFlags` semantics with the literal `carries a risk flag`; `express-lane.md`'s Eligibility names `kept risk flag`. One assertion function, a go-red negative for each.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/risk-flag-facts.test.js tests/risk-flags-prose-conformance.test.js`
Expected: FAIL with `Cannot find module`

- [ ] **Step 3: Implement**

`micro-plan.md`: add a check to the applicability gate, cheapest first: a spec body that carries a risk flag (a `Risk-flags:` line with any slug, or an unreadable one; `Risk-flags: none` and no line are fine) falls through to `/superpowers:writing-plans`, because the composed plan has no audited proof step. Update "All three must hold" to "All four". `express-lane.md`: Eligibility gains the condition. Add a `plugin/bin/lib/issues/` clause to `docs/plugin-structure.md` naming `risk-flag-facts.js`, stating `packet-gather.js` (#4611) consumes it once shipped.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/risk-flag-facts.test.js tests/bin-lib/express/eligibility.test.js tests/risk-flags-prose-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/risk-flag-facts.js plugin/bin/lib/express/eligibility.js plugin/skills/build/micro-plan.md plugin/skills/_shared/express-lane.md docs/plugin-structure.md tests/bin-lib/issues/risk-flag-facts.test.js tests/bin-lib/express/eligibility.test.js tests/risk-flags-prose-conformance.test.js
git commit -m "Keep flagged records off unaudited paths and produce risk facts — refs #4618"
```

### Task 7: `/specify` and `/backlog refine` prose

**Role:** judgment

**Files:**
- Modify: `plugin/skills/specify/shaping-mode-stamping.md`
- Modify: `plugin/skills/specify/record-creation-subissues.md`
- Modify: `plugin/skills/specify/spec-template.md`
- Modify: `plugin/skills/backlog/refine-mode.md`
- Modify: `plugin/skills/_shared/work-record.md`
- Modify: `plugin/skills/_shared/policy-schema.md`
- Test: `tests/risk-flags-prose-conformance.test.js`

**Interfaces:**
- Consumes: the CLI verbs from Task 4, the removal text from Global Constraints.
- The canonical procedure lives once, as a `### Risk flags` section of `shaping-mode-stamping.md`, placed after `### Metadata block` and before `### Stamp scoring and stage labels`. `record-creation-subissues.md` cites it, stating only its per-unit deltas. Content of the section, in order:
  1. Classify: write the composed body to the session-tmp body file; run `risk-flags.js classify --body-file`. Add flags from your own reading of Deliverables, Acceptance Criteria and Key Files against the categories in `classify`'s `known` list; you may add, never drop. Evidence you quote is the CLI's neutralized `evidence`, wrapped per `_shared/untrusted-record-content.md`; your own added evidence is run through the same rule.
  2. Human reachable: define headless verbatim from Global Constraints, plus bare drain's entry path. In `auto` no new stop is added (`_shared/auto-mode-contract.md`): headless takes step 4.
  3. Interactive: render one batch table (flag, evidence), then one `AskUserQuestion` for the batch: `multiSelect: true`, one option per flag, selected means remove, none selected means keep all; more than four flags takes the "Other" free-text answer naming the ones to remove. Include flags already on the record that read unconfirmed. Write the answers file; run `settle --answers-file`, adding `--prior-body-file` (the record's current body) when shaping an existing record and `--run "$PIPELINE_RUN_DIR"` when a run dir resolved. An `AskUserQuestion` that errors, times out or is auto-answered takes step 4.
  4. Headless: run `settle --headless` with the same prior-body and `--add` arguments.
  5. Removal logging: with `logged: true`, done. With no run dir or `logged: false`, post a record comment per each `removed` slug with exactly `Risk flag {slug} removed by the maintainer during shaping` (through `_shared/github-write-transport.md`; under `local-files`, append it to the body's `## Gotchas`), after the create in decomposition mode, when the number exists.
  6. All body rewrites of these lines go through `bin/risk-flags.js` (`addRiskFlags`, `removeRiskFlag` in `record.js`); never hand-edit the line. Existing backlog records are classified only when next shaped; an `already shaped, no-op` record is not touched.
- Compose-then-write-once's assembly shows `Risk-flags: {value}` and the optional `Risk-flags-unconfirmed: true` in the metadata block, and the `compose-record.js --check` runs after settle so the checked file is the settled one.
- `record-creation-subissues.md`: a `**Risk flags**` paragraph right after `**Premise verification**` and before `**Ceremony**`. Decomposition's one question is asked in a pre-pass over every unit's composed body before the first create, so the batch gets one `AskUserQuestion`; answers are held per unit and `settle` runs inside the loop. Origin-set carve-out passes `--prior-body-file`.
- `spec-template.md`: the metadata block gains `Risk-flags: {comma-separated slugs, or none — written by /specify's Risk flags step}` and `Risk-flags-unconfirmed: {true — headless-kept flags awaiting a human; omitted otherwise}`, with one paragraph naming grammar, the unknown-reads-all-four rule, `Proof(<slug>)`, and "never hand-edit". The `risk:*` axis is named as a different axis.
- `refine-mode.md`: new `## Step 3.7: Unconfirmed risk flags` between Step 3.6 and Step 4, human-present mode only (`refine-headless.md` is never touched and this step never runs under it). Population: records in this run's fresh lane whose body `parseRiskFlags` reads `unconfirmed: true`. One batch table and one `AskUserQuestion`, same shape as above. Write through `risk-flags.js confirm` on a freshly re-fetched body (`gh issue view {n} --json body`), then `gh issue edit {n} --body-file`; a fetch failure skips the write, per Step 5's fail-closed Pre-write reverify. Log removals as the Risk flags section's step 5 states. Records with no flag line are never touched: this step runs no classifier. Step 1's snapshot already carries `body` (line 38); Step 5's Body pre-write reverify rule applies to this write, a mismatch skipping it.
- `_shared/work-record.md`: a short subsection on the two lines, naming `parseRiskFlags` as the one reader and `bin/risk-flags.js` as the one writer path; `local-files` carries them in the body, never in `facets`.
- `_shared/policy-schema.md`: the `risk-categories` and `risk-path-globs` rows' consumer cell changes from `none yet (#4608)` to `` `risk-flags.js` `` plus `` `plan-audit.js` `` for `risk-categories`. 302 B of headroom: keep the net growth under 100 B.

- [ ] **Step 1: Write the failing test**

Extend `tests/risk-flags-prose-conformance.test.js` with one assertion function per file, each paired with a go-red negative against mutated text:

```js
test('AC2.1: the interactive path shows flags in one batch question and settles a remove through the CLI', () => assertShaping(read(SHAPING)));
test('AC3.1: the headless path keeps every detected flag with no AskUserQuestion, and the error path joins it', () => assertHeadless(read(SHAPING)));
test('AC1.1: the flag line reaches the created record: settle runs before the write and before --check', () => assertOrder(read(SHAPING)));
test('AC1.1: decomposition settles per unit before the create call', () => assertDecomposition(read(SUBISSUES)));
test('AC6.1 AC6.2: no batch path classifies: classify and settle appear only under specify/', () => assertNoBatchClassify(walkSkills()));
test('refine surfaces unconfirmed flags through confirm, human-present only', () => assertRefine(read(REFINE)));
test('the template documents both lines and the writer rule', () => assertTemplate(read(TEMPLATE)));
```

`assertShaping` pins `risk-flags.js settle`, `--answers-file`, `--prior-body-file`, `multiSelect`, and the removal text literal. `assertHeadless` pins `settle --headless`, `errors, times out or is auto-answered`. `assertOrder` compares offsets: the `### Risk flags` heading precedes `### Stamp scoring`, and the assembly lists `Risk-flags:` above `## Current State`. `assertNoBatchClassify` walks `plugin/skills/**/*.md` through `readText` and asserts `risk-flags.js classify` and `risk-flags.js settle` occur only under `plugin/skills/specify/`; its go-red plants the literal in a refine-mode copy. `assertRefine` pins `risk-flags.js confirm` and `Step 3.7`, and that `refine-headless.md` has no `risk-flags.js`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/risk-flags-prose-conformance.test.js`
Expected: FAIL after Step 1 with an assertion naming the absent literal

- [ ] **Step 3: Write the prose**

Follow `docs/skill-authoring.md`. Reference `/claude-tweaks:specify` and `/claude-tweaks:backlog` fully qualified in instruction text. Use `${CLAUDE_PLUGIN_ROOT}` in command lines. Keep to the rail.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/risk-flags-prose-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/skill-conventions.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode-stamping.md plugin/skills/specify/record-creation-subissues.md plugin/skills/specify/spec-template.md plugin/skills/backlog/refine-mode.md plugin/skills/_shared/work-record.md plugin/skills/_shared/policy-schema.md tests/risk-flags-prose-conformance.test.js
git commit -m "Wire risk-flag classification into specify and backlog refine — refs #4618"
```
