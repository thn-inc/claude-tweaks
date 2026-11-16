'use strict';
// Ordering conformance for record #3976: wrap-up moves the run's tracked spec header to
// .claude-tweaks/pipelines/archive/{run-id}/ in one commit BEFORE every merge path it drives
// (bin/archive-run-header.js), so the merge lands the header already archived. The prose is the
// declared contract here -- the CLI call sites and their order ARE the feature -- so this reads
// the live skill text (skill-prose-conformance-tests: "a documented convention this project wants
// enforced"); the two pre-existing order claims it leans on (AC2.1/AC2.2: wrap-up's pack before
// its Execute phase, dispatch's first-call gate before the second call) are pinned beside it.
//
// Go-red [IL-105]. Order claims carry three controls, each matched to its own message:
//   1. a frozen pre-change excerpt (bytes copied from the live file at 02e95ed42f, before this
//      change) on which `assertOrder` throws "anchor not found" naming the NEW anchor -- the
//      earlier anchors of the chain are present in the excerpt, so absence of the new one is
//      the only reason it can throw;
//   2. a synthetic swap of each adjacent anchor pair, every anchor present, which must throw
//      "must come after" -- the comparison's own arithmetic;
//   3. the live text with the move relocated to the end of the file (after every merge text),
//      which must throw "must come after" -- a real misplacement.
// Presence claims scoped to a region (a section, a paragraph) are proved by mutating the LIVE
// FILE inside that region only and re-running the whole slice-then-check pipeline, so the slice
// itself is exercised (a file-wide includes would stay green). Reads go through readText
// (CRLF-safe, #2763).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));
const collapse = (s) => s.replace(/\s+/g, ' ');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MOVE = '**Archive the spec header (#3976).**';
const CLI = 'bin/archive-run-header.js';
const CLI_CALL = 'node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run';
const absent = (anchor) => new RegExp(`anchor not found: ${escapeRe(anchor)}`);
const misordered = (anchor) => new RegExp(`${escapeRe(anchor)} must come after`);

// Each anchor must occur and the first occurrences must increase. The two messages are the two
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
    assert.throws(
      () => assertOrder(swapped.join('\n'), anchors, label),
      misordered(anchors[i]),
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

// One claim per call: it holds on the live text, throws "anchor not found" naming `newAnchor` on
// the frozen pre-change excerpt, and every adjacent pair goes red when swapped.
function pinOrder(label, live, frozen, chains, newAnchor) {
  for (const anchors of chains) {
    assertOrder(live, anchors, label);
    assert.throws(() => assertOrder(frozen, anchors, label), absent(newAnchor), `${label}: the frozen excerpt must miss ${newAnchor}, and only it`);
    assertEveryPairGoesRed(anchors, label);
  }
}
function assertRelocationGoesRed(text, chains, start, endOf, label) {
  const moved = relocatedToEnd(text, start, endOf);
  for (const anchors of chains) {
    assert.throws(() => assertOrder(moved, anchors, label), /must come after/, `${label}: the relocated move must read as misordered`);
  }
}

// A region's facts: the slice runs inside the predicate, so a mutation made only within the region
// proves the slice as well as the fact. `facts` must not overlap one another.
const bodyAt = (text, start, endOf) => {
  const s = text.indexOf(start);
  assert.notStrictEqual(s, -1, `region start not found: ${start}`);
  const e = endOf(text, s);
  assert.ok(e > s, `region for ${start} is empty`);
  return { s, e, body: collapse(text.slice(s, e)) };
};
const missingIn = (text, start, endOf, facts) => {
  const { body } = bodyAt(text, start, endOf);
  return facts.filter((fact) => !body.includes(fact));
};
function assertFactsPinned(text, start, endOf, facts, label) {
  assert.deepStrictEqual(missingIn(text, start, endOf, facts), [], `${label}: region lost a fact`);
  for (const fact of facts) {
    const { s, e } = bodyAt(text, start, endOf);
    // Strip the fact from the region's own bytes (whitespace-tolerant), leave the rest of the file alone.
    const loose = new RegExp(fact.split(' ').map(escapeRe).join('\\s+'), 'g');
    const region = text.slice(s, e);
    const doctored = text.slice(0, s) + region.replace(loose, '') + text.slice(e);
    assert.notStrictEqual(doctored, text, `${label}: the fact "${fact}" was not found in the region -- the control cannot discriminate`);
    assert.deepStrictEqual(missingIn(doctored, start, endOf, facts), [fact], `${label}: removing only "${fact}" must turn exactly that fact red`);
  }
}

// ---- Frozen pre-change excerpts: bytes copied from the live files at 02e95ed42f ----

const FROZEN_EXEC = "**`worktree` mode under `integration-model: pr-first` (`_shared/integration-model.md`): no `Fixes` line here.** The run's draft PR\n(`_shared/pr-early-run-lifecycle.md`) already carries one `Fixes #{n}` line per record, composed\nat PR-open time — adding a second, differently-scoped set here would duplicate (and risk\ndisagreeing with) that authoritative list. This step's commit is an ordinary commit.\n\n**Phase exit (any run with a run dir, `_shared/integration-model.md`):** one call pushes this\ncommit and flips wrap-up's PR checklist row —\n\n**Branch finish (`worktree` mode, `integration-model: pr-first`, #3813).** The run's one branch\nfinish, reached on every path through this step: after the commit and phase-exit push above, so\n\n\"Approve all, leave PR open\", Override, and a console the empty-console fast path skipped carry\nno merge decision: they skip the merge, landing on `pending-review`. Then run cleanup items 4, 6,\n7 and 8 in canonical order (`cleanup-procedures-execution.md` Sections C, D, E, B) — item 4's\nSection C step 3 finds the merge already routed.";

const FROZEN_SHORT_CIRCUIT = "When this run's spec has a materialized header (`{run-dir}/wrap-up-pack.json`'s `inputs.closingRecords` is\n\n```bash\nWORKTREE_PATH=$(node -e \"console.log(require(process.argv[1]+'/run-state.json').worktree)\" \"{run-dir}\")\nnode \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" delete-ledger --run \"$RUN_DIR\"\n```\n\n```bash\ngit -C \"$WORKTREE_PATH\" rm \"$LEDGER_FILE\"\ngit -C \"$WORKTREE_PATH\" commit -m \"Wrap-up: delete resolved open items ledger for #{n} — auto-merge short-circuit\"\n```\n\nEvery other report except `not found` leaves the ledger on disk: commit nothing; the verb logs its `SKIP`, hand-log one where Item 2 says.\n\n**`integration-model: pr-first` only — push this commit now**, its own Bash call: `gh pr merge`\nbelow merges the PR's remote head, not this worktree's local state, so a commit left unpushed\nhere would simply be absent from the merge.\n\n**`integration-model: pr-first` (`_shared/integration-model.md`):** run the Verdict backstop above\nfirst (anything but `{n}=1`, stop here and go to \"Any layer fails\" below). Then run `_shared/pr-first-merge.md`'s\nprocedure now — `tag: {tag}` (see `manifesto-authorized-merge.md`'s Tag selection section) (distinct from dispatch's `auto-merge` tag; `/help`'s\n\n**`integration-model: local-merge`:** run the Verdict backstop above first (anything but `{n}=1`,\nstop here and go to \"Any layer fails\" below). Then read the values below, then run\n`_shared/local-merge-sequence.md` with this branch's bindings and failure routing. Its Step 2 —";

const FROZEN_SECTION_C = "## C. Git Worktree (worktree strategy only)\n\n   **`integration-model: local-merge`:** verify the feature branch reached an outcome (merged, PR\n   created, discarded, or explicitly kept as-is) via `/superpowers:finishing-a-development-branch`:\n   - **Already completed (merged, PR created, or discarded)** → proceed to step 4.\n   - **Not yet decided** → check `_shared/local-merge-auto-finish.md`'s Precondition\n     (`integration-model` resolves `local-merge` AND `{run-dir}/config.yml` exists — see\n\n     When the Precondition does not hold (an `interactive` or standalone run — no `config.yml` in\n     this run's directory), run `/superpowers:finishing-a-development-branch` now (do not stop and\n     ask the user to run it separately). Present the merge/PR/discard/keep-as-is options as the\n\n3.6. **Close the pipeline run — the sanctioned exit the teardown gate checks for.** If a pipeline";

// multispec-review-console.md: verbatim spans (not whole lines) of the capture note, step 0, the two
// replaced clauses and step 2, as they stood at 02e95ed42f.
const FROZEN_MS_CAPTURE = "**Before any step below — capture each spec's header fields.**";
const FROZEN_MS_WHY = "Why here: the header is committed only on the run's branch, so the main-checkout parent run dir holds no `spec-{id}/work/` file until merge; and from step 2 on a merged PR makes the worktree a reap candidate (`bin/lib/reconcile/reap-merged.js`), and step 6 removes it — nothing after this point re-reads a header.";
const FROZEN_MS_STEP0 = '0. **Delete the shared open-items ledger (#3420).** Runs after the batch pass';
const FROZEN_MS_ASIDE = "(`--ledger` stays required: it names the exact path the run's creation line logged, and the bare verb would return `ambiguous` if the shared branch owned more than one ledger, or `unattributable` with no merge base)";
const FROZEN_MS_LAST = "Then delete the run's design-wrapper caches (item 3, deferred here from every spec — `wrap-up/cleanup-procedures-execution.md` Section A, for each manifest spec) and commit and push any it removed before step 2, as above, even when the ledger was not deleted (#3813).";
const FROZEN_MS_STEP2 = '2. **Finish the shared branch.** `integration-model: pr-first` (`_shared/integration-model.md`): run';
const FROZEN_MULTISPEC = [FROZEN_MS_CAPTURE, FROZEN_MS_WHY, FROZEN_MS_STEP0, FROZEN_MS_ASIDE, FROZEN_MS_LAST, FROZEN_MS_STEP2].join('\n');

// ---- AC2.1 / AC2.2: the pre-existing orderings this feature's seams rest on ----

test('AC2.1 wrap-up consumes the pack in Phase 3 before Phase 4 executes, and Phase 4 names the file that carries the move', () => {
  const chain = ['### Nothing left behind', 'wrap-up-pack.js', '### Execute approved actions'];
  const text = read('wrap-up/SKILL.md');
  assertOrder(text, chain, 'wrap-up/SKILL.md');
  assertEveryPairGoesRed(chain, 'wrap-up/SKILL.md');
  assert.throws(() => assertOrder('', chain, 'wrap-up/SKILL.md'), absent(chain[0]));
  assert.throws(
    () => assertOrder(relocatedToEnd(text, '### Nothing left behind', (t, s) => t.indexOf('### Execute approved actions', s)), chain, 'wrap-up/SKILL.md'),
    /must come after/,
  );

  // The link between the two files: Phase 4's section names the sub-file that carries the move.
  // The control strips the filename from that section only; the rest of the file still names it.
  const sectionStart = '### Execute approved actions';
  const sectionEnd = (t, s) => t.indexOf('\n### ', s + 1);
  const FILE = 'execution-and-verification.md';
  const named = (t) => bodyAt(t, sectionStart, sectionEnd).body.includes(FILE);
  assert.ok(named(text), `wrap-up/SKILL.md's Execute approved actions section no longer names ${FILE}`);
  const { s, e } = bodyAt(text, sectionStart, sectionEnd);
  const doctored = text.slice(0, s) + text.slice(s, e).split(FILE).join('') + text.slice(e);
  assert.notStrictEqual(doctored, text);
  assert.ok(doctored.includes(FILE), 'precondition: the file is still named elsewhere in wrap-up/SKILL.md');
  assert.ok(!named(doctored), 'a mention outside the section must not satisfy the claim');
});

test('AC2.2 the first-call bookends and the first-call artifact check precede the second call', () => {
  const chain = ['## First call — build,test', 'verify-run-bookends.js', '## Second call — review,polish,wrap-up'];
  const prompt = read('dispatch/task-prompt.md');
  assertOrder(prompt, chain, 'dispatch/task-prompt.md');
  assertEveryPairGoesRed(chain, 'dispatch/task-prompt.md');
  assert.throws(() => assertOrder('', chain, 'dispatch/task-prompt.md'), absent(chain[0]));
  assert.throws(
    () => assertOrder(relocatedToEnd(prompt, '## First call — build,test', (t, s) => t.indexOf('## Second call — review,polish,wrap-up', s)), chain, 'dispatch/task-prompt.md'),
    /must come after/,
  );

  // two-call-gate.md's `## 2. The gate` section holds both literals; proved by stripping each from
  // that section of the live file only, while the rest of the file keeps carrying it.
  const gateFile = read('dispatch/two-call-gate.md');
  const gateOf = (t) => sectionOf(t, '## 2. The gate');
  for (const literal of ['first-call-artifact-check.js', 'before dispatching the second call']) {
    assert.ok(gateOf(gateFile).includes(literal), `two-call-gate.md ## 2. The gate lost: ${literal}`);
    const gate = gateOf(gateFile);
    const at = gateFile.indexOf(gate);
    const doctored = gateFile.slice(0, at) + gate.split(literal).join('') + gateFile.slice(at + gate.length);
    assert.notStrictEqual(doctored, gateFile);
    if (literal === 'first-call-artifact-check.js') {
      assert.ok(doctored.includes(literal), 'precondition: the module is still cited below the gate section');
    }
    assert.ok(!gateOf(doctored).includes(literal), `a mention outside the section must not satisfy ${literal}`);
  }
});

// ---- AC2.1: the move precedes each pr-first / local-merge finish ----

test('AC2.1 pr-first: the move precedes the Phase exit push and the Branch finish merge', () => {
  const text = read('wrap-up/execution-and-verification.md');
  const chain = [MOVE, '**Phase exit (any run with a run dir', '**Branch finish ('];
  pinOrder('execution-and-verification.md', text, FROZEN_EXEC, [chain], MOVE);
  assertRelocationGoesRed(text, [chain], MOVE, toParagraphEnd, 'execution-and-verification.md');
});

test('AC2.1 the move precedes Section B\'s archival', () => {
  // Cleanup items 4/8 (worktree removal, run-dir archive) run after the Branch finish: this
  // anchor is the sentence that hands over to them.
  const text = read('wrap-up/execution-and-verification.md');
  const chain = [MOVE, 'run cleanup items 4, 6,'];
  pinOrder('execution-and-verification.md (Section B)', text, FROZEN_EXEC, [chain], MOVE);
  assertRelocationGoesRed(text, [chain], MOVE, toParagraphEnd, 'execution-and-verification.md (Section B)');
});

test('AC2.1 short-circuit: the move follows the pack read and the ledger commit, and precedes the push and both merge branches', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  const head = ['wrap-up-pack.json', 'delete-ledger', MOVE, 'push these commits now'];
  const prFirst = [...head, "_shared/pr-first-merge.md`'s"];
  const localMerge = [...head, "_shared/local-merge-sequence.md` with this branch's bindings"];
  pinOrder('auto-merge-short-circuit.md', text, FROZEN_SHORT_CIRCUIT, [prFirst, localMerge], MOVE);
  assertRelocationGoesRed(text, [prFirst, localMerge], MOVE, toParagraphEnd, 'auto-merge-short-circuit.md');
});

test('AC2.1 local-merge: the move runs in the "Not yet decided" bullet, before either finish in Section C step 3', () => {
  const text = read('wrap-up/cleanup-procedures-execution.md');
  const finish = [
    '- **Already completed (merged, PR created, or discarded)**',
    '- **Not yet decided**',
    MOVE,
    'local-merge-auto-finish.md',
    'finishing-a-development-branch` now',
  ];
  const bounds = ['## C. Git Worktree', MOVE, '**Close the pipeline run'];
  pinOrder('cleanup-procedures-execution.md', text, FROZEN_SECTION_C, [finish, bounds], MOVE);
  // A resumed run whose branch already merged takes the first bullet and never reaches the move.
  assertRelocationGoesRed(text, [finish, bounds], MOVE, (t, s) => t.indexOf('Then check', s), 'cleanup-procedures-execution.md');
});

// ---- Each call site's own facts, scoped to its paragraph ----

test('every wrap-up call site carries the CLI call and the self-logging contract in its own paragraph', () => {
  const CONTRACT = [CLI_CALL, "`_shared/auto-decision-log.md`'s **CLIs that log their own entries**", 'on any exit other than 0, log one `SKIP` and continue'];
  const sites = [
    ['wrap-up/execution-and-verification.md', toParagraphEnd, [...CONTRACT, 'Skip it under `MULTISPEC_REVIEW_DEFER=1`']],
    ['wrap-up/auto-merge-short-circuit.md', toParagraphEnd, CONTRACT],
    ['wrap-up/cleanup-procedures-execution.md', (t, s) => t.indexOf('Then check', s), CONTRACT],
  ];
  for (const [rel, endOf, facts] of sites) {
    const text = read(rel);
    assert.strictEqual(text.split(MOVE).length - 1, 1, `${rel}: exactly one move paragraph`);
    assertFactsPinned(text, MOVE, endOf, facts, rel);
  }
  assert.ok(!FROZEN_EXEC.includes(MOVE), 'control: the frozen excerpt carries no move paragraph');
});

test('the MULTISPEC_REVIEW_DEFER skip list names the archive paragraph it also skips', () => {
  const text = read('wrap-up/execution-and-verification.md');
  const fact = 'the **Archive the spec header (#3976)** paragraph below';
  assertFactsPinned(text, '**MULTISPEC_REVIEW_DEFER branch:**', toParagraphEnd, [fact, 'nothing else in this step is deferred by it'], 'MULTISPEC_REVIEW_DEFER branch');
});

// ---- AC3.3: multi-spec runs move once, at Shared teardown step 0 ----

test('AC3.3 multi-spec: one move at Shared teardown step 0, after the header capture, before the shared branch finish', () => {
  const text = read('flow/multispec-review-console.md');
  const chain = [FROZEN_MS_CAPTURE, '**Delete the shared open-items ledger', CLI, '**Finish the shared branch.**'];
  pinOrder('flow/multispec-review-console.md', text, FROZEN_MULTISPEC, [chain], CLI);
  assertRelocationGoesRed(text, [chain], ' Last, archive the spec headers', (t, s) => t.indexOf('\n', s), 'flow/multispec-review-console.md');

  // The appended sentence's own facts, scoped to it. On `logged: false` the owed line is hand-logged;
  // only a non-zero exit logs a SKIP.
  assertFactsPinned(text, ' Last, archive the spec headers', (t, s) => t.indexOf('\n', s), [
    'node "${CLAUDE_PLUGIN_ROOT}/bin/archive-run-header.js" --run "$MULTISPEC_PARENT_DIR"',
    'then push as above',
    'a non-zero exit → one `SKIP`',
  ], 'multispec step 0');

  // The three spans the edit replaced: retired live, carried by the frozen text, replacements the reverse.
  for (const retired of [FROZEN_MS_ASIDE, FROZEN_MS_WHY, 'reap candidate', 'creation line logged, and the bare verb']) {
    assert.ok(FROZEN_MULTISPEC.includes(retired), `control: the frozen text carries ${retired.slice(0, 60)}`);
    assert.ok(!text.includes(retired), `retired clause still present: ${retired.slice(0, 60)}`);
  }
  for (const kept of [
    '(`--ledger` stays required: the bare verb can return `ambiguous` or `unattributable`)',
    "Why here: the header lives only on the run's branch until step 0 archives it there, and step 6 removes the worktree — nothing after this point re-reads a header.",
  ]) {
    assert.ok(text.includes(kept), `replacement missing: ${kept.slice(0, 60)}`);
    assert.ok(!FROZEN_MULTISPEC.includes(kept), `control: the frozen text must not carry ${kept.slice(0, 60)}`);
  }
});
