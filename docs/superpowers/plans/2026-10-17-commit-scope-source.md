# Commit-Scope Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `bin/compose-subject.js` one documented source for its Conventional-Commits scope — two policy keys resolved inside the composer, explicit `--scope` winning — and make every merge fence pass `--range {base}...{head}` so the pr-first and local-merge paths compose identical subjects.

**Architecture:** A pure resolver module (`plugin/bin/lib/commit-scope.js`) owns the precedence ladder (explicit flag → path-prefix match over the changed files → constant → unscoped) and is unit-tested with plain arrays. `plugin/bin/lib/compose-subject.js` owns only the policy read (two new readers on `plugin/bin/lib/policy.js`), the `git diff --name-only` call through a new injectable `gitRunner` dep, and the exit-code mapping. Six merge-fence call lines gain `--range`; the conformance test's call-line regex is tightened to require it.

**Tech Stack:** Node 18+, `node --test`, the existing `run(argv, deps)` seam (gh-api-module-pattern), `policy-schema.js` flat parser.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T184419-spec-3298/work/3298-spec.md` (record #3298)

**Premise-refs:** `plugin/bin/lib/compose-subject.js`, `plugin/bin/lib/release/subject.js`, `plugin/bin/lib/policy.js`, `plugin/bin/lib/policy-schema.js`, `tests/merge-subject-composer-conformance.test.js`, `tests/pr-first-merge.test.js`, `tests/policy-schema.test.js`

## Global Constraints

- Scope token grammar is `composeSubject`'s own: `^[A-Za-z0-9._/-]+$` (`plugin/bin/lib/release/subject.js:78`); the resolver never re-validates characters.
- `policy.yml` is flat `key: value` only (`parseFlatLines`, `plugin/bin/lib/policy-schema.js:335`); list values are comma-separated strings (`readListKey`, `plugin/bin/lib/policy.js:91`). No nested map.
- `tests/policy-schema.test.js:139` pins `POLICY_KEYS.length` at 73 → becomes 75; both new keys are `tier: 'advanced'` (core tier at its cap of 12, `tests/policy-schema-metadata.test.js:27`); summaries ≤ 140 chars and must not contain their own key string (`:21`), and must not appear verbatim in `_shared/policy-schema.md` (`:46`).
- `tests/pr-first-merge.test.js:264` pins the literal `--scope {scope}` inside `pr-first-merge.md` Step 3 — the replacement sentence keeps that literal.
- `tests/merge-subject-composer-conformance.test.js:26` caps `plugin/skills/_shared/pr-first-merge.md` at 31,304 bytes; it is 30,941 bytes on the merge base (363 bytes headroom). Replace, never add beside.
- `_shared/policy-schema.md` is capped by `CEILING_BYTES` = 51,200 (`tests/dispatch-sequential-execution-conformance.test.js:32`); it is 45,219 bytes on the merge base. `settle-and-merge.md` is 46,294 bytes against the same shared ceiling (headroom check in `plan-audit.js`).
- Three-dot range only: `git diff --name-only {base}...{head}` (changes on the branch since the merge base; two dots would include integration-branch drift).
- Every composer test goes through injectable deps — never a real `gh` or `git`.
- Commit message style: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer the session reminder supplies.

## Review Focus

1. A `commit-scope-paths` entry with no `=` or an empty side (`plugin/bin/=`, `=bin`, `plugin/bin`) — expected: exit 1 naming the entry, never an unscoped subject. Pinned in Task 2's `parseScopePaths` tests and Task 3's CLI test.
2. A changed path that matches no prefix alongside one that matches (`README.md` + `plugin/bin/x.js` with only `plugin/bin/=bin`) — expected: `bin`, the unmatched path contributes nothing. Pinned in Task 2.
3. A longer and a shorter prefix both matching the same path (`plugin/=a, plugin/bin/=b`) — expected: the longer prefix wins per path. Pinned in Task 2 (AC5.1).
4. `--range` given on a project with neither key set — expected: no git call, composer output byte-identical to today. Pinned in Task 3 (AC3.2).
5. `git diff` output with a trailing newline or CRLF line ends — expected: empty/whitespace entries dropped, paths trimmed. Pinned in Task 3's gitRunner fixture (returns `"a\nb\r\n\n"`).

---

### Task 1: Policy keys and readers

**Files:**
- Modify: `plugin/bin/lib/policy-schema.js:72` (insert two `POLICY_KEYS` rows after the `merge-sensitive-paths` row)
- Modify: `plugin/bin/lib/policy.js:91-98` (add `readCommitScope`; export it)
- Modify: `plugin/skills/_shared/policy-schema.md:135` (two Dispatch & merge table rows after `work-links`)
- Modify: `tests/policy-schema.test.js:130-141` (count 73 → 75 with the two comment lines the file's convention uses)
- Test: `tests/policy.test.js` (two `readCommitScope` cases beside the `readListKey` cases at `:157-172`)

**Interfaces:**
- Produces: `readCommitScope(repoRoot: string): string | null` — `resolveValue('commit-scope', parsePolicy(repoRoot)['commit-scope']) ?? null` (a blank/absent/whitespace-bearing value resolves `null` via the schema default). `commit-scope-paths` is read with the existing `readListKey(repoRoot, 'commit-scope-paths'): string[]` — no new reader.
- Produces: two `POLICY_KEYS` rows — `{ key: 'commit-scope', type: 'string', summary: "Names the one Conventional-Commits scope every merge subject carries, and the fallback when a path rule is ambiguous.", category: 'merge-safety', tier: 'advanced' }` and `{ key: 'commit-scope-paths', type: 'list', default: [], summary: "Maps changed-path prefixes to the Conventional-Commits scope a merge subject carries when every changed file agrees.", category: 'merge-safety', tier: 'advanced' }`.

- [ ] **Step 1: Write the failing tests**

In `tests/policy.test.js`, after the `readListKey` cases (`:157-172`), using the same temp-repo fixture those tests use:

```js
test('AC10.1: readCommitScope: key present -> the token; absent or blank -> null', () => {
  // fixture writes `commit-scope: api`
  assert.strictEqual(readCommitScope(repo), 'api');
  // fixture writes nothing / `commit-scope:`
  assert.strictEqual(readCommitScope(repoEmpty), null);
});
test('AC10.1: readCommitScope: a whitespace-bearing value fails string validation and resolves null', () => {
  // fixture writes `commit-scope: two words`
  assert.strictEqual(readCommitScope(repo), null);
});
```

In `tests/policy-schema.test.js:139-140`, change both `73` literals to `75` and add two comment lines above them in the file's existing `N -> N+1, #issue (…): key — type, default — meaning` style: `73 -> 74, #3298 (merge-subject scope source): commit-scope — string, no default — the constant Conventional-Commits scope token`; `74 -> 75, #3298: commit-scope-paths — list, default [] — comma-separated prefix=token pairs resolved against a merge's changed files`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node -e "const p = require('./plugin/bin/lib/policy.js'); const { POLICY_KEYS } = require('./plugin/bin/lib/policy-schema.js'); if (typeof p.readCommitScope !== 'function' || !POLICY_KEYS.some((k) => k.key === 'commit-scope-paths')) process.exit(1)"`
Expected: FAIL (exit 1) — `readCommitScope` is not exported and no `commit-scope-paths` row exists yet. (The full suites in Step 4 are the green check; `tests/policy-schema.test.js`'s count assertion reads `73 !== 75` until both rows land, and `tests/policy-key-naming.test.js` fails "keys with no documented row" until the md rows do.)

- [ ] **Step 3: Add the two `POLICY_KEYS` rows and the reader**

`plugin/bin/lib/policy-schema.js`: insert the two rows from Interfaces immediately after the `merge-sensitive-paths` row (`:72`), with a two-line comment above them: `// commit-scope / commit-scope-paths (#3298): the merge-subject scope source bin/compose-subject.js resolves when --scope is absent — explicit flag > a commit-scope-paths match over the changed files > commit-scope > unscoped. Both advanced: the core tier is at its cap.`

`plugin/bin/lib/policy.js`: after `readListKey`, add

```js
// `commit-scope` (#3298): the constant Conventional-Commits scope token
// bin/compose-subject.js falls back to. resolveValue applies the schema's
// string validation (non-blank, whitespace-free) — anything else resolves
// to the schema default, which this key leaves unset, hence null.
function readCommitScope(repoRoot) {
  return resolveValue('commit-scope', parsePolicy(repoRoot)['commit-scope']) ?? null;
}
```

and add `readCommitScope` to `module.exports`.

`plugin/skills/_shared/policy-schema.md`: after the `work-links` row (`:135`), add two rows:

```
| `commit-scope` | `policy.yml` | `bin/compose-subject.js` — every merge fence (`_shared/pr-first-merge.md` Step 3 and the four local-merge fences) | unset | One `type(scope):` token (`[A-Za-z0-9._/-]+`) for every merge subject, and the fallback when `commit-scope-paths` matches nothing or more than one scope. Precedence: an explicit `--scope` on the composer call, then a `commit-scope-paths` match, then this key, else unscoped |
| `commit-scope-paths` | `policy.yml` | same as `commit-scope` | `[]` (empty) | Comma-separated `{path-prefix}={token}` pairs (e.g. `plugin/bin/=bin, plugin/skills/=skills`); each file changed in the fence's `--range {base}...{head}` takes its longest matching prefix, and the subject is scoped only when exactly one token results — zero or several fall back to `commit-scope`, with a stderr note naming the spanned scopes. Set while the composer call carries no `--range`, the composer exits 1 instead of composing an unscoped subject silently. A `=` inside a prefix or token is unsupported |
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/policy.test.js tests/policy-schema.test.js tests/policy-key-naming.test.js tests/policy-schema-metadata.test.js tests/resolve-policy-cli.test.js tests/dispatch-sequential-execution-conformance.test.js`
Expected: PASS. Also `wc -c plugin/skills/_shared/policy-schema.md` prints a number ≤ 51200.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/policy-schema.js plugin/bin/lib/policy.js plugin/skills/_shared/policy-schema.md tests/policy.test.js tests/policy-schema.test.js
git commit -m "Add commit-scope and commit-scope-paths policy keys — the merge-subject scope source, refs #3298"
```

---

### Task 2: Pure resolver module

**Files:**
- Create: `plugin/bin/lib/commit-scope.js`
- Test: `tests/bin-lib/commit-scope.test.js`

**Interfaces:**
- Produces: `class CommitScopeError extends Error` (exported; `name = 'CommitScopeError'`).
- Produces: `parseScopePaths(entries: string[]): Array<{ prefix: string, token: string }>` — `entries` is `readListKey`'s already-split, trimmed list. Each entry splits on its **first** `=`; an entry with no `=`, an empty prefix, or an empty token throws `CommitScopeError` with message `commit-scope-paths entry ${JSON.stringify(entry)} is not {path-prefix}={token}`. Order preserved. `[]` → `[]`.
- Produces: `resolveCommitScope({ explicit, constant, pairs, changedPaths }): { scope: string | null, source: 'explicit' | 'paths' | 'constant' | 'none', note: string[] | null }` — `explicit` (string|null), `constant` (string|null), `pairs` (from `parseScopePaths`), `changedPaths` (string[]). Rules: a non-empty trimmed `explicit` → `{ scope: explicit.trim(), source: 'explicit', note: null }`. Else, when `pairs.length > 0`: for each changed path take the pair whose `prefix` is the longest string-prefix of it (`path.startsWith(prefix)`; a path matching none contributes nothing); collect the distinct tokens in first-seen order; exactly one → `{ scope, source: 'paths', note: null }`; zero → fall through with `note: null`; more than one → fall through with `note` = the distinct tokens sorted ascending. Then a non-empty trimmed `constant` → `{ scope: constant.trim(), source: 'constant', note }`; else `{ scope: null, source: 'none', note }`. Pure: no fs, no process, no policy read.

- [ ] **Step 1: Write the failing tests**

`tests/bin-lib/commit-scope.test.js`, `node:test` + `node:assert/strict`, requiring `../../plugin/bin/lib/commit-scope.js`:

```js
test('parseScopePaths: splits each entry on the first = and keeps order', () => {
  assert.deepEqual(parseScopePaths(['plugin/bin/=bin', 'plugin/skills/=skills']), [
    { prefix: 'plugin/bin/', token: 'bin' }, { prefix: 'plugin/skills/', token: 'skills' }]);
  assert.deepEqual(parseScopePaths(['a=b=c']), [{ prefix: 'a', token: 'b=c' }]);
  assert.deepEqual(parseScopePaths([]), []);
});
test('parseScopePaths: no =, empty prefix, or empty token throws CommitScopeError naming the entry', () => {
  for (const bad of ['plugin/bin', '=bin', 'plugin/bin/=']) {
    assert.throws(() => parseScopePaths([bad]), (e) => e instanceof CommitScopeError && e.message.includes(JSON.stringify(bad)));
  }
});
test('resolveCommitScope: explicit wins over paths and constant', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: 'api', constant: 'web', pairs, changedPaths: ['plugin/bin/x.js'] }), { scope: 'api', source: 'explicit', note: null });
});
test('resolveCommitScope: constant only', () => {
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'web', pairs: [], changedPaths: [] }), { scope: 'web', source: 'constant', note: null });
});
test('resolveCommitScope: single path match; an unmatched path contributes nothing', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['README.md', 'plugin/bin/x.js', 'plugin/bin/lib/y.js'] }), { scope: 'bin', source: 'paths', note: null });
});
test('AC5.1: resolveCommitScope: the longest matching prefix wins per path', () => {
  const pairs = parseScopePaths(['plugin/=a', 'plugin/bin/=b']);
  assert.equal(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['plugin/bin/x.js'] }).scope, 'b');
  const reversed = parseScopePaths(['plugin/bin/=b', 'plugin/=a']);
  assert.equal(resolveCommitScope({ explicit: null, constant: null, pairs: reversed, changedPaths: ['plugin/bin/x.js'] }).scope, 'b');
});
test('resolveCommitScope: zero matches falls back to constant, else none', () => {
  const pairs = parseScopePaths(['plugin/bin/=bin']);
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'plugin', pairs, changedPaths: ['README.md'] }), { scope: 'plugin', source: 'constant', note: null });
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: ['README.md'] }), { scope: null, source: 'none', note: null });
});
test('resolveCommitScope: ambiguous matches fall back with a sorted note — to constant, else unscoped', () => {
  const pairs = parseScopePaths(['plugin/skills/=skills', 'plugin/bin/=bin']);
  const paths = ['plugin/bin/x.js', 'plugin/skills/a.md'];
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: 'plugin', pairs, changedPaths: paths }), { scope: 'plugin', source: 'constant', note: ['bin', 'skills'] });
  assert.deepEqual(resolveCommitScope({ explicit: null, constant: null, pairs, changedPaths: paths }), { scope: null, source: 'none', note: ['bin', 'skills'] });
});
test('resolveCommitScope: blank explicit/constant are treated as absent', () => {
  assert.deepEqual(resolveCommitScope({ explicit: '  ', constant: '', pairs: [], changedPaths: [] }), { scope: null, source: 'none', note: null });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node -e "require('./plugin/bin/lib/commit-scope.js')"`
Expected: FAIL with `Cannot find module` (and `node --test tests/bin-lib/commit-scope.test.js` fails the same way once the test file exists)

- [ ] **Step 3: Implement `plugin/bin/lib/commit-scope.js`**

Header comment in the repo's module style (what it owns, who consumes it — `bin/lib/compose-subject.js` — and the precedence ladder in one line). Export `{ CommitScopeError, parseScopePaths, resolveCommitScope }`. Longest-prefix selection: for each path, filter pairs by `path.startsWith(prefix)`, pick the max `prefix.length`; the fallback branches as the Interfaces block states.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/commit-scope.test.js`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/commit-scope.js tests/bin-lib/commit-scope.test.js
git commit -m "Add commit-scope resolver — explicit > path prefix > constant > unscoped, refs #3298"
```

---

### Task 3: Composer wiring (`--range`, `gitRunner`, policy read)

**Files:**
- Modify: `plugin/bin/lib/compose-subject.js:17` (header usage), `:26-31` (exit-3 meaning widened), `:55` (`USAGE`), `:78-100` (`parseArgs`), `:203-215` (`realDeps`), `:288-300` (scope resolution before `composeSubject`)
- Modify: `plugin/bin/compose-subject.js` (header comment only if it lists flags — it does not today; leave untouched if so)
- Test: `tests/bin-lib/compose-subject.test.js:33-50` (`fakeDeps` gains three deps) and new cases after `:460`

**Interfaces:**
- Consumes: Task 1's `readCommitScope`, `readListKey`; Task 2's `parseScopePaths`, `resolveCommitScope`, `CommitScopeError`.
- Produces: `parseArgs` gains `range: string | null` (flag `--range <base>...<head>`, same missing-value handling as `--scope`). `realDeps` gains `readCommitScope: () => readCommitScope(process.cwd())`, `readCommitScopePaths: () => readListKey(process.cwd(), 'commit-scope-paths')`, `gitRunner: (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, windowsHide: true })` (`GIT_TIMEOUT_MS` from `./shared-primitives`, the getter `claims-git-cas.js:45` already imports). `USAGE` and the header usage line gain `[--range <base>...<head>]` after `[--scope <scope>]`. The header's exit-code paragraph reads `3 an external read failed — a \`gh issue view\` call, or the \`git diff --name-only\` behind --range`.
- Produces, in `run()` after the record loop and the Release Note check, before `composeSubject`: when `opts.scope` is set → `scope = opts.scope` (today's behaviour, no policy read, no git call). Otherwise: `constant = deps.readCommitScope()`; `pairs = parseScopePaths(deps.readCommitScopePaths())` — a `CommitScopeError` prints `compose-subject.js: {message}` to stderr and returns 1; when `pairs.length > 0` and `!opts.range` → stderr `compose-subject.js: commit-scope-paths is set but no --range was given — pass --range {base}...{head}` and return 1; when `pairs.length > 0` → `changedPaths = deps.gitRunner(['diff', '--name-only', opts.range]).split(/\r?\n/).map(trim).filter(Boolean)`, a throw prints `compose-subject.js: git diff --name-only {range} failed: {errMessage(err)}` and returns 3; when `pairs.length === 0`, `gitRunner` is never called even if `--range` was given. Then `resolveCommitScope({ explicit: null, constant, pairs, changedPaths })`; a non-null `note` prints `compose-subject.js: changed paths span scopes {note.join(', ')} — falling back to commit-scope "{scope}"` or `… — subject left unscoped`. The resolved `scope` replaces `scope: opts.scope` in the `composeSubject` call.

- [ ] **Step 1: Write the failing tests**

Extend `fakeDeps` (`tests/bin-lib/compose-subject.test.js:33`) with three optional parameters and deps: `commitScope = null` → `readCommitScope: () => commitScope`; `commitScopePaths = []` → `readCommitScopePaths: () => commitScopePaths`; `changedFiles = null` → `gitRunner: (args) => { out.gitCalls.push(args); if (changedFiles instanceof Error) throw changedFiles; if (changedFiles === null) throw new Error('gitRunner must not be called'); return changedFiles; }` with `out.gitCalls = []`. Then add:

```js
test('AC1.1: explicit --scope beats a commit-scope policy value', () => {
  const { deps, out } = fakeDeps({ commitScope: 'web' });
  assert.equal(run(['2251', '--scope', 'api', '--shell'], deps), 0, out.stderr);
  assert.match(out.stdout, /^SUBJECT_TITLE='feat\(api\): /);
  assert.equal(out.gitCalls.length, 0);
});
test('AC2.1: commit-scope-paths with one matching scope across the diff scopes the subject', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\nplugin/bin/lib/y.js\n' });
  assert.equal(run(['2251', '--range', 'main...feat', '--shell'], deps), 0, out.stderr);
  assert.match(out.stdout, /^SUBJECT_TITLE='feat\(bin\): /);
  assert.deepEqual(out.gitCalls, [['diff', '--name-only', 'main...feat']]);
});
test('AC2.2: paths spanning two scopes fall back to commit-scope with a stderr note', () => {
  const { deps, out } = fakeDeps({ commitScope: 'plugin', commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\nplugin/skills/a.md\n' });
  assert.equal(run(['2251', '--range', 'main...feat', '--shell'], deps), 0, out.stderr);
  assert.match(out.stdout, /^SUBJECT_TITLE='feat\(plugin\): /);
  assert.match(out.stderr, /span scopes bin, skills — falling back to commit-scope "plugin"/);
});
test('AC2.3: paths spanning two scopes with no commit-scope leave the subject unscoped, with the note', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/skills/=skills', 'plugin/bin/=bin'], changedFiles: 'plugin/bin/x.js\nplugin/skills/a.md\r\n\n' });
  assert.equal(run(['2251', '--range', 'main...feat', '--shell'], deps), 0, out.stderr);
  assert.match(out.stdout, /^SUBJECT_TITLE='feat: /);
  assert.match(out.stderr, /span scopes bin, skills — subject left unscoped/);
});
test('AC3.1: commit-scope-paths set with no --range exits 1 naming the flag', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'] });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /pass --range \{base\}\.\.\.\{head\}/);
  assert.equal(out.gitCalls.length, 0);
});
test('AC3.2: --range with no commit-scope-paths never calls git and composes as before', () => {
  const { deps, out } = fakeDeps({ commitScope: 'web' });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).title, 'feat(web): Merge-time conventional subject (#2251)');
  assert.equal(out.gitCalls.length, 0);
});
test('AC4.1: a throwing gitRunner exits 3 with the message on stderr', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin/=bin'], changedFiles: new Error('fatal: bad revision') });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 3);
  assert.match(out.stderr, /git diff --name-only main\.\.\.feat failed: fatal: bad revision/);
});
test('a malformed commit-scope-paths entry exits 1 naming the entry', () => {
  const { deps, out } = fakeDeps({ commitScopePaths: ['plugin/bin'] });
  assert.equal(run(['2251', '--range', 'main...feat'], deps), 1);
  assert.match(out.stderr, /commit-scope-paths entry "plugin\/bin" is not \{path-prefix\}=\{token\}/);
});
test('a policy-sourced token with ( fails composeSubject\'s own validation, exit 1', () => {
  const { deps, out } = fakeDeps({ commitScope: 'a(b' });
  assert.equal(run(['2251'], deps), 1);
  assert.match(out.stderr, /scope must be a single token/);
});
test('parseArgs and USAGE: --range parsed; trailing --range is an error; USAGE advertises it', () => {
  assert.equal(parseArgs(['2251', '--range', 'main...feat']).range, 'main...feat');
  assert.equal(parseArgs(['2251']).range, null);
  assert.ok(parseArgs(['2251', '--range']).error);
  const { USAGE } = require('../../plugin/bin/lib/compose-subject.js');
  assert.match(USAGE, /\[--range <base>\.\.\.<head>\]/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node -e "const { parseArgs } = require('./plugin/bin/lib/compose-subject.js'); if (parseArgs(['2251', '--range', 'a...b']).range !== 'a...b') process.exit(1)"`
Expected: FAIL (exit 1) — `parseArgs` returns `unknown argument: --range` today. (`node --test tests/bin-lib/compose-subject.test.js` then fails the ten new cases the same way: `range` undefined, policy-driven titles unscoped.)

- [ ] **Step 3: Implement the wiring in `plugin/bin/lib/compose-subject.js`**

Per the Interfaces block: `--range` in `parseArgs` (add it to the `--repo/--tag/--scope` value-taking branch); the three `realDeps` entries; the scope-resolution block placed after the Release Note check and before the `composeSubject` call; header usage line, `USAGE`, and the exit-3 paragraph updated. Import `{ readCommitScope, readListKey }` from `./policy` and `{ parseScopePaths, resolveCommitScope, CommitScopeError }` from `./commit-scope`, and `GIT_TIMEOUT_MS` from `./shared-primitives` (it already imports `GH_TIMEOUT_MS` from there).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/compose-subject.test.js`
Expected: PASS (every pre-existing case unchanged, plus the ten above)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/compose-subject.js tests/bin-lib/compose-subject.test.js
git commit -m "Resolve the merge-subject scope from policy in compose-subject.js — --range, gitRunner, explicit --scope wins, refs #3298"
```

---

### Task 4: Every merge fence passes `--range`; conformance regex tightened

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md:277`, `:292`, `:315`
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md:118`, `:125-131`
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:268`
- Modify: `plugin/skills/dispatch/settle-and-merge.md:400`
- Modify: `plugin/skills/flow/worktree-merge.md:63`, `:68-76` (step 2's composer-failure sentence)
- Test: `tests/merge-subject-composer-conformance.test.js:41` (`COMPOSER_CALL`)

**Interfaces:**
- Produces: six call lines of the shape `SUBJECT_EXPORTS=$(node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {records} [--tag …] --range {base}...{head} --shell) || exit 1`, using each file's own placeholders: `pr-first-merge.md` → `--range {integration-branch}...{branch}` (both sites); `local-merge-auto-finish.md` → `--range {base-branch}...{feature-branch}`; `auto-merge-short-circuit.md` → `--range {integration-branch}...{branch}`; `settle-and-merge.md` → `--range {integration-branch}...{branch}`; `worktree-merge.md` → `--range {base-branch}...{branch}`. `--range` goes immediately before `--shell`.
- Produces: `COMPOSER_CALL` = `/SUBJECT_EXPORTS=\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/compose-subject\.js" [^\n]*--range \{[a-z-]+\}\.\.\.\{[a-z-]+\} --shell\) \|\| exit 1\n[ \t]*eval "\$SUBJECT_EXPORTS"/`.

- [ ] **Step 1: Tighten the regex (the failing test)**

Replace `COMPOSER_CALL` at `tests/merge-subject-composer-conformance.test.js:41` with the Interfaces value. Leave `PRE_*` excerpts and every other assertion untouched.

- [ ] **Step 2: Run the test to verify it fails against the current fences**

Run: `node -e "const fs = require('fs'); const re = /--range \{[a-z-]+\}\.\.\.\{[a-z-]+\} --shell\) \|\| exit 1/; for (const f of ['plugin/skills/_shared/pr-first-merge.md', 'plugin/skills/_shared/local-merge-auto-finish.md', 'plugin/skills/wrap-up/auto-merge-short-circuit.md', 'plugin/skills/dispatch/settle-and-merge.md', 'plugin/skills/flow/worktree-merge.md']) if (!re.test(fs.readFileSync(f, 'utf8'))) process.exit(1)"`
Expected: FAIL (exit 1) — no fence carries `--range` yet. `node --test tests/merge-subject-composer-conformance.test.js` with the tightened regex also fails `composer eval line present` on all four `LOCAL_SITES` and the pr-first `assert.match(text, COMPOSER_CALL)` — AC8.1's discrimination proof that the tightened regex does not match the pre-change text.

- [ ] **Step 3: Edit the six call lines and the three prose sites**

Call lines per the Interfaces block. Prose:

`pr-first-merge.md:292` — replace the sentence `Append \`--scope {scope}\` when the project's commit convention requires \`type(scope):\`.` with `` `{scope}` resolves inside the composer from the `commit-scope`/`commit-scope-paths` policy keys (`_shared/policy-schema.md`) over the `--range` above — the run's branch is present locally in the session holding its worktree; an explicit `--scope {scope}` overrides both. `` (keeps the `--scope {scope}` literal `tests/pr-first-merge.test.js:264` pins).

`local-merge-auto-finish.md:128-130` ("On a composer failure" paragraph): after `a \`breaking\` label with no \`## Breaking Change\` section,` insert `or \`commit-scope-paths\` set while this call passes no \`--range\`,` so the sentence still reads as a list of shaping-vs-invocation causes.

`worktree-merge.md` step 2 ("If the composer call fails", `:68-76`): same insertion after `a \`breaking\` label with no \`## Breaking Change\` section`.

- [ ] **Step 4: Run the tests and the byte check**

Run: `node --test tests/merge-subject-composer-conformance.test.js tests/pr-first-merge.test.js tests/ceremony-profile-roster.test.js && wc -c plugin/skills/_shared/pr-first-merge.md`
Expected: PASS; `wc -c` ≤ 31304 (AC9.1). Then `grep -c -- '--range {' plugin/skills/_shared/pr-first-merge.md` prints `2`, and the same grep prints `1` for each of the four `LOCAL_SITES` files (AC6.1).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/_shared/local-merge-auto-finish.md plugin/skills/wrap-up/auto-merge-short-circuit.md plugin/skills/dispatch/settle-and-merge.md plugin/skills/flow/worktree-merge.md tests/merge-subject-composer-conformance.test.js
git commit -m "Pass --range from every merge fence — pr-first and local-merge compose identical scoped subjects, refs #3298"
```

---

### Task 5: Journey and structure docs

**Files:**
- Modify: `docs/journeys/merge-a-record-with-a-conventional-subject-2251.md:25`, `:29`, `:58-59`
- Modify: `docs/plugin-structure.md:57`, `:178` (and one new line after `:57`)

**Interfaces:**
- Consumes: the flag and key names from Tasks 1-4; nothing produced for later tasks.

- [ ] **Step 1: Edit the journey**

`:25` (the URL line): change `{n} --tag {tag} --shell` to `{n} --tag {tag} --range {base}...{head} --shell`.

`:29`: replace `A project whose convention needs \`type(scope):\` appends \`--scope {token}\` — today only \`_shared/pr-first-merge.md\` Step 3 instructs this; the four local-merge fences don't yet, so a scoped subject lands only on the pr-first path;` with `A project whose convention needs \`type(scope):\` sets the \`commit-scope\` and/or \`commit-scope-paths\` policy keys; every fence passes \`--range {base}...{head}\` so the composer can read the changed paths, an explicit \`--scope {token}\` overrides both, and \`commit-scope-paths\` set with no \`--range\` also exits 1;`.

After `:59`'s `#3028` bullet, add: `- Updated during build of #3298 (merge-subject scope source): the \`commit-scope\`/\`commit-scope-paths\` policy keys, the composer-side resolution, and \`--range\` on every fence — the "pr-first only" qualifier is gone`.

- [ ] **Step 2: Edit the structure doc**

`:57`: after `and prints plugin/bin/lib/release/subject.js's composeSubject() output as JSON or --shell assignments` insert `; resolves the type(scope): scope when --scope is absent — commit-scope / commit-scope-paths policy keys via bin/lib/commit-scope.js over the fence's --range {base}...{head} diff (#3298)`.

New line after `:57`: `plugin/bin/lib/commit-scope.js → parseScopePaths (commit-scope-paths entries → {prefix, token} pairs, first-= split, CommitScopeError on a malformed entry) + resolveCommitScope (explicit flag > longest-prefix path match over the changed files > commit-scope constant > unscoped, with an ambiguity note) — pure, no I/O (#3298). Consumed by plugin/bin/lib/compose-subject.js`.

`:178`: add `[--range <base>...<head>]` after `[--scope <scope>]`; after `optional type(scope): via --scope` add `, or from the commit-scope / commit-scope-paths policy keys over --range's diff when --scope is absent`; change `3 gh issue view failed` to `3 gh issue view or the --range git diff failed`.

- [ ] **Step 3: Verify**

Run: `grep -n "local-merge fences don't yet" docs/journeys/merge-a-record-with-a-conventional-subject-2251.md; grep -c "commit-scope.js" docs/plugin-structure.md`
Expected: the first grep prints nothing (AC7.1); the count is `2` or more. Then run every `tests/*.test.js` whose text names `plugin-structure.md` or `docs/journeys` (`grep -l "plugin-structure.md\|docs/journeys" tests/*.test.js | xargs node --test`) — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/journeys/merge-a-record-with-a-conventional-subject-2251.md docs/plugin-structure.md
git commit -m "Document the merge-subject scope source — journey 2251 and plugin-structure, refs #3298"
```

---

Waived AC11.1: `npm test` in full is run by `/build` Common Step 5, not by a plan task.
