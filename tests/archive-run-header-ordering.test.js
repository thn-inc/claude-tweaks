'use strict';
// Ordering conformance for record #3976: wrap-up moves the run's tracked spec header to
// .claude-tweaks/pipelines/archive/{run-id}/ in one commit BEFORE every merge path it drives
// (bin/archive-run-header.js), so the merge lands the header already archived. The prose is the
// declared contract here -- the CLI call sites and their order ARE the feature -- so this reads
// the live skill text (skill-prose-conformance-tests: "a documented convention this project wants
// enforced"); the two pre-existing order claims it leans on (AC2.1/AC2.2: wrap-up's pack before
// its Execute phase, dispatch's first-call gate before the second call) are pinned beside it.
//
// Go-red [IL-105], three controls per claim:
//   1. a frozen pre-change excerpt (bytes copied from the live file before this change) on which
//      the same `assertOrder` throws "anchor not found" -- the new anchor did not exist yet;
//   2. a synthetic swap of each adjacent anchor pair on which `assertOrder` throws "must come
//      after" -- the comparison's own arithmetic, with every anchor present, so a miss cannot be
//      absence in disguise;
//   3. the live text with the move relocated to the end of the file (after every merge text),
//      which must throw "must come after" -- a real misplacement, matched to its own message.
// Reads go through readText (CRLF-safe, #2763).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));

const MOVE = '**Archive the spec header (#3976).**';
const CLI = 'bin/archive-run-header.js';
const ABSENT = /anchor not found/;
const MISORDERED = /must come after/;

// Each anchor must occur and the first occurrences must increase. Its two messages are the two
// halves of the claim, so a control can be matched to the half it exercises.
function assertOrder(text, anchors, label) {
  let prevAt = -1;
  let prevAnchor = null;
  for (const anchor of anchors) {
    const at = text.indexOf(anchor);
    assert.notStrictEqual(at, -1, `${label}: anchor not found: ${anchor}`);
    if (prevAnchor !== null) {
      assert.ok(at > prevAt, `${label}: ${anchor} must come after ${prevAnchor}`);
    }
    prevAt = at;
    prevAnchor = anchor;
  }
}

// Control 2: the chain with one adjacent pair swapped, every anchor present.
function assertEveryPairGoesRed(anchors, label) {
  for (let i = 1; i < anchors.length; i++) {
    const swapped = anchors.slice();
    [swapped[i - 1], swapped[i]] = [swapped[i], swapped[i - 1]];
    const synthetic = swapped.join('\n');
    assert.throws(
      () => assertOrder(synthetic, anchors, label),
      MISORDERED,
      `${label}: swapping "${anchors[i - 1]}" and "${anchors[i]}" must read as misordered`,
    );
  }
}

// Control 3: cut the span [start, end) out of the live text and append it after everything else.
function relocatedToEnd(text, start, endOf) {
  const s = text.indexOf(start);
  assert.notStrictEqual(s, -1, `relocation anchor not found: ${start}`);
  const e = endOf(text, s);
  assert.ok(e > s, `relocation span for ${start} is empty`);
  const out = `${text.slice(0, s)}${text.slice(e)}\n\n${text.slice(s, e)}`;
  assert.notStrictEqual(out, text, 'relocation changed nothing');
  return out;
}
const toParagraphEnd = (text, s) => {
  const e = text.indexOf('\n\n', s);
  return e === -1 ? text.length : e;
};

// One claim per call: it holds on the live text, throws "anchor not found" on the frozen
// pre-change excerpt, and every adjacent pair goes red when swapped.
function pinOrder(label, live, frozen, chains) {
  for (const anchors of chains) {
    assertOrder(live, anchors, label);
    assert.throws(() => assertOrder(frozen, anchors, label), ABSENT, `${label}: frozen excerpt must not carry the new anchor`);
    assertEveryPairGoesRed(anchors, label);
  }
}

// ---- Frozen pre-change excerpts: bytes copied from the live files before #3976's edit ----

const FROZEN_EXEC = "**`worktree` mode under `integration-model: pr-first` (`_shared/integration-model.md`): no `Fixes` line here.** The run's draft PR\n(`_shared/pr-early-run-lifecycle.md`) already carries one `Fixes #{n}` line per record, composed\nat PR-open time — adding a second, differently-scoped set here would duplicate (and risk\ndisagreeing with) that authoritative list. This step's commit is an ordinary commit.\n\n**Phase exit (any run with a run dir, `_shared/integration-model.md`):** one call pushes this\ncommit and flips wrap-up's PR checklist row —\n\n**Branch finish (`worktree` mode, `integration-model: pr-first`, #3813).** The run's one branch\nfinish, reached on every path through this step: after the commit and phase-exit push above, so\n\n\"Approve all, leave PR open\", Override, and a console the empty-console fast path skipped carry\nno merge decision: they skip the merge, landing on `pending-review`. Then run cleanup items 4, 6,\n7 and 8 in canonical order (`cleanup-procedures-execution.md` Sections C, D, E, B) — item 4's\nSection C step 3 finds the merge already routed.";

const FROZEN_SHORT_CIRCUIT = "```bash\nWORKTREE_PATH=$(node -e \"console.log(require(process.argv[1]+'/run-state.json').worktree)\" \"{run-dir}\")\nnode \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" delete-ledger --run \"$RUN_DIR\"\n```\n\n```bash\ngit -C \"$WORKTREE_PATH\" rm \"$LEDGER_FILE\"\ngit -C \"$WORKTREE_PATH\" commit -m \"Wrap-up: delete resolved open items ledger for #{n} — auto-merge short-circuit\"\n```\n\nEvery other report except `not found` leaves the ledger on disk: commit nothing; the verb logs its `SKIP`, hand-log one where Item 2 says.\n\n**`integration-model: pr-first` only — push this commit now**, its own Bash call: `gh pr merge`\nbelow merges the PR's remote head, not this worktree's local state, so a commit left unpushed\nhere would simply be absent from the merge.\n\n**`integration-model: pr-first` (`_shared/integration-model.md`):** run the Verdict backstop above\nfirst (anything but `{n}=1`, stop here and go to \"Any layer fails\" below). Then run `_shared/pr-first-merge.md`'s\nprocedure now — `tag: {tag}` (see `manifesto-authorized-merge.md`'s Tag selection section) (distinct from dispatch's `auto-merge` tag; `/help`'s\n\n**`integration-model: local-merge`:** run the Verdict backstop above first (anything but `{n}=1`,\nstop here and go to \"Any layer fails\" below). Then read the values below, then run\n`_shared/local-merge-sequence.md` with this branch's bindings and failure routing. Its Step 2 —";

const FROZEN_SECTION_C = "   **`integration-model: local-merge`:** verify the feature branch reached an outcome (merged, PR\n   created, discarded, or explicitly kept as-is) via `/superpowers:finishing-a-development-branch`:\n   - **Already completed (merged, PR created, or discarded)** → proceed to step 4.\n   - **Not yet decided** → check `_shared/local-merge-auto-finish.md`'s Precondition\n     (`integration-model` resolves `local-merge` AND `{run-dir}/config.yml` exists — see\n\n     When the Precondition does not hold (an `interactive` or standalone run — no `config.yml` in\n     this run's directory), run `/superpowers:finishing-a-development-branch` now (do not stop and\n     ask the user to run it separately). Present the merge/PR/discard/keep-as-is options as the\n\n3.6. **Close the pipeline run — the sanctioned exit the teardown gate checks for.** If a pipeline";

// multispec-review-console.md: the three spans step 0 / the capture note / step 2 carried before the edit.
const FROZEN_MULTISPEC_TRIMMED_ASIDE = '(`--ledger` stays required: it names the exact path the run\'s creation line logged, and the bare verb would return `ambiguous` if the shared branch owned more than one ledger, or `unattributable` with no merge base)';
const FROZEN_MULTISPEC_WHY = 'Why here: the header is committed only on the run\'s branch, so the main-checkout parent run dir holds no `spec-{id}/work/` file until merge; and from step 2 on a merged PR makes the worktree a reap candidate (`bin/lib/reconcile/reap-merged.js`), and step 6 removes it — nothing after this point re-reads a header.';
const FROZEN_MULTISPEC = [
  '**Before any step below — capture each spec\'s header fields.** For each `id` in `manifest.yml`\'s `specs[].id`, read the header.',
  FROZEN_MULTISPEC_WHY,
  '0. **Delete the shared open-items ledger (#3420).** Runs after the batch pass. Run `delete-ledger` ' + FROZEN_MULTISPEC_TRIMMED_ASIDE + '. Then delete the run\'s design-wrapper caches and commit and push any it removed before step 2, as above, even when the ledger was not deleted (#3813).',
  '1. **Tear down the shared ephemeral dev server** if one was started.',
  '2. **Finish the shared branch.** `integration-model: pr-first`: run `_shared/pr-first-merge.md`\'s procedure now.',
].join('\n');

// ---- AC2.1 / AC2.2: the pre-existing orderings this feature's seams rest on ----

test('AC2.1 wrap-up consumes the pack in Phase 3 before Phase 4 executes', () => {
  const chain = ['### Nothing left behind', 'wrap-up-pack.js', '### Execute approved actions'];
  const text = read('wrap-up/SKILL.md');
  assertOrder(text, chain, 'wrap-up/SKILL.md');
  assertEveryPairGoesRed(chain, 'wrap-up/SKILL.md');
  assert.throws(() => assertOrder('', chain, 'wrap-up/SKILL.md'), ABSENT);
  const section = relocatedToEnd(text, '### Nothing left behind', (t, s) => t.indexOf('### Execute approved actions', s));
  assert.throws(() => assertOrder(section, chain, 'wrap-up/SKILL.md'), MISORDERED);
});

test('AC2.2 the first-call bookends and the first-call artifact check precede the second call', () => {
  const chain = ['## First call — build,test', 'verify-run-bookends.js', '## Second call — review,polish,wrap-up'];
  const prompt = read('dispatch/task-prompt.md');
  assertOrder(prompt, chain, 'dispatch/task-prompt.md');
  assertEveryPairGoesRed(chain, 'dispatch/task-prompt.md');
  assert.throws(() => assertOrder('', chain, 'dispatch/task-prompt.md'), ABSENT);
  const moved = relocatedToEnd(prompt, '## First call — build,test', (t, s) => t.indexOf('## Second call — review,polish,wrap-up', s));
  assert.throws(() => assertOrder(moved, chain, 'dispatch/task-prompt.md'), MISORDERED);

  const gate = sectionOf(read('dispatch/two-call-gate.md'), '## 2. The gate');
  for (const literal of ['first-call-artifact-check.js', 'before dispatching the second call']) {
    assert.ok(gate.includes(literal), `two-call-gate.md ## 2. The gate lost: ${literal}`);
    const stripped = gate.split(literal).join('');
    assert.notStrictEqual(stripped, gate);
    assert.ok(!stripped.includes(literal), `control for ${literal} must not carry it`);
  }
});

// ---- AC2.1: the move precedes each pr-first / local-merge finish ----

test('AC2.1 pr-first: the move precedes the Phase exit push and the Branch finish merge', () => {
  const text = read('wrap-up/execution-and-verification.md');
  pinOrder('execution-and-verification.md', text, FROZEN_EXEC, [
    [MOVE, '**Phase exit (any run with a run dir', '**Branch finish ('],
  ]);
  const late = relocatedToEnd(text, MOVE, toParagraphEnd);
  assert.throws(
    () => assertOrder(late, [MOVE, '**Phase exit (any run with a run dir', '**Branch finish ('], 'execution-and-verification.md'),
    MISORDERED,
  );
});

test('AC2.1 the move precedes Section B\'s archival', () => {
  // Cleanup items 4/8 (worktree removal, run-dir archive) run after the Branch finish: this
  // anchor is the sentence that hands over to them.
  const text = read('wrap-up/execution-and-verification.md');
  const chain = [MOVE, 'run cleanup items 4, 6,'];
  pinOrder('execution-and-verification.md (Section B)', text, FROZEN_EXEC, [chain]);
  assert.throws(
    () => assertOrder(relocatedToEnd(text, MOVE, toParagraphEnd), chain, 'execution-and-verification.md (Section B)'),
    MISORDERED,
  );
});

test('AC2.1 short-circuit: the move precedes the push and both merge branches', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  const prFirst = ['delete-ledger', MOVE, 'push these commits now', "_shared/pr-first-merge.md`'s"];
  const localMerge = ['delete-ledger', MOVE, 'push these commits now', "_shared/local-merge-sequence.md` with this branch's bindings"];
  pinOrder('auto-merge-short-circuit.md', text, FROZEN_SHORT_CIRCUIT, [prFirst, localMerge]);
  for (const chain of [prFirst, localMerge]) {
    assert.throws(
      () => assertOrder(relocatedToEnd(text, MOVE, toParagraphEnd), chain, 'auto-merge-short-circuit.md'),
      MISORDERED,
    );
  }
});

test('AC2.1 local-merge: the move precedes the finish in Section C step 3', () => {
  const text = read('wrap-up/cleanup-procedures-execution.md');
  const finish = [MOVE, 'local-merge-auto-finish.md', 'finishing-a-development-branch` now'];
  const bounds = ['## C. Git Worktree', MOVE, '3.6. **Close the pipeline run'];
  pinOrder('cleanup-procedures-execution.md', text, FROZEN_SECTION_C, [finish, bounds]);
  const endAtVerify = (t, s) => t.indexOf('verify the feature branch reached an outcome', s);
  for (const chain of [finish, bounds]) {
    assert.throws(
      () => assertOrder(relocatedToEnd(text, MOVE, endAtVerify), chain, 'cleanup-procedures-execution.md'),
      MISORDERED,
    );
  }
});

// ---- AC3.3: multi-spec runs move once, at Shared teardown step 0 ----

test('AC3.3 multi-spec: one move at Shared teardown step 0, after the header capture, before the shared branch finish', () => {
  const text = read('flow/multispec-review-console.md');
  const chain = [
    '**Before any step below — capture each spec\'s header fields.**',
    '0. **Delete the shared open-items ledger',
    CLI,
    '2. **Finish the shared branch.**',
  ];
  pinOrder('flow/multispec-review-console.md', text, FROZEN_MULTISPEC, [chain]);
  const late = relocatedToEnd(text, ' Last, archive the spec headers', (t, s) => t.indexOf('\n', s));
  assert.throws(() => assertOrder(late, chain, 'flow/multispec-review-console.md'), MISORDERED);

  // The three spans the edit replaced: retired here, and the replacements present.
  for (const retired of [FROZEN_MULTISPEC_TRIMMED_ASIDE, FROZEN_MULTISPEC_WHY, 'reap candidate', 'creation line logged, and the bare verb']) {
    assert.ok(FROZEN_MULTISPEC.includes(retired), `control: the frozen text carries ${retired.slice(0, 60)}`);
    assert.ok(!text.includes(retired), `retired clause still present: ${retired.slice(0, 60)}`);
  }
  for (const kept of [
    '(`--ledger` stays required: the bare verb can return `ambiguous` or `unattributable`)',
    'Why here: the header lives only on the run\'s branch until step 0 archives it there, and step 6 removes the worktree — nothing after this point re-reads a header.',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run "$MULTISPEC_PARENT_DIR"',
  ]) {
    assert.ok(text.includes(kept), `replacement missing: ${kept.slice(0, 60)}`);
    assert.ok(!FROZEN_MULTISPEC.includes(kept), `control: the frozen text must not carry ${kept.slice(0, 60)}`);
  }
});

test('AC3.3 the pr-first wrap-up move skips under MULTISPEC_REVIEW_DEFER=1', () => {
  const text = read('wrap-up/execution-and-verification.md');
  const paragraphs = text.split(/\n\n/).filter((p) => p.includes(MOVE));
  assert.strictEqual(paragraphs.length, 1, 'exactly one paragraph carries the move anchor');
  const literal = 'Skip it under `MULTISPEC_REVIEW_DEFER=1`';
  assert.ok(paragraphs[0].includes(literal), `the move paragraph lost: ${literal}`);
  // Control: the same sentence elsewhere in the file does not count for the paragraph.
  const elsewhere = paragraphs[0].split(literal).join('');
  assert.notStrictEqual(elsewhere, paragraphs[0]);
  assert.ok(!elsewhere.includes(literal));
  assert.ok(!FROZEN_EXEC.includes(MOVE), 'control: the frozen excerpt carries no move paragraph');
});

test('every wrap-up call site carries the CLI call and the self-logging contract', () => {
  // The paragraph's span: to its blank line, or in Section C (inline in step 3's bullet) to the
  // "verify the feature branch" clause it leads into. Hand-log only when the envelope says logged: false.
  const spanEnd = {
    'wrap-up/execution-and-verification.md': toParagraphEnd,
    'wrap-up/auto-merge-short-circuit.md': toParagraphEnd,
    'wrap-up/cleanup-procedures-execution.md': (t, s) => t.indexOf('verify the feature branch reached an outcome', s),
  };
  for (const [rel, endOf] of Object.entries(spanEnd)) {
    const text = read(rel);
    assert.strictEqual(text.split(MOVE).length - 1, 1, `${rel}: exactly one move paragraph`);
    const at = text.indexOf(MOVE);
    const body = text.slice(at, endOf(text, at));
    for (const fact of [`node "\${CLAUDE_PLUGIN_ROOT}/${CLI}" --run`, '`logged: false`', 'log-decision.js --text-file', '`SKIP`']) {
      assert.ok(body.includes(fact), `${rel}: move paragraph lost ${fact}`);
      const stripped = body.split(fact).join('');
      assert.notStrictEqual(stripped, body);
      assert.ok(!stripped.includes(fact), `${rel}: control for ${fact} must not carry it`);
    }
  }
});
