# Record-less Housekeeping Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `compose-subject.js` compose a merge subject for a marker-stamped housekeeping PR that links no record, so tidy's (and wrap-up residue-sweep's) creation-time arm and the `## Arm ready PR` sweep backstop stop failing with `missing <n> argument`.

**Architecture:** A new pure composer `composeHousekeepingSubject` beside `composeSubject` in `plugin/bin/lib/release/subject.js` builds a `chore[(scope)]: {pr title} (#{pr})` subject with no `Release-Note:` and no `Fixes`/`Refs` lines. `plugin/bin/lib/compose-subject.js` gains a boolean `--housekeeping` flag: with it, `parseArgs` accepts zero record numbers but requires `--pr`, and `run` reads the PR (`gh pr view`) instead of records, refuses a PR whose body carries no housekeeping marker, neutralizes closing phrases in the title, and writes the result through the existing `--out-dir`/JSON output path. Skill prose at the three housekeeping arm sites is pointed at the new form, documented once in `_shared/pr-first-merge.md` Step 3.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T151011-record-5208/work/5208-spec.md`

## Global Constraints

- Without `--housekeeping`, a call with no `<n>` still refuses with `missing <n> argument` (exit 1) — byte-identical message to today.
- The record form's output (title, body, files, exit codes) is unchanged for every existing invocation.
- Housekeeping output: subject `chore[(scope)]: {title} (#{pr})` within `SUBJECT_BUDGET` (72) via the existing `truncateHead`; body has no `Release-Note:` line and no `Fixes #`/`Refs #` line (the PR closes no record).
- Exit codes keep the existing vocabulary (header comment, `#2319` decision): 1 malformed invocation or uncomposable input (now including "PR carries no housekeeping marker"), 2 `gh` absent / repo unresolvable, 3 an external read (`gh pr view`, `gh pr diff`) or an `--out-dir` write failed.
- Housekeeping marker regex is exactly `/<!-- (?:tidy-housekeeping-pr|wrap-up-residue-pr) -->/` — the same pattern `_shared/github-pr-scan.md` item 9 uses.
- `_shared/pr-first-merge.md` Step 3 must keep exactly four single-line merging fences and exactly two `PR_FIRST_COMPOSER_CALL` matches (`tests/merge-subject-composer-conformance.test.js`): document the record-less invocation in prose, never as a new fenced block.
- **Composed-bundle rail (binding):** `_shared/pr-first-merge.md` + `_shared/pr-checklist-refresh.md` compose the `merge` bundle (`wrap-up/auto-merge-short-circuit.md:254`, `wrap-up/execution-and-verification.md:83`, `wrap-up/merge-mode.md:25`, `dispatch/task-prompt.md:117`), whose composed max is **52,491 B against the 52,500 B rail** — 9 B of headroom. `pr-first-merge.md`'s raw size (37,313 B) is not the binding number. Every byte Task 2 adds to unfenced `pr-first-merge.md` prose must be offset by cutting restatement in the same file (e.g. Step 3's "**Creation-time caller:**" line restates degrade routing `tidy/step-7-5-worktree-always.md` already owns); net growth ≤ 0 B is the target. Verify with `plan-audit.js {plan} --bytes`'s `headroom.composed` (every `merge` row `over: 0`) and `node --test tests/bin-lib/skill-audit/context-cost.test.js`.
- Commit messages: `{Verb} {what} — {detail} — refs #5208`, never `closes`/`fixes`.
- Governing skill `gh-api-module-pattern` (quoted verbatim, applicable rules):
  - "**The quiet posture is owed by any call the module catches and recovers from, not only by a probe seam — and a catch that reads the error text needs stderr `'pipe'`, not `'ignore'`.**" — the new `gh pr view` call goes through the existing `deps.runner` (already `stdio: ['ignore', 'pipe', 'pipe']`); add no new spawn.
  - "**A `--repo` argument is a *slug*, and the slug is host-qualified — never hand-roll `` `${owner}/${repo}` `` at one.**" — pass the existing `slug` (`repoSlug(repoSpec)`) to `gh pr view --repo`.
  - "**Bound every remote-contacting call on the seam; a local-only call owes no bound.**" — `deps.runner` already carries `GH_TIMEOUT_MS`; no new runner.
  - "**The inverse decision needs the same evidence: a domain outcome no caller can act on differently stays on the base code, overloaded and documented.**" — the missing-marker refusal is exit 1, not a new code; extend the header comment's exit-code list to name it.
  - "**A Split-1/2 CLI that also writes caller-named files maps a write failure to its remote-failure code and states that it is a create-only, no-lock overwrite.**" — the housekeeping path reuses the existing `--out-dir` write block unchanged.

## Review Focus

- PR title already Conventional-Commits shaped (`chore: Prune plans`) → subject must not read `chore: chore: Prune plans`; strip one leading `{word}[(scope)][!]: ` prefix from the title before composing. Test in Task 1.
- PR title containing a closing phrase (`Prune plans (closes #12)`) → the squash commit lands on main and would close #12; the title is passed through `neutralizeClosingPhrases` (`plugin/bin/lib/flow/closing-links.js`) before composing. Test in Task 1.
- A record-linked PR (no marker) sent through `--housekeeping` → must refuse (exit 1), never merge a record PR without its `Fixes` lines. Test in Task 1.
- `--housekeeping` combined with a record number, `--keep-open`, or `--range`, or missing `--pr` → exit 1 with a usage message. Test in Task 1.
- Over-long PR title → subject truncated within 72 chars with the `(#{pr})` suffix intact. Test in Task 1.

---

### Task 1: Record-less housekeeping composer

**Role:** integration
**Review risk:** high (gates a merge that carries no `Fixes` line)

**Files:**
- Modify: `plugin/bin/lib/release/subject.js` (add `composeHousekeepingSubject`, export it; extend header comment by one sentence)
- Modify: `plugin/bin/lib/compose-subject.js` (`parseArgs`, `run`, `USAGE`, header comment)
- Test: `tests/bin-lib/release/subject.test.js`
- Test: `tests/bin-lib/compose-subject.test.js`

**Interfaces:**
- Produces: `composeHousekeepingSubject({ title: string, number: number, scope?: string|null, tag?: string|null }) -> { title: string, body: string }` exported from `plugin/bin/lib/release/subject.js`. Throws `ComposeSubjectError` on a non-positive `number`, an empty `title`, or a scope failing the same token rule as `composeSubject`.
- Produces: `parseArgs` result gains `housekeeping: boolean`.
- Produces: CLI form `compose-subject.js --housekeeping --pr <n> [--repo …] [--tag <tag>] [--scope <scope>] [--out-dir <dir>]`.
- Consumes: `neutralizeClosingPhrases(text, { owner, repo }) -> { text, neutralized }` from `plugin/bin/lib/flow/closing-links.js`.

- [ ] **Step 1: Write the failing tests in `tests/bin-lib/release/subject.test.js`**

```js
test('composeHousekeepingSubject: chore subject from the PR title, body has no Release-Note and no Fixes/Refs line', () => {
  const out = composeHousekeepingSubject({ title: 'Prune 111 completed execution plans', number: 5207 });
  assert.equal(out.title, 'chore: Prune 111 completed execution plans (#5207)');
  assert.equal(out.body, 'Prune 111 completed execution plans');
  assert.doesNotMatch(out.body, /Release-Note:|^(Fixes|Refs) #/m);
  const tagged = composeHousekeepingSubject({ title: 'Prune plans', number: 9, tag: 'housekeeping', scope: 'tidy' });
  assert.equal(tagged.title, 'chore(tidy): Prune plans (#9)');
  assert.equal(tagged.body, 'Prune plans\n\n[housekeeping]');
});

test('composeHousekeepingSubject: a Conventional-Commits-shaped title loses its prefix, an over-long one truncates within the budget', () => {
  assert.equal(composeHousekeepingSubject({ title: 'chore(tidy)!: Prune plans', number: 9 }).title, 'chore: Prune plans (#9)');
  const long = composeHousekeepingSubject({ title: 'Prune '.repeat(30).trim(), number: 5207 });
  assert.ok(long.title.length <= SUBJECT_BUDGET, long.title);
  assert.ok(long.title.endsWith('… (#5207)'), long.title);
});

test('composeHousekeepingSubject: throws ComposeSubjectError on a bad number, an empty title, or a bad scope', () => {
  for (const bad of [{ title: 'T', number: 0 }, { title: '  ', number: 9 }, { title: 'T', number: 9, scope: 'a b' }]) {
    assert.throws(() => composeHousekeepingSubject(bad), (err) => err instanceof ComposeSubjectError);
  }
});
```

Add `composeHousekeepingSubject` to the file's existing `require` destructure.

**Also in Step 1 — `tests/bin-lib/compose-subject.test.js`:** extend `fakeDeps` with a `prView = null` option: in `runner`, when `args[0] === 'pr' && args[1] === 'view'`, push the call, throw `new Error('gh pr view must not be called')` when `prView === null`, throw it when it is an `Error`, else return `JSON.stringify(prView)`; keep the existing `pr diff` branch (move its `assert.deepEqual(args.slice(0, 2), ['pr', 'diff'])` below the new `view` branch). Fixture: `const HK_PR = { number: 5207, title: 'Prune 111 completed execution plans', body: '<!-- tidy-housekeeping-pr -->\nTidy housekeeping.' };`.

```js
test('AC2.1: --housekeeping --pr {n} --out-dir {d} exits 0 and writes a chore subject and a body with no Release-Note or Fixes line', () => {
  const { deps, out } = fakeDeps({ prView: HK_PR });
  const code = run(['--housekeeping', '--pr', '5207', '--out-dir', '/tmp/hk'], deps);
  assert.equal(code, 0, out.stderr);
  const title = 'chore: Prune 111 completed execution plans (#5207)';
  assert.equal(out.files[nodePath.join(nodePath.resolve(PHANTOM_CWD, '/tmp/hk'), 'title.txt')], title);
  const body = out.files[nodePath.join(nodePath.resolve(PHANTOM_CWD, '/tmp/hk'), 'body.md')];
  assert.equal(body, 'Prune 111 completed execution plans');
  assert.equal(out.stdout, `'${title}'\n`);
  assert.deepEqual(out.calls[0].slice(0, 3), ['pr', 'view', '5207']);
  assert.ok(out.calls[0].includes('acme/repo'));
  assert.ok(!out.calls.some((c) => c[0] === 'issue'), 'no gh issue view in the record-less form');
});

test('AC2.2: --pr {n} with no <n> and no --housekeeping still exits 1 with missing <n> argument', () => {
  const { deps, out } = fakeDeps();
  assert.equal(run(['--pr', '5207', '--out-dir', '/tmp/hk'], deps), 1);
  assert.match(out.stderr, /^missing <n> argument\n/);
  assert.equal(out.calls.length, 0);
});

test('--housekeeping usage errors: with a record number, --keep-open, --range, or without --pr — exit 1, no gh call', () => {
  for (const argv of [['5207', '--housekeeping', '--pr', '1'], ['--housekeeping', '--pr', '1', '--keep-open', '2'], ['--housekeeping', '--range', 'a...b'], ['--housekeeping']]) {
    const { deps, out } = fakeDeps({ prView: HK_PR });
    assert.equal(run(argv, deps), 1, argv.join(' '));
    assert.equal(out.calls.length, 0, argv.join(' '));
  }
});

test('--housekeeping refuses a PR body with no housekeeping marker (exit 1), accepts the wrap-up-residue-pr marker', () => {
  const plain = fakeDeps({ prView: { ...HK_PR, body: 'Fixes #12' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], plain.deps), 1);
  assert.match(plain.out.stderr, /no housekeeping marker/);
  const residue = fakeDeps({ prView: { ...HK_PR, body: '<!-- wrap-up-residue-pr -->' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], residue.deps), 0, residue.out.stderr);
});

test('--housekeeping neutralizes a closing phrase in the PR title', () => {
  const { deps, out } = fakeDeps({ prView: { ...HK_PR, title: 'Prune plans (closes #12)' } });
  assert.equal(run(['--housekeeping', '--pr', '5207'], deps), 0, out.stderr);
  const { title, body } = JSON.parse(out.stdout);
  assert.doesNotMatch(`${title}\n${body}`, /closes #12/);
});

test('--housekeeping: a failed or unparseable gh pr view exits 3', () => {
  assert.equal(run(['--housekeeping', '--pr', '5207'], fakeDeps({ prView: new Error('boom') }).deps), 3);
  const bad = fakeDeps({ prView: HK_PR });
  const runner = bad.deps.runner;
  bad.deps.runner = (args) => (args[1] === 'view' ? 'not json' : runner(args));
  assert.equal(run(['--housekeeping', '--pr', '5207'], bad.deps), 3);
});

test('USAGE advertises --housekeeping', () => {
  assert.match(USAGE, /--housekeeping/);
});
```

Import `USAGE` in the file's existing destructure if it is not already imported. Under `commit-scope-paths`, the housekeeping path resolves scope over `gh pr diff` exactly as the record form does — no extra test needed beyond the existing `--pr` scope tests, since the scope block is shared.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js`
Expected: FAIL — `composeHousekeepingSubject is not a function`; `--housekeeping` rejected as `unknown argument: --housekeeping`.

- [ ] **Step 3: Implement `composeHousekeepingSubject` in `plugin/bin/lib/release/subject.js`**

Prefix `chore`, scope validated with the same regex and the same too-long check as `composeSubject` (factor the shared scope/prefix/head lines into one local helper used by both rather than copying them), title first stripped of one leading `^[A-Za-z]+(\([^)]*\))?!?:\s+` prefix then trimmed, head via `truncateHead`, suffix ` (#{number})`. Body paragraphs: the cleaned (untruncated) title, then `[{tag}]` when `tag` is a non-blank string, joined by `\n\n`. Add one sentence to the header comment naming the record-less housekeeping form and that it carries no `Release-Note:`/`Fixes` lines.

- [ ] **Step 4: Implement the `--housekeeping` path in `plugin/bin/lib/compose-subject.js`**

- `parseArgs`: `opts.housekeeping = false`; `--housekeeping` sets it (boolean, consumes no value). After the loop, when `housekeeping`: error `'--housekeeping takes no <n> argument'` if `numbers.length`, `'--housekeeping takes no --keep-open'` if `keepOpen.length`, `'--housekeeping requires --pr'` if `pr === null` (this also covers `--range`, which forbids `--pr`); skip the `missing <n> argument` check. Without it, today's checks run unchanged and in today's order.
- `run`: after repo resolution, when `opts.housekeeping`: `deps.runner(['pr', 'view', String(opts.pr), '--repo', slug, '--json', 'number,title,body'], injected)` (throw → exit 3 `compose-subject.js: gh pr view {n} failed: …`; unparseable → exit 3); body not matching `HOUSEKEEPING_MARKER` (module constant, regex in Global Constraints) → exit 1 `compose-subject.js: PR #{n} carries no housekeeping marker (<!-- tidy-housekeeping-pr --> or <!-- wrap-up-residue-pr -->) — the record-less form is for housekeeping PRs only`; title through `neutralizeClosingPhrases(title, { owner: repoSpec.owner, repo: repoSpec.repo }).text`. Skip the record loop and the Release Note / Breaking Change checks; run the existing scope block unchanged; compose with `composeHousekeepingSubject({ title, number: opts.pr as Number, scope, tag: opts.tag })` (catch `ComposeSubjectError` → exit 1 like today); fall through to the existing output block.
- `USAGE` and the header `// Usage:` line gain `[--housekeeping]`; the header gains one paragraph describing the record-less form and its marker refusal (exit 1).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/release/subject.js plugin/bin/lib/compose-subject.js tests/bin-lib/release/subject.test.js tests/bin-lib/compose-subject.test.js
git commit -m "Add a record-less --housekeeping form to compose-subject.js — chore subject from the PR title, no Fixes or Release-Note — refs #5208"
```

### Task 2: Point the housekeeping arm sites at the record-less form

**Role:** integration
**Review risk:** high (decides which composer fences merge with no `Fixes` line, and the Arm ready PR flavor branch)

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge.md` (Step 3, the "Creation-time caller" line) — raw 37,313 B is fine, but the composed `merge` bundle has 9 B of headroom (Global Constraints): net growth ≤ 0 B
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (the `pr-first` bullet's "Then run Step 3's fences only where the table routes to Step 3." sentence) — 13,003 B, ample headroom
- Modify: `plugin/skills/tidy/actions-github-issues.md` (`## Arm ready PR`, the "If every gate still holds" paragraph) — 15,669 B, ample headroom
- Modify: `plugin/skills/wrap-up/residue-sweep.md` (the `pr-first` bullet's "arm now via `_shared/pr-first-merge.md` Step 3's initial compose + `gh pr merge --auto` fences" clause) — same defect, not named in the spec's Key Files; found by the behavior-change sweep for `<!-- wrap-up-residue-pr -->`
- Test: `tests/merge-subject-composer-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI form `compose-subject.js --housekeeping --pr <n> [--tag <tag>] --out-dir "<dir>"`.

- [ ] **Step 1: Write the failing conformance test in `tests/merge-subject-composer-conformance.test.js`**

```js
test('AC1.1: every housekeeping arm site composes with the record-less --housekeeping form', () => {
  const HK_CALL = 'compose-subject.js" --housekeeping --pr {pr-number} --out-dir "{subject-dir}"';
  const text = read(PR_FIRST);
  const start = text.indexOf('## Step 3:');
  const step3 = text.slice(start, text.indexOf('\n## ', start + 1));
  assert.match(step3, /--housekeeping/, 'pr-first-merge.md Step 3 documents the record-less form');
  assert.match(step3, /--housekeeping[^\n]*branch 1|branch 1[^\n]*--housekeeping/, "the record-less form covers every composer fence, branch 1's immediate-merge degrade included");
  assert.ok(read('plugin/skills/tidy/step-7-5-worktree-always.md').includes(HK_CALL), 'tidy Step 7.5 carries the full record-less command');
  for (const rel of ['plugin/skills/tidy/actions-github-issues.md', 'plugin/skills/wrap-up/residue-sweep.md']) {
    assert.match(read(rel), /--housekeeping/, `${rel} names the record-less form`);
  }
  assert.doesNotMatch(read('plugin/skills/wrap-up/residue-sweep.md'), /not its degrade chain/, "residue-sweep runs Step 3 branch 1's immediate-merge degrade (record Decision)");
  // go-red: the pre-change Step 3 composer line is record-only
  assert.doesNotMatch('node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" {issue-list} --tag {tag} --keep-open {keep-open} --pr {pr-number} --out-dir "{subject-dir}"', /--housekeeping/);
});
```

(`read` and `PR_FIRST` already exist in the file; adjust `read`'s argument form to whatever that helper takes.)

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/merge-subject-composer-conformance.test.js`
Expected: FAIL on `pr-first-merge.md Step 3 documents the record-less invocation`.

- [ ] **Step 3: Edit the prose**

- `pr-first-merge.md` Step 3: append one short sentence to the "**Creation-time caller:**" line covering **every** composer fence in Step 3, branch 1's immediate-merge degrade (`merge-verification: off`) included (the record's Decision) — e.g. `A marker-stamped PR has no {issue-list}: every composer fence here, branch 1's included, passes --housekeeping in place of it, --tag and --keep-open.` (housekeeping composes carry no `--tag` — the plan-review settlement; `{tag}`'s definition list stays unchanged) (inline code as needed; the sentence must name `--housekeeping` and `branch 1` on one line — the Step 1 test pins it). Do not drop the restated degrade list. **Pinned, do not alter:** that line's `**Creation-time caller:**` label, its `Step 2.5` mention and the literal `Red path, Conflict path and ready+comment degrades become leave-unarmed` (`tests/tidy-housekeeping-pr-check-wait-conformance.test.js`), and line 299's `a caller with no \`Fixes\` record (tidy's housekeeping arm)` (`tests/accept-park-prose-conformance.test.js`). Offset the added bytes (net ≤ +9 B, Global Constraints) by tightening unpinned restatement elsewhere in `pr-first-merge.md` — before cutting any phrase, `git grep -n -F '{phrase}' -- tests plugin` and leave any phrase a test or another skill file reads. Keep the four fences byte-identical. Re-measure with `node "/Users/thomasholknielsen/.claude/plugins/cache/claude-tweaks-marketplace/claude-tweaks/6.176.0/bin/plan-audit.js" docs/superpowers/plans/2026-11-23-record-less-housekeeping-arm.md --bytes` (every `merge` row in `headroom.composed` must show `over: 0`).
- `tidy/step-7-5-worktree-always.md`: after "Then run Step 3's fences only where the table routes to Step 3.", add that the composer fence takes the record-less form — `node "${CLAUDE_PLUGIN_ROOT}/bin/compose-subject.js" --housekeeping --pr {pr-number} --out-dir "{subject-dir}"`, no `{issue-list}` and no `--keep-open` (a housekeeping PR links no record).
- `tidy/actions-github-issues.md` `## Arm ready PR`: in "If every gate still holds …", add that the housekeeping-marker flavor composes with Step 3's record-less `--housekeeping` form (no `--tag`), the record-linked flavor with its `Fixes` records as `{issue-list}`.
- `wrap-up/residue-sweep.md`: extend "arm now via `_shared/pr-first-merge.md` Step 3's initial compose + `gh pr merge --auto` fences" with "— the compose in its record-less `--housekeeping` form", and replace "(not its degrade chain — failure leaves it unarmed, reported)" with a clause that runs Step 3 branch 1's degrade as Step 3 routes it (under `merge-verification: off`, the immediate merge — a success, logged `merged`), any other failure leaving it unarmed, reported (record Decision: "The same rule covers the sweep backstop and `<!-- wrap-up-residue-pr -->` PRs"; plan-review settlement, Reading B).

- [ ] **Step 4: Run the touched prose suites**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js tests/merge-subject-composer-conformance.test.js tests/tidy-housekeeping-pr-check-wait-conformance.test.js tests/tidy-arm-ready-pr-acceptance-guard.test.js tests/merge-verification-gate-conformance.test.js tests/sweep-backstop.test.js tests/below-floor-parent-close-conformance.test.js tests/accept-park-prose-conformance.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/_shared/pr-first-merge.md plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/tidy/actions-github-issues.md plugin/skills/wrap-up/residue-sweep.md tests/merge-subject-composer-conformance.test.js
git commit -m "Point the housekeeping arm sites at compose-subject.js --housekeeping — tidy Step 7.5, Arm ready PR, residue-sweep — refs #5208"
```

## Acceptance coverage

| Clause | Covered by |
|---|---|
| AC1.1 (housekeeping PR logs `armed` or `merged`, never `arm-failed`) | Task 2 Step 1 `AC1.1` prose test + Task 1 `AC2.1` CLI test (the arm failed only because the composer exited 1) — accepted as AC1's coverage by the record's Decision; a live outcome is not observable in a unit suite |
| AC2.1 | Task 1 Step 2 `AC2.1` |
| AC2.2 | Task 1 Step 2 `AC2.2` |
| AC3.1 (`npm test` passes) | `/claude-tweaks:build` Common Step 5 final verification |
