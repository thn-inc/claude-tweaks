'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  renderVerdictMarker,
  parseVerdictMarker,
  verdictAgreement,
} = require('../../../plugin/bin/lib/issues/accept-verdict');

const LT = '\\u003c';
const GT = '\\u003e';
const OPEN = '<!-- accept-verdict: ';
const CLOSE = ' -->';
const good = '<!-- accept-verdict: {"v":1,"verdict":"changes-requested","choice":"fix-forward","note":"x"} -->';
const goodVerdict = { v: 1, verdict: 'changes-requested', choice: 'fix-forward', note: 'x' };
const raw = (json) => `${OPEN}${json}${CLOSE}`;
const block = (obj) => raw(JSON.stringify(obj));

const parseOwner = (body) => parseVerdictMarker({ body, authorAssociation: 'OWNER' });

function assertRejected(result, reasonPattern, label) {
  assert.strictEqual(result.ok, false, `${label}: expected a rejection, got ${JSON.stringify(result)}`);
  assert.strictEqual(typeof result.reason, 'string', label);
  assert.notStrictEqual(result.reason, '', label);
  assert.match(result.reason, reasonPattern, label);
  assert.strictEqual(result.verdict, undefined, label);
}

function assertAllRejected(cases) {
  for (const [label, body, reasonPattern] of cases) {
    assertRejected(parseOwner(body), reasonPattern, label);
  }
}

test('AC4.1: a well-formed block from a trusted comment parses', () => {
  for (const authorAssociation of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.deepStrictEqual(
      parseVerdictMarker({ body: good, authorAssociation }),
      { ok: true, verdict: goodVerdict },
      authorAssociation,
    );
  }
});

test('AC4.1: a block parses beside prose and with either choice or the approved shape', () => {
  assert.deepStrictEqual(parseOwner(`Found a bug.\n\n${good}\n\nThanks`), { ok: true, verdict: goodVerdict });
  assert.deepStrictEqual(parseOwner(`${good}  \n`), { ok: true, verdict: goodVerdict });
  const revert = { v: 1, verdict: 'changes-requested', choice: 'revert-now', note: 'y' };
  assert.deepStrictEqual(parseOwner(block(revert)), { ok: true, verdict: revert });
  const approved = { v: 1, verdict: 'approved', note: 'ok' };
  assert.deepStrictEqual(parseOwner(block(approved)), { ok: true, verdict: approved });
});

test('AC4.1: note is optional; a marker without one parses and carries none', () => {
  const noNote = { v: 1, verdict: 'approved' };
  assert.deepStrictEqual(parseOwner(block(noNote)), { ok: true, verdict: noNote });
});

test('AC4.1: the note limit is 2000 characters, inclusive', () => {
  const note = 'n'.repeat(2000);
  assert.deepStrictEqual(parseOwner(block({ v: 1, verdict: 'approved', note })), {
    ok: true,
    verdict: { v: 1, verdict: 'approved', note },
  });
  assertRejected(parseOwner(block({ v: 1, verdict: 'approved', note: `${note}n` })), /note/, '2001');
});

test('AC4.1: each malformed block is { ok: false }, never an exception', () => {
  assertAllRejected([
    ['an empty body', '', /no verdict marker/],
    ['a body with no marker', 'just prose', /no verdict marker/],
    ['an unterminated comment', '<!-- accept-verdict: {"v":1,"verdict":"approved","note":"x"}', /malformed/],
    ['v: 2', block({ v: 2, verdict: 'approved', note: 'x' }), /version/],
    ['v missing', block({ verdict: 'approved', note: 'x' }), /version/],
    ['v as a string', block({ v: '1', verdict: 'approved', note: 'x' }), /version/],
    ['an unknown verdict word', block({ v: 1, verdict: 'pending', note: 'x' }), /verdict word/],
    ['a missing verdict', block({ v: 1, note: 'x' }), /verdict word/],
    ['choice missing with changes-requested', block({ v: 1, verdict: 'changes-requested', note: 'x' }), /choice/],
    ['choice present with approved', block({ v: 1, verdict: 'approved', choice: 'fix-forward', note: 'x' }), /choice/],
    ['an unknown choice word', block({ v: 1, verdict: 'changes-requested', choice: 'shrug', note: 'x' }), /choice/],
    ['a null choice with approved', block({ v: 1, verdict: 'approved', choice: null }), /choice/],
    ['a note that is not a string', block({ v: 1, verdict: 'approved', note: 7 }), /note/],
    ['a null note', block({ v: 1, verdict: 'approved', note: null }), /note/],
    ['an unknown field', block({ v: 1, verdict: 'approved', note: 'x', extra: true }), /unknown field/],
    ['a __proto__ field', raw('{"v":1,"verdict":"approved","__proto__":{"x":1}}'), /unknown field/],
    ['a repeated key', raw('{"v":1,"verdict":"approved","verdict":"changes-requested","choice":"fix-forward"}'), /repeated key/],
    ['a repeated key with spaces', raw('{"v":1,"verdict" : "approved","verdict" : "approved"}'), /repeated key/],
    ['a repeated key spelled with an escape', raw('{"v":1,"verdict":"approved","\\u0076erdict":"approved"}'), /repeated key/],
    ['JSON that does not parse', raw('{"v":1,'), /does not parse/],
    ['a JSON array', raw('[1]'), /not an object/],
    ['JSON null', raw('null'), /not an object/],
    ['a block in a ``` fence', `\`\`\`\n${good}\n\`\`\``, /code/],
    ['a block in a ~~~ fence', `~~~\n${good}\n~~~`, /code/],
    ['a block in a fence with an info string', `\`\`\`html\n${good}\n\`\`\``, /code/],
    ['a block in an unterminated fence', `\`\`\`\n${good}\n`, /code/],
    ['a block in an unterminated ~~~ fence', `~~~\n\n${good}`, /code/],
    ['a block past a shorter closing fence', `\`\`\`\`\n\`\`\`\n${good}\n\`\`\`\``, /code/],
    ['a block past a closer of the wrong character', `\`\`\`\n~~~\n${good}\n\`\`\``, /code/],
    ['a block past a closer with trailing text', `\`\`\`\n\`\`\` x\n${good}\n\`\`\``, /code/],
    ['a block past a closer indented four spaces', `\`\`\`\n    \`\`\`\n${good}\n\`\`\``, /code/],
    ['a block in a fence indented three spaces', `   \`\`\`\n${good}\n   \`\`\``, /code/],
    ['a block in a ~~~ fence whose info holds a backtick', `~~~ a\`b\n${good}\n~~~`, /code/],
    ['an indented block', `    ${good}`, /code/],
    ['a tab-indented block', `\t${good}`, /code/],
    ['a block in an inline span', `see \`${good}\` here`, /code/],
    ['a block in a double-backtick span', `see \`\` ${good} \`\` here`, /code/],
    ['a block in a span crossing lines', `see \`\n${good}\n\` here`, /code/],
    ['a second block in one comment', `${good}\n\n${good}`, /more than one/],
    ['a second block on one line', `${good} ${good}`, /more than one/],
    ['a real block beside a fenced one', `${good}\n\n\`\`\`\n${good}\n\`\`\``, /code/],
    ['a real block beside an inline-span one', `${good}\n\nsee \`${good}\``, /code/],
    ['a block broken across lines', '<!-- accept-verdict: {"v":1,\n"verdict":"approved"} -->', /malformed/],
    ['an opener split from its name', '<!--\naccept-verdict: {"v":1,"verdict":"approved"} -->', /malformed/],
    ['a wrong-case marker name', '<!-- ACCEPT-VERDICT: {"v":1,"verdict":"approved"} -->', /malformed/],
    ['a marker missing its spaces', '<!--accept-verdict:{"v":1,"verdict":"approved"}-->', /malformed/],
    ['a raw < inside a note', raw('{"v":1,"verdict":"approved","note":"a<b"}'), /raw/],
    ['a raw > inside a note', raw('{"v":1,"verdict":"approved","note":"a>b"}'), /raw/],
  ]);
});

test('AC4.1: bodies that are not strings, and malformed arguments, are rejected', () => {
  for (const body of [undefined, null, 7, {}, [good], true]) {
    assertRejected(parseOwner(body), /not a string/, `body ${JSON.stringify(body)}`);
  }
  for (const input of [undefined, null, 7, 'x', {}]) {
    assertRejected(parseVerdictMarker(input), /untrusted/, `input ${JSON.stringify(input)}`);
  }
});

test('AC4.1: a well-formed block from an untrusted comment is rejected', () => {
  for (const authorAssociation of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'owner', '', null, 1]) {
    assertRejected(parseVerdictMarker({ body: good, authorAssociation }), /untrusted/, String(authorAssociation));
  }
  assertRejected(parseVerdictMarker({ body: good }), /untrusted/, 'no association field');
  assertRejected(parseVerdictMarker({ body: good, author_association: 'OWNER' }), /untrusted/, 'REST spelling only');
});

test('AC4.1: trust is checked before the body is looked at', () => {
  assertRejected(parseVerdictMarker({ body: 7, authorAssociation: 'NONE' }), /untrusted/, 'untrusted non-string body');
});

test('AC4.1: CRLF bodies: a well-formed block parses, and a fenced or indented block is rejected', () => {
  const ok = { ok: true, verdict: goodVerdict };
  assert.deepStrictEqual(parseOwner(`${good}\r\n`), ok);
  assert.deepStrictEqual(parseOwner(`Intro\r\n\r\n${good}\r\n\r\nOutro`), ok);
  assert.deepStrictEqual(parseOwner(`Intro\r${good}\rOutro`), ok);
  assertAllRejected([
    ['a CRLF ``` fence', `\`\`\`\r\n${good}\r\n\`\`\`\r\n`, /code/],
    ['a CRLF ~~~ fence', `~~~\r\n${good}\r\n~~~\r\n`, /code/],
    ['a CRLF fence with an info string', `\`\`\`html\r\n${good}\r\n\`\`\`\r\n`, /code/],
    ['a CRLF unterminated fence', `\`\`\`\r\n${good}\r\n`, /code/],
    ['a CR-only fence', `\`\`\`\r${good}\r\`\`\`\r`, /code/],
    ['a CRLF indented block', `Intro\r\n\r\n    ${good}\r\n`, /code/],
    ['a CRLF span crossing lines', `see \`\r\n${good}\r\n\` here`, /code/],
    ['a CRLF second block', `${good}\r\n${good}\r\n`, /more than one/],
    ['a block broken by CRLF', '<!-- accept-verdict: {"v":1,\r\n"verdict":"approved"} -->', /malformed/],
    ['a block broken by a bare CR', '<!-- accept-verdict: {"v":1,\r"verdict":"approved"} -->', /malformed/],
  ]);
});

test('AC4.1: a block must own its line, so a nesting construct cannot carry one', () => {
  assertAllRejected([
    ['prose before it', `Approved ${good}`, /malformed/],
    ['prose after it', `${good} approved`, /malformed/],
    ['a blockquote', `> ${good}`, /malformed/],
    ['a closed fence inside a blockquote', `> \`\`\`\n> ${good}\n> \`\`\``, /code/],
    ['an open fence inside a blockquote', `> \`\`\`\n> ${good}`, /malformed/],
    ['a list item', `- ${good}`, /malformed/],
    ['a fence inside a list item', `- \`\`\`\n  ${good}\n  \`\`\``, /malformed/],
    ['a three-space indent', `   ${good}`, /malformed/],
    ['a backslash-escaped opener that renders as text', `\\${good}`, /malformed/],
    ['a U+2028 that is not a Markdown line ending', `prose ${good}`, /malformed/],
    ['a second close on the line', `${good} -->`, /raw|malformed/],
  ]);
});

test('AC4.1: a block inside another HTML comment is rejected', () => {
  assertRejected(parseOwner(`<!-- example:\n${good}`), /inside another/, 'comment still open');
  assert.deepStrictEqual(parseOwner(`<!-- other: 1 -->\n${good}`), { ok: true, verdict: goodVerdict }, 'closed comment');
});

test('AC4.1: code that does not hide the block leaves it parsing', () => {
  const ok = { ok: true, verdict: goodVerdict };
  assert.deepStrictEqual(parseOwner(`\`\`\`\ncode\n\`\`\`\n\n${good}`), ok, 'closed fence before');
  assert.deepStrictEqual(parseOwner(`${good}\n\n~~~\ncode\n~~~`), ok, 'closed fence after');
  assert.deepStrictEqual(parseOwner(`see \`code\` here\n\n${good}`), ok, 'closed span before');
  assert.deepStrictEqual(parseOwner(`one \` backtick\n\n${good}`), ok, 'an unmatched backtick opens nothing');
  assert.deepStrictEqual(parseOwner(`\`\`\`a\`b\n\n${good}`), ok, 'a backtick info string is not a fence');
  assert.deepStrictEqual(parseOwner(`    \`\`\`\n${good}`), ok, 'a four-space ``` is indented code, not a fence');
  assert.deepStrictEqual(parseOwner(`\`\`\`\n\`\`\`\`\n${good}`), ok, 'a longer closer closes');
});

test('AC4.1: pathological bodies stay fast and never throw', () => {
  const big = [
    '`'.repeat(200000),
    '` '.repeat(100000),
    '<!-- accept-verdict: '.repeat(10000),
    `${OPEN}${'['.repeat(200000)}${CLOSE}`,
    `${OPEN}{"note":"${'\\'.repeat(200001)}"}${CLOSE}`,
    Array.from({ length: 400 }, (_, i) => '`'.repeat(i + 1)).join(' '),
  ];
  for (const body of big) assert.strictEqual(parseOwner(body).ok, false);
});

test('AC4.2: a note holding --> is rejected unescaped and round-trips through render', () => {
  assertRejected(parseOwner(raw('{"v":1,"verdict":"approved","note":"a --> b"}')), /raw/, 'hand-built raw -->');

  const note = 'a --> b <c>';
  const rendered = renderVerdictMarker({ v: 1, verdict: 'approved', note });
  assert.strictEqual(rendered.indexOf('-->'), rendered.length - 3, 'no raw --> before the closing one');
  assert.ok(!rendered.includes('<c>'), 'no raw <c>');
  assert.ok(rendered.includes(`a --${GT} b ${LT}c${GT}`), `escapes kept their backslash: ${rendered}`);
  assert.deepStrictEqual(parseOwner(rendered), { ok: true, verdict: { v: 1, verdict: 'approved', note } });

  const handEscaped = raw(`{"v":1,"verdict":"approved","note":"a --${GT} b"}`);
  assert.deepStrictEqual(parseOwner(handEscaped), { ok: true, verdict: { v: 1, verdict: 'approved', note: 'a --> b' } });
});

test('AC4.2: render emits the contract format, one line, and round-trips awkward notes', () => {
  assert.strictEqual(
    renderVerdictMarker({ note: 'x', choice: 'fix-forward', verdict: 'changes-requested', v: 1 }),
    good,
    'fields in contract order, whatever the input order',
  );
  for (const note of ['', 'line\nbreak', 'crlf\r\nbreak', 'tab\t', '"quote"', 'back\\slash', '`tick`', '```', `${good}`, '--!>', 'u2028 ', '🙂', '$& $1']) {
    const verdict = { v: 1, verdict: 'approved', note };
    const rendered = renderVerdictMarker(verdict);
    assert.ok(!rendered.includes('\n') && !rendered.includes('\r'), `single line: ${JSON.stringify(note)}`);
    assert.deepStrictEqual(parseOwner(`${rendered}\r\n`), { ok: true, verdict }, JSON.stringify(note));
  }
});

test('AC4.2: render throws on an invalid object', () => {
  const invalid = [
    undefined,
    null,
    'x',
    [],
    {},
    { verdict: 'approved', note: 'x' },
    { v: 2, verdict: 'approved', note: 'x' },
    { v: 1, verdict: 'pending', note: 'x' },
    { v: 1, verdict: 'changes-requested', note: 'x' },
    { v: 1, verdict: 'approved', choice: 'fix-forward', note: 'x' },
    { v: 1, verdict: 'changes-requested', choice: 'shrug', note: 'x' },
    { v: 1, verdict: 'approved', note: 7 },
    { v: 1, verdict: 'approved', note: 'n'.repeat(2001) },
    { v: 1, verdict: 'approved', note: 'x', extra: 1 },
  ];
  for (const obj of invalid) assert.throws(() => renderVerdictMarker(obj), Error, JSON.stringify(obj));
});

test('AC4.3: a verdict that disagrees with the label yields no action and the note', () => {
  const disagree = { action: 'none', note: 'verdict label and comment disagree' };
  const approved = { v: 1, verdict: 'approved', note: 'x' };
  const changes = { v: 1, verdict: 'changes-requested', choice: 'revert-now', note: 'x' };
  const cases = [
    ['accept:approved vs changes-requested', ['accept:approved'], changes, disagree],
    ['accept:changes-requested vs approved', ['accept:changes-requested'], approved, disagree],
    ['accept:approved vs approved', ['accept:approved'], approved, { action: 'proceed' }],
    ['demo:approved vs approved', ['demo:approved'], approved, { action: 'proceed' }],
    ['accept:changes-requested vs changes', ['accept:changes-requested'], changes, { action: 'proceed' }],
    ['demo:changes-requested vs changes', ['demo:changes-requested'], changes, { action: 'proceed' }],
    ['stale demo:pending beside accept:approved', ['accept:approved', 'demo:pending'], approved, disagree],
    ['changes label beats a stale approved', ['accept:approved', 'demo:changes-requested'], changes, { action: 'proceed' }],
    ['changes label beats a stale approved, approved marker', ['accept:approved', 'demo:changes-requested'], approved, disagree],
    ['pending label', ['accept:pending'], approved, disagree],
    ['no verdict label', ['bug'], approved, disagree],
    ['empty labels', [], approved, disagree],
    ['labels not an array', undefined, approved, disagree],
    ['no verdict', ['accept:approved'], undefined, disagree],
    ['a word pending against a pending label', ['accept:pending'], { verdict: 'pending' }, disagree],
    ['a word none against no label', [], { verdict: 'none' }, disagree],
  ];
  for (const [label, labels, verdict, expected] of cases) {
    assert.deepStrictEqual(verdictAgreement({ labels, verdict }), expected, label);
  }
  assert.deepStrictEqual(verdictAgreement(), disagree, 'no argument');
});

test('AC4.3: a parsed marker feeds verdictAgreement directly', () => {
  const { verdict } = parseOwner(good);
  assert.deepStrictEqual(verdictAgreement({ labels: ['accept:changes-requested'], verdict }), { action: 'proceed' });
});
