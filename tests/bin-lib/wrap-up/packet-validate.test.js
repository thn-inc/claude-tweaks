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

  for (const status of ['failed', 'skipped', 'not-run']) {
    const recording = validate(
      [claim('risk-proofs', 'Auth verified', ['flag:auth', 'recording:demo'])],
      {},
      [fact('recording:demo', status)],
    );
    assertOnly(recording, 'kept');
  }
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

test('a risk proof needs a proof fact', () => {
  assertDropped(validate([claim('risk-proofs', 'Auth is risky', ['flag:auth'])]), 'risk proof cites no proof fact');
  assertDropped(
    validate([claim('risk-proofs', 'Both are risky', ['flag:auth', 'flag:billing'])], {}, [fact('flag:billing', 'passed')]),
    'risk proof cites no proof fact',
  );
});

test('a risk proof routes on its check or story proof, whatever its wording', () => {
  const text = 'Signed in with an expired session';
  assertMoved(validate([claim('risk-proofs', text, ['flag:auth', 'check:lint'])]), 'tried-to-break', 'check:lint');
  assertMoved(
    validate([claim('risk-proofs', text, ['flag:auth', 'story:login#negative-2'])]),
    'couldnt-test',
    'story:login#negative-2',
  );
  assertMoved(validate([claim('risk-proofs', text, ['flag:auth', 'story:signup'])], {}, [SIGNUP_NOT_RUN]), 'couldnt-test', 'story:signup');
  assertMoved(
    validate([claim('risk-proofs', text, ['flag:auth', 'story:login#negative-2', 'check:lint'])]),
    'tried-to-break',
    'check:lint',
  );
  assertOnly(validate([claim('risk-proofs', text, ['flag:auth', 'story:login'])]), 'kept');
});

test('a risk proof citing a failed link or recording stays kept', () => {
  const text = 'Signed in with an expired session';
  const recording = fact('recording:demo', 'failed');
  assertOnly(validate([claim('risk-proofs', text, ['flag:auth', 'recording:demo'])], {}, [recording]), 'kept');
  assertOnly(
    validate([claim('risk-proofs', text, ['flag:auth', 'link:settings'])], { 'link:settings': { status: 'failed' } }),
    'kept',
  );
});

test('incompatibility runs before the risk-proof and tried-to-break rules', () => {
  assertDropped(
    validate([claim('risk-proofs', 'Changed the guard', ['change:src/a.js'])]),
    'incompatible fact change:src/a.js (change) for risk-proofs',
  );
  assertDropped(
    validate(
      [claim('tried-to-break', 'Submitted it twice', ['finding:1', 'story:login#negative-2'])],
      { 'story:login#negative-2': { negative: true } },
    ),
    'incompatible fact finding:1 (finding) for tried-to-break',
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

test('a claim with credential-shaped text is screened, whatever its section', () => {
  const c = claim('test-guide', 'Log in with password=hunter2', ['link:settings']);
  const screened = validate([c]);
  assertOnly(screened, 'screened');
  assert.deepEqual(screened.screened[0], { claim: c, key: 'password' });

  for (const [section, refs] of [
    ['what-changed', ['change:src/a.js']],
    ['tried-to-break', ['check:lint']],
    ['least-confident', ['finding:1']],
    ['risk-proofs', ['flag:r', 'check:unit-tests']],
  ]) {
    const other = claim(section, 'Log in with password=hunter2', refs);
    const result = validate([other]);
    assertOnly(result, 'screened');
    assert.deepEqual(result.screened[0], { claim: other, key: 'password' }, section);
  }
});

test('an unknown section is dropped ahead of the screen, so a screened section is always a real one', () => {
  assertDropped(validate([claim('nowhere', 'token=abc', ['change:src/a.js'])]), 'unknown section nowhere');
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

test('validateFactsShape refuses a malformed refused list, and an absent one is fine', () => {
  const paths = (refused) => factsErrorPaths({ ...factsDoc(), refused });
  assert.deepEqual(paths(undefined), []);
  assert.deepEqual(paths([]), []);
  assert.deepEqual(paths([{ id: 'link:a', reason: 'r' }]), []);
  assert.deepEqual(paths(null), ['facts.refused']);
  assert.deepEqual(paths('link:a'), ['facts.refused']);
  assert.deepEqual(paths({}), ['facts.refused']);
  assert.deepEqual(paths([null]), ['facts.refused[0]']);
  assert.deepEqual(paths(['link:a']), ['facts.refused[0]']);
  assert.deepEqual(paths([{ id: 'link:a', reason: 'r' }, { reason: 'r' }]), ['facts.refused[1].id']);
  assert.deepEqual(paths([{ id: 'link:a', reason: 3 }]), ['facts.refused[0].reason']);
});

test('validateFactsShape names each fact field', () => {
  const one = (entry) => factsErrorPaths({ ...factsDoc(), facts: [entry] });
  const good = fact('story:login', 'passed');
  assert.deepEqual(one(good), []);
  assert.deepEqual(one(null), ['facts.facts[0]']);
  assert.deepEqual(one({ ...good, id: 'no-colon' }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, id: ['story:login'] }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, id: 'nope:login', kind: 'nope' }), ['facts.facts[0].kind']);
  assert.deepEqual(one({ ...good, kind: 'check' }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, id: 'story-x:login' }), ['facts.facts[0].id']);
  assert.deepEqual(one({ ...good, status: 'PASS' }), ['facts.facts[0].status']);
  assert.deepEqual(one({ ...good, source: 3 }), ['facts.facts[0].source']);
  for (const kind of [{ toString: 1 }, 7, null]) {
    assert.deepEqual(one({ ...good, kind }), ['facts.facts[0].id', 'facts.facts[0].kind'], JSON.stringify(kind));
  }
});

test('a malformed kind is a SchemaError, never a TypeError', () => {
  const doc = { ...factsDoc(), facts: [{ ...fact('story:login', 'passed'), kind: { toString: 1 } }] };
  assert.throws(() => validatePacket(doc, { schemaVersion: 1, claims: [] }), SchemaError);
});

test('validateFactsShape refuses an optional text field that is not a string', () => {
  const one = (entry) => factsErrorPaths({ ...factsDoc(), facts: [entry] });
  const good = fact('story:login', 'passed');
  for (const field of ['reason', 'text', 'url', 'command', 'label']) {
    assert.deepEqual(one({ ...good, [field]: 'a string' }), [], field);
    assert.deepEqual(one({ ...good, [field]: 3 }), [`facts.facts[0].${field}`], field);
    assert.deepEqual(one({ ...good, [field]: null }), [`facts.facts[0].${field}`], field);
  }
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
  assert.deepEqual(one({ ...good, text: '' }), ['narrative.claims[0].text']);
  assert.deepEqual(one({ ...good, text: ' \n\t ' }), ['narrative.claims[0].text']);
  assert.deepEqual(one({ ...good, refs: 'link:settings' }), ['narrative.claims[0].refs']);
  assert.deepEqual(one({ ...good, refs: ['link:settings', 3] }), ['narrative.claims[0].refs[1]']);
});

test('validatePacket refuses a malformed claim instead of throwing a TypeError', () => {
  assert.throws(() => validatePacket(factsDoc(), narrativeDoc([{ section: 'test-guide', text: 'x' }])), SchemaError);
  assert.throws(() => validatePacket(null, null), SchemaError);
});
