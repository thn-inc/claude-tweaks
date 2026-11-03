'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyRiskFlags, inertEvidence, readRiskPolicy } = require('../../../plugin/bin/lib/issues/risk-flag-classify');

const spec = (o) => `Surface: infra\n\n## Deliverables\n\n${o.d || '- [ ] x'}\n\n## Acceptance Criteria\n\n${o.a || '1. y'}\n\n## Technical Approach\n\n### Key Files\n\n${o.k || '- `a/b.js` — z'}\n`;

test('AC1.1: a Key Files migrations path yields the migrations flag', () => {
  const r = classifyRiskFlags(spec({ k: '- `db/migrations/001_add.sql` — add' }));
  assert.deepStrictEqual(r.flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
});

test('AC1.1: a Deliverable mentioning a schema change yields the migrations flag with its sentence', () => {
  const r = classifyRiskFlags(spec({ d: '- [ ] Apply a schema change to users' }));
  assert.strictEqual(r.flags[0].slug, 'migrations');
  assert.match(r.flags[0].evidence, /schema change to users/);
});

test('each built-in floor has a positive and a word-bounded negative', () => {
  for (const [text, slug] of [['Refuse an unauthenticated login', 'auth'], ['Change a hook payload field', 'public-contract'], ['Send an email to the owner', 'irreversible-side-effect']]) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.map((f) => f.slug), [slug], text);
  }
  assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. the author wrote authority notes about emigration' })).flags, []);
});

test('a section other than the three is not read', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Overview\n\nschema change\n\n## Deliverables\n\n- a\n\n## Acceptance Criteria\n\n1. b\n\n### Key Files\n\n- `a/b.js`\n').flags, []);
});

test('a missing section is reported, not silent', () => {
  assert.deepStrictEqual(classifyRiskFlags('## Deliverables\n\n- a\n').missingSections, ['Acceptance Criteria', 'Key Files']);
});

test('a policy extra and a path glob classify', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({ d: '- [ ] Add a data export' }), { extraCategories: ['data-export'] }).flags.map((f) => f.slug), ['data-export']);
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `src/secure/a.js`' }), { pathGlobs: { auth: ['src/secure/**'] } }).flags.map((f) => [f.slug, f.via]), [['auth', 'path-glob']]);
});

test('inertEvidence neutralizes hostile text', () => {
  const out = inertEvidence('a\n## Forged [x](https://evil.example) <!-- m --> `c`');
  assert.ok(!out.includes('\n'));
  assert.match(out, /\\\[x\\\]/);
  assert.match(out, /\\<!-- m --\\>/);
  assert.ok(inertEvidence('z'.repeat(500)).length <= 300);
});

test('readRiskPolicy: control mode off consults neither extra key', () => {
  const read = () => 'risk-categories: pii\nrisk-path-globs:\n  auth: [a/**]\n';
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: read }), { controlMode: false, extraCategories: [], pathGlobs: {}, globsInvalid: false });
});

test('readRiskPolicy: control mode on resolves both, a malformed block is flagged', () => {
  const on = (rest) => () => `control-mode: on\n${rest}`;
  assert.deepStrictEqual(readRiskPolicy('/r', { readFile: on('risk-categories: pii\nrisk-path-globs:\n  pii: [a/**]\n') }), { controlMode: true, extraCategories: ['pii'], pathGlobs: { pii: ['a/**'] }, globsInvalid: false });
  assert.strictEqual(readRiskPolicy('/r', { readFile: on('risk-path-globs: x\n') }).globsInvalid, true);
});

test('readRiskPolicy: an absent file is control mode off, another error throws', () => {
  const err = (code) => () => { throw Object.assign(new Error(code), { code }); };
  assert.strictEqual(readRiskPolicy('/r', { readFile: err('ENOENT') }).controlMode, false);
  assert.strictEqual(readRiskPolicy('/r', { readFile: err('ENOTDIR') }).controlMode, false);
  assert.throws(() => readRiskPolicy('/r', { readFile: err('EACCES') }), /EACCES/);
});

// Controller ruling C3: Key Files keyword matching skips backticked spans, so a path
// that also spells a keyword is reported by the path rule, never as a keyword.
test('C3: a backticked Key Files path is matched as a path, never as a keyword', () => {
  const r = classifyRiskFlags(spec({ k: '- `src/migrations/auth/login.js` — z' }));
  assert.deepStrictEqual(r.flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
  // The same words outside backticks on a Key Files line are keywords.
  const kw = classifyRiskFlags(spec({ k: '- `a/b.js` — touches the login flow' }));
  assert.deepStrictEqual(kw.flags.map((f) => [f.slug, f.via]), [['auth', 'keyword']]);
});

test('C3: a Key Files heading nested under Acceptance Criteria is still read as Key Files', () => {
  const body = '## Deliverables\n\n- a\n\n## Acceptance Criteria\n\n1. b\n\n### Key Files\n\n- `src/auth/a.js`\n';
  assert.deepStrictEqual(classifyRiskFlags(body).flags, []);
  assert.deepStrictEqual(classifyRiskFlags(body).missingSections, []);
});

// Controller ruling C4: an absent heading is missing; a present, empty one is not.
test('C4: an empty section is not missing, an absent one is', () => {
  const empty = '## Deliverables\n\n## Acceptance Criteria\n\n### Key Files\n';
  assert.deepStrictEqual(classifyRiskFlags(empty), { flags: [], missingSections: [] });
  assert.deepStrictEqual(classifyRiskFlags('Surface: infra\n').missingSections, ['Deliverables', 'Acceptance Criteria', 'Key Files']);
  assert.deepStrictEqual(classifyRiskFlags(null).missingSections, ['Deliverables', 'Acceptance Criteria', 'Key Files']);
});

test('one flag per slug, first match wins, built-ins in canonical order then extras', () => {
  const r = classifyRiskFlags(spec({
    d: '- [ ] Add a data export\n- [ ] Send a notification on payment\n- [ ] Rotate session tokens',
    a: '1. The login page refuses an expired session token\n2. A drop column migration runs',
  }), { extraCategories: ['data-export'] });
  assert.deepStrictEqual(r.flags.map((f) => f.slug), ['migrations', 'auth', 'irreversible-side-effect', 'data-export']);
  assert.strictEqual(r.flags.find((f) => f.slug === 'auth').evidence, 'Rotate session tokens');
  assert.strictEqual(r.flags.find((f) => f.slug === 'migrations').evidence, 'A drop column migration runs');
});

test('a .sql path and a policy extra spelled with a space classify', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `db/schema.sql` — z' })).flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
  assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. Run a data export' }), { extraCategories: ['data-export'] }).flags.map((f) => f.slug), ['data-export']);
  assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. Run a dataexport' }), { extraCategories: ['data-export'] }).flags, []);
});

test('null opts read as no extras, and an invalid extra slug throws', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({}), null), { flags: [], missingSections: [] });
  assert.throws(() => classifyRiskFlags(spec({}), { extraCategories: ['Data Export'] }), TypeError);
  assert.throws(() => classifyRiskFlags(spec({}), { pathGlobs: { pii: ['a/**'] } }), /pii/);
});

test('inertEvidence: a pre-existing backslash cannot unescape a bracket, and a cap never ends mid-escape', () => {
  assert.strictEqual(inertEvidence('\\[x](u)'), '\\\\\\[x\\](u)');
  assert.strictEqual(inertEvidence('a\u0000b\u001b[1mc\u007f'), 'ab\\[1mc');
  const capped = inertEvidence(`${'z'.repeat(298)}[[[`);
  assert.ok(capped.length <= 300);
  assert.ok(!/(^|[^\\])(\\\\)*\\$/.test(capped.replace(/…$/, '')), capped.slice(-6));
});
