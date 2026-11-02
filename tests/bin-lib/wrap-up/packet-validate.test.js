// tests/bin-lib/wrap-up/packet-validate.test.js
// Acceptance-packet claim validation (#4611).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SchemaError,
  validateFactsShape,
  validateNarrativeShape,
  validatePacket,
} = require('../../../plugin/bin/lib/wrap-up/packet-validate');

const fact = (id, status, extra = {}) => ({
  id,
  kind: id.split(':', 1)[0],
  status,
  source: 'fixture',
  ...extra,
});

// `changes` merges into a base fact by id; `added` appends further facts.
function factsDoc(changes = {}, added = []) {
  const base = [
    fact('change:src/a.js', 'passed'),
    fact('check:unit-tests', 'passed'),
    fact('check:lint', 'failed', { reason: '2 errors' }),
    fact('story:login', 'passed'),
    fact('story:login#negative-2', 'skipped', { reason: 'no dev server' }),
    fact('link:settings', 'passed', { url: 'http://localhost:3000/settings' }),
    fact('finding:1', 'passed'),
    fact('flag:auth', 'passed'),
  ];
  return {
    schemaVersion: 1,
    record: 4611,
    partial: [],
    facts: [...base.map((f) => ({ ...f, ...changes[f.id] })), ...added],
  };
}

const narrativeDoc = (claims) => ({ schemaVersion: 1, claims });
const claim = (section, text, refs) => ({ section, text, refs });
const validate = (claims, changes, added) => validatePacket(factsDoc(changes, added), narrativeDoc(claims));

// Exactly one bucket holds the one claim; the others stay empty.
function assertOnly(result, bucket) {
  for (const name of ['kept', 'moved', 'dropped', 'screened']) {
    assert.equal(result[name].length, name === bucket ? 1 : 0, `${name}: ${JSON.stringify(result[name])}`);
  }
}

function assertDropped(result, reason) {
  assertOnly(result, 'dropped');
  assert.equal(result.dropped[0].reason, reason);
}

function assertMoved(result, to, becauseId) {
  assertOnly(result, 'moved');
  assert.equal(result.moved[0].to, to);
  assert.equal(result.moved[0].because.id, becauseId);
}

const SIGNUP_NOT_RUN = fact('story:signup', 'not-run', { reason: 'no story result recorded' });

test('validatePacket drops a claim citing an absent fact', () => {
  const c = claim('test-guide', 'Open settings', ['link:nope']);
  const result = validate([c]);
  assertDropped(result, 'absent fact link:nope');
  assert.equal(result.dropped[0].claim, c);
});

test('an absent ref wins over an incompatible one, whichever comes first', () => {
  assertDropped(validate([claim('test-guide', 'Open', ['check:unit-tests', 'link:nope'])]), 'absent fact link:nope');
});

test('an empty-string ref is an absent fact', () => {
  assertDropped(validate([claim('test-guide', 'Open', [''])]), 'absent fact ');
});

test('drops a claim with no refs', () => {
  assertDropped(validate([claim('what-changed', 'Changed a thing', [])]), 'no refs');
});

test('drops an unknown section', () => {
  assertDropped(validate([claim('couldnt-test', 'Skipped it', ['story:login'])]), 'unknown section couldnt-test');
});

test('an inherited property name is an unknown section', () => {
  assertDropped(validate([claim('constructor', 'x', ['story:login'])]), 'unknown section constructor');
});

test('drops an incompatible kind', () => {
  assertDropped(
    validate([claim('test-guide', 'Run the tests', ['check:unit-tests'])]),
    'incompatible fact check:unit-tests (check) for test-guide',
  );
  assertDropped(
    validate([claim('test-guide', 'Run the tests', ['story:login', 'check:unit-tests'])]),
    'incompatible fact check:unit-tests (check) for test-guide',
  );
});

test('a verified claim citing a failed fact moves to tried-to-break', () => {
  const moved = validate([claim('test-guide', 'Login verified', ['story:login', 'link:settings'])], {
    'story:login': { status: 'failed' },
  });
  assertMoved(moved, 'tried-to-break', 'story:login');

  const c = claim('tried-to-break', 'Lint fails on bad input', ['check:lint']);
  const kept = validate([c]);
  assertOnly(kept, 'kept');
  assert.equal(kept.kept[0], c);
});

test('mixed passed and failed refs moves to tried-to-break', () => {
  const result = validate(
    [claim('test-guide', 'Settings flow verified', ['link:settings', 'story:login', 'story:signup'])],
    {},
    [fact('story:signup', 'failed')],
  );
  assertMoved(result, 'tried-to-break', 'story:signup');
});

test('a cited failure outranks a cited skip, whichever comes first', () => {
  const result = validate([claim('test-guide', 'Login verified', ['story:login#negative-2', 'story:login'])], {
    'story:login': { status: 'failed' },
  });
  assertMoved(result, 'tried-to-break', 'story:login');
});

test('because is the first triggering fact among several', () => {
  const failed = validate([claim('test-guide', 'Login verified', ['story:signup', 'story:login'])], {
    'story:login': { status: 'failed' },
  }, [fact('story:signup', 'failed')]);
  assertMoved(failed, 'tried-to-break', 'story:signup');

  const skipped = validate([claim('test-guide', 'Login verified', ['story:login', 'story:signup', 'story:login#negative-2'])], {}, [SIGNUP_NOT_RUN]);
  assertMoved(skipped, 'couldnt-test', 'story:signup');
});

test('a claim citing a skipped fact moves to couldnt-test', () => {
  assertMoved(
    validate([claim('test-guide', 'Negative login tested', ['story:login#negative-2'])]),
    'couldnt-test',
    'story:login#negative-2',
  );
});

test('a plain manual step citing a not-run story stays in the test guide', () => {
  const refs = ['story:signup', 'link:settings'];
  const plain = validate([claim('test-guide', 'Open the signup page and submit the form', refs)], {}, [SIGNUP_NOT_RUN]);
  assertOnly(plain, 'kept');

  const worded = validate([claim('test-guide', 'Signup works', refs)], {}, [SIGNUP_NOT_RUN]);
  assertMoved(worded, 'couldnt-test', 'story:signup');

  const plainFailed = validate([claim('test-guide', 'Log in with the test account', ['story:login'])], {
    'story:login': { status: 'failed' },
  });
  assertOnly(plainFailed, 'kept');
});

test('a verified claim citing only passed facts is kept', () => {
  assertOnly(validate([claim('test-guide', 'Login verified', ['story:login', 'link:settings'])]), 'kept');
});

test('only check and story facts route', () => {
  const link = validate([claim('test-guide', 'Settings verified', ['link:settings'])], {
    'link:settings': { status: 'failed' },
  });
  assertOnly(link, 'kept');

  const skippedLink = validate([claim('test-guide', 'Settings verified', ['link:settings'])], {
    'link:settings': { status: 'skipped' },
  });
  assertOnly(skippedLink, 'kept');

  const change = validate([claim('what-changed', 'Tested the parser', ['change:src/a.js'])], {
    'change:src/a.js': { status: 'failed' },
  });
  assertOnly(change, 'kept');

  const finding = validate([claim('least-confident', 'Works, probably', ['finding:1'])], {
    'finding:1': { status: 'not-run' },
  });
  assertOnly(finding, 'kept');

  const flag = validate([claim('risk-proofs', 'Auth verified', ['flag:auth', 'check:unit-tests'])], {
    'flag:auth': { status: 'failed' },
  });
  assertOnly(flag, 'kept');
});

test('risk-proofs needs a flag', () => {
  assertDropped(validate([claim('risk-proofs', 'Proved', ['check:unit-tests'])]), 'risk proof cites no flag');
  assertOnly(validate([claim('risk-proofs', 'Proved', ['flag:auth', 'check:unit-tests'])]), 'kept');
});

test('a risk proof still routes on its proof fact', () => {
  assertMoved(
    validate([claim('risk-proofs', 'Auth verified', ['flag:auth', 'check:lint'])]),
    'tried-to-break',
    'check:lint',
  );
});

test('schema mismatch is refused', () => {
  assert.throws(() => validatePacket({ ...factsDoc(), schemaVersion: 2 }, narrativeDoc([])), SchemaError);
  assert.throws(() => validatePacket(factsDoc(), { ...narrativeDoc([]), schemaVersion: 2 }), SchemaError);
});

test('SchemaError carries both documents\' errors, by path', () => {
  assert.throws(
    () => validatePacket({ ...factsDoc(), schemaVersion: 2 }, { schemaVersion: 2, claims: [] }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.name, 'SchemaError');
      assert.deepEqual(error.errors.map((e) => e.path), ['facts.schemaVersion', 'narrative.schemaVersion']);
      assert.ok(error.errors.every((e) => typeof e.message === 'string' && e.message));
      assert.match(error.message, /facts\.schemaVersion/);
      return true;
    },
  );
});

test('a test-guide claim with credential-shaped text is screened', () => {
  const c = claim('test-guide', 'Log in with password=hunter2', ['link:settings']);
  const screened = validate([c]);
  assertOnly(screened, 'screened');
  assert.deepEqual(screened.screened[0], { claim: c, key: 'password' });

  assertOnly(validate([claim('what-changed', 'Log in with password=hunter2', ['change:src/a.js'])]), 'kept');
});

test('screening runs before every evidence rule', () => {
  for (const refs of [[], ['link:nope'], ['check:unit-tests'], ['story:login#negative-2']]) {
    const result = validate([claim('test-guide', 'Verified with token=abc', refs)]);
    assertOnly(result, 'screened');
    assert.equal(result.screened[0].key, 'token');
  }
});

test('a tried-to-break claim citing only routine passes is dropped', () => {
  const refs = ['check:unit-tests', 'story:login'];
  assertDropped(
    validate([claim('tried-to-break', 'Ran everything', refs)]),
    'tried-to-break claim cites no negative or failed fact',
  );
  assertOnly(validate([claim('tried-to-break', 'Ran everything', refs)], { 'story:login': { negative: true } }), 'kept');
});

test('a skipped fact that is not negative gives a tried-to-break claim no evidence', () => {
  assertDropped(
    validate([claim('tried-to-break', 'Tried it', ['story:login#negative-2'])]),
    'tried-to-break claim cites no negative or failed fact',
  );
});

test('only a literal negative: true counts as negative', () => {
  assertDropped(
    validate([claim('tried-to-break', 'Tried it', ['story:login'])], { 'story:login': { negative: 'false' } }),
    'tried-to-break claim cites no negative or failed fact',
  );
});

test('a tried-to-break claim citing only skipped negative stories moves to couldnt-test', () => {
  const text = 'Submitted the form with an expired session';
  const refs = ['story:login#negative-2'];
  const negative = { 'story:login#negative-2': { negative: true } };

  assertMoved(validate([claim('tried-to-break', text, refs)], negative), 'couldnt-test', 'story:login#negative-2');

  const notRun = { 'story:login#negative-2': { negative: true, status: 'not-run' } };
  assertMoved(validate([claim('tried-to-break', text, refs)], notRun), 'couldnt-test', 'story:login#negative-2');

  const withPassedNegative = { ...negative, 'story:login': { negative: true } };
  assertOnly(validate([claim('tried-to-break', text, [...refs, 'story:login'])], withPassedNegative), 'kept');

  assertOnly(validate([claim('tried-to-break', text, [...refs, 'check:lint'])], negative), 'kept');
});

test('a moved tried-to-break claim names the first negative fact, not an earlier plain one', () => {
  const result = validate(
    [claim('tried-to-break', 'Submitted it twice', ['story:signup', 'story:login#negative-2'])],
    { 'story:login#negative-2': { negative: true } },
    [SIGNUP_NOT_RUN],
  );
  assertMoved(result, 'couldnt-test', 'story:login#negative-2');

  const twoNegatives = validate(
    [claim('tried-to-break', 'Submitted it twice', ['story:login#negative-2', 'story:signup'])],
    { 'story:login#negative-2': { negative: true } },
    [{ ...SIGNUP_NOT_RUN, negative: true }],
  );
  assertMoved(twoNegatives, 'couldnt-test', 'story:login#negative-2');
});

test('a verification-worded tried-to-break claim still routes', () => {
  const negative = { 'story:login': { negative: true } };
  assertOnly(
    validate([claim('tried-to-break', 'Lint verified broken', ['story:login#negative-2', 'check:lint'])]),
    'kept',
  );
  assertMoved(
    validate([claim('tried-to-break', 'Expired session tested', ['story:login', 'story:login#negative-2'])], negative),
    'couldnt-test',
    'story:login#negative-2',
  );
  assertOnly(validate([claim('tried-to-break', 'Expired session tested', ['story:login'])], negative), 'kept');
});

test('an encoded path id is valid and an unencoded citation is absent', () => {
  const encoded = fact('change:src/%2Bpage.svelte', 'passed');
  assert.deepEqual(validateFactsShape(factsDoc({}, [encoded])), { ok: true, errors: [] });
  assert.equal(validateFactsShape(factsDoc({}, [fact('change:src/+page.svelte', 'passed')])).ok, false);

  assertDropped(
    validate([claim('what-changed', 'Changed the page', ['change:src/+page.svelte'])], {}, [encoded]),
    'absent fact change:src/+page.svelte',
  );
});

test('every claim lands in one bucket, in input order', () => {
  const claims = [
    claim('what-changed', 'First', ['change:src/a.js']),
    claim('what-changed', 'Second', []),
    claim('what-changed', 'Third', ['change:src/a.js']),
    claim('test-guide', 'Fourth works', ['story:login#negative-2']),
    claim('test-guide', 'token=abc', ['link:settings']),
  ];
  const result = validate(claims);
  assert.deepEqual(result.kept.map((c) => c.text), ['First', 'Third']);
  assert.deepEqual(result.dropped.map((d) => d.claim.text), ['Second']);
  assert.deepEqual(result.moved.map((m) => m.claim.text), ['Fourth works']);
  assert.deepEqual(result.screened.map((s) => s.claim.text), ['token=abc']);
});

const factsErrorPaths = (doc) => validateFactsShape(doc).errors.map((e) => e.path);
const narrativeErrorPaths = (doc) => validateNarrativeShape(doc).errors.map((e) => e.path);

test('validateFactsShape accepts the fixture', () => {
  assert.deepEqual(validateFactsShape(factsDoc()), { ok: true, errors: [] });
});

test('validateFactsShape refuses a non-object without throwing', () => {
  for (const doc of [null, undefined, 'facts', 3]) {
    assert.deepEqual(factsErrorPaths(doc), ['facts']);
    assert.equal(validateFactsShape(doc).ok, false);
  }
});

test('validateFactsShape names each top-level field', () => {
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), schemaVersion: '1' }), ['facts.schemaVersion']);
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), facts: {} }), ['facts.facts']);
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), partial: 'note' }), ['facts.partial']);
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), partial: ['ok', 3] }), ['facts.partial[1]']);
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), record: '4611' }), ['facts.record']);
  assert.deepEqual(factsErrorPaths({ ...factsDoc(), record: 1.5 }), ['facts.record']);
});

test('validateFactsShape names each fact field', () => {
  const one = (entry) => factsErrorPaths({ ...factsDoc(), facts: [entry] });
  const good = fact('story:login', 'passed');
  assert.deepEqual(one(good), []);
  assert.deepEqual(one(null), ['facts.facts[0]']);
  assert.deepEqual(one({ ...good, id: 'no-colon' }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, id: ['story:login'] }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, kind: 'nope' }), ['facts.facts[0].kind']);
  assert.deepEqual(one({ ...good, status: 'PASS' }), ['facts.facts[0].status']);
  assert.deepEqual(one({ ...good, source: 3 }), ['facts.facts[0].source']);
});

test('validateFactsShape refuses a repeated id', () => {
  const repeat = fact('story:login', 'failed');
  assert.deepEqual(factsErrorPaths(factsDoc({}, [repeat])), ['facts.facts[8].id']);
});

test('validateNarrativeShape names each field', () => {
  const good = claim('test-guide', 'Open', ['link:settings']);
  const one = (entry) => narrativeErrorPaths(narrativeDoc([entry]));
  assert.deepEqual(validateNarrativeShape(narrativeDoc([good])), { ok: true, errors: [] });
  assert.deepEqual(narrativeErrorPaths(null), ['narrative']);
  assert.deepEqual(narrativeErrorPaths({ schemaVersion: 2, claims: [] }), ['narrative.schemaVersion']);
  assert.deepEqual(narrativeErrorPaths({ schemaVersion: 1, claims: {} }), ['narrative.claims']);
  assert.deepEqual(one(null), ['narrative.claims[0]']);
  assert.deepEqual(one({ ...good, section: 3 }), ['narrative.claims[0].section']);
  assert.deepEqual(one({ ...good, text: null }), ['narrative.claims[0].text']);
  assert.deepEqual(one({ ...good, refs: 'link:settings' }), ['narrative.claims[0].refs']);
  assert.deepEqual(one({ ...good, refs: ['link:settings', 3] }), ['narrative.claims[0].refs[1]']);
});

test('validatePacket refuses a malformed claim instead of throwing a TypeError', () => {
  assert.throws(() => validatePacket(factsDoc(), narrativeDoc([{ section: 'test-guide', text: 'x' }])), SchemaError);
  assert.throws(() => validatePacket(null, null), SchemaError);
});
