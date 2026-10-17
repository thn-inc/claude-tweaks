# Dispatch First Call on the Capable Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `/claude-tweaks:dispatch`'s first Task call (`build,test`) from the Standard to the Capable model profile, name the `model-ceiling: standard` clamp beside it, and have the dispatching session log each group's resolved first-call model to the group's `decisions.md`.

**Architecture:** Two additive prose edits to one skill sub-file (`plugin/skills/dispatch/task-prompt.md`): the FIRST-call template's `[Use: ...]` line and `resolve-profile.js` argument (plus a clamp caveat paragraph right after that template's fence), and a new dispatching-session instruction in the file's Context pack section. A new `node --test` conformance suite pins both templates' profiles, the caveat, and the log instruction. The SECOND-call template is untouched.

**Tech Stack:** Markdown skill prose; Node 18+ `node --test` (built-in runner, no deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T161758-spec-3224/work/3224-spec.md` (record #3224)

Scope keywords: Dispatch group {group}: first-call model

## Global Constraints

- The SECOND-call template's three model lines stay byte-identical: `[Use: Standard] -- this dispatch wraps review+polish+wrap-up execution, not analysis; the` / `pipeline's own steps select their own models as usual. Resolve via` / `` `node "{plugin-root}/bin/resolve-profile.js" standard` (contract § Model Selection). ``
- Templates use the `{plugin-root}` placeholder (Context pack item 1, #1542), never a literal `${CLAUDE_PLUGIN_ROOT}` — the record's AC text predates that; the build-time assumption check logged the correction to `decisions.md`.
- Nothing is added to `plugin/skills/dispatch/SKILL.md` (46,054 bytes, over the 45 KB advisory ceiling). `task-prompt.md` is 34,986 bytes; the shared ceiling is 46,080 bytes; no file-specific or per-skill byte pin on `task-prompt.md` exists (`git grep -n -E "task-prompt.*(byteLength|wc -c|CEILING)" -- tests` → no hits). This plan adds ~2 KB.
- Commit messages say `refs #3224`, never `closes`/`fixes`, and end with `Claude-Session: https://claude.ai/code/session_01LzjeBaJPYTntRsRJ2VHX8r`.
- Never run `git stash` / `git stash pop`; use a temporary WIP commit to set work aside.
- Run every long command in the foreground; never `run_in_background`.

## Review Focus

1. **A dispatching-session log line written into `{minted-run-dir}/decisions.md` BEFORE the first call breaks `/flow`'s adoption.** `plugin/bin/lib/flow/preflight.js:136-147` classifies a minted dir whose `decisions.md` holds anything other than Step 2.8 claim-log lines (`plugin/bin/lib/log-decision/claim-log.js`'s `classifyDecisions`) as case 3 (recovery), not case 2 (fresh mint). The instruction must therefore say to log AFTER the first call returns (by then `/flow` Step 3 has written `config.yml`). Task 2's test pins the "after the first call returns" wording.
2. **A `model-ceiling: standard` project silently runs the first call on Sonnet.** `plugin/bin/lib/model-profiles/profiles.js`'s `resolve()` clamps at lines 122-128 (`source = 'ceiling'`). The caveat must name the clamp, the file, and `source: 'ceiling'`. Task 1's test pins all three.
3. **The SECOND call drifting to Capable by an over-broad edit.** Task 1's test byte-pins the second call's three model lines.
4. **The extractor matching the wrong fenced block** (e.g. a future example fence added above the template). Task 1's helper reads the first fence after each `## ... call` heading; its synthetic go-red test proves it distinguishes Standard from Capable.
5. **CRLF checkouts** (Windows parity) turning the byte-pin red spuriously — the test normalizes `\r\n` to `\n` on read.

---

### Task 1: First call on Capable, clamp caveat, conformance pin

**Files:**
- Create: `tests/dispatch-model-profile-conformance.test.js`
- Modify: `plugin/skills/dispatch/task-prompt.md:180-183` (FIRST-call template's model lines + new paragraph after its closing fence)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `tests/dispatch-model-profile-conformance.test.js` exporting nothing; helper functions `sections(text) -> { contextPack, first, second }`, `fencedBlock(section) -> string`, `profileOf(block) -> { use: string[], arg: string[] }` defined at file top — Task 2 appends tests to this same file and reuses `sections`.

Note on existing suite: `tests/resolve-profile-invocation-conformance.test.js` is a corpus-wide scan for repo-local `node bin/resolve-profile.js` paths; it never parses either template's `[Use: ...]` line, so per the record's Deliverable 5 the pin goes in a new file. That suite must stay green (the new `{plugin-root}` form is not a repo-local path).

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-model-profile-conformance.test.js`:

```js
'use strict';

// Pins plugin/skills/dispatch/task-prompt.md's per-call model profile (#3224, #3212):
// the FIRST Task call (build,test) runs on Capable, the SECOND (review,polish,wrap-up)
// stays on Standard. Standard-profile first calls bypassed /flow in 6 of 10 observed
// firings against 0 of 3 on Capable (#3212) — a flip back on either line goes red here.
// Live-file read, not a frozen fixture: the template IS the contract being enforced
// (skill-prose-conformance-tests' declared-contract carve-out).

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');
const FIRST_HEADING = '## First call — build,test';
const SECOND_HEADING = '## Second call — review,polish,wrap-up';

function read() {
  return fs.readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');
}

function sections(text) {
  const a = text.indexOf(FIRST_HEADING);
  const b = text.indexOf(SECOND_HEADING);
  if (a === -1 || b === -1 || b < a) {
    throw new Error('task-prompt.md: first/second call headings not found in order');
  }
  return { contextPack: text.slice(0, a), first: text.slice(a, b), second: text.slice(b) };
}

// The first fenced block in a section — the operative template inlined verbatim into
// that call's Task() prompt.
function fencedBlock(section) {
  const m = section.match(/^```\n([\s\S]*?)^```$/m);
  if (!m) throw new Error('no fenced template block in section');
  return m[1];
}

function profileOf(block) {
  const use = [...block.matchAll(/\[Use: (\w+)\]/g)].map((m) => m[1]);
  const arg = [...block.matchAll(/node "\{plugin-root\}\/bin\/resolve-profile\.js" (\w+)/g)].map((m) => m[1]);
  return { use, arg };
}

// --- Proof the extractor can go red (synthetic fixture) ---

test('profileOf distinguishes a Standard template from a Capable one', () => {
  const standard = '[Use: Standard] -- x. Resolve via `node "{plugin-root}/bin/resolve-profile.js" standard`';
  const capable = '[Use: Capable] -- x. Resolve via `node "{plugin-root}/bin/resolve-profile.js" capable`';
  assert.deepStrictEqual(profileOf(standard), { use: ['Standard'], arg: ['standard'] });
  assert.deepStrictEqual(profileOf(capable), { use: ['Capable'], arg: ['capable'] });
});

// --- Live file ---

test('FIRST-call template resolves the Capable profile', () => {
  const block = fencedBlock(sections(read()).first);
  assert.deepStrictEqual(profileOf(block), { use: ['Capable'], arg: ['capable'] });
});

test('FIRST-call [Use: Capable] line carries its #3212 rationale on the same line', () => {
  const block = fencedBlock(sections(read()).first);
  const line = block.split('\n').find((l) => l.includes('[Use: Capable]'));
  assert.ok(line, 'no [Use: Capable] line in the first-call template');
  assert.match(line, /#3212/);
});

test('SECOND-call template stays on Standard, byte-identical', () => {
  const block = fencedBlock(sections(read()).second);
  assert.deepStrictEqual(profileOf(block), { use: ['Standard'], arg: ['standard'] });
  const pinned = [
    "[Use: Standard] -- this dispatch wraps review+polish+wrap-up execution, not analysis; the",
    "pipeline's own steps select their own models as usual. Resolve via",
    '`node "{plugin-root}/bin/resolve-profile.js" standard` (contract § Model Selection).',
  ].join('\n');
  assert.ok(block.includes(pinned), 'second-call model lines changed');
});

test('FIRST-call section names the model-ceiling clamp beside the template', () => {
  const { first } = sections(read());
  const afterFence = first.slice(first.indexOf(fencedBlock(first)) + fencedBlock(first).length);
  const caveat = afterFence.slice(0, 1500);
  assert.match(caveat, /model-ceiling: standard/);
  assert.match(caveat, /`sonnet`/);
  assert.match(caveat, /plugin\/bin\/lib\/model-profiles\/profiles\.js/);
  assert.match(caveat, /source: 'ceiling'/);
});

module.exports = { sections, fencedBlock, profileOf };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-model-profile-conformance.test.js`
Expected: FAIL — "FIRST-call template resolves the Capable profile" fails with actual `{ use: ['Standard'], arg: ['standard'] }`; the #3212-rationale and clamp-caveat tests also fail. The synthetic test and the SECOND-call test pass.

- [ ] **Step 3: Write minimal implementation**

In `plugin/skills/dispatch/task-prompt.md`, inside the FIRST-call fenced block, replace exactly:

```
[Use: Standard] -- this dispatch wraps build+test execution, not analysis; the pipeline's own
steps select their own models as usual. Resolve via `node "{plugin-root}/bin/resolve-profile.js" standard`
(contract § Model Selection).
```

with:

```
[Use: Capable] -- raised from Standard because Standard first calls bypassed /flow in 6 of 10 observed firings, Capable in 0 of 3 (#3212);
the pipeline's own steps still select their own models as usual. Resolve via
`node "{plugin-root}/bin/resolve-profile.js" capable` (contract § Model Selection).
```

Then, immediately after that block's closing fence line and before the existing paragraph that begins `The Foreground execution clause above is backed by a mechanical check`, insert this paragraph (blank line before and after):

```markdown
**The `model-ceiling` clamp (#3212).** `[Use: Capable]` above does not guarantee Opus. A project
`model-ceiling: standard` policy value clamps the resolved `capable` profile back to `sonnet` —
`plugin/bin/lib/model-profiles/profiles.js`'s `resolve()`, the `model-ceiling` clamp at lines
122-128, which reports `source: 'ceiling'` in `resolve-profile.js`'s JSON. On such a project this
call runs on Sonnet by configuration, an expected and named outcome; the per-group log line in the
Context pack section above records it. The same function's later diff-size cap does not apply
here: it fires only when the caller passes `--diff-facts`, and this invocation never does. The
6-of-10 versus 0-of-3 evidence is a small, opportunistic sample, not a controlled experiment, and
the added Opus spend is accepted as the cost of fewer stranded builds — re-measure the first-call
deviation rate once a further batch of dispatch firings has run on Capable.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dispatch-model-profile-conformance.test.js tests/resolve-profile-invocation-conformance.test.js`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Discrimination check (AC 3)**

In a scratch worktree (never mutate the shared tree): `git worktree add /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/5d2bdfdd-81fd-44de-a33a-4dc14f1edcb7/scratchpad/wt-3224-disc HEAD`, copy the new test file in, flip that tree's first-call `[Use: Capable]`/`capable` back to `Standard`/`standard`, run the suite there, confirm red; separately flip the second call's `standard` to `capable`, confirm red. Remove the scratch worktree with `git worktree remove --force` on that scratch path only. Record the red outputs in the task report.

- [ ] **Step 6: Commit**

```bash
git add tests/dispatch-model-profile-conformance.test.js plugin/skills/dispatch/task-prompt.md
git commit -F {message-file}
```

Message: `Run dispatch's first /flow call on the Capable profile — name the model-ceiling clamp beside it`, blank line, `refs #3224`, blank line, the `Claude-Session:` line.

---

### Task 2: Log each group's resolved first-call model

**Files:**
- Modify: `plugin/skills/dispatch/task-prompt.md:72-83` (Context pack section — new paragraph after the "Before substituting `{context-pack}` into either call, compose item 5's two bundles" paragraph, before `## First call — build,test`)
- Test: `tests/dispatch-model-profile-conformance.test.js` (append)

**Interfaces:**
- Consumes: `sections(text)` and `read()` from Task 1's test file (same file — append below the existing tests, above the `module.exports` line).
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Append to `tests/dispatch-model-profile-conformance.test.js`, above `module.exports`:

```js
test('Context pack instructs the dispatching session to log the resolved first-call model', () => {
  const { contextPack } = sections(read());
  assert.ok(
    contextPack.includes(
      '`AUTO {time} — Dispatch group {group}: first-call model resolved to {model}. Reversibility: n/a (informational).`',
    ),
    'missing the per-group first-call model log line',
  );
  assert.match(contextPack, /_shared\/auto-decision-log\.md/);
  // Logged only after the first call returns: a pre-dispatch line in the minted dir's
  // decisions.md would make /flow Step 3 classify it as case 3, not case 2
  // (bin/lib/flow/preflight.js + bin/lib/log-decision/claim-log.js's classifyDecisions).
  assert.match(contextPack, /after the first call returns/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-model-profile-conformance.test.js`
Expected: FAIL — "Context pack instructs the dispatching session to log the resolved first-call model" fails with "missing the per-group first-call model log line".

- [ ] **Step 3: Write minimal implementation**

In `plugin/skills/dispatch/task-prompt.md`, after the paragraph ending `which, for the dispatched agent, each template citation's own fallback already says.` and before `## First call — build,test`, insert (blank line before and after):

```markdown
**Log each group's resolved first-call model (#3212).** This is a dispatching-session step, not
part of `{context-pack}`. When resolving the first call's profile
(`node "{plugin-root}/bin/resolve-profile.js" capable`, the template below), keep the resolved
`model`; after the first call returns — never before it is dispatched — write one line per group
to that group's `{minted-run-dir}/decisions.md` through `log-decision.js` (item 4's shape), per
`_shared/auto-decision-log.md`'s canonical entry schema:
`AUTO {time} — Dispatch group {group}: first-call model resolved to {model}. Reversibility: n/a (informational).`
The timing matters: before the first call, the minted directory's `decisions.md` may hold only
`/flow` Step 2.8's claim-log lines, and any other line makes `/flow` Step 3 treat the directory as
a recovery (adoption case 3, `bin/lib/flow/preflight.js` via
`bin/lib/log-decision/claim-log.js`'s `classifyDecisions`) instead of a fresh mint (case 2). A
`source` of `ceiling` in the resolver's output means the clamp described under the first-call
template applied.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dispatch-model-profile-conformance.test.js tests/flow-claim-preflight.test.js tests/dispatch-flow-rundir-handoff.test.js`
Expected: PASS.

- [ ] **Step 5: Run every suite that reads task-prompt.md (AC 7)**

Run: `node --test tests/claim-mcp-projection-conformance.test.js tests/dispatch-rederive-from-artifacts-conformance.test.js tests/foreground-execution-instruction.test.js tests/flow-cleanup-only-conformance.test.js tests/dispatch-flow-rundir-handoff.test.js tests/subagent-contract-clauses.test.js tests/dispatch-settle-and-merge-lazy-read.test.js tests/ephemeral-server-handoff-fixture.test.js tests/dispatch-no-stash-conformance.test.js tests/flow-claim-preflight.test.js tests/dispatch-heartbeat-visibility.test.js tests/dispatch-mechanical-enforcement.test.js tests/dispatch-prompt-bundle-citations.test.js tests/dispatch-worktree-anchoring.test.js tests/build-already-shipped-exit.test.js tests/pr-first-merge.test.js tests/ephemeral-server-handoff-conformance.test.js tests/resolve-profile-invocation-conformance.test.js tests/dispatch-model-profile-conformance.test.js > /private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks/5d2bdfdd-81fd-44de-a33a-4dc14f1edcb7/scratchpad/task2-suites.txt 2>&1`
Expected: exit 0; tail of the file shows `fail 0`.

- [ ] **Step 6: Commit**

Message: `Log dispatch's resolved first-call model per group — after the call returns, keeping /flow's case-2 adoption`, blank line, `refs #3224`, blank line, the `Claude-Session:` line.

---

## Investigation record (no task — PR description only)

Deliverable 4's evidence was gathered at plan time (build-time assumption check, logged to `decisions.md`): all six named first-call transcripts (#3070, #3062, #3111, #3129, #3126, #3138) are retrievable as subagent `.jsonl` files; none shows visible assistant text or tool input citing context-pack item 3, the #2413 scope note, or its language ("read-only facts", "never substitute", "resolved policy values") near a Manifesto-skip decision. Stored thinking blocks are redacted (0 of 422 carry text), so the finding covers visible reasoning only. #3070's own report attributes its skip to the Skill tool returning `/flow`'s prose rather than an engine, after which it hand-executed. Outcome (b), content-based negative finding: item 3 is not reworded. This goes in the PR description verbatim-in-substance.
