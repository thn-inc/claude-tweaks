'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { FLOOR, classifyRiskFlags, inertEvidence } = require('../../../plugin/bin/lib/issues/risk-flag-classify');
const { LIST_ELEMENT_PATTERNS } = require('../../../plugin/bin/lib/policy-schema');

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

// Controller ruling C3 (amended): Key Files keyword matching skips path-like backticked
// spans (holding `/` or `.`), so a path that also spells a keyword is reported by the
// path rule, never as a keyword; a backticked word stays keyword text.
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

test('C3: a nested Key Files migrations path reports via path, not as an Acceptance Criteria keyword', () => {
  const migrations = '## Deliverables\n\n- a\n\n## Acceptance Criteria\n\n1. b\n\n### Key Files\n\n- `db/migrations/a.sql`\n';
  assert.deepStrictEqual(classifyRiskFlags(migrations).flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
});

test('C3 amended: a backticked non-path token on a Key Files line stays keyword-visible', () => {
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `src/x.js` — the `login` handler' })).flags.map((f) => [f.slug, f.via]), [['auth', 'keyword']]);
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

test('an extra category named none throws the same TypeError, so the writers never meet it', () => {
  assert.throws(() => classifyRiskFlags(spec({ a: '1. none of this' }), { extraCategories: ['none'] }), (error) => error instanceof TypeError && /invalid extra category "none"/.test(error.message));
  assert.throws(() => classifyRiskFlags(spec({}), { extraCategories: ['pii', 'none'] }), TypeError);
});

test('inertEvidence: a pre-existing backslash cannot unescape a bracket, and a cap never ends mid-escape', () => {
  assert.strictEqual(inertEvidence('\\[x](u)'), '\\\\\\[x\\](u)');
  assert.strictEqual(inertEvidence('a\u0000b\u001b[1mc\u007f'), 'ab\\[1mc');
  const capped = inertEvidence(`${'z'.repeat(298)}[[[`);
  assert.ok(capped.length <= 300);
  assert.ok(!/(^|[^\\])(\\\\)*\\$/.test(capped.replace(/…$/, '')), capped.slice(-6));
});

test('inertEvidence drops a control byte before collapsing, so it leaves no double space', () => {
  assert.strictEqual(inertEvidence('a \u0000 b'), 'a b');
  assert.strictEqual(inertEvidence('a\t\u0001\r\nb'), 'a b');
});

test('inertEvidence drops zero-width and bidi format characters, and escapes a table pipe', () => {
  for (const ch of ['\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069', '\ufeff']) {
    assert.strictEqual(inertEvidence(`ad${ch}min`), 'admin', `U+${ch.codePointAt(0).toString(16).toUpperCase()}`);
  }
  assert.strictEqual(inertEvidence('a | b'), 'a \\| b');
  assert.strictEqual(inertEvidence('\\|'), '\\\\\\|', 'a backslash already there cannot cancel the pipe escape');
  assert.strictEqual(inertEvidence('a\u202e | \u2066b'), 'a \\| b');
});

test('the auth rule reads authenticate and authorize forms, never author or authority', () => {
  for (const text of ['Authenticate via OAuth', 'Only authenticated users may read', 'Authorize the caller', 'An authorized caller may write', 'Authorise the caller']) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.map((f) => f.slug), ['auth'], text);
  }
  for (const text of ['The author signs it', 'Ask the authority', 'Two authors reviewed']) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags, [], text);
  }
});

// One phrase per keyword alternative, in FLOOR order. Each phrase matches its own
// alternative and no other one in any category, so every rule is exercised alone.
const FLOOR_PHRASES = [
  ['migrations', '(?:database|data|schema) migrations?', 'Add a database migration'],
  ['migrations', 'schema changes?', 'Review the schema changes'],
  ['migrations', 'alter table', 'Run alter table on users'],
  ['migrations', 'drop (?:table|column)', 'Drop column legacy_id'],
  ['migrations', 'database schema', 'Document the database schema'],
  ['auth', 'auth(?:n|z|enticat\\w*|ori[sz]\\w*)?', 'Add auth to the route'],
  ['auth', 'permissions?', 'Check permissions first'],
  ['auth', 'access control', 'Add access control'],
  ['auth', 'rbac', 'Use RBAC roles'],
  ['auth', 'login', 'Fix the login page'],
  ['auth', 'session tokens?', 'Rotate the session token'],
  ['public-contract', 'public (?:api|contract)s?', 'Version the public API'],
  ['public-contract', 'hook payloads?', 'Change a hook payload'],
  ['public-contract', 'file formats?', 'Change the file format'],
  ['public-contract', 'wire format', 'Keep the wire format'],
  ['public-contract', 'breaking changes?', 'Note a breaking change'],
  ['public-contract', 'openapi', 'Update the OpenAPI spec'],
  ['irreversible-side-effect', 'irreversibl\\w*', 'This is irreversible'],
  ['irreversible-side-effect', 'permanently delet\\w*', 'Records are permanently deleted'],
  ['irreversible-side-effect', 'outbound (?:sends?|emails?|messages?)', 'Queue outbound messages'],
  ['irreversible-side-effect', 'sends? (?:an? )?(?:emails?|sms|notifications?)', 'It sends SMS'],
  ['irreversible-side-effect', 'payments?', 'Capture the payment'],
  ['irreversible-side-effect', 'refunds?', 'Issue a refund'],
];

test('finding 8: a data, database or schema migration is flagged; a bare or expand-contract migration is not', () => {
  for (const text of ['Run the data migration', 'Write a database migration', 'Two schema migrations ship together']) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.map((f) => [f.slug, f.via]), [['migrations', 'keyword']], text);
  }
  for (const text of ['Follow the expand-contract migration for the hook payload shape', 'Add a migration note', 'Migrate the callers']) {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${text}` })).flags.filter((f) => f.slug === 'migrations'), [], text);
  }
  assert.deepStrictEqual(classifyRiskFlags(spec({ k: '- `db/migrations/0002_x.sql` — expand-contract migration' })).flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
});

test('every floor keyword rule classifies alone, from a phrase matching only that rule', () => {
  const alternatives = Object.entries(FLOOR).flatMap(([slug, rule]) => rule.keywords.map((alt) => [slug, alt]));
  assert.deepStrictEqual(FLOOR_PHRASES.map(([slug, alt]) => [slug, alt]), alternatives);
  for (const [slug, alt, phrase] of FLOOR_PHRASES) {
    const hits = alternatives.filter(([, a]) => new RegExp(`\\b(?:${a})\\b`, 'i').test(phrase)).map(([, a]) => a);
    assert.deepStrictEqual(hits, [alt], phrase);
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: `1. ${phrase}` })).flags.map((f) => [f.slug, f.via]), [[slug, 'keyword']], phrase);
  }
});

test('extra slugs are checked by the policy schema slug rule itself, not a copy', () => {
  const original = LIST_ELEMENT_PATTERNS.slug;
  LIST_ELEMENT_PATTERNS.slug = /^[a-z0-9][a-z0-9_-]*$/;
  try {
    assert.deepStrictEqual(classifyRiskFlags(spec({ a: '1. Run the data_export job' }), { extraCategories: ['data_export'] }).flags.map((f) => f.slug), ['data_export']);
  } finally {
    LIST_ELEMENT_PATTERNS.slug = original;
  }
});
