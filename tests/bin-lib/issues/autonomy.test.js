'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { CEILINGS, resolveCeiling, permittedGrants, clearsFloor, bookkeepingPermissions } = require('../../../plugin/bin/lib/issues/autonomy.js');

const cleanRow = { verdict: 'clean', kind: 'producer', dispositioned: 9, coverage: 0.9 };

test('ceilings are ordered least to most permissive', () => {
  assert.deepEqual(CEILINGS, ['supervised', 'trusted', 'unattended']);
});

test('resolution follows CLI > run config > policy > default', () => {
  assert.equal(resolveCeiling({ cliArg: 'unattended', runConfig: 'trusted', policy: 'supervised' }), 'unattended');
  assert.equal(resolveCeiling({ runConfig: 'trusted', policy: 'supervised' }), 'trusted');
  assert.equal(resolveCeiling({ policy: 'trusted' }), 'trusted');
  assert.equal(resolveCeiling({}), 'supervised');
  assert.equal(resolveCeiling(undefined), 'supervised');
});

test('an unrecognized value is ignored, and resolution continues past it', () => {
  // Fail toward less autonomy, never toward more: a typo in policy.yml must not
  // silently resolve to a tier the operator did not name, in either direction.
  assert.equal(resolveCeiling({ cliArg: 'yolo', policy: 'trusted' }), 'trusted');
  assert.equal(resolveCeiling({ cliArg: 'TRUSTED' }), 'supervised', 'case-sensitive by design');
  assert.equal(resolveCeiling({ policy: '' }), 'supervised');
});

test('supervised permits nothing, whatever the evidence says', () => {
  const result = permittedGrants({ ceiling: 'supervised', row: cleanRow });
  assert.equal(result.grants.bornReady.granted, false);
  assert.equal(result.grants.bornAuthorized.granted, false);
  assert.ok(result.grants.bornReady.reason.length > 0);
});

test('trusted permits born-ready on a clean class, never born-authorized', () => {
  const result = permittedGrants({ ceiling: 'trusted', row: cleanRow });
  assert.equal(result.grants.bornReady.granted, true);
  assert.equal(result.grants.bornAuthorized.granted, false);
});

test('a mixed or ungraded class earns nothing at any ceiling', () => {
  for (const ceiling of CEILINGS) {
    for (const verdict of ['mixed', 'insufficient-evidence']) {
      const result = permittedGrants({ ceiling, row: { ...cleanRow, verdict } });
      assert.equal(result.grants.bornReady.granted, false, `${ceiling}/${verdict}`);
      assert.equal(result.grants.bornAuthorized.granted, false, `${ceiling}/${verdict}`);
    }
  }
});

test('the unstructured kind is denied at every ceiling, clean verdict or not', () => {
  // Defense in depth. trust.js pins this kind's verdict already; this module must
  // deny it on its own, so a future change to either one cannot open it alone.
  for (const ceiling of CEILINGS) {
    const result = permittedGrants({ ceiling, row: { ...cleanRow, kind: 'unstructured' } });
    assert.equal(result.grants.bornReady.granted, false, ceiling);
    assert.equal(result.grants.bornAuthorized.granted, false, ceiling);
    assert.match(result.grants.bornReady.reason, /unclassifi/i);
  }
});

test('a kind this module does not recognize is denied, not permitted', () => {
  // The check is an allowlist of the three kinds that name a real class, not a
  // denylist naming 'unstructured'. A denylist inverts the design's stated hazard
  // instead of fixing it: a fifth kind added to provenance.js later, or a row
  // whose kind is an empty string, would sail through it with a clean verdict.
  // Both of these granted before the allowlist landed.
  for (const kind of ['some-future-kind', '', 'PRODUCER', undefined, null, 42]) {
    const result = permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind } });
    assert.equal(result.grants.bornReady.granted, false, `kind ${JSON.stringify(kind)} must not grade`);
    assert.equal(result.grants.bornAuthorized.granted, false, `kind ${JSON.stringify(kind)} must not grade`);
  }
});

test('a human-filed class earns nothing, however clean and however high the ceiling', () => {
  // Born-ready authorizes an AGENT's filing to skip the human shaping round-trip. A
  // human-filed class has no agent filing to authorize, so its verdict — however
  // good — is evidence about the wrong thing. This is not hypothetical: on this
  // repo `human:human` is the largest provenance by a wide margin and the first
  // that will clear both floors, so a governor that graded it would fire here
  // first and on the weakest possible justification.
  const humanRow = { ...cleanRow, kind: 'human', provenance: 'human:human' };
  for (const ceiling of ['trusted', 'unattended']) {
    for (const optIn of [undefined, true]) {
      const result = permittedGrants({ ceiling, row: humanRow, grantOriginationEnabled: optIn });
      assert.equal(result.grants.bornReady.granted, false, `${ceiling}/${optIn}`);
      assert.equal(result.grants.bornAuthorized.granted, false, `${ceiling}/${optIn}`);
      assert.match(result.grants.bornReady.reason, /human-filed/);
    }
  }
});

test('agent-filed classes are exactly producer and side-effect', () => {
  // Control for the test above — the exclusion must not be so wide that it also
  // denies the two kinds the tier exists to serve.
  for (const kind of ['producer', 'side-effect']) {
    assert.equal(permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind } }).grants.bornReady.granted, true, kind);
  }
});

test('every kind provenance.js emits is classified, and denials are distinguishable', () => {
  // Control for the allowlist: it must not be so tight that it denies a real
  // class, and the two reasons for denying must not blur together. These four
  // are provenance.js's complete output set, and they fall into three buckets —
  // grantable, gradable-but-human-filed, and structurally unclassifiable — so a
  // change there this module has not been taught about fails here, not in
  // production.
  assert.equal(permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind: 'producer' } }).grants.bornReady.granted, true);
  assert.equal(permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind: 'side-effect' } }).grants.bornReady.granted, true);

  const human = permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind: 'human' } });
  assert.equal(human.grants.bornReady.granted, false);
  assert.match(human.grants.bornReady.reason, /human-filed/, 'a real class denied for whose filing it is');

  const unstructured = permittedGrants({ ceiling: 'trusted', row: { ...cleanRow, kind: 'unstructured' } });
  assert.equal(unstructured.grants.bornReady.granted, false);
  assert.match(unstructured.grants.bornReady.reason, /unclassifiable/, 'not a class at all — a different denial');
});

test('a missing or malformed row is denied, not defaulted', () => {
  for (const row of [undefined, null, {}, { verdict: 'clean' }, { kind: 'human' }]) {
    const result = permittedGrants({ ceiling: 'unattended', row });
    assert.equal(result.grants.bornReady.granted, false);
    assert.equal(result.grants.bornAuthorized.granted, false);
  }
});

test('unattended permits born-authorized only on an explicit second opt-in', () => {
  // Machinery originating a grant contradicts _shared/work-record.md's standing
  // invariant ("auto:* labels are only ever added by an interactive human
  // session"). The tier is defined so the ceiling is complete, but the grant path
  // stays shut behind its own flag until that invariant is deliberately amended.
  const withoutOptIn = permittedGrants({ ceiling: 'unattended', row: cleanRow });
  assert.equal(withoutOptIn.grants.bornReady.granted, true);
  assert.equal(withoutOptIn.grants.bornAuthorized.granted, false);
  assert.match(withoutOptIn.grants.bornAuthorized.reason, /opt-in/i);

  const withOptIn = permittedGrants({ ceiling: 'unattended', row: cleanRow, grantOriginationEnabled: true });
  assert.equal(withOptIn.grants.bornAuthorized.granted, true);
});

test('the opt-in is the literal boolean true, and nothing merely truthy', () => {
  // This is the whole of the safety predicate: `grantOriginationEnabled !== true`
  // is what stands between a config value and machinery originating auto:build.
  // Without this test the check can be relaxed to `!grantOriginationEnabled` and
  // the suite stays green — verified by hand-reverting it, which is the only way
  // to know a check discriminates. A caller reading 'true' or 1 out of parsed YAML
  // must not clear this gate by accident.
  for (const value of ['true', 1, {}, [], 'yes', 'on', -1]) {
    const result = permittedGrants({ ceiling: 'unattended', row: cleanRow, grantOriginationEnabled: value });
    assert.equal(result.grants.bornAuthorized.granted, false, `${JSON.stringify(value)} must not clear the opt-in`);
  }
});

test('permittedGrants validates its own ceiling rather than relying on indexOf', () => {
  // Denying an unrecognized ceiling must be deliberate, not a side effect of
  // CEILINGS.indexOf(garbage) being -1. Reverting isCeiling to `ceiling || ...`
  // also leaves the suite green without this.
  for (const ceiling of ['yolo', 'UNATTENDED', ' unattended ', 42, null, ['unattended']]) {
    const result = permittedGrants({ ceiling, row: cleanRow, grantOriginationEnabled: true });
    assert.equal(result.grants.bornReady.granted, false, `ceiling ${JSON.stringify(ceiling)} must fall back to supervised`);
    assert.equal(result.grants.bornAuthorized.granted, false, `ceiling ${JSON.stringify(ceiling)} must fall back to supervised`);
  }
});

test('permittedGrants survives a null argument the way resolveCeiling does', () => {
  // Default parameters fire only on undefined, so `= {}` left null throwing while
  // the sibling function returned a value. Two functions in one module should not
  // disagree about robustness — a caller sweeping records would crash mid-run.
  assert.equal(permittedGrants(null).grants.bornReady.granted, false);
  assert.equal(permittedGrants(undefined).grants.bornReady.granted, false);
  assert.equal(permittedGrants().grants.bornReady.granted, false);
});

test('the second opt-in cannot raise a lower ceiling', () => {
  for (const ceiling of ['supervised', 'trusted']) {
    const result = permittedGrants({ ceiling, row: cleanRow, grantOriginationEnabled: true });
    assert.equal(result.grants.bornAuthorized.granted, false, ceiling);
  }
});

test('per-grant reasons: a withheld grant always carries a non-empty reason', () => {
  // A partially-granted result (bornReady granted, bornAuthorized withheld) keeps
  // bornReady's reason empty -- see the dedicated full-grant test below for the
  // one case where a *granted* grant carries a non-empty reason too.
  const cases = [
    permittedGrants({ ceiling: 'trusted', row: cleanRow }),
    permittedGrants({ ceiling: 'unattended', row: cleanRow }),
    permittedGrants({ ceiling: 'supervised', row: cleanRow }),
    permittedGrants({ ceiling: 'trusted', row: null }),
  ];
  for (const result of cases) {
    for (const name of ['bornReady', 'bornAuthorized']) {
      const g = result.grants[name];
      if (!g.granted) assert.ok(g.reason.length > 0, `${name} withheld must carry a non-empty reason`);
    }
  }
});

test('a full grant (both bornReady and bornAuthorized) populates both reasons with the shared positive rationale', () => {
  // #666: the old flat `reason` carried this text and nothing else reproduced it
  // once the flat keys were removed, so the per-grant shape populates it on both
  // grants instead of leaving `granted: true` unexplained.
  const result = permittedGrants({ ceiling: 'unattended', row: cleanRow, grantOriginationEnabled: true });
  assert.equal(result.grants.bornReady.granted, true);
  assert.equal(result.grants.bornAuthorized.granted, true);
  assert.ok(result.grants.bornReady.reason.length > 0);
  assert.equal(result.grants.bornReady.reason, result.grants.bornAuthorized.reason);
});

test('a granted bornReady never carries the withheld grant\'s opt-in denial', () => {
  const result = permittedGrants({ ceiling: 'unattended', row: cleanRow });
  assert.equal(result.grants.bornReady.granted, true);
  assert.equal(result.grants.bornReady.reason, '');
  assert.equal(result.grants.bornAuthorized.granted, false);
  assert.match(result.grants.bornAuthorized.reason, /opt-in/i);
});

test('a denial applies the same reason to both grants', () => {
  const result = permittedGrants({ ceiling: 'supervised', row: cleanRow });
  assert.equal(result.grants.bornReady.granted, false);
  assert.equal(result.grants.bornAuthorized.granted, false);
  assert.equal(result.grants.bornReady.reason, result.grants.bornAuthorized.reason);
});

// clearsFloor -- structured Defer-reason: path only (see #696).

test('clearsFloor returns false for an ambiguous or unrecognized reason', () => {
  assert.strictEqual(clearsFloor('Not sure if this is even still relevant'), false);
});

test('clearsFloor returns false for an empty string', () => {
  assert.strictEqual(clearsFloor(''), false);
});

test('clearsFloor returns false for a non-string input', () => {
  assert.strictEqual(clearsFloor(undefined), false);
});

test('clearsFloor returns false for a whitespace-only string', () => {
  assert.strictEqual(clearsFloor('   '), false);
});

// bookkeepingPermissions

test('bookkeepingPermissions at supervised unlocks nothing', () => {
  assert.deepEqual(bookkeepingPermissions('supervised'), {
    ledgerNarrowing: false,
    queueWriteAutoFile: false,
    opsAckAutoAcknowledge: false,
    consoleAutoResolve: false,
    refineAutoApply: false,
    ledgerRouteRemainder: false,
  });
});

test('bookkeepingPermissions at trusted unlocks ledger narrowing and queue-write auto-file, not ops-ack', () => {
  assert.deepEqual(bookkeepingPermissions('trusted'), {
    ledgerNarrowing: true,
    queueWriteAutoFile: true,
    opsAckAutoAcknowledge: false,
    consoleAutoResolve: false,
    refineAutoApply: false,
    ledgerRouteRemainder: false,
  });
});

test('bookkeepingPermissions at unattended unlocks all four', () => {
  assert.deepEqual(bookkeepingPermissions('unattended'), {
    ledgerNarrowing: true,
    queueWriteAutoFile: true,
    opsAckAutoAcknowledge: true,
    consoleAutoResolve: true,
    refineAutoApply: true,
    ledgerRouteRemainder: true,
  });
});

test('bookkeepingPermissions at supervised unlocks neither consoleAutoResolve nor ledgerRouteRemainder', () => {
  const result = bookkeepingPermissions('supervised');
  assert.strictEqual(result.consoleAutoResolve, false);
  assert.strictEqual(result.ledgerRouteRemainder, false);
});

test('bookkeepingPermissions at trusted unlocks neither consoleAutoResolve nor ledgerRouteRemainder', () => {
  const result = bookkeepingPermissions('trusted');
  assert.strictEqual(result.consoleAutoResolve, false);
  assert.strictEqual(result.ledgerRouteRemainder, false);
});

test('bookkeepingPermissions at unattended unlocks consoleAutoResolve and ledgerRouteRemainder', () => {
  const result = bookkeepingPermissions('unattended');
  assert.strictEqual(result.consoleAutoResolve, true);
  assert.strictEqual(result.ledgerRouteRemainder, true);
});

test('bookkeepingPermissions gates refineAutoApply at unattended only, same as consoleAutoResolve (#1178)', () => {
  assert.strictEqual(bookkeepingPermissions('supervised').refineAutoApply, false);
  assert.strictEqual(bookkeepingPermissions('trusted').refineAutoApply, false);
  assert.strictEqual(bookkeepingPermissions('unattended').refineAutoApply, true);
});

test('reverting refineAutoApply\'s tier threshold fails the trusted-tier assertion (test discriminates)', () => {
  // Mirrors the discrimination test below for consoleAutoResolve/ledgerRouteRemainder:
  // gate refineAutoApply on 'trusted' instead of 'unattended' and the
  // trusted-tier case must diverge from the real implementation.
  const wronglyGated = (ceiling) => {
    const tier = CEILINGS.includes(ceiling) ? ceiling : 'supervised';
    const atLeastLocal = (t, min) => CEILINGS.indexOf(t) >= CEILINGS.indexOf(min);
    return {
      ...bookkeepingPermissions(tier),
      refineAutoApply: atLeastLocal(tier, 'trusted'),
    };
  };
  assert.notDeepEqual(wronglyGated('trusted'), bookkeepingPermissions('trusted'));
});

test('bookkeepingPermissions falls back to supervised for undefined or an unrecognized tier', () => {
  const supervised = bookkeepingPermissions('supervised');
  assert.deepEqual(bookkeepingPermissions(undefined), supervised);
  assert.deepEqual(bookkeepingPermissions('bogus-tier'), supervised);
});

test('reverting bookkeepingPermissions\' tier thresholds fails the trusted-tier assertion (test discriminates)', () => {
  // Confirms the test above actually distinguishes trusted from unattended,
  // not just reads correct -- gate queueWriteAutoFile on 'unattended' instead
  // of 'trusted' and the trusted-tier case must fail.
  const wronglyGated = (ceiling) => {
    const tier = CEILINGS.includes(ceiling) ? ceiling : 'supervised';
    const atLeastLocal = (t, min) => CEILINGS.indexOf(t) >= CEILINGS.indexOf(min);
    return {
      ledgerNarrowing: atLeastLocal(tier, 'trusted'),
      queueWriteAutoFile: atLeastLocal(tier, 'unattended'),
      opsAckAutoAcknowledge: atLeastLocal(tier, 'unattended'),
      consoleAutoResolve: atLeastLocal(tier, 'unattended'),
      refineAutoApply: atLeastLocal(tier, 'unattended'),
      ledgerRouteRemainder: atLeastLocal(tier, 'unattended'),
    };
  };
  assert.notDeepEqual(wronglyGated('trusted'), bookkeepingPermissions('trusted'));
});

test('reverting bookkeepingPermissions\' new-key tier thresholds fails the trusted-tier assertion (test discriminates)', () => {
  // Confirms the trusted-tier test above actually distinguishes trusted from
  // unattended for the two new keys, not just reads correct -- gate
  // consoleAutoResolve/ledgerRouteRemainder on 'trusted' instead of
  // 'unattended' and the trusted-tier case must fail. (Comparing at the
  // 'unattended' tier instead would not discriminate this mis-gating: both
  // the too-permissive 'trusted' threshold and the correct 'unattended'
  // threshold evaluate to true once the input tier itself is 'unattended'.)
  const wronglyGated = (ceiling) => {
    const tier = CEILINGS.includes(ceiling) ? ceiling : 'supervised';
    const atLeastLocal = (t, min) => CEILINGS.indexOf(t) >= CEILINGS.indexOf(min);
    return {
      ledgerNarrowing: atLeastLocal(tier, 'trusted'),
      queueWriteAutoFile: atLeastLocal(tier, 'trusted'),
      opsAckAutoAcknowledge: atLeastLocal(tier, 'unattended'),
      consoleAutoResolve: atLeastLocal(tier, 'trusted'),
      refineAutoApply: atLeastLocal(tier, 'unattended'),
      ledgerRouteRemainder: atLeastLocal(tier, 'trusted'),
    };
  };
  assert.notDeepEqual(wronglyGated('trusted'), bookkeepingPermissions('trusted'));
});

// --- structured Defer-reason: path (_shared/deferral-gate.md floor mapping, #620) ---

test('clearsFloor: the four floor-clearing structured Defer-reason values return true', () => {
  for (const r of ['needs-human-decision', 'genuinely-larger', 'blocked-external', 'blocked-dependency']) {
    assert.strictEqual(clearsFloor(r), true, r);
  }
});

test('clearsFloor: tangential and pre-existing-outside-diff do not clear the floor', () => {
  assert.strictEqual(clearsFloor('tangential'), false);
  assert.strictEqual(clearsFloor('pre-existing-outside-diff'), false);
});

test('clearsFloor: the documented verdict vector for the whole vocabulary, in contract order', () => {
  const vocab = ['tangential', 'needs-human-decision', 'pre-existing-outside-diff', 'genuinely-larger', 'blocked-external', 'blocked-dependency'];
  assert.deepStrictEqual(vocab.map(clearsFloor), [false, true, false, true, true, true]);
});

test('clearsFloor: a free-prose reason that merely contains a vocabulary word is not the structured value itself', () => {
  // exact-match only: whitespace or case variants, or prose merely mentioning a
  // vocabulary word, are not structured values -- the structured path denies them.
  assert.strictEqual(clearsFloor('tangential to the diff and blocked on external state'), false);
  assert.strictEqual(clearsFloor('requires a product decision from the owner'), false);
  assert.strictEqual(clearsFloor(' blocked-external '), false);
  assert.strictEqual(clearsFloor('Blocked-External'), false);
});

test('clearsFloor: an unknown string returns false', () => {
  assert.strictEqual(clearsFloor('minor'), false);
});
