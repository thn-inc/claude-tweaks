'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  REASONS,
  REMEDIES,
  parseTypedDispatch,
  resolveBuildAuthority,
  formatAuthorityLine,
  remedyFor,
} = require('../../../plugin/bin/lib/issues/build-authority');

// A person's interactive session: every condition 1-4 holds.
const SESSION_ENV = Object.freeze({
  CLAUDECODE: '1',
  CLAUDE_CODE_SESSION_ID: 'sess-1',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDE_CODE_SESSION_ATTENDED: '1',
});

function counter(answer) {
  const fn = () => { fn.calls += 1; return answer; };
  fn.calls = 0;
  return fn;
}

function resolve(over = {}) {
  return resolveBuildAuthority({
    number: 12,
    labels: ['ready'],
    named: true,
    env: SESSION_ENV,
    typedCommand: { answer: 'typed' },
    stdinIsTTY: false,
    ...over,
  });
}

// ---- REASONS ----

test('AC3: REASONS is the twenty-one words, in order, frozen', () => {
  assert.deepStrictEqual(REASONS, [
    'not-named', 'not-ready', 'held', 'labels-unreadable', 'entrypoint', 'not-attended', 'remote',
    'hub-run', 'launcher', 'no-session-id', 'no-pointer', 'pointer-unreadable', 'pointer-other-session',
    'expired', 'no-transcript', 'transcript-unreadable', 'no-prompt-row', 'not-typed', 'other-command',
    'not-a-terminal', 'ci',
  ]);
  assert.ok(Object.isFrozen(REASONS));
});

test('REMEDIES has one sentence per reason word, frozen', () => {
  assert.deepStrictEqual(Object.keys(REMEDIES).sort(), [...REASONS].sort());
  assert.ok(Object.isFrozen(REMEDIES));
  assert.strictEqual(REMEDIES['not-ready'], 'run /claude-tweaks:specify #N');
  assert.strictEqual(REMEDIES.launcher, 'the launcher must export CC_LAUNCHED_BY=user (thn-inc/claude-user-config#50)');
  assert.strictEqual(REMEDIES['not-named'], 'grant it with /claude-tweaks:backlog refine #N');
  assert.strictEqual(REMEDIES.expired, 'grant it with /claude-tweaks:backlog refine #N, or type the command again');
  assert.strictEqual(REMEDIES['no-pointer'], 'grant it with /claude-tweaks:backlog refine #N, or type the command again');
  assert.strictEqual(REMEDIES.held, 'clear bot:blocked, bot:parked or parked on #N once its trigger has fired, then type the command again');
  assert.strictEqual(REMEDIES['labels-unreadable'], "re-run once the record's labels can be read");
  for (const word of REASONS.filter((w) => !['not-ready', 'launcher', 'expired', 'no-pointer', 'held', 'labels-unreadable'].includes(w))) {
    assert.strictEqual(REMEDIES[word], 'grant it with /claude-tweaks:backlog refine #N', word);
  }
});

// ---- the state table, one test per row ----

test('AC3 row 1: labels not an array -> none (labels-unreadable)', () => {
  for (const labels of [null, undefined, 'ready', { ready: true }]) {
    assert.deepStrictEqual(resolve({ labels }), { authority: 'none', reasons: ['labels-unreadable'] });
  }
});

test('AC3 row 2: auto:build -> label, nothing else read (typedCommand not called)', () => {
  const tc = counter({ answer: 'none', reason: 'not-typed' });
  assert.deepStrictEqual(
    resolve({ labels: ['auto:build'], named: false, env: {}, typedCommand: tc }),
    { authority: 'label', reasons: [] },
  );
  assert.deepStrictEqual(resolve({ labels: [{ name: 'auto:build' }, 'bot:blocked'], typedCommand: tc }).authority, 'label');
  assert.strictEqual(tc.calls, 0);
});

test('AC3 row 3: the command did not name the record -> none (not-named)', () => {
  for (const named of [false, undefined, 'true', 1]) {
    assert.deepStrictEqual(resolve({ named }), { authority: 'none', reasons: ['not-named'] });
  }
});

test('AC3 row 4 / AC15: named, labels lack ready -> none (not-ready)', () => {
  assert.deepStrictEqual(resolve({ labels: [] }), { authority: 'none', reasons: ['not-ready'] });
  assert.deepStrictEqual(resolve({ labels: ['Ready', 'ready '] }), { authority: 'none', reasons: ['not-ready'] });
});

for (const label of ['bot:blocked', 'bot:parked', 'parked']) {
  test(`AC3 row 5 / AC15: named ready record carrying ${label} -> none (held), even with a typed command`, () => {
    const tc = counter({ answer: 'typed' });
    assert.deepStrictEqual(resolve({ labels: ['ready', label], typedCommand: tc }), { authority: 'none', reasons: ['held'] });
    assert.deepStrictEqual(resolve({ labels: [{ name: label }, { name: 'ready' }], typedCommand: tc }), { authority: 'none', reasons: ['held'] });
    assert.strictEqual(tc.calls, 0);
  });
}

test('AC3 row 6: named, ready, in session, conditions 1-4 hold, transcript typed -> typed', () => {
  const tc = counter({ answer: 'typed' });
  assert.deepStrictEqual(resolve({ typedCommand: tc }), { authority: 'typed', reasons: [] });
  assert.strictEqual(tc.calls, 1);
  assert.deepStrictEqual(resolve({ typedCommand: { answer: 'typed' } }), { authority: 'typed', reasons: [] });
  assert.deepStrictEqual(resolve({ labels: [{ name: 'ready' }] }), { authority: 'typed', reasons: [] });
});

test('AC3 row 6: either session variable alone marks a session', () => {
  const { CLAUDECODE, ...noCode } = SESSION_ENV;
  const { CLAUDE_CODE_SESSION_ID, ...noId } = SESSION_ENV;
  for (const env of [noCode, noId]) {
    const tc = counter({ answer: 'none', reason: 'no-pointer' });
    // stdinIsTTY true would pass the terminal path; the session path must run instead.
    assert.deepStrictEqual(resolve({ env, typedCommand: tc, stdinIsTTY: true }), { authority: 'none', reasons: ['no-pointer'] });
    assert.strictEqual(tc.calls, 1);
  }
});

test('AC3 row 6: a non-string session variable still takes the session path, never the terminal path', () => {
  for (const env of [{ CLAUDECODE: 1 }, { CLAUDE_CODE_SESSION_ID: 7 }, { CLAUDECODE: true }]) {
    const tc = counter({ answer: 'typed' });
    assert.deepStrictEqual(resolve({ env, stdinIsTTY: true, typedCommand: tc }), { authority: 'none', reasons: ['entrypoint', 'not-attended'] });
    assert.strictEqual(tc.calls, 0);
    const full = { ...env, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ATTENDED: '1' };
    const tc2 = counter({ answer: 'none', reason: 'no-pointer' });
    assert.deepStrictEqual(resolve({ env: full, stdinIsTTY: true, typedCommand: tc2 }), { authority: 'none', reasons: ['no-pointer'] });
    assert.strictEqual(tc2.calls, 1);
  }
});

test('AC3 condition 5: a typedCommand thunk that throws answers none (transcript-unreadable), never propagates', () => {
  const thrower = () => { throw new Error('EIO'); };
  assert.deepStrictEqual(resolve({ typedCommand: thrower }), { authority: 'none', reasons: ['transcript-unreadable'] });
});

test('AC3 row 7: named, ready, outside a session, terminal conditions hold -> typed, no transcript read', () => {
  const tc = counter({ answer: 'none', reason: 'no-pointer' });
  assert.deepStrictEqual(resolve({ env: {}, stdinIsTTY: true, typedCommand: tc }), { authority: 'typed', reasons: [] });
  assert.deepStrictEqual(resolve({ env: { CLAUDECODE: '', CLAUDE_CODE_SESSION_ID: '' }, stdinIsTTY: true, typedCommand: tc }), { authority: 'typed', reasons: [] });
  assert.strictEqual(tc.calls, 0);
});

test('AC3 row 7: env absent or not an object reads as {}', () => {
  for (const env of [undefined, null, 'CI=1', 42]) {
    assert.deepStrictEqual(resolve({ env, stdinIsTTY: true }), { authority: 'typed', reasons: [] });
    assert.deepStrictEqual(resolve({ env, stdinIsTTY: false }), { authority: 'none', reasons: ['not-a-terminal'] });
  }
});

test('AC3 row 8: terminal path — stdin not a terminal, CI set -> none naming each', () => {
  for (const stdinIsTTY of [false, undefined, 'true', 1]) {
    assert.deepStrictEqual(resolve({ env: {}, stdinIsTTY }), { authority: 'none', reasons: ['not-a-terminal'] });
  }
  for (const CI of ['1', 'true', ' ', '0']) {
    assert.deepStrictEqual(resolve({ env: { CI }, stdinIsTTY: true }), { authority: 'none', reasons: ['ci'] });
  }
  assert.deepStrictEqual(resolve({ env: { CI: '' }, stdinIsTTY: true }).authority, 'typed');
  assert.deepStrictEqual(
    resolve({ env: { CI: '1', CLAUDE_CODE_REMOTE: '1', CC_HUB_RUN: '1', CC_POSTURE: 'x' }, stdinIsTTY: false }),
    { authority: 'none', reasons: ['not-a-terminal', 'ci', 'remote', 'hub-run', 'launcher'] },
  );
});

test('AC3 row 8: session path collects every failed condition 1-4 and never calls typedCommand', () => {
  const tc = counter({ answer: 'typed' });
  assert.deepStrictEqual(
    resolve({ env: { CLAUDECODE: '1', CLAUDE_CODE_REMOTE: '1', CC_HUB_RUN: 'x', CC_LAUNCHED_BY: 'hub' }, typedCommand: tc }),
    { authority: 'none', reasons: ['entrypoint', 'not-attended', 'remote', 'hub-run', 'launcher'] },
  );
  assert.strictEqual(tc.calls, 0);
});

// ---- per environment condition: unset, empty, wrong value ----

const BAD_ENTRYPOINT = [undefined, '', 'CLI', 'cli ', 'cli\n', 'sdk-cli'];
const BAD_ATTENDED = [undefined, '', '1\n', ' 1', '0', 'true'];

for (const v of BAD_ENTRYPOINT) {
  test(`AC3 condition 1: CLAUDE_CODE_ENTRYPOINT=${JSON.stringify(v)} -> none (entrypoint)`, () => {
    const tc = counter({ answer: 'typed' });
    const env = { ...SESSION_ENV, CLAUDE_CODE_ENTRYPOINT: v };
    if (v === undefined) delete env.CLAUDE_CODE_ENTRYPOINT;
    assert.deepStrictEqual(resolve({ env, typedCommand: tc }), { authority: 'none', reasons: ['entrypoint'] });
    assert.strictEqual(tc.calls, 0);
  });
}

for (const v of BAD_ATTENDED) {
  test(`AC3 condition 2: CLAUDE_CODE_SESSION_ATTENDED=${JSON.stringify(v)} -> none (not-attended)`, () => {
    const tc = counter({ answer: 'typed' });
    const env = { ...SESSION_ENV, CLAUDE_CODE_SESSION_ATTENDED: v };
    if (v === undefined) delete env.CLAUDE_CODE_SESSION_ATTENDED;
    assert.deepStrictEqual(resolve({ env, typedCommand: tc }), { authority: 'none', reasons: ['not-attended'] });
    assert.strictEqual(tc.calls, 0);
  });
}

for (const [key, word] of [['CLAUDE_CODE_REMOTE', 'remote'], ['CC_HUB_RUN', 'hub-run']]) {
  test(`AC3 condition 3: ${key} set -> none (${word}) on both paths; unset or empty holds`, () => {
    for (const v of ['1', 'true', '0', ' ', '\n']) {
      const tc = counter({ answer: 'typed' });
      assert.deepStrictEqual(resolve({ env: { ...SESSION_ENV, [key]: v }, typedCommand: tc }), { authority: 'none', reasons: [word] });
      assert.strictEqual(tc.calls, 0);
      assert.deepStrictEqual(resolve({ env: { [key]: v }, stdinIsTTY: true }), { authority: 'none', reasons: [word] });
    }
    assert.strictEqual(resolve({ env: { ...SESSION_ENV, [key]: '' } }).authority, 'typed');
    assert.strictEqual(resolve({ env: { [key]: '' }, stdinIsTTY: true }).authority, 'typed');
  });
}

test('AC3 condition 4 / Review Focus 3: CC_POSTURE set and CC_LAUNCHED_BY unset -> none (launcher)', () => {
  const tc = counter({ answer: 'typed' });
  const r = resolve({ env: { ...SESSION_ENV, CC_POSTURE: 'interactive' }, typedCommand: tc });
  assert.deepStrictEqual(r, { authority: 'none', reasons: ['launcher'] });
  assert.strictEqual(tc.calls, 0);
  assert.match(formatAuthorityLine(12, r), /the launcher must export CC_LAUNCHED_BY=user/);
});

for (const v of ['hub', '', 'User', 'user ', 'user\n']) {
  test(`AC3 condition 4: CC_LAUNCHED_BY=${JSON.stringify(v)} with CC_POSTURE set -> none (launcher)`, () => {
    const tc = counter({ answer: 'typed' });
    const env = { ...SESSION_ENV, CC_POSTURE: 'x', CC_LAUNCHED_BY: v };
    assert.deepStrictEqual(resolve({ env, typedCommand: tc }), { authority: 'none', reasons: ['launcher'] });
    assert.strictEqual(tc.calls, 0);
    assert.deepStrictEqual(resolve({ env: { CC_POSTURE: 'x', CC_LAUNCHED_BY: v }, stdinIsTTY: true }), { authority: 'none', reasons: ['launcher'] });
  });
}

test('AC3 condition 4: CC_LAUNCHED_BY set alone must be user; user passes; neither set holds', () => {
  assert.deepStrictEqual(resolve({ env: { ...SESSION_ENV, CC_LAUNCHED_BY: 'hub' } }), { authority: 'none', reasons: ['launcher'] });
  assert.strictEqual(resolve({ env: { ...SESSION_ENV, CC_LAUNCHED_BY: 'user' } }).authority, 'typed');
  assert.strictEqual(resolve({ env: { ...SESSION_ENV, CC_POSTURE: 'x', CC_LAUNCHED_BY: 'user' } }).authority, 'typed');
  assert.strictEqual(resolve({ env: { ...SESSION_ENV, CC_POSTURE: '', CC_LAUNCHED_BY: '' } }).authority, 'typed');
});

// ---- condition 5: the typedCommand answer ----

test('AC3 condition 5: a refused transcript answer is none with its reason word', () => {
  for (const reason of ['no-session-id', 'no-pointer', 'expired', 'no-transcript', 'not-typed', 'other-command']) {
    const tc = counter({ answer: 'none', reason });
    assert.deepStrictEqual(resolve({ typedCommand: tc }), { authority: 'none', reasons: [reason] });
    assert.strictEqual(tc.calls, 1);
  }
});

test('AC3 condition 5: an answer that is not exactly typed is none; an unknown reason names not-typed', () => {
  for (const typedCommand of [
    undefined, null, 'typed', { answer: 'Typed' }, { answer: 'typed ' }, { answer: true },
    { reason: 'made-up' }, () => undefined, () => 'typed',
    { answer: 'none', reason: 'made-up' }, { answer: 'none', reason: 'label' }, { answer: 'none' },
  ]) {
    assert.deepStrictEqual(resolve({ typedCommand }), { authority: 'none', reasons: ['not-typed'] }, JSON.stringify(typedCommand));
  }
  assert.deepStrictEqual(resolve({ typedCommand: { reason: 'expired' } }), { authority: 'none', reasons: ['expired'] });
});

test('AC3 condition 5: typedCommand thunk is not called when the record is not named or not ready', () => {
  const tc = counter({ answer: 'typed' });
  resolve({ named: false, typedCommand: tc });
  resolve({ labels: [], typedCommand: tc });
  resolve({ labels: null, typedCommand: tc });
  resolve({ env: {}, stdinIsTTY: true, typedCommand: tc });
  assert.strictEqual(tc.calls, 0);
});

// ---- parseTypedDispatch ----

test('AC2 grammar: parseTypedDispatch accepts a record list and resume #N', () => {
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12,#13'), [12, 13]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12,#12'), [12, 12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12, #13'), [12, 13]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch 12'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch resume #12'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch resume 12'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12 \r'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12\r'), [12]);
  assert.deepStrictEqual(parseTypedDispatch('/claude-tweaks:dispatch #12   '), [12]);
});

test('AC2 grammar: parseTypedDispatch rejects every other form', () => {
  for (const line of [
    '/claude-tweaks:dispatch next',
    '/claude-tweaks:dispatch --budget 2',
    '/claude-tweaks:dispatch #12 --budget 2',
    '/claude-tweaks:dispatch close-out #12',
    '/claude-tweaks:dispatch --settle-parked',
    '/claude-tweaks:dispatch --priority high',
    '/claude-tweaks:dispatch #12,',
    '/claude-tweaks:dispatch #x',
    '/claude-tweaks:dispatch #0',
    '/claude-tweaks:dispatch #12 #13',
    '/claude-tweaks:dispatch resume #12 #13',
    '/claude-tweaks:dispatch resume #12,#13',
    '/claude-tweaks:dispatch resume',
    '/claude-tweaks:dispatch resume #x',
    '/claude-tweaks:dispatch #12\r\r',
    '/claude-tweaks:dispatch #12\n',
    '/claude-tweaks:dispatch #12\t',
    '/claude-tweaks:dispatch #0x0c',
    '/claude-tweaks:dispatch #1e1',
    '/claude-tweaks:dispatch #12.0',
    '/claude-tweaks:dispatch # 12',
    '/claude-tweaks:dispatch #99999999999999999999',
    '/claude-tweaks:dispatch ',
    '/claude-tweaks:dispatch',
    '',
    ' /claude-tweaks:dispatch #12',
    '/claude-tweaks:dispatchx #12',
    '/claude-tweaks:dispatch#12',
    '/claude-tweaks:dispatch12',
    '/claude-tweaks:flow #12',
    '/claude-tweaks:Dispatch #12',
  ]) {
    assert.strictEqual(parseTypedDispatch(line), null, JSON.stringify(line));
  }
  for (const v of [undefined, null, 12, ['/claude-tweaks:dispatch #12']]) {
    assert.strictEqual(parseTypedDispatch(v), null);
  }
});

// ---- formatAuthorityLine ----

test('formatAuthorityLine: label prints nothing (null)', () => {
  assert.strictEqual(formatAuthorityLine(12, { authority: 'label', reasons: [] }), null);
});

test('formatAuthorityLine: none with empty or missing reasons prints the fixed fallback, never ()', () => {
  const fallback = '#12 has no auto:build label — not built: typed command not accepted; grant it with /claude-tweaks:backlog refine #12 (a typed command with any other argument records nothing)';
  assert.strictEqual(formatAuthorityLine(12, { authority: 'none', reasons: [] }), fallback);
  assert.strictEqual(formatAuthorityLine(12, { authority: 'none' }), fallback);
  assert.strictEqual(formatAuthorityLine(12, { authority: 'none', reasons: 'held' }), fallback);
});

test('formatAuthorityLine: held and labels-unreadable carry their actionable remedies', () => {
  assert.strictEqual(
    formatAuthorityLine(12, { authority: 'none', reasons: ['held'] }),
    '#12 has no auto:build label — not built: typed command not accepted (held); clear bot:blocked, bot:parked or parked on #12 once its trigger has fired, then type the command again (a typed command with any other argument records nothing)',
  );
  assert.strictEqual(
    formatAuthorityLine(12, { authority: 'none', reasons: ['labels-unreadable'] }),
    "#12 has no auto:build label — not built: typed command not accepted (labels-unreadable); re-run once the record's labels can be read (a typed command with any other argument records nothing)",
  );
});

test('formatAuthorityLine: typed', () => {
  assert.strictEqual(
    formatAuthorityLine(12, { authority: 'typed', reasons: [] }),
    '#12 has no auto:build label — built on the typed /claude-tweaks:dispatch command',
  );
});

test('formatAuthorityLine: none names the reasons and the first reason\'s remedy with the number', () => {
  assert.strictEqual(
    formatAuthorityLine(12, { authority: 'none', reasons: ['not-ready'] }),
    '#12 has no auto:build label — not built: typed command not accepted (not-ready); run /claude-tweaks:specify #12 (a typed command with any other argument records nothing)',
  );
  assert.strictEqual(
    formatAuthorityLine(7, { authority: 'none', reasons: ['entrypoint', 'remote'] }),
    '#7 has no auto:build label — not built: typed command not accepted (entrypoint, remote); grant it with /claude-tweaks:backlog refine #7 (a typed command with any other argument records nothing)',
  );
  assert.strictEqual(
    formatAuthorityLine(7, { authority: 'none', reasons: ['remote', 'launcher'] }),
    '#7 has no auto:build label — not built: typed command not accepted (remote, launcher); grant it with /claude-tweaks:backlog refine #7 (a typed command with any other argument records nothing)',
  );
  assert.strictEqual(
    formatAuthorityLine(9, { authority: 'none', reasons: ['no-pointer'] }),
    '#9 has no auto:build label — not built: typed command not accepted (no-pointer); grant it with /claude-tweaks:backlog refine #9, or type the command again (a typed command with any other argument records nothing)',
  );
});

test('remedyFor: the first reason word names the remedy with the record number, else the caller falls back (an unknown or empty list, a non-array)', () => {
  assert.strictEqual(remedyFor(['not-ready', 'ci'], 12, 'FALLBACK'), 'run /claude-tweaks:specify #12');
  assert.strictEqual(remedyFor(['bogus'], 12, 'FALLBACK'), 'FALLBACK');
  assert.strictEqual(remedyFor([], 12, 'FALLBACK'), 'FALLBACK');
  assert.strictEqual(remedyFor(undefined, 12, 'FALLBACK'), 'FALLBACK');
  assert.strictEqual(remedyFor(['__proto__'], 12, 'FALLBACK'), 'FALLBACK');
});
