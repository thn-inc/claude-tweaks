// tests/hooks-log-modules.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const post = require('../plugin/bin/lib/hooks/post-tool-use');
const substop = require('../plugin/bin/lib/hooks/subagent-stop');

function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'seed', '-q'], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });
  return fs.realpathSync(dir);
}
function mkRun() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e2run-'));
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  fs.mkdirSync(run, { recursive: true });
  return run;
}
const readEvents = (run) => fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);

test('post-tool-use logs commit breadcrumb with hash', () => {
  const repo = gitRepoWithCommit();
  const run = mkRun();
  post.run({ input: { tool_name: 'Bash', tool_input: { command: 'git commit -m "x"' }, cwd: repo }, runDir: run, runState: { status: 'active' }, ownedRun: { dir: run, attribution: 'session' }, cwd: repo });
  const ev = readEvents(run);
  assert.strictEqual(ev[0].type, 'commit');
  assert.strictEqual(ev[0].action, 'commit');
  assert.match(ev[0].hash, /^[0-9a-f]{4,}$/);
});

test('post-tool-use logs a DISTINCT hash for each of two real commits to the same dir in one invocation, not the current-HEAD hash twice', () => {
  const repo = gitRepoWithCommit();
  const run = mkRun();
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'first'], { env });
  const firstHash = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'second'], { env });
  const secondHash = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();

  post.run({
    input: { tool_name: 'Bash', tool_input: { command: 'git commit -m "a" && git commit --allow-empty -m "b"' }, cwd: repo },
    runDir: run, runState: { status: 'active' }, ownedRun: { dir: run, attribution: 'session' }, cwd: repo,
  });
  const ev = readEvents(run);
  assert.strictEqual(ev.length, 2);
  assert.strictEqual(ev[0].hash, firstHash, 'the first target should log the OLDER commit\'s own hash');
  assert.strictEqual(ev[1].hash, secondHash, 'the second target should log the NEWER commit\'s own hash');
  assert.notStrictEqual(ev[0].hash, ev[1].hash, 'the two commit targets must not both log the same current-HEAD hash');
});

test('post-tool-use without run dir or without git targets is a no-op', () => {
  const repo = gitRepoWithCommit();
  assert.deepStrictEqual(post.run({ input: { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: repo }, runDir: null, runState: null, ownedRun: { dir: null, attribution: null }, cwd: repo }), {});
  const run = mkRun();
  post.run({ input: { tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: repo }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: repo });
  assert.ok(!fs.existsSync(path.join(run, 'events.jsonl')));
});

function transcript(lastText) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e3-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'task' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: lastText }] } }),
  ];
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('subagent-stop flags a missing status line as contract violation (warn, non-blocking)', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('I did some things.') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});

// #2265: the canonical status position moved to a trailing "STATUS: {WORD}"
// line; a bare word as the literal FIRST line (the old shape) is now
// lenient-compliant, not canonical — still no dispatcher-facing warning, but
// an informational contract-violation variant IS logged so a stale
// old-format dispatch site stays visible. See tests/hooks-subagent-stop.test.js
// for the full canonical/lenient/violation matrix this migration added.
test('subagent-stop accepts an old-format (bare-word-first) status line leniently, logging an informational variant', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('DONE\nAll checks green.') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {}, 'lenient compliance never returns a dispatcher-facing warning');
  const ev = readEvents(run);
  assert.strictEqual(ev[0].type, 'contract-violation');
  assert.strictEqual(ev[0].variant, 'lenient', 'old-format first-line is lenient, not a hard violation');
});

function multiTurnTranscript(texts) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e3-multi-')), 'agent.jsonl');
  const lines = [];
  for (const t of texts) {
    lines.push(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }));
    lines.push(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } }));
  }
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('subagent-stop checks the LAST assistant message, not an earlier compliant one', () => {
  const run = mkRun();
  const t = multiTurnTranscript(['DONE\nfirst pass looked fine.', 'Actually let me also check this other thing.']);
  const out = substop.run({ input: { agent_transcript_path: t }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});

test('subagent-stop checks the LAST assistant message, not an earlier non-compliant one', () => {
  const run = mkRun();
  const t = multiTurnTranscript(['still investigating', 'DONE\nAll checks green.']);
  const out = substop.run({ input: { agent_transcript_path: t }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  // Old-format (bare-word-first) LAST turn — lenient-compliant, informational
  // event only (#2265); see the dedicated old-format test above.
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readEvents(run)[0].variant, 'lenient');
});

function toolOnlyLastTurnTranscript() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e3-toolonly-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'still investigating, not done yet' }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } }),
    // The TRUE last assistant turn — tool-call only, no text block at all.
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'SomeTool', input: {} }] } }),
  ];
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('subagent-stop treats a tool-call-only LAST assistant turn as nothing to grade, not a fallback to an earlier text message (finding regression)', () => {
  const run = mkRun();
  const t = toolOnlyLastTurnTranscript();
  const out = substop.run({ input: { agent_transcript_path: t }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  // The real last turn has no text at all — best-effort no-op, matching
  // this file's "unreadable/ungradable -> no-op" posture. Previously the
  // scan fell through to the EARLIER "still investigating" text (which
  // doesn't start with a status keyword) and wrongly flagged it as a
  // contract violation.
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(run, 'events.jsonl')));
});

function textPlusToolUseLastTurnTranscript() {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-e3-textplustool-')), 'agent.jsonl');
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
    // The TRUE last assistant turn: narration text ALONGSIDE a tool call in
    // the same message — not a completed reply, since the turn continues
    // after the tool result comes back. Reproduces #1329's reported
    // "Waiting for the batch-A task review to complete." pattern.
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Waiting for the batch-A task review to complete.' },
          { type: 'tool_use', id: 'x', name: 'Monitor', input: {} },
        ],
      },
    }),
  ];
  fs.writeFileSync(f, lines.join('\n') + '\n');
  return f;
}

test('subagent-stop treats narration alongside a tool call in the LAST turn as nothing to grade (#1329)', () => {
  const run = mkRun();
  const t = textPlusToolUseLastTurnTranscript();
  const out = substop.run({ input: { agent_transcript_path: t }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  // The text is genuine mid-task narration that precedes a tool call, not a
  // completed reply — previously this was extracted and graded as if it
  // were the final status-line reply, wrongly flagging it as a violation.
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(run, 'events.jsonl')));
});

test('subagent-stop still flags genuine prose-only LAST turn with no tool call as a contract violation (#1329 regression guard)', () => {
  const run = mkRun();
  const t = multiTurnTranscript(['DONE\nfirst pass looked fine.', 'Waiting for the batch-B review notification.']);
  const out = substop.run({ input: { agent_transcript_path: t }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});

test('subagent-stop with unreadable transcript or no run dir is a silent no-op', () => {
  const run = mkRun();
  assert.deepStrictEqual(substop.run({ input: { agent_transcript_path: '/nope.jsonl' }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' }), {});
  assert.deepStrictEqual(substop.run({ input: {} , runDir: null, runState: null, ownedRun: { dir: null, attribution: null }, cwd: '/x' }), {});
});

// #1425: a contract-violation event must land only in the calling session's
// OWN run (ctx.ownedRun), never the session-agnostic newest-non-terminal
// ctx.runDir a sibling session's Task-agent stop could otherwise stamp.
test('subagent-stop scopes the contract-violation event to ctx.ownedRun, not the foreign ctx.runDir (#1425)', () => {
  const runA = mkRun(); // owned by this session
  const runB = mkRun(); // a newer, foreign run ctx.runDir happens to resolve to
  const out = substop.run({
    input: { agent_transcript_path: transcript('I did some things.') },
    runDir: runB,
    runState: null,
    ownedRun: { dir: runA, attribution: 'session' },
    cwd: '/x',
  });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(runA)[0].type, 'contract-violation', 'event must land in the OWNED run');
  assert.ok(!fs.existsSync(path.join(runB, 'events.jsonl')), 'the foreign runDir must receive nothing');
});

test('subagent-stop with no owned run writes no event even though ctx.runDir names a foreign run (#1425)', () => {
  const runB = mkRun(); // foreign — no session owns it
  const out = substop.run({
    input: { agent_transcript_path: transcript('I did some things.') },
    runDir: runB,
    runState: null,
    ownedRun: { dir: null, attribution: null },
    cwd: '/x',
  });
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(runB, 'events.jsonl')));
});

// #1431 AC3: a fallback-attributed ownedRun (resolveRun's "nobody claims it
// and nobody else owns it, so the newest non-terminal run is the best guess"
// arm, context.js's own doc comment) is not the same as no owned run at all
// (the case above, which writes nothing) — it's a genuine best-effort guess
// that DOES still receive the event, but tagged `attribution: 'fallback'` so
// a reader auditing events.jsonl can filter it out as unproven, per this
// file's own header pattern (mirrors post-tool-use.js's identical commit-event
// hardening, which #1425's fix already modeled subagent-stop.js's ctx.ownedRun
// scoping on).
test('#1431: a fallback-attributed owned run still receives the event, tagged attribution: fallback', () => {
  const runGuess = mkRun(); // the best-guess run ownedRun.attribution: 'fallback' points at
  const out = substop.run({
    input: { agent_transcript_path: transcript('I did some things.') },
    runDir: runGuess,
    runState: null,
    ownedRun: { dir: runGuess, attribution: 'fallback' },
    cwd: '/x',
  });
  assert.match(out.json.systemMessage, /status line/i);
  const ev = readEvents(runGuess);
  assert.strictEqual(ev[0].type, 'contract-violation');
  assert.strictEqual(ev[0].attribution, 'fallback', 'a guessed run\'s event must be tagged, not silently trusted');
});

// #750: superpowers:subagent-driven-development's implementer-prompt.md
// template asks for "- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED |
// NEEDS_CONTEXT" — a bold, colon-prefixed bullet line, not claude-tweaks'
// own bare-word contract. An SDD-dispatched implementer correctly following
// ITS OWN template must not be flagged as violating a DIFFERENT contract.
// #2265: the bolded "**Status:**" line is off-position here (not the reply's
// last non-empty line), so it's now lenient-compliant rather than fully
// canonical — still accepted with no dispatcher-facing warning, but an
// informational variant is logged.
test('subagent-stop accepts the bolded "**Status:** DONE" line from superpowers SDD\'s implementer template (#750)', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('**Status:** DONE\nCommits: abc123 fix thing') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readEvents(run)[0].variant, 'lenient');
});

test('subagent-stop accepts the bolded "- **Status:** DONE" bulleted form exactly as the SDD template renders it (#750)', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('- **Status:** DONE\n- Commits: abc123 fix thing') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readEvents(run)[0].variant, 'lenient');
});

test('subagent-stop accepts the bolded status line for all four contract words (#750)', () => {
  for (const word of ['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']) {
    const run = mkRun();
    const out = substop.run({ input: { agent_transcript_path: transcript(`**Status:** ${word}\nmore detail`) }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
    assert.deepStrictEqual(out, {}, `expected ${word} to be accepted`);
    assert.strictEqual(readEvents(run)[0].variant, 'lenient', `expected lenient variant for ${word}`);
  }
});

// #2265: this exact shape — narration first, bolded status line LAST — is
// now the intentionally-rewarded case: the status marker sits in the new
// canonical trailing POSITION, just still in the old SDD bold format rather
// than the new "STATUS: {WORD}" text. Lenient-compliant, not a violation.
// (The old assertion here predated the trailing-line migration, when only
// the first line was ever checked.)
test('subagent-stop accepts narration followed by a trailing bolded status line as lenient-compliant (#2265, formerly #750 AC3)', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('Let me check the diff first before giving a verdict.\n**Status:** DONE') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(readEvents(run)[0].variant, 'lenient');
});

// The genuine regression this AC guarded against survives in a different
// shape: a status word buried in the MIDDLE of a long reply — outside both
// the first-3 and last-3 non-empty-line windows — must still be flagged.
test('subagent-stop still flags a status word buried outside the first-or-last-3 window as a contract violation (#2265)', () => {
  const run = mkRun();
  const body = [
    'Investigating the report.',
    'Reading the relevant files now.',
    'Found the likely cause.',
    '**Status:** DONE', // line 4 of 8 — outside first-3 (1-3) and last-3 (6-8)
    'Double-checking before concluding.',
    'Confirmed the fix is correct.',
    'Writing up the summary.',
    'Nothing further to add.',
  ].join('\n');
  const out = substop.run({ input: { agent_transcript_path: transcript(body) }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.match(out.json.systemMessage, /status line/i);
  const ev = readEvents(run)[0];
  assert.strictEqual(ev.type, 'contract-violation');
  assert.strictEqual(ev.variant, undefined, 'a genuine violation carries no lenient variant field');
});

// A bold label that is NOT "Status:" (e.g. a differently-shaped report) must
// not be accepted just because it superficially resembles the SDD prefix.
test('subagent-stop still flags a bolded non-"Status:" label as a contract violation (#750 AC3)', () => {
  const run = mkRun();
  const out = substop.run({ input: { agent_transcript_path: transcript('**Result:** DONE\nAll good.') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});

// #1596: a third-party agent (a plugin-namespaced agent_type whose prefix
// isn't this plugin's own "claude-tweaks") was never given the status-line
// format at all, so a malformed-looking reply from it is not evidence of a
// violation — subagent-output-contract.md's Exemption section. Previously
// this module had no exemption check, so every such reply was still logged.
test('isExemptAgentType: true for a third-party plugin-namespaced agent_type', () => {
  assert.strictEqual(substop.isExemptAgentType('code-simplifier:code-simplifier'), true);
  assert.strictEqual(substop.isExemptAgentType('impeccable:impeccable-finish-reviewer'), true);
});

test('isExemptAgentType: false for this plugin\'s own namespaced agent_type', () => {
  assert.strictEqual(substop.isExemptAgentType('claude-tweaks:qa-agent'), false);
});

test('isExemptAgentType: false for a bare harness built-in type (no namespace)', () => {
  assert.strictEqual(substop.isExemptAgentType('general-purpose'), false);
  assert.strictEqual(substop.isExemptAgentType('Explore'), false);
});

test('isExemptAgentType: false for a missing/non-string agent_type', () => {
  assert.strictEqual(substop.isExemptAgentType(undefined), false);
  assert.strictEqual(substop.isExemptAgentType(null), false);
});

test('subagent-stop: does not log a contract-violation for an exempt third-party agent_type, even with malformed text (#1596)', () => {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcript('Based on my review, the file looks fine.'), agent_type: 'code-simplifier:code-simplifier' },
    runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x',
  });
  assert.deepStrictEqual(out, {});
  assert.ok(!fs.existsSync(path.join(run, 'events.jsonl')), 'expected no events.jsonl for an exempt agent');
});

test('subagent-stop: still logs a contract-violation for a non-exempt agent_type with malformed text (#1596)', () => {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcript('Based on my review, DONE'), agent_type: 'general-purpose' },
    runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x',
  });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});

// #1928 AC5: no agent transcript ⇒ nothing to grade. The parent session's own
// transcript_path was the fallback that graded orchestrator narration as a
// subagent reply (2,471 events in the corpus, most of this shape).
test('#1928 AC5: transcript_path alone appends no contract-violation event', () => {
  const run = mkRun();
  const out = substop.run({ input: { transcript_path: transcript('I did some things.') }, runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x' });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false);
});

// #2036: SubagentStop's agent_transcript_path identical to the same event's
// own transcript_path is a known-unreliable attribution (claude-code#27755) —
// the dispatching session's own async-wait status narration
// (agent-tool-async-wait-pattern.md: status message, no tool call, while
// awaiting an Agent-tool dispatch's async notification), not a distinct
// subagent's final reply. AC1: no contract-violation event or systemMessage.
test('#2036 AC1: agent_transcript_path identical to transcript_path appends no contract-violation event', () => {
  const run = mkRun();
  const t = transcript('Waiting on the code-simplifier subagent to return before proceeding.');
  const out = substop.run({
    input: { agent_transcript_path: t, transcript_path: t },
    runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x',
  });
  assert.deepStrictEqual(out, {});
  assert.strictEqual(fs.existsSync(path.join(run, 'events.jsonl')), false);
});

// #2036 AC2: a genuine subagent stop — a DISTINCT agent_transcript_path from
// transcript_path, whose own final reply omits the status line — must still
// be flagged. The #2036 fix narrows the false-positive without disabling the
// real check.
test('#2036 AC2: a genuinely distinct agent transcript missing the status line still logs a contract-violation, even when transcript_path is also present', () => {
  const run = mkRun();
  const out = substop.run({
    input: { agent_transcript_path: transcript('I did some things.'), transcript_path: '/main-session/transcript.jsonl' },
    runDir: run, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd: '/x',
  });
  assert.match(out.json.systemMessage, /status line/i);
  assert.strictEqual(readEvents(run)[0].type, 'contract-violation');
});
