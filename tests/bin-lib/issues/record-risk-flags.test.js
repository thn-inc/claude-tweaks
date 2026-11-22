'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseRiskFlags, addRiskFlags, removeRiskFlag, confirmRiskFlags, appendRiskProofGotcha, parseTripwireFlags, addTripwireRiskFlags, carryTripwireFlags,
  RISK_FLAGS_UNKNOWN, RISK_FLAGS_NONE,
} = require('../../../plugin/bin/lib/issues/record');
const { readRecord, writeRecord } = require('../../../plugin/bin/lib/issues/local-store');

const ALL = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];

test('AC5.1: a malformed line reads all four, never no flags', () => {
  for (const line of ['Risk-flags: Auth', 'Risk-flags:', 'Risk-flags: none, auth', 'risk-flags: none', 'Risk-Flags: none', 'Risk_flags: auth', 'Risk-flags : auth']) {
    const r = parseRiskFlags(`Surface: infra\n${line}\n\n## Overview\n`);
    assert.deepStrictEqual(r.flags.slice(0, 4), ALL, line);
    assert.strictEqual(r.status, 'unknown', line);
    assert.strictEqual(r.reason, 'malformed', line);
  }
});

// Final review finding 1: a hand-edited formatting variant is a flag line read malformed,
// never an absent one. One case per variant the detection admits.
const VARIANT_FLAG_LINES = [
  ['bold', '**Risk-flags:** auth'],
  ['bold key, colon outside', '**Risk-flags**: auth'],
  ['italic', '_Risk-flags:_ auth'],
  ['list', '- Risk-flags: auth'],
  ['star list', '* Risk-flags: auth'],
  ['plus list, bold', '+ **Risk-flags:** auth'],
  ['numbered', '1. Risk-flags: auth'],
  ['numbered paren', '2) Risk-flags: auth'],
  ['blockquote', '> Risk-flags: auth'],
  ['nested blockquote list', '> > - Risk-flags: auth'],
];

test('finding 1: a bold, list, numbered or blockquoted flag line reads malformed, all four flagged', () => {
  for (const [name, line] of VARIANT_FLAG_LINES) {
    const r = parseRiskFlags(`Surface: infra\n${line}\n\n## Overview\n`);
    assert.deepStrictEqual([r.status, r.reason, r.flags], ['unknown', 'malformed', ALL], name);
    assert.strictEqual(r.raw, line, name);
  }
});

test('finding 1: a variant line keeps a policy slug it named, as any malformed line does', () => {
  assert.deepStrictEqual(parseRiskFlags('**Risk-flags:** pii\n').flags, [...ALL, 'pii']);
});

test('finding 1: a variant marker line, nested emphasis included, reads as the marker', () => {
  for (const line of ['**Risk-flags-unconfirmed:** true', '- Risk-flags-unconfirmed: true', '> Risk-flags-unconfirmed: true', '***Risk-flags-unconfirmed:*** true', '**_Risk-flags-unconfirmed_**: true', '- **Risk-flags-unconfirmed:** false']) {
    const r = parseRiskFlags(`Risk-flags: auth\n${line}\n`);
    assert.deepStrictEqual([r.status, r.flags, r.unconfirmed], ['ok', ['auth'], true], line);
  }
});

test('finding 1: the writers\' repair rewrites a variant flag line, and a variant marker, in the exact form', () => {
  for (const [name, line] of VARIANT_FLAG_LINES) {
    assert.strictEqual(addRiskFlags(`Surface: infra\n${line}\n\n## Overview\n`, []), 'Surface: infra\nRisk-flags: migrations, auth, public-contract, irreversible-side-effect\n\n## Overview\n', name);
  }
  assert.strictEqual(addRiskFlags('- Risk-flags: auth\n**Risk-flags-unconfirmed:** true\n', []), 'Risk-flags: migrations, auth, public-contract, irreversible-side-effect\nRisk-flags-unconfirmed: true\n');
});

test('finding 1: a prose "risk flags:" sentence below a ## heading is out of the preamble and stays unread', () => {
  for (const line of ['The risk flags: see below', '**Risk flags:** see below', '- Risk flags: none of these apply']) {
    const body = `Surface: infra\n\n## Overview\n\n${line}\n`;
    assert.deepStrictEqual(parseRiskFlags(body), { flags: [], status: 'unclassified', reason: null, unconfirmed: false, raw: null }, line);
    assert.strictEqual(addRiskFlags(body, []), `Surface: infra\nRisk-flags: none\n\n## Overview\n\n${line}\n`, line);
  }
});

test('finding 1: a key that only resembles the flag key stays unread', () => {
  for (const line of ['Risky flags: auth', 'The risk-flags line: auth', '-Risk-flags: auth', '1.Risk-flags: auth']) {
    assert.strictEqual(parseRiskFlags(`${line}\n\n## O\n`).status, 'unclassified', line);
  }
});

test('malformed: an empty slug, a bad character and a trailing comma all read malformed', () => {
  for (const line of ['Risk-flags: auth,,migrations', 'Risk-flags: auth,', 'Risk-flags: auth_x', 'Risk-flags: -auth', 'Risk-flags: none, none', 'Risk-flags:  ']) {
    const r = parseRiskFlags(`${line}\n`);
    assert.deepStrictEqual([r.status, r.reason], ['unknown', 'malformed'], line);
  }
});

test('AC5.1: a line naming an unknown slug reads all four plus the named slug', () => {
  const r = parseRiskFlags('Risk-flags: auth, pii\n');
  assert.deepStrictEqual(r, { flags: [...ALL, 'pii'], status: 'unknown', reason: 'unknown-slug', unconfirmed: false, raw: 'Risk-flags: auth, pii' });
});

test('AC5.2: an absent line reads unclassified with no flags', () => {
  assert.deepStrictEqual(parseRiskFlags('Surface: infra\n\n## Overview\n').flags, []);
  assert.strictEqual(parseRiskFlags('Surface: infra\n').status, 'unclassified');
  assert.deepStrictEqual(parseRiskFlags('Surface: infra\n'), { flags: [], status: 'unclassified', reason: null, unconfirmed: false, raw: null });
  assert.deepStrictEqual(parseRiskFlags(null).flags, []);
  assert.strictEqual(parseRiskFlags(undefined).status, 'unclassified');
});

test('AC5.3: Risk-flags none reads ok with an empty list', () => {
  const r = parseRiskFlags('Risk-flags: none\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', []]);
  assert.strictEqual(RISK_FLAGS_NONE, 'none');
});

test('AC5.4: each of the three states is pinned by name', () => {
  assert.deepStrictEqual(['Risk-flags: Bad\n', '', 'Risk-flags: none\n'].map((b) => parseRiskFlags(b).status), ['unknown', 'unclassified', 'ok']);
});

test('a policy slug is known only when passed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: pii\n', { extraCategories: ['pii'] }).status, 'ok');
  assert.strictEqual(parseRiskFlags('Risk-flags: pii\n').status, 'unknown');
});

test('materialized spec shape: frontmatter and H1 ahead of the metadata lines', () => {
  const r = parseRiskFlags('---\nrecord: 1\n---\n# 1: t\n\nSurface: infra\nRisk-flags: migrations\n\n## Overview\n');
  assert.deepStrictEqual([r.status, r.flags], ['ok', ['migrations']]);
});

test('frontmatter: a risk-flags key inside the frontmatter block is not the record line', () => {
  assert.strictEqual(parseRiskFlags('---\nrisk-flags: none\n---\n# t\n\n## Overview\n').status, 'unclassified');
});

test('section scope: a line under a later heading is not the record line', () => {
  assert.strictEqual(parseRiskFlags('Surface: x\n\n## Original request\n\nRisk-flags: none\n').status, 'unclassified');
});

test('fence: a fenced line in the preamble is not the record line', () => {
  assert.strictEqual(parseRiskFlags('```\nRisk-flags: none\n```\n\n## Overview\n').status, 'unclassified');
});

test('fence: a fenced heading does not end the preamble', () => {
  assert.strictEqual(parseRiskFlags('```\n## fake\n```\nRisk-flags: auth\n\n## Overview\n').status, 'ok');
});

test('CRLF: a CRLF body parses and a writer round-trips it', () => {
  const body = 'Surface: x\r\nRisk-flags: auth\r\n\r\n## Overview\r\n';
  assert.deepStrictEqual(parseRiskFlags(body).flags, ['auth']);
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags(body, ['migrations'])).flags, ['migrations', 'auth']);
  assert.strictEqual(addRiskFlags(body, ['migrations']), 'Surface: x\r\nRisk-flags: migrations, auth\r\n\r\n## Overview\r\n');
  assert.strictEqual(addRiskFlags('Surface: x\r\n\r\n## O\r\n', ['auth']), 'Surface: x\r\nRisk-flags: auth\r\n\r\n## O\r\n');
});

test('two flag lines read malformed', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags: none\n').reason, 'malformed');
});

test('marker: any value but exactly false reads unconfirmed, a misspelled marker fails toward caution', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n').unconfirmed, true);
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: false\n').unconfirmed, false);
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: yes\n').unconfirmed, true);
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\nrisk_flags unconfirmed:\n').unconfirmed, true);
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\n').unconfirmed, false);
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\n\n## O\n\nRisk-flags-unconfirmed: true\n').unconfirmed, false);
});

test('addRiskFlags only adds: built-in order, then extras; preserves a kept flag', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Risk-flags: auth\n', [])).flags.join(), 'auth');
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', ['auth', 'migrations'])).flags, ['migrations', 'auth']);
});

test('addRiskFlags on an unclassified body with no slugs writes Risk-flags none', () => {
  assert.strictEqual(parseRiskFlags(addRiskFlags('Surface: x\n\n## O\n', [])).status, 'ok');
  assert.strictEqual(addRiskFlags('Surface: x\n\n## O\n', []), 'Surface: x\nRisk-flags: none\n\n## O\n');
});

test('addRiskFlags never narrows a malformed line: it widens to all four', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: Auth\n', [])).flags, ALL);
});

test('addRiskFlags on Risk-flags none replaces it', () => {
  assert.deepStrictEqual(parseRiskFlags(addRiskFlags('Risk-flags: none\n', ['auth'])).flags, ['auth']);
});

test('addRiskFlags inserts inside the metadata block, above the first heading', () => {
  assert.strictEqual(addRiskFlags('Surface: x\nUi-stack: y\n\n## O\n', ['auth']), 'Surface: x\nUi-stack: y\nRisk-flags: auth\n\n## O\n');
  assert.strictEqual(addRiskFlags('## O\n', ['auth']), 'Risk-flags: auth\n\n## O\n');
});

test('addRiskFlags: an H1 anchor gets a blank line before the flag line; frontmatter is skipped', () => {
  assert.strictEqual(addRiskFlags('# 1: t\n\n## O\n', ['auth']), '# 1: t\n\nRisk-flags: auth\n\n## O\n');
  assert.strictEqual(addRiskFlags('---\nrecord: 1\n---\n## O\n', ['auth']), '---\nrecord: 1\n---\nRisk-flags: auth\n\n## O\n');
  assert.strictEqual(addRiskFlags('', ['auth']), 'Risk-flags: auth\n');
  assert.strictEqual(addRiskFlags('Surface: x', ['auth']), 'Surface: x\nRisk-flags: auth');
});

test('addRiskFlags: the inserted line is read back, whatever sits in the preamble', () => {
  for (const body of ['```\nunclosed fence\n', 'Surface: x\n```\ncode\n```\n\n## O\n', '```\n## fake\n```\n']) {
    const r = parseRiskFlags(addRiskFlags(body, ['auth']));
    assert.deepStrictEqual([r.status, r.flags], ['ok', ['auth']], body);
  }
});

test('addRiskFlags unconfirmed writes the marker right below the flag line', () => {
  assert.strictEqual(addRiskFlags('Surface: x\n\n## O\n', ['auth'], { unconfirmed: true }), 'Surface: x\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n');
});

test('addRiskFlags keeps an existing marker when unconfirmed is not passed: adding never confirms', () => {
  assert.strictEqual(addRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n', ['migrations']), 'Risk-flags: migrations, auth\nRisk-flags-unconfirmed: true\n');
  assert.strictEqual(addRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: yes\n', []), 'Risk-flags: auth\nRisk-flags-unconfirmed: true\n');
});

test('addRiskFlags refuses a slug that would write an unreadable line', () => {
  for (const slugs of [['Auth'], ['none'], ['a,b'], [''], ['x y'], 'auth', null]) {
    assert.throws(() => addRiskFlags('Surface: x\n', slugs), /addRiskFlags: invalid slug/, JSON.stringify(slugs));
  }
});

test('AC5.5: removeRiskFlag without humanConfirmed true refuses', () => {
  for (const opts of [undefined, {}, { humanConfirmed: false }, { humanConfirmed: 'true' }, { humanConfirmed: 1 }]) {
    assert.throws(() => removeRiskFlag('Risk-flags: auth\n', 'auth', opts), /removeRiskFlag refused/);
  }
});

test('removeRiskFlag drops one flag, writes none for the last, clears the marker', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', 'auth', { humanConfirmed: true }), 'Risk-flags: migrations\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n', 'auth', { humanConfirmed: true }), 'Risk-flags: none\n');
});

test('removeRiskFlag on a flag the line does not carry returns the body byte-identical', () => {
  const body = 'Risk-flags: auth\nRisk-flags-unconfirmed: true\r\n';
  assert.strictEqual(removeRiskFlag(body, 'migrations', { humanConfirmed: true }), body);
  const bare = 'Surface: x\n';
  assert.strictEqual(removeRiskFlag(bare, 'auth', { humanConfirmed: true }), bare);
});

test('removeRiskFlag preserves a CRLF body', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, migrations\r\n\r\n## O\r\n', 'auth', { humanConfirmed: true }), 'Risk-flags: migrations\r\n\r\n## O\r\n');
});

test('confirmRiskFlags refuses without humanConfirmed, clears the marker with it', () => {
  assert.throws(() => confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n'), /refused/);
  assert.strictEqual(confirmRiskFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n', { humanConfirmed: true }), 'Risk-flags: auth\n');
});

test('confirmRiskFlags returns the body byte-identical when no marker exists', () => {
  const body = 'Surface: x\r\nRisk-flags: auth\r\n';
  assert.strictEqual(confirmRiskFlags(body, { humanConfirmed: true }), body);
  assert.strictEqual(confirmRiskFlags('', { humanConfirmed: true }), '');
});

test('Reading A: a confirmed removal on an unknown line is refused with its own code, for both unknown reasons', () => {
  for (const body of ['Risk-flags: Auth\nRisk-flags-unconfirmed: true\n', 'Risk-flags: auth, pii\nRisk-flags-unconfirmed: true\n']) {
    assert.throws(() => removeRiskFlag(body, 'auth', { humanConfirmed: true }), (e) => e.code === RISK_FLAGS_UNKNOWN && /^removeRiskFlag refused: unreadable Risk-flags line/.test(e.message), body);
    assert.throws(() => confirmRiskFlags(body, { humanConfirmed: true }), (e) => e.code === RISK_FLAGS_UNKNOWN && /^confirmRiskFlags refused: unreadable Risk-flags line/.test(e.message), body);
  }
  assert.strictEqual(RISK_FLAGS_UNKNOWN, 'RISK_FLAGS_UNKNOWN');
});

test('Reading A: the humanConfirmed refusal still comes first on an unknown line', () => {
  assert.throws(() => removeRiskFlag('Risk-flags: Auth\n', 'auth', {}), (e) => e.code !== RISK_FLAGS_UNKNOWN && /^removeRiskFlag refused/.test(e.message));
  assert.throws(() => confirmRiskFlags('Risk-flags: Auth\n', {}), (e) => e.code !== RISK_FLAGS_UNKNOWN && /^confirmRiskFlags refused/.test(e.message));
});

test('Reading A: the refusal names the way out for its own reason', () => {
  const messageFor = (body) => {
    try { removeRiskFlag(body, 'auth', { humanConfirmed: true }); } catch (e) { return e.message; }
    return '';
  };
  const malformed = messageFor('Risk-flags: Auth\n');
  assert.match(malformed, /\(malformed\)/);
  assert.match(malformed, /repair it with addRiskFlags first/);
  const unknownSlug = messageFor('Risk-flags: auth, pii\n');
  assert.match(unknownSlug, /\(unknown-slug\)/);
  assert.match(unknownSlug, /risk-categories/);
  assert.match(unknownSlug, /by hand/);
  assert.doesNotMatch(unknownSlug, /addRiskFlags/);
});

test('every entry point takes a null options argument like an absent one', () => {
  assert.strictEqual(parseRiskFlags('Risk-flags: auth\n', null).status, 'ok');
  assert.strictEqual(addRiskFlags('Risk-flags: auth\n', ['migrations'], null), 'Risk-flags: migrations, auth\n');
  assert.throws(() => removeRiskFlag('Risk-flags: auth\n', 'auth', null), /removeRiskFlag refused: humanConfirmed/);
  assert.throws(() => confirmRiskFlags('Risk-flags: auth\n', null), /confirmRiskFlags refused: humanConfirmed/);
});

test('Reading A: a policy slug passed in makes the line known, so the removal goes through', () => {
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, pii\n', 'pii', { humanConfirmed: true, extraCategories: ['pii'] }), 'Risk-flags: auth\n');
});

test('Reading A: addRiskFlags repairs a malformed line to the widened set, and keeps an unknown slug unknown', () => {
  const repaired = parseRiskFlags(addRiskFlags('Risk-flags: Auth\n', [], { unconfirmed: true }));
  assert.deepStrictEqual([repaired.status, repaired.flags, repaired.unconfirmed], ['ok', ALL, true]);
  const still = parseRiskFlags(addRiskFlags('Risk-flags: auth, pii\n', []));
  assert.deepStrictEqual([still.status, still.reason, still.flags], ['unknown', 'unknown-slug', [...ALL, 'pii']]);
});

test('repair never carries none as a slug: a malformed none-beside-a-slug line is rewritten without it', () => {
  const repaired = addRiskFlags('Risk-flags: none, auth\n', []);
  assert.doesNotMatch(repaired, /none/);
  const r = parseRiskFlags(repaired);
  assert.deepStrictEqual([r.status, r.flags], ['ok', ALL]);
  const widened = addRiskFlags('Risk-flags: none, pii\n', []);
  assert.doesNotMatch(widened, /none/);
  assert.deepStrictEqual(parseRiskFlags(widened).flags, [...ALL, 'pii']);
});

test('repair collapses two flag lines into one', () => {
  const repaired = addRiskFlags('Surface: x\nRisk-flags: auth\nRisk-flags: none\n\n## O\n', []);
  assert.strictEqual(repaired, 'Surface: x\nRisk-flags: migrations, auth, public-contract, irreversible-side-effect\n\n## O\n');
  assert.strictEqual(parseRiskFlags(repaired).status, 'ok');
});

test('local-files parity: the flag lines survive writeRecord and readRecord', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-flags-parity-'));
  try {
    const bodies = {
      ok: 'Surface: infra\nRisk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n\n## Overview\n\nx\n',
      unknown: 'Surface: infra\nRisk-flags: auth, pii\n\n## Overview\n\nx\n',
      malformed: 'Surface: infra\nRisk-flags: Auth\n\n## Overview\n\nx\n',
      unclassified: 'Surface: infra\n\n## Overview\n\nRisk-flags: none\n',
    };
    const seen = new Set();
    Object.entries(bodies).forEach(([name, body], i) => {
      const p = path.join(dir, `${i + 1}-parity-${name}.md`);
      writeRecord(p, { title: `parity ${name}`, body, facets: {} });
      const read = parseRiskFlags(readRecord(p).body);
      assert.deepStrictEqual(read, parseRiskFlags(body), name);
      assert.strictEqual(Object.keys(readRecord(p).facets).some((k) => /risk-?flags/i.test(k)), false, name);
      seen.add(read.status);
    });
    assert.deepStrictEqual([...seen].sort(), ['ok', 'unclassified', 'unknown']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('appendRiskProofGotcha names each slug, is idempotent, widens in place, creates the section', () => {
  const once = appendRiskProofGotcha('## Gotchas\n\n- a\n', ['auth']);
  assert.match(once, /Proof\(auth\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth']), once);
  assert.match(appendRiskProofGotcha(once, ['auth', 'migrations']), /Proof\(migrations\):/);
  assert.strictEqual(appendRiskProofGotcha(once, ['auth', 'migrations']).match(/Risk proof required/g).length, 1);
  assert.match(appendRiskProofGotcha('## Overview\n\nx\n', ['auth']), /## Gotchas\n\n- Risk proof required/);
  assert.match(appendRiskProofGotcha('## Gotchas\n\n- a\n\n## Original request\n\nb\n', ['auth']), /Risk proof required[^\n]*\n\n## Original request/);
  assert.strictEqual(appendRiskProofGotcha('## O\n', []), '## O\n');
  const narrowed = appendRiskProofGotcha(appendRiskProofGotcha('## Gotchas\n\n- a\n', ['migrations', 'auth']), ['auth']);
  assert.doesNotMatch(narrowed, /Proof\(migrations\)|`migrations`/);
  assert.strictEqual(narrowed.match(/Risk proof required/g).length, 1);
  assert.doesNotMatch(appendRiskProofGotcha(narrowed, []), /Risk proof required/);
  assert.match(appendRiskProofGotcha(narrowed, []), /## Gotchas\n\n- a\n/);
});

test('appendRiskProofGotcha writes the full bullet: the contract text and one proof line per slug', () => {
  const out = appendRiskProofGotcha('## Gotchas\n\n- a\n', ['migrations', 'auth']);
  const bullet = out.split('\n').find((l) => l.startsWith('- Risk proof required:'));
  assert.ok(bullet.includes('one plan step must contain, per slug, a line `Proof(<slug>): <text>` with a specific proof of at least 20 characters.'));
  assert.ok(bullet.endsWith('Lines: `Proof(migrations): …`, `Proof(auth): …`.'), bullet);
  assert.doesNotMatch(bullet, /Slugs:/);
});

test('appendRiskProofGotcha places the bullet at the end of the Gotchas section, or a new section before the right heading', () => {
  assert.match(
    appendRiskProofGotcha('## Gotchas\n\n- a\n- b\n\n## Original request\n\nz\n', ['auth']),
    /^## Gotchas\n\n- a\n- b\n- Risk proof required: [^\n]*\n\n## Original request\n\nz\n$/,
  );
  const breaking = appendRiskProofGotcha('## Overview\n\nx\n\n## Breaking Change\n\ny\n\n## Original request\n\nz\n', ['auth']);
  assert.match(breaking, /x\n\n## Gotchas\n\n- Risk proof required[^\n]*\n\n## Breaking Change\n\ny\n\n## Original request/);
  const original = appendRiskProofGotcha('## Overview\n\nx\n\n## Original request\n\nz\n', ['auth']);
  assert.match(original, /x\n\n## Gotchas\n\n- Risk proof required[^\n]*\n\n## Original request\n\nz\n$/);
  const empty = appendRiskProofGotcha('## Gotchas\n\n## Original request\n', ['auth']);
  assert.match(empty, /^## Gotchas\n\n- Risk proof required[^\n]*\n\n## Original request\n$/);
});

test('appendRiskProofGotcha ignores a Gotchas heading and a bullet inside a fence', () => {
  const body = '## Overview\n\n```\n## Gotchas\n- Risk proof required: old\n```\n';
  const out = appendRiskProofGotcha(body, ['auth']);
  assert.match(out, /```\n\n## Gotchas\n\n- Risk proof required: this record/);
  assert.strictEqual(out.startsWith(body), true);
});

test('appendRiskProofGotcha round-trips: adding then clearing restores a body that already has a Gotchas section, an empty one included', () => {
  for (const body of [
    '## Gotchas\n\n- a\n\n## Original request\n\nz\n',
    '## Overview\n\nx\n\n## Gotchas\n\n## Original request\n\nz\n',
    '## Overview\n\nx\n\n## Gotchas\n',
    '## Overview\n\nx\n\n## Gotchas\n\n- a',
  ]) {
    const added = appendRiskProofGotcha(body, ['auth']);
    assert.match(added, /Risk proof required/, JSON.stringify(body));
    assert.strictEqual(appendRiskProofGotcha(added, []), body, JSON.stringify(body));
  }
});

test('appendRiskProofGotcha clearing a section it created leaves the heading, never anything of the rest of the body', () => {
  assert.strictEqual(appendRiskProofGotcha(appendRiskProofGotcha('## Overview\n\nx\n', ['auth']), []), '## Overview\n\nx\n\n## Gotchas\n');
});

// _shared/work-record.md: everything from `## Original request` to the end of the body is
// preserved byte-for-byte, so the bullet scan and the Gotchas lookup stop at that heading.
test('appendRiskProofGotcha never reads or writes the Original request section: a quoted bullet is not the record\'s own', () => {
  const quoted = '## Original request\n\n- Risk proof required: quoted\n\nmore\n';
  const body = `## Overview\n\nx\n\n## Gotchas\n\n- g\n\n${quoted}`;
  const added = appendRiskProofGotcha(body, ['auth']);
  assert.match(added, /^## Overview\n\nx\n\n## Gotchas\n\n- g\n- Risk proof required: this record[^\n]*\n\n## Original request\n/);
  assert.strictEqual(added.slice(added.indexOf('## Original request')), quoted);
  const cleared = appendRiskProofGotcha(added, []);
  assert.strictEqual(cleared, body);
  assert.strictEqual(appendRiskProofGotcha(body, []), body);
  assert.strictEqual(appendRiskProofGotcha(quoted, []), quoted);
});

test('appendRiskProofGotcha never reads or writes the Original request section: a quoted Gotchas heading is not the record\'s own', () => {
  const quoted = '## Original request\n\n## Gotchas\n\n- q\n';
  const body = `## Overview\n\nx\n\n${quoted}`;
  const added = appendRiskProofGotcha(body, ['auth']);
  assert.match(added, /^## Overview\n\nx\n\n## Gotchas\n\n- Risk proof required: [^\n]*\n\n## Original request\n/);
  assert.strictEqual(added.slice(added.indexOf('## Original request')), quoted);
  const widened = appendRiskProofGotcha(added, ['auth', 'migrations']);
  assert.strictEqual(widened.slice(widened.indexOf('## Original request')), quoted);
  assert.strictEqual(widened.match(/Risk proof required/g).length, 1);
  // a body with a quoted Gotchas heading and nothing of its own above it
  const alone = appendRiskProofGotcha(quoted, ['auth']);
  assert.strictEqual(alone.slice(alone.indexOf('## Original request')), quoted);
  assert.match(alone, /^## Gotchas\n\n- Risk proof required: [^\n]*\n\n## Original request\n/);
});

test('appendRiskProofGotcha: a Gotchas section ends at the next h2, so the bullet lands before Breaking Change', () => {
  const body = '## Overview\n\nx\n\n## Gotchas\n\n- g\n\n## Breaking Change\n\nb\n';
  assert.strictEqual(
    appendRiskProofGotcha(body, ['auth']).replace(/- Risk proof required: [^\n]*/, '- BULLET'),
    '## Overview\n\nx\n\n## Gotchas\n\n- g\n- BULLET\n\n## Breaking Change\n\nb\n',
  );
});

test('appendRiskProofGotcha: a fenced heading inside Gotchas does not end the section', () => {
  const body = '## Gotchas\n\n- g\n\n```\n## Something\n```\n\n- h\n\n## Original request\n\nz\n';
  assert.strictEqual(
    appendRiskProofGotcha(body, ['auth']).replace(/- Risk proof required: [^\n]*/, '- BULLET'),
    '## Gotchas\n\n- g\n\n```\n## Something\n```\n\n- h\n- BULLET\n\n## Original request\n\nz\n',
  );
});

test('appendRiskProofGotcha: a Breaking Change heading quoted in Original request is not a placement anchor', () => {
  const quoted = '## Original request\n\n## Breaking Change\n\nq\n';
  const body = `## Overview\n\nx\n\n${quoted}`;
  const added = appendRiskProofGotcha(body, ['auth']);
  assert.strictEqual(added.slice(added.indexOf('## Original request')), quoted);
  assert.match(added, /^## Overview\n\nx\n\n## Gotchas\n\n- Risk proof required: [^\n]*\n\n## Original request\n/);
});

test('appendRiskProofGotcha: a fenced Breaking Change line is not a placement anchor', () => {
  const body = '## Overview\n\n```\n## Breaking Change\n```\n\nx\n';
  const added = appendRiskProofGotcha(body, ['auth']);
  assert.strictEqual(added.startsWith(body), true);
  assert.match(added, /\n\nx\n\n## Gotchas\n\n- Risk proof required: [^\n]*\n$/);
});

test('appendRiskProofGotcha: a fenced Original request heading does not end the record\'s own sections', () => {
  const body = '## Overview\n\n```\n## Original request\n```\n\n## Gotchas\n\n- g\n';
  assert.match(appendRiskProofGotcha(body, ['auth']), /- g\n- Risk proof required: /);
});

test('appendRiskProofGotcha keeps one bullet when a body already carries two, and orders slugs canonically', () => {
  const dup = '## Gotchas\n\n- Risk proof required: x\n- a\n- Risk proof required: y\n';
  const out = appendRiskProofGotcha(dup, ['auth']);
  assert.strictEqual(out.match(/Risk proof required/g).length, 1);
  assert.match(out, /- a\n/);
  assert.strictEqual(appendRiskProofGotcha('## Gotchas\n\n- a\n', ['auth', 'migrations']), appendRiskProofGotcha('## Gotchas\n\n- a\n', ['migrations', 'auth']));
});

test('appendRiskProofGotcha preserves CRLF and refuses an unreadable slug', () => {
  const out = appendRiskProofGotcha('## Gotchas\r\n\r\n- a\r\n', ['auth']);
  assert.doesNotMatch(out, /[^\r]\n/);
  assert.match(out, /\r\n- Risk proof required: /);
  assert.throws(() => appendRiskProofGotcha('## O\n', ['Auth']), /appendRiskProofGotcha: invalid slug/);
});

test('parseRiskFlags returns an ok line in canonical order: built-ins first', () => {
  assert.deepStrictEqual(parseRiskFlags('Risk-flags: auth, migrations\n').flags, ['migrations', 'auth']);
  assert.deepStrictEqual(parseRiskFlags('Risk-flags: zeta, auth, alpha\n', { extraCategories: ['alpha', 'zeta'] }).flags, ['auth', 'zeta', 'alpha']);
});

// The tripwire line (#4619): Risk-flags-added-by-tripwire: {slugs}, written only by addTripwireRiskFlags.
const TW = 'Risk-flags-added-by-tripwire:';
const TW_BODY = '# T\n\nRisk-flags: none\n\n## Overview\n';

test('addTripwireRiskFlags adds the flag and the tripwire line', () => {
  assert.strictEqual(addTripwireRiskFlags(TW_BODY, ['migrations']),
    `# T\n\nRisk-flags: migrations\n${TW} migrations\n\n## Overview\n`);
});

test('a second call unions the tripwire line', () => {
  const once = addTripwireRiskFlags(TW_BODY, ['migrations']);
  const twice = addTripwireRiskFlags(once, ['auth']);
  assert.strictEqual(twice, `# T\n\nRisk-flags: migrations, auth\n${TW} migrations, auth\n\n## Overview\n`);
  assert.strictEqual(addTripwireRiskFlags(twice, ['auth']), twice, 'idempotent');
});

test('a tripwire line is rewritten in canonical order and a human-declared flag stays off it', () => {
  const body = `Risk-flags: public-contract, irreversible-side-effect\n${TW} irreversible-side-effect\n\n## O\n`;
  const out = addTripwireRiskFlags(body, ['auth']);
  assert.strictEqual(out, `Risk-flags: auth, public-contract, irreversible-side-effect\n${TW} auth, irreversible-side-effect\n\n## O\n`);
});

test('parseRiskFlags ignores the tripwire line', () => {
  const r = parseRiskFlags(`# T\n\nRisk-flags: migrations\n${TW} migrations\n\n## Overview\n`);
  assert.strictEqual(r.status, 'ok');
  assert.deepStrictEqual(r.flags, ['migrations']);
  assert.strictEqual(parseRiskFlags(`${TW} migrations\n\n## O\n`).status, 'unclassified');
});

test('parseTripwireFlags reads ok, absent, a variant spelling as malformed, and ignores a fenced example', () => {
  assert.deepStrictEqual(parseTripwireFlags(`Risk-flags: auth\n${TW} auth, migrations\n\n## O\n`), { status: 'ok', flags: ['auth', 'migrations'] });
  assert.deepStrictEqual(parseTripwireFlags('Risk-flags: auth\n\n## O\n'), { status: 'absent', flags: [] });
  assert.deepStrictEqual(parseTripwireFlags(''), { status: 'absent', flags: [] });
  for (const line of ['**Risk-flags-added-by-tripwire:** auth', '- risk_flags_added_by_tripwire: auth', '> Risk flags added by tripwire: auth',
    'risk-flags-added-by-tripwire: auth', TW, `${TW} Auth`, `${TW} none`, `${TW} auth,, migrations`, `${TW} auth migrations`]) {
    assert.deepStrictEqual(parseTripwireFlags(`Risk-flags: auth\n${line}\n\n## O\n`), { status: 'malformed', flags: [] }, line);
  }
  assert.strictEqual(parseTripwireFlags(`${TW} auth\n${TW} migrations\n\n## O\n`).status, 'malformed', 'two lines');
  assert.strictEqual(parseTripwireFlags(`Risk-flags: auth\n\n## O\n${TW} auth\n`).status, 'absent', 'past the first heading');
  assert.strictEqual(parseTripwireFlags(`Risk-flags: auth\n\n\`\`\`\n${TW} auth\n\`\`\`\n\n## O\n`).status, 'absent', 'fenced example');
});

test('a malformed tripwire line contributes no slugs and is rewritten in exact form', () => {
  const body = `Risk-flags: auth\n**Risk-flags-added-by-tripwire:** migrations\n\n## O\n`;
  const out = addTripwireRiskFlags(body, ['public-contract']);
  assert.strictEqual(out, `Risk-flags: auth, public-contract\n${TW} public-contract\n\n## O\n`);
});

test('two tripwire lines collapse to one exact line; the first is rewritten in place', () => {
  const body = `Risk-flags: auth\n${TW} auth\nSurface: infra\n${TW} migrations\n\n## O\n`;
  assert.strictEqual(addTripwireRiskFlags(body, ['public-contract']), `Risk-flags: auth, public-contract\n${TW} public-contract\nSurface: infra\n\n## O\n`);
});

test('the line sits below an unconfirmed marker', () => {
  const body = 'Risk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n';
  assert.strictEqual(addTripwireRiskFlags(body, ['migrations']),
    `Risk-flags: migrations, auth\nRisk-flags-unconfirmed: true\n${TW} migrations\n\n## O\n`);
  assert.strictEqual(addTripwireRiskFlags(addTripwireRiskFlags(body, ['migrations']), ['irreversible-side-effect']),
    `Risk-flags: migrations, auth, irreversible-side-effect\nRisk-flags-unconfirmed: true\n${TW} migrations, irreversible-side-effect\n\n## O\n`);
});

test('[] is byte-identical', () => {
  for (const body of [TW_BODY, `Risk-flags: auth\n${TW} auth\n`, 'no line at all', '', 'a\r\nb\n']) {
    assert.strictEqual(addTripwireRiskFlags(body, []), body);
  }
});

test('a uniformly CRLF body stays CRLF', () => {
  const body = TW_BODY.replace(/\n/g, '\r\n');
  const out = addTripwireRiskFlags(body, ['migrations']);
  assert.strictEqual(out, `# T\r\n\r\nRisk-flags: migrations\r\n${TW} migrations\r\n\r\n## Overview\r\n`);
  assert.ok(!/[^\r]\n/.test(out));
});

test('addTripwireRiskFlags refuses an invalid slug list like addRiskFlags', () => {
  assert.throws(() => addTripwireRiskFlags(TW_BODY, ['Auth']), TypeError);
  assert.throws(() => addTripwireRiskFlags(TW_BODY, 'auth'), TypeError);
  assert.throws(() => addTripwireRiskFlags(TW_BODY, ['none']), TypeError);
});

test('addTripwireRiskFlags passes extraCategories through to addRiskFlags', () => {
  const out = addTripwireRiskFlags(TW_BODY, ['pii'], { extraCategories: ['pii'] });
  assert.strictEqual(parseRiskFlags(out, { extraCategories: ['pii'] }).status, 'ok');
  assert.strictEqual(parseTripwireFlags(out).status, 'ok');
});

test('removeRiskFlag drops the slug from the tripwire line', () => {
  const body = `Risk-flags: migrations, auth\n${TW} migrations, auth\n\n## O\n`;
  const step1 = removeRiskFlag(body, 'auth', { humanConfirmed: true });
  assert.strictEqual(step1, `Risk-flags: migrations\n${TW} migrations\n\n## O\n`);
  assert.strictEqual(removeRiskFlag(step1, 'migrations', { humanConfirmed: true }), 'Risk-flags: none\n\n## O\n');
});

test('removeRiskFlag leaves a tripwire line that does not name the slug alone, CRLF included', () => {
  const body = `Risk-flags: migrations, auth\r\n${TW} migrations\r\n\r\n## O\r\n`;
  assert.strictEqual(removeRiskFlag(body, 'auth', { humanConfirmed: true }), `Risk-flags: migrations\r\n${TW} migrations\r\n\r\n## O\r\n`);
});

// Characterization (project-maturity: established): removeRiskFlag on a body with no tripwire line.
test('removeRiskFlag on a body with no tripwire line is byte-identical to today', () => {
  const opts = { humanConfirmed: true };
  assert.strictEqual(removeRiskFlag('# T\n\nRisk-flags: migrations, auth\n\n## Overview\n', 'auth', opts), '# T\n\nRisk-flags: migrations\n\n## Overview\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n', 'auth', opts), 'Risk-flags: none\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n\n## O\n', 'auth', opts), 'Risk-flags: migrations\n\n## O\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n\n## O\n', 'migrations', opts), 'Risk-flags: auth\n\n## O\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: migrations, auth\r\n\r\n## O\r\n', 'auth', opts), 'Risk-flags: migrations\r\n\r\n## O\r\n');
  assert.strictEqual(removeRiskFlag('x\n\n## O\n', 'auth', opts), 'x\n\n## O\n');
});

test('addTripwireRiskFlags never records a slug the flag line already declares', () => {
  assert.strictEqual(addTripwireRiskFlags('Risk-flags: auth\n\n## O\n', ['auth', 'migrations']), `Risk-flags: migrations, auth\n${TW} migrations\n\n## O\n`);
  assert.strictEqual(addTripwireRiskFlags('Risk-flags: auth\n\n## O\n', ['auth']), 'Risk-flags: auth\n\n## O\n', 'nothing new: no line, byte-identical');
});

test('addTripwireRiskFlags drops a tripwire slug the flag line no longer carries', () => {
  const body = `Risk-flags: auth\n${TW} migrations, auth\n\n## O\n`;
  assert.strictEqual(addTripwireRiskFlags(body, ['public-contract']), `Risk-flags: auth, public-contract\n${TW} auth, public-contract\n\n## O\n`);
});

test('removeRiskFlag drops a slug found only on the tripwire line, and a malformed tripwire line', () => {
  const opts = { humanConfirmed: true };
  assert.strictEqual(removeRiskFlag(`Risk-flags: auth\n${TW} migrations, auth\n\n## O\n`, 'migrations', opts), `Risk-flags: auth\n${TW} auth\n\n## O\n`);
  assert.strictEqual(removeRiskFlag(`Risk-flags: auth\n${TW} migrations\n\n## O\n`, 'migrations', opts), 'Risk-flags: auth\n\n## O\n');
  assert.strictEqual(removeRiskFlag('Risk-flags: auth\n**Risk-flags-added-by-tripwire:** migrations\n\n## O\n', 'migrations', opts), 'Risk-flags: auth\n\n## O\n');
  assert.strictEqual(removeRiskFlag(`Risk-flags: migrations, auth\n${TW} auth\n${TW} migrations\n\n## O\n`, 'auth', opts), 'Risk-flags: migrations\n\n## O\n', 'two lines read malformed and go');
  const untouched = `Risk-flags: auth\n${TW} auth\n\n## O\n`;
  assert.strictEqual(removeRiskFlag(untouched, 'migrations', opts), untouched, 'neither line names it: byte-identical');
});

test('removeRiskFlag rewrites the tripwire line in canonical order', () => {
  const body = `Risk-flags: migrations, auth, irreversible-side-effect\n${TW} irreversible-side-effect, auth, migrations\n\n## O\n`;
  assert.strictEqual(removeRiskFlag(body, 'migrations', { humanConfirmed: true }), `Risk-flags: auth, irreversible-side-effect\n${TW} auth, irreversible-side-effect\n\n## O\n`);
});

test('carryTripwireFlags carries the prior body\'s line onto a re-shaped body, minus any slug no longer kept', () => {
  const prior = `Risk-flags: migrations, auth\n${TW} migrations, auth\n\n## O\n`;
  assert.strictEqual(carryTripwireFlags('# T\n\nRisk-flags: migrations, auth\nSurface: infra\n\n## O\n', prior),
    `# T\n\nRisk-flags: migrations, auth\n${TW} migrations, auth\nSurface: infra\n\n## O\n`);
  assert.strictEqual(carryTripwireFlags('Risk-flags: auth\nRisk-flags-unconfirmed: true\n\n## O\n', prior),
    `Risk-flags: auth\nRisk-flags-unconfirmed: true\n${TW} auth\n\n## O\n`);
  assert.strictEqual(carryTripwireFlags('Risk-flags: none\n\n## O\n', prior), 'Risk-flags: none\n\n## O\n');
  assert.strictEqual(carryTripwireFlags('Risk-flags: auth\n\n## O\n', 'Risk-flags: auth\n\n## O\n'), 'Risk-flags: auth\n\n## O\n', 'no prior line: byte-identical');
  assert.strictEqual(carryTripwireFlags('Risk-flags: auth\r\n\r\n## O\r\n', prior), `Risk-flags: auth\r\n${TW} auth\r\n\r\n## O\r\n`);
});

// RISK_FLAG_LINE_KEYS (#6052) feeds issues/plan-line.js's spec-hash exclusions; the module's
// own regexes hold the same strings, so each exported key is fed through the module's readers.
test('RISK_FLAG_LINE_KEYS name the lines the module reads', () => {
  const { RISK_FLAG_LINE_KEYS: KEYS } = require('../../../plugin/bin/lib/issues/record-risk-flags');
  assert.strictEqual(KEYS.length, 3);
  const none = parseRiskFlags(`${KEYS[0]} none\n\n## O\n`);
  assert.strictEqual(none.status, 'ok');
  assert.deepStrictEqual(none.flags, []);
  const auth = parseRiskFlags(`${KEYS[0]} auth\n${KEYS[1]} true\n\n## O\n`);
  assert.strictEqual(auth.status, 'ok');
  assert.deepStrictEqual(auth.flags, ['auth']);
  assert.strictEqual(auth.unconfirmed, true);
  assert.deepStrictEqual(parseTripwireFlags(`${KEYS[2]} auth\n\n## O\n`), { status: 'ok', flags: ['auth'] });
});
