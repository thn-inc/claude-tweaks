'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseRiskFlags, addRiskFlags, removeRiskFlag, confirmRiskFlags, appendRiskProofGotcha,
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
