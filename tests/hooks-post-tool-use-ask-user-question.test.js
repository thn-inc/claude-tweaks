// tests/hooks-post-tool-use-ask-user-question.test.js
//
// #452's ask-user-question event: one PostToolUse log-tier event per
// AskUserQuestion call, holding every question posed in that call (1-4 per
// AskUserQuestionInput) with its header, full question text, and option
// labels, plus ONE raw `response` string for the whole event.
//
// `tool_response` for this tool is NOT the SDK's structured
// `AskUserQuestionOutput` object (`{questions, answers}`) — real captured
// transcripts (see docs/reference/agent-sdk-payload-notes.md's
// "AskUserQuestion input/output shapes" section's Correction) show it is
// always a plain natural-language string with a varying prefix/suffix, and
// the embedded question text can contain unescaped nested double quotes,
// making it unsafe to regex-parse into a structured per-question answer map.
// So there is no per-question `answer` field — only the whole-event `response`
// string, extracted via this file's existing `extractToolResponseText` helper.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const ctxLib = require('../plugin/bin/lib/hooks/context');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

function readEvents(runDir) {
  const raw = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function makeRunDir() {
  return scratchDir('ct-auq-run-');
}

function askCtx({ toolInput, toolResponse, ownedRun } = {}) {
  const input = { tool_name: 'AskUserQuestion' };
  if (toolInput !== undefined) input.tool_input = toolInput;
  if (toolResponse !== undefined) input.tool_response = toolResponse;
  return { input, cwd: '/does/not/matter', env: process.env, ownedRun };
}

test('logs questions (header, question, option labels) and the raw response text — real captured payload (Example 1)', () => {
  // Real tool_input/tool_response pair, captured verbatim from a live
  // session transcript — see docs/reference/agent-sdk-payload-notes.md's
  // AskUserQuestion Correction (single question, plain recommended-option
  // answer).
  const runDir = makeRunDir();
  const toolInput = {
    questions: [
      {
        question: 'The hardest part of this feature is judgment, not plumbing: ... Who should make that call?',
        header: 'Judgment source',
        options: [
          { label: 'LLM judges each event in reflect (Recommended)', description: '...' },
          { label: 'Deterministic heuristics in bin/lib/hooks/', description: '...' },
          { label: "Hybrid: heuristics filter, LLM judges what's left", description: '...' },
        ],
      },
    ],
  };
  const toolResponse =
    'Your questions have been answered: "The hardest part of this feature is judgment, not plumbing: ... Who should make that call?"="LLM judges each event in reflect (Recommended)". You can now continue with these answers in mind.';
  const out = post.run(askCtx({ toolInput, toolResponse, ownedRun: { dir: runDir } }));
  assert.deepStrictEqual(out, {});
  const events = readEvents(runDir).filter((e) => e.type === 'ask-user-question');
  assert.strictEqual(events.length, 1);
  assert.deepStrictEqual(events[0].questions, [
    {
      header: 'Judgment source',
      question: 'The hardest part of this feature is judgment, not plumbing: ... Who should make that call?',
      options: [
        'LLM judges each event in reflect (Recommended)',
        'Deterministic heuristics in bin/lib/hooks/',
        "Hybrid: heuristics filter, LLM judges what's left",
      ],
    },
  ]);
  assert.strictEqual(events[0].response, toolResponse);
});

test('handles multiple questions in one call — real captured payload (Example 3)', () => {
  const runDir = makeRunDir();
  const toolInput = {
    questions: [
      {
        question:
          'Should this be a brand-new 7th reflect lens (e.g. "Friction"), or folded into the existing "Near-misses" lens since both already look for things that almost went wrong?',
        header: 'New lens vs. fold-in',
        options: [{ label: 'New dedicated lens (Recommended)' }],
      },
      {
        question:
          "Should this lens always run in every wrap-up (full/light mode), or short-circuit (skip, no LLM call) when the run's events.jsonl has zero denial/violation events and the session's AskUserQuestion count is below some baseline?",
        header: 'Always run vs. short-circuit',
        options: [{ label: 'Always run, let the lens itself decide there\'s nothing to flag' }],
      },
    ],
  };
  const toolResponse =
    'Your questions have been answered: "Should this be a brand-new 7th reflect lens (e.g. "Friction"), or folded into the existing "Near-misses" lens since both already look for things that almost went wrong?"="New dedicated lens (Recommended)", "Should this lens always run in every wrap-up (full/light mode), or short-circuit (skip, no LLM call) when the run\'s events.jsonl has zero denial/violation events and the session\'s AskUserQuestion count is below some baseline?"="Always run, let the lens itself decide there\'s nothing to flag". You can now continue with these answers in mind.';
  const out = post.run(askCtx({ toolInput, toolResponse, ownedRun: { dir: runDir } }));
  assert.deepStrictEqual(out, {});
  const events = readEvents(runDir).filter((e) => e.type === 'ask-user-question');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].questions.length, 2);
  assert.strictEqual(events[0].questions[0].header, 'New lens vs. fold-in');
  assert.strictEqual(events[0].questions[1].header, 'Always run vs. short-circuit');
  assert.strictEqual(events[0].response, toolResponse);
});

test('extracts a normal string tool_response into the response field', () => {
  const runDir = makeRunDir();
  const toolInput = { questions: [{ question: 'Pick a color', header: 'Color', options: [{ label: 'red' }, { label: 'blue' }] }] };
  const toolResponse = 'Your questions have been answered: "Pick a color"="blue". You can now continue with these answers in mind.';
  post.run(askCtx({ toolInput, toolResponse, ownedRun: { dir: runDir } }));
  const events = readEvents(runDir).filter((e) => e.type === 'ask-user-question');
  assert.strictEqual(events[0].response, toolResponse);
  assert.deepStrictEqual(events[0].questions, [
    { header: 'Color', question: 'Pick a color', options: ['red', 'blue'] },
  ]);
});

test('logs response: null when tool_response is absent or malformed, and never throws', () => {
  const runDir = makeRunDir();
  const toolInput = { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'a' }] }] };
  // tool_response missing entirely.
  assert.doesNotThrow(() => post.run(askCtx({ toolInput, ownedRun: { dir: runDir } })));
  // tool_response an object with none of the recognized shapes.
  assert.doesNotThrow(() => post.run(askCtx({ toolInput, toolResponse: { unexpected: true }, ownedRun: { dir: runDir } })));
  // tool_response a number.
  assert.doesNotThrow(() => post.run(askCtx({ toolInput, toolResponse: 42, ownedRun: { dir: runDir } })));
  const events = readEvents(runDir).filter((e) => e.type === 'ask-user-question');
  assert.strictEqual(events.length, 3);
  for (const e of events) assert.strictEqual(e.response, null);
});

test('does not fire for a tool other than AskUserQuestion', () => {
  const runDir = makeRunDir();
  const out = post.run({ env: process.env, input: { tool_name: 'ExitWorktree' }, cwd: '/x', ownedRun: { dir: runDir } });
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(runDir, 'events.jsonl')), 'no event file should be created');
});

test('no-ops (writes nothing, never throws) when ctx.ownedRun.dir is unset', () => {
  const toolInput = { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'a' }] }] };
  const toolResponse = 'Your questions have been answered: "Q?"="a". You can now continue with these answers in mind.';
  const out = post.run(askCtx({ toolInput, toolResponse }));
  assert.deepStrictEqual(out, {});
  const out2 = post.run(askCtx({ toolInput, toolResponse, ownedRun: {} }));
  assert.deepStrictEqual(out2, {});
});

test('never throws on malformed tool_input', () => {
  const runDir = makeRunDir();
  // No tool_input at all.
  assert.doesNotThrow(() => post.run(askCtx({ ownedRun: { dir: runDir } })));
  // tool_input.questions missing.
  assert.doesNotThrow(() => post.run(askCtx({ toolInput: {}, ownedRun: { dir: runDir } })));
  // tool_input.questions not an array.
  assert.doesNotThrow(() => post.run(askCtx({ toolInput: { questions: 'nope' }, ownedRun: { dir: runDir } })));
  // A posed question missing header/question/options entirely.
  assert.doesNotThrow(() => post.run(askCtx({
    toolInput: { questions: [{}] },
    toolResponse: 'Your questions have been answered: "?"="a". You can now continue with these answers in mind.',
    ownedRun: { dir: runDir },
  })));
  // An option missing its label.
  assert.doesNotThrow(() => post.run(askCtx({
    toolInput: { questions: [{ question: 'Q?', header: 'H', options: [{ description: 'no label' }] }] },
    toolResponse: 'Your questions have been answered: "Q?"="a". You can now continue with these answers in mind.',
    ownedRun: { dir: runDir },
  })));
  const events = readEvents(runDir).filter((e) => e.type === 'ask-user-question');
  assert.ok(events.length >= 5, 'every malformed call above should still log something, never throw');
});

// ─── concurrent sibling runs, neither ownership-stamped (#1410) ────────────
//
// #1194's own wrap-up found an ask-user-question event in its run's
// events.jsonl whose question text belonged to unrelated records — resolveRun
// (context.js) had guessed a sibling worktree's run dir because neither side
// was yet ownership-stamped (no record-worktree call had landed). This
// exercises the FULL chain — resolveRun's real fallback output fed straight
// into post-tool-use.js's logAskUserQuestion — rather than a hand-built
// ctx.ownedRun, since that's the actual call path #1194's contaminated log
// went through. Needs real git worktrees: classifyOwnership only ever
// answers 'foreign' when it can prove the caller's cwd resolves to a
// different, still-live worktree than the recorded binding.

function mkRun(mainCwd, id, state) {
  const dir = path.join(mainCwd, '.claude-tweaks', 'pipelines', id);
  fs.mkdirSync(dir, { recursive: true });
  if (state) fs.writeFileSync(path.join(dir, 'run-state.json'), JSON.stringify(state));
  return dir;
}

test("#1410: an ask-user-question event answered in this session's worktree never lands in a concurrent sibling worktree's unowned run dir", () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  // Newer, so the pre-#1410 "newest non-terminal, unowned" guess would have
  // picked it — neither run is ownership-stamped (no sessionId), matching
  // #1194's actual observed state (no record-worktree call had landed yet).
  const foreignRun = mkRun(main, '2026-08-27T090000-foreign', { status: 'active', worktree: otherWt });

  const toolInput = { questions: [{ question: 'Which branch strategy?', header: 'Git strategy', options: [{ label: 'rebase' }] }] };
  const toolResponse = 'Your questions have been answered: "Which branch strategy?"="rebase". You can now continue with these answers in mind.';

  // Caller's own session id is unknown to either run (fresh session, no
  // ownership stamp yet) — exactly resolveRun's unknown-sessionId fallback arm.
  const ownedRun = ctxLib.resolveRun(callerWt, {}, null);
  assert.deepStrictEqual(ownedRun, { dir: null, attribution: null }, 'the only candidate is worktree-bound to a different session — must not be guessed into');

  post.run(askCtx({ toolInput, toolResponse, ownedRun }));
  assert.ok(!fs.existsSync(path.join(foreignRun, 'events.jsonl')), "the sibling worktree's own run must never receive this session's event");
});

test('#1410: the event lands in an older, worktree-compatible sibling run instead of a newer foreign-bound one', () => {
  const main = gitRepo();
  const callerWt = linkedWorktreeOf(main);
  const otherWt = linkedWorktreeOf(main);
  const compatibleRun = mkRun(main, '2026-08-27T090000-mine', { status: 'active', worktree: callerWt });
  const foreignRun = mkRun(main, '2026-08-27T090100-foreign', { status: 'active', worktree: otherWt });

  const toolInput = { questions: [{ question: 'Which branch strategy?', header: 'Git strategy', options: [{ label: 'rebase' }] }] };
  const toolResponse = 'Your questions have been answered: "Which branch strategy?"="rebase". You can now continue with these answers in mind.';

  const ownedRun = ctxLib.resolveRun(callerWt, {}, null);
  assert.deepStrictEqual(ownedRun, { dir: compatibleRun, attribution: 'fallback' }, 'the newer candidate is foreign-bound and must be skipped in favor of the compatible one');

  post.run(askCtx({ toolInput, toolResponse, ownedRun }));
  const events = readEvents(compatibleRun).filter((e) => e.type === 'ask-user-question');
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].attribution, 'fallback');
  assert.ok(!fs.existsSync(path.join(foreignRun, 'events.jsonl')), "the foreign sibling's run must never receive this session's event");
});

test('#5556: the event carries toolUseId from the hook input, null when absent or not a string', () => {
  const toolInput = { questions: [{ question: 'Q?', header: 'H', options: [{ label: 'a' }] }] };
  const withId = makeRunDir();
  const noId = makeRunDir();
  const badId = makeRunDir();
  const ctxWith = askCtx({ toolInput, toolResponse: 'r', ownedRun: { dir: withId } });
  ctxWith.input.tool_use_id = 'toolu_q1';
  post.run(ctxWith);
  post.run(askCtx({ toolInput, toolResponse: 'r', ownedRun: { dir: noId } }));
  const ctxBad = askCtx({ toolInput, toolResponse: 'r', ownedRun: { dir: badId } });
  ctxBad.input.tool_use_id = 42;
  post.run(ctxBad);
  assert.strictEqual(readEvents(withId).find((e) => e.type === 'ask-user-question').toolUseId, 'toolu_q1');
  assert.strictEqual(readEvents(noId).find((e) => e.type === 'ask-user-question').toolUseId, null);
  assert.strictEqual(readEvents(badId).find((e) => e.type === 'ask-user-question').toolUseId, null);
});
