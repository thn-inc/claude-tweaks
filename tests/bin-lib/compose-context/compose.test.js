'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KEYS, VOCAB, UNRESOLVED, MarkerError, parseMarkers, stripMarkers, compose, unresolvedKeys, renderResolvedHeader,
} = require('../../../plugin/bin/lib/compose-context/compose');

const ALL = {
  'integration-model': 'pr-first', mode: 'auto', attendance: 'attended',
  transport: 'gh', 'worktree-policy': 'always', 'work-backend': 'github-issues',
};
const HEADER = '<!-- resolved: integration-model=pr-first mode=auto attendance=attended transport=gh worktree-policy=always work-backend=github-issues -->';

test('KEYS is the six-key canonical order and VOCAB covers exactly those keys', () => {
  assert.deepEqual(KEYS, ['integration-model', 'mode', 'attendance', 'transport', 'worktree-policy', 'work-backend']);
  assert.deepEqual(Object.keys(VOCAB), KEYS);
  assert.deepEqual(VOCAB.mode, ['auto', 'confirm', 'interactive', 'hybrid']);
  assert.equal(UNRESOLVED, 'unresolved');
});

test('a branch is stripped when its condition does not match', () => {
  const src = { path: 'a.md', content: 'keep\n<!-- when: integration-model=local-merge -->\ndrop me\n<!-- /when -->\nafter\n' };
  assert.equal(compose([src], ALL), `${HEADER}\nkeep\nafter\n`);
});

test('a branch is kept when its condition matches, with its marker lines removed', () => {
  const src = { path: 'a.md', content: '<!-- when: integration-model=pr-first -->\nkept\n<!-- /when -->\n' };
  assert.equal(compose([src], ALL), `${HEADER}\nkept\n`);
});

test('nested markers (depth 1) resolve with AND semantics', () => {
  const src = { path: 'a.md', content: [
    '<!-- when: integration-model=pr-first -->',
    'outer',
    '<!-- when: mode=auto -->',
    'inner-match',
    '<!-- /when -->',
    '<!-- when: mode=confirm -->',
    'inner-miss',
    '<!-- /when -->',
    '<!-- /when -->',
    '',
  ].join('\n') };
  assert.equal(compose([src], ALL), `${HEADER}\nouter\ninner-match\n`);
  // inner match inside a stripped outer block is stripped with it
  const src2 = { path: 'b.md', content: '<!-- when: integration-model=local-merge -->\nouter\n<!-- when: mode=auto -->\ninner\n<!-- /when -->\n<!-- /when -->\n' };
  assert.equal(compose([src2], ALL), `${HEADER}\n`);
});

test('an unresolved key keeps both branches and appears in unresolvedKeys and the header', () => {
  const conditions = { ...ALL, mode: UNRESOLVED, 'work-backend': UNRESOLVED };
  const src = { path: 'a.md', content: '<!-- when: mode=auto -->\nA\n<!-- /when -->\n<!-- when: mode=confirm -->\nB\n<!-- /when -->\n' };
  const out = compose([src], conditions);
  assert.equal(out.split('\n')[0], '<!-- resolved: integration-model=pr-first mode=unresolved attendance=attended transport=gh worktree-policy=always work-backend=unresolved -->');
  assert.equal(out, `${out.split('\n')[0]}\nA\nB\n`);
  assert.deepEqual(unresolvedKeys(conditions), ['mode', 'work-backend']);
  assert.equal(renderResolvedHeader(ALL), HEADER);
});

test('sources concatenate in argv order, each body newline-terminated', () => {
  const a = { path: 'a.md', content: 'first' };
  const b = { path: 'b.md', content: 'second\n' };
  assert.equal(compose([b, a], ALL), `${HEADER}\nsecond\nfirst\n`);
});

const MALFORMED = [
  ['unclosed marker', '<!-- when: mode=auto -->\nx\n', 1, /unclosed/],
  ['unknown key', '<!-- when: colour=red -->\nx\n<!-- /when -->\n', 1, /unknown key/],
  ['unknown value', '<!-- when: mode=turbo -->\nx\n<!-- /when -->\n', 1, /unknown value/],
  ['nesting deeper than 1', '<!-- when: mode=auto -->\n<!-- when: transport=gh -->\n<!-- when: attendance=attended -->\nx\n<!-- /when -->\n<!-- /when -->\n<!-- /when -->\n', 3, /nesting/],
  ['close without open', 'x\n<!-- /when -->\n', 2, /without/],
  ['two pairs on one marker', '<!-- when: mode=auto transport=gh -->\nx\n<!-- /when -->\n', 1, /malformed marker/],
  ['a marker-shaped comment with no key=value', '<!-- when: -->\nx\n<!-- /when -->\n', 1, /malformed marker/],
];

test('an ordinary HTML comment that merely starts with the word "when" is content, not a marker', () => {
  const src = { path: 'a.md', content: '<!-- whenever this runs, note it -->\nbody\n' };
  assert.equal(compose([src], ALL), `${HEADER}\n<!-- whenever this runs, note it -->\nbody\n`);
});
for (const [label, content, line, re] of MALFORMED) {
  test(`malformed marker (${label}) throws MarkerError naming file and line ${line}`, () => {
    const src = { path: 'bad.md', content };
    assert.throws(() => compose([src], ALL), (err) => err instanceof MarkerError && err.name === 'MarkerError' && err.file === 'bad.md' && err.line === line && re.test(err.message));
    assert.throws(() => stripMarkers(content), (err) => err instanceof MarkerError && err.line === line);
  });
}

test('every marker in every source is validated before any branch is decided', () => {
  // the second source is malformed even though the first would compose cleanly
  const good = { path: 'good.md', content: 'ok\n' };
  const bad = { path: 'bad.md', content: '<!-- when: mode=auto -->\nx\n' };
  assert.throws(() => compose([good, bad], ALL), (err) => err.file === 'bad.md' && err.line === 1);
});

test('stripMarkers removes marker lines only and keeps every branch', () => {
  const content = 'a\n<!-- when: mode=auto -->\nb\n<!-- when: transport=gh -->\nc\n<!-- /when -->\n<!-- /when -->\nd\n';
  assert.equal(stripMarkers(content), 'a\nb\nc\nd\n');
  assert.equal(stripMarkers('no markers'), 'no markers');
});

test('a conditions object missing a key or carrying an off-vocabulary value is a TypeError, not a silent default', () => {
  const { mode, ...missing } = ALL;
  assert.throws(() => compose([{ path: 'a.md', content: 'x\n' }], missing), TypeError);
  assert.throws(() => compose([{ path: 'a.md', content: 'x\n' }], { ...ALL, transport: 'carrier-pigeon' }), TypeError);
});

test('a fenced example composes verbatim — fence lines and marker lines included — even when the fenced condition does not match', () => {
  // ALL resolves integration-model=pr-first, so a real (unfenced) local-merge
  // block here would be stripped entirely. Fenced, it must survive untouched.
  const content = '```markdown\n<!-- when: integration-model=local-merge -->\nlocal only\n<!-- /when -->\n```\nafter\n';
  const src = { path: 'a.md', content };
  assert.equal(compose([src], ALL), `${HEADER}\n${content}`);
});

test('stripMarkers leaves a marker-shaped line inside a fence untouched', () => {
  const content = '```\n<!-- when: mode=auto -->\n```\n';
  assert.equal(stripMarkers(content), content);
});

test('a marker opened at line 1 whose only close sits inside a fence throws MarkerError "unclosed" with line 1', () => {
  const content = '<!-- when: mode=auto -->\nx\n```\n<!-- /when -->\n```\n';
  assert.throws(
    () => compose([{ path: 'a.md', content }], ALL),
    (err) => err instanceof MarkerError && /unclosed/.test(err.message) && err.line === 1,
  );
});

test('a four-backtick fence containing a nested three-backtick block and a marker pair composes verbatim', () => {
  const content = '````markdown\n```bash\necho hi\n```\n<!-- when: mode=confirm -->\nx\n<!-- /when -->\n````\nafter\n';
  const src = { path: 'a.md', content };
  assert.equal(compose([src], ALL), `${HEADER}\n${content}`);
});

test('a ```markdown fence containing a ~~~ line and a marker pair, closed by ```, composes verbatim with no error', () => {
  const content = '```markdown\n<!-- when: mode=auto -->\n~~~\nx\n<!-- /when -->\n```\nafter\n';
  const src = { path: 'a.md', content };
  assert.equal(compose([src], ALL), `${HEADER}\n${content}`);
  assert.equal(stripMarkers(content), content);
});

test('parseMarkers tags text tokens inside a code fence with fenced: true and nothing else', () => {
  const tokens = parseMarkers('a\n```bash\n# not a heading\n<!-- when: mode=auto -->\n```\nb\n');
  assert.deepEqual(tokens.map((token) => [token.type, token.fenced === true]), [
    ['text', false], ['text', true], ['text', true], ['text', true], ['text', true], ['text', false], ['text', false],
  ]);
  assert.ok(!('fenced' in tokens[0]), 'an unfenced token carries no fenced key');
});
