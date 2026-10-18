# Chained Claim Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One exported claim-reader helper in `claim-store.js` replaces the two hand-built chained readers in `specify/shaping-mode.md` and `dispatch/queue-pull-script.md`, and an unresolved repo slug becomes a read failure on both, never an absent claim.

**Architecture:** `createClaimReader(deps)` resolves the repo slug once, then returns `{ repoSlug, read }`. `read(n)` calls the existing `readClaimBlob`, chains the git tip from the first git read, and hands `readClaimBlob` a stub `ghApi` when the slug is unresolved, so the contents-API path reports `repo-slug-unresolved` and never requests `repos/null/...`. Both heredocs call the helper; the shaping fence also reports the failed reads in an `unreadable` array.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T183730-record-3393/work/3393-spec.md`

Scope keywords: readClaimBlob(, repo-slug-unresolved

## Global Constraints

- Helper lives in `plugin/bin/lib/issues/claim-store.js` and is exported from its `module.exports`.
- Per-record return is exactly `{ content }` (string or `null` for absent) or `{ failure }` (string).
- Unresolved slug on the contents-API path → `{ failure: 'repo-slug-unresolved' }` (the literal dispatch already uses).
- `plugin/skills/dispatch/queue-pull-script.md` must stay under 51,200 bytes (49,445 today; this change shrinks it). `plugin/skills/specify/shaping-mode.md` must stay under `SPECIFY_SUBFILE_CEILING_BYTES` = 28,672 (19,091 today).
- The shaping fence runs inside `node -e "..."`: its body may contain no `"`, `$`, or backtick.
- No user-visible change (Release Note).

## Review Focus

1. Slug unresolved but the git read succeeds — must return the git answer (content or absent), not `repo-slug-unresolved`. Pinned in Task 1 (`git hit with unresolved slug`).
2. Tip chaining: after a git hit, the next read must reuse the tip (one `git fetch` total). Pinned in Task 1 (`chains the git tip`).
3. A contents-API answer must never set the chained tip (a blob sha is not a commit sha). Pinned in Task 1 (`contents-API hit`, asserts the next read fetches again).
4. `gh repo view` printing an empty line — must resolve to `null`, not `''`. Pinned in Task 1 (`resolveRepoSlug`).
5. Shaping fence output on the happy path must stay `{ refuse: false }` exactly — no empty `unreadable` key. Pinned by the existing fence test in `tests/specify-near-duplicate-prose.test.js`.

---

### Task 1: `createClaimReader` helper in claim-store.js

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js` (add two functions after `readClaimBlobContentsApi`; extend `module.exports`; require `defaultRunner` from `./claims-git-cas`)
- Test: `tests/bin-lib/issues/claim-store.test.js` (append; reuse the file's `isRead`, `fakeGitRunnerAlwaysWorks`, `fakeGitRunnerAlwaysFails`)

**Interfaces:**
- Produces: `resolveRepoSlug(runGh?) -> string|null` — `runGh(args)` returns stdout or throws; default runs `gh repo view --json nameWithOwner -q .nameWithOwner` via `execFileSync` with `timeout: GH_TIMEOUT_MS`, `windowsHide: true`. Trimmed; empty or thrown → `null`.
- Produces: `createClaimReader({ gitRunner?, ghApi?, repoSlug?, runGh? } = {}) -> { repoSlug: string|null, read(issueNumber) -> { content: string|null } | { failure: string } }`. Defaults: `gitRunner` = claims-git-cas `defaultRunner`, `ghApi` = `defaultGhApi`. `repoSlug` used as given when the key is present (including `null`); otherwise `resolveRepoSlug(runGh)`. `read` is a closure (callers pass it unbound).

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/claim-store.test.js`, add `createClaimReader, resolveRepoSlug` to the require)

```js
test('createClaimReader: git hit returns content and chains the git tip (one fetch for two reads)', () => {
  let fetches = 0;
  const base = fakeGitRunnerAlwaysWorks('a'.repeat(40), '{"runId":"r1"}');
  const gitRunner = (args) => { if (args[0] === 'fetch') fetches += 1; return base(args); };
  const ghApi = () => { throw new Error('contents API must not be called on a git hit'); };
  const { read } = createClaimReader({ gitRunner, ghApi, repoSlug: 'acme/w' });
  assert.deepEqual(read(42), { content: '{"runId":"r1"}' });
  assert.deepEqual(read(43), { content: '{"runId":"r1"}' });
  assert.equal(fetches, 1);
});

test('createClaimReader: git hit with unresolved slug still returns the git answer', () => {
  const gitRunner = fakeGitRunnerAlwaysWorks('a'.repeat(40), null);
  const ghApi = () => { throw new Error('contents API must not be called on a git hit'); };
  assert.deepEqual(createClaimReader({ gitRunner, ghApi, repoSlug: null }).read(42), { content: null });
});

test('createClaimReader: contents-API hit when git fails, and the blob sha never becomes the chained tip', () => {
  let fetches = 0;
  const failing = fakeGitRunnerAlwaysFails();
  const gitRunner = (args) => { if (args[0] === 'fetch') fetches += 1; return failing(args); };
  const ghApi = (args) => {
    assert.equal(isRead(args, 'claims/issue-42.json'), true);
    return { stdout: JSON.stringify({ content: '{"runId":"r2"}', sha: 'blobsha' }), failure: null, status: null };
  };
  const { read } = createClaimReader({ gitRunner, ghApi, repoSlug: 'acme/w' });
  assert.deepEqual(read(42), { content: '{"runId":"r2"}' });
  read(42);
  assert.equal(fetches, 2);
});

test('createClaimReader: contents-API 404 reads as absent ({content: null})', () => {
  const ghApi = (args) => { assert.equal(isRead(args, 'claims/issue-42.json'), true); return { stdout: null, failure: null, status: 404 }; };
  assert.deepEqual(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: 'acme/w' }).read(42), { content: null });
});

test('AC1.1: createClaimReader: unresolved slug with a failing git read is a failure, never absent, and never asks repos/null', () => {
  const ghApi = (args) => { throw new Error(`contents API must not be called without a slug: ${args[0]}`); };
  const reader = createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: null });
  assert.equal(reader.repoSlug, null);
  assert.deepEqual(reader.read(42), { failure: 'repo-slug-unresolved' });
});

test('createClaimReader: a contents-API transport failure propagates as {failure}', () => {
  const ghApi = () => ({ stdout: null, failure: 'network-failure', status: null });
  assert.deepEqual(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), ghApi, repoSlug: 'acme/w' }).read(42), { failure: 'network-failure' });
});

test('createClaimReader: resolves the slug through runGh when none is given', () => {
  const runGh = (args) => { assert.deepEqual(args, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); return 'acme/w\n'; };
  assert.equal(createClaimReader({ gitRunner: fakeGitRunnerAlwaysFails(), runGh }).repoSlug, 'acme/w');
});

test('resolveRepoSlug: a thrown or empty gh answer resolves to null', () => {
  assert.equal(resolveRepoSlug(() => { throw new Error('gh: not logged in'); }), null);
  assert.equal(resolveRepoSlug(() => '\n'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL with "createClaimReader is not a function"

- [ ] **Step 3: Implement `resolveRepoSlug` and `createClaimReader` in `plugin/bin/lib/issues/claim-store.js`**

`read(n)`: `const r = readClaimBlob({ gitRunner, ghApi: slug ? ghApi : unresolvedSlugGhApi }, slug, n, tip)` where `unresolvedSlugGhApi = () => ({ stdout: null, failure: 'repo-slug-unresolved', status: null })`; on `r.failure` return `{ failure: r.failure }`; when `r.via === 'git'` set `tip = r.sha`; return `{ content: r.absent ? null : r.content }`. Add a header comment naming #3393 and the `repos/null` 404 it closes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Add createClaimReader to claim-store — one chained claim reader, unresolved slug is a failure (refs #3393)"
```

### Task 2: Move both heredocs onto the helper

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md` (the `node -e "` refusal fence and the paragraph after it, ~lines 113-155)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (the `#3278: neighbour-in-flight pass` heredoc, ~lines 620-640)
- Modify: `plugin/skills/dispatch/mcp-transport.md:114` (`claim-store.js`'s `readClaimBlob` → `createClaimReader`)
- Test: `tests/specify-near-duplicate-prose.test.js` (append)
- Test: `tests/dispatch-per-record-groups-prose.test.js` (append)

**Interfaces:**
- Consumes: `createClaimReader()` → `{ repoSlug, read }` from Task 1.

- [ ] **Step 1: Write the failing tests**

Append to `tests/specify-near-duplicate-prose.test.js`, reusing the file's fence-extraction anchors (`open = 'node -e "\n'`, `close = '" "$NEAR_DUP_HITS" "$NEAR_DUP_SNAPSHOT"\n'`):

```js
test('AC1.1: the shaping-mode refusal fence reads claims through createClaimReader and reports failed reads as unreadable (#3393)', () => {
  const start = SHAPING_MODE.indexOf('node -e "\n');
  const fence = SHAPING_MODE.slice(start, SHAPING_MODE.indexOf('" "$NEAR_DUP_HITS" "$NEAR_DUP_SNAPSHOT"\n', start));
  assert.match(fence, /createClaimReader\(\)/);
  assert.doesNotMatch(fence, /readClaimBlob\(/);
  assert.doesNotMatch(fence, /'repo', 'view'/);
  assert.match(fence, /unreadable/);
  const after = SHAPING_MODE.slice(SHAPING_MODE.indexOf('" "$NEAR_DUP_HITS" "$NEAR_DUP_SNAPSHOT"\n', start));
  assert.match(after.slice(0, 1500), /`unreadable`/);
});
```

Append to `tests/dispatch-per-record-groups-prose.test.js` (it already reads `QUEUE_PULL`):

```js
test('AC1.1: the neighbour-in-flight pass reads claims through createClaimReader (#3393)', () => {
  const start = QUEUE_PULL.indexOf('# #3278: neighbour-in-flight pass');
  const block = QUEUE_PULL.slice(start, QUEUE_PULL.indexOf('NEIGHBOUR_RC=$?', start));
  assert.ok(start !== -1, 'neighbour-in-flight anchor must exist');
  assert.match(block, /readClaimContent: createClaimReader\(\)\.read/);
  assert.doesNotMatch(block, /readClaimBlob\(/);
  assert.doesNotMatch(block, /'repo', 'view'/);
});

test('AC2.1: the neighbour-in-flight heredoc runs offline and excludes nothing when no in-flight record neighbours a candidate (#3393)', () => {
  // extract between the node-eval-file line's '<<NODE_EVAL_EOF\n' and '\nNODE_EVAL_EOF\nNEIGHBOUR_RC',
  // substitute ${CLAUDE_PLUGIN_ROOT} with path.join(ROOT, 'plugin'), run with
  // execFileSync(process.execPath, ['-e', code, groupsFile, inFlightFile, exclusionsFile]) where
  // groups = [[{ number: 1, body: '### Key Files\n\n- `a.js`\n', labels: [] }]], inFlight = [] —
  // no neighbour, so no claim read and no network. Assert exit 0 and that the exclusions file
  // is absent or holds no neighbour-in-flight entry.
});
```

(The AC2.1 test body is written by the implementer from the comment; keep the anchors exact and use `os.tmpdir()` + `fs.mkdtempSync`, removing the directory afterward, as the shaping fence test does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/specify-near-duplicate-prose.test.js tests/dispatch-per-record-groups-prose.test.js`
Expected: FAIL — the two AC1.1 tests (no `createClaimReader` in either block). The AC2.1 test may already pass (append-shaped: it pins today's happy path and must stay green after Step 3).

- [ ] **Step 3: Rewrite the two blocks**

Shaping fence: require `{ createClaimReader }` instead of `readClaimBlob`/`defaultGhApi`/`defaultRunner`; inside `if (numbers.length)`, `const claims = createClaimReader();`, loop `const r = claims.read(n); if (r.failure) unreadable.push(n); claimContentByNumber[n] = r.failure ? null : r.content;`; split `claims.repoSlug` for owner/repo; keep the GraphQL block (it still needs `execFileSync`). Build the output object as before and add `out.unreadable = unreadable` only when non-empty. The paragraph after the fence: a failed claim read — including an unresolved repo slug, which is never read as an absent claim — still leaves the candidate not in flight, and now lands in the output's `unreadable` list, which is quoted beside the candidate table.

Dispatch heredoc: drop the `execFileSync`, `readClaimBlob`/`defaultGhApi`, `defaultRunner` requires and the `slug`/`tip`/`readClaimContent` block; require `{ createClaimReader }` and pass `readClaimContent: createClaimReader().read`.

`mcp-transport.md:114`: replace "`claim-store.js`'s `readClaimBlob` over git and `gh api`" with "`claim-store.js`'s `createClaimReader` over git and `gh api`".

- [ ] **Step 4: Run tests to verify they pass, and check byte ceilings**

Run: `node --test tests/specify-near-duplicate-prose.test.js tests/dispatch-per-record-groups-prose.test.js tests/bin-lib/skill-audit/context-cost.test.js tests/dispatch-named-form-exclusion-reasons.test.js`
Expected: PASS, 0 failures
Run: `wc -c plugin/skills/specify/shaping-mode.md plugin/skills/dispatch/queue-pull-script.md`
Expected: below 28672 and 51200 respectively.
Run: `git grep -n "readClaimBlob(" -- plugin/skills`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/mcp-transport.md tests/specify-near-duplicate-prose.test.js tests/dispatch-per-record-groups-prose.test.js
git commit -m "Move shaping-mode and neighbour-pass claim reads onto createClaimReader (refs #3393)"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (helper) | Task 1 |
| Deliverable 2 (both heredocs) | Task 2 |
| Deliverable 3 (tests: git hit, contents-API hit, 404 absent, unresolved slug, transport failure) | Task 1 |
| AC1.1 (unresolved slug + failing git → unreadable on both callers) | Task 1 helper test; Task 2 caller pins |
| AC2.1 (same results on the gh-present happy path) | Task 2: existing shaping fence test (`{ refuse: false }`) + new dispatch heredoc run |
