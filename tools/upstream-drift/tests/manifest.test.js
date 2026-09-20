'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseManifest, validateManifest, loadManifest } = require('../manifest');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// Builds one known-valid dependency object (not YAML — a plain JS object,
// matching what parseManifest would have produced) so validation tests can
// delete/mutate a single field without re-authoring YAML per case.
function validDependency() {
  return {
    name: 'sample-cli',
    kind: 'npm-cli',
    'installed-probe': {
      type: 'command',
      run: 'npx --no-install sample --version',
    },
    pinned: '1.0.0',
    upstream: {
      repo: 'example/sample',
      'tag-prefix': 'v',
    },
    'contract-paths': ['cli/main.mjs'],
    assertions: [
      {
        file: 'docs/sample.md',
        claims: 'exits non-zero on a warning',
        'upstream-path': 'cli/main.mjs',
        'must-match': 'process.exit(2)',
      },
    ],
    fixtures: [
      {
        run: 'npx sample detect --json fixtures/warning.html',
        expect: { exit: 2, stream: 'stdout', keys: ['name', 'severity'] },
      },
    ],
  };
}

// ─── 1. round-trip of the full schema example (frozen fixture) ─────────

test('parseManifest round-trips the full schema example against a frozen fixture', () => {
  const result = parseManifest(readFixture('full-schema.yml'));

  assert.deepStrictEqual(result, {
    dependencies: [
      {
        name: 'sample-cli',
        kind: 'npm-cli',
        'installed-probe': {
          type: 'command',
          run: 'npx --no-install sample --version',
          root: 'npm root -g',
          'root-suffix': 'sample',
        },
        pinned: '1.2.3',
        upstream: { repo: 'example/sample', 'tag-prefix': 'cli-v' },
        'contract-paths': ['cli/engine/main.mjs', 'cli/engine/registry.mjs'],
        assertions: [
          {
            file: 'docs/sample.md',
            claims: 'exits non-zero on a warning-level finding',
            'upstream-path': 'cli/engine/main.mjs',
            'must-match': 'process.exit(2)',
          },
          {
            file: 'docs/sample.md',
            claims: 'a clean scan prints an empty array',
            'upstream-path': 'cli/engine/main.mjs',
            'must-match': "stdout.write('[]",
          },
        ],
        fixtures: [
          {
            run: 'npx --no-install sample detect --json fixtures/warning.html',
            expect: { exit: 2, stream: 'stdout', keys: ['name', 'severity', 'file', 'line'] },
          },
          {
            run: 'npx --no-install sample detect --json fixtures/clean.html',
            expect: { exit: 0, stream: 'stdout', keys: [] },
          },
        ],
      },
      {
        name: 'sample-plugin',
        kind: 'claude-plugin',
        'installed-probe': {
          type: 'plugin-cache-glob',
          glob: '~/.claude/plugins/cache/*/sample/*/.claude-plugin/plugin.json',
        },
        pinned: '4.0.2',
        upstream: { repo: 'example/sample', 'tag-prefix': 'skill-v' },
        'contract-paths': ['skills/sample/SKILL.md'],
        assertions: [
          {
            file: 'skills/sample-wrapper/command-map.md',
            claims: 'the plugin exposes a polish command',
            'upstream-path': 'skills/sample/SKILL.md',
            'must-match': 'polish [target]',
          },
        ],
        fixtures: [],
      },
    ],
  });

  assert.deepStrictEqual(validateManifest(result), []);
});

// ─── 2. a sequence of maps parses into the right array of objects ──────

test('a block sequence of maps parses into an array of objects', () => {
  const text = [
    'assertions:',
    '  - file: a.md',
    '    claims: first claim',
    '  - file: b.md',
    '    claims: second claim',
    '',
  ].join('\n');

  assert.deepStrictEqual(parseManifest(text), {
    assertions: [
      { file: 'a.md', claims: 'first claim' },
      { file: 'b.md', claims: 'second claim' },
    ],
  });
});

// ─── 3. flow map and flow sequence forms, including empty [] ───────────

test('flow maps and flow sequences parse, including their empty forms', () => {
  const text = [
    'flowmap: { a: 1, b: "two", c: true }',
    'flowseq: [1, "two", three]',
    'emptymap: {}',
    'emptyseq: []',
  ].join('\n');

  assert.deepStrictEqual(parseManifest(text), {
    flowmap: { a: 1, b: 'two', c: true },
    flowseq: [1, 'two', 'three'],
    emptymap: {},
    emptyseq: [],
  });
});

// ─── 4. a '#' inside a double-quoted value survives intact ─────────────

test('a # inside a double-quoted scalar is not treated as a comment', () => {
  const text = 'run: "npx thing --flag #1 --other" # this part IS a real comment\n';

  assert.deepStrictEqual(parseManifest(text), {
    run: 'npx thing --flag #1 --other',
  });
});

// ─── 5. tab-indented input throws, naming the line number ──────────────

test('a tab used for indentation throws, naming the line number', () => {
  const text = ['dependencies:', '  - name: x', '\tkind: npm-cli', ''].join('\n');

  assert.throws(() => parseManifest(text), (err) => {
    assert.match(err.message, /line 3/);
    assert.match(err.message, /tab/i);
    return true;
  });
});

// ─── 6. each of the eight required keys, missing in turn ───────────────

test('each of the eight required dependency keys, when missing, produces a validation error naming the dependency and key', () => {
  const requiredKeys = [
    'name',
    'kind',
    'installed-probe',
    'pinned',
    'upstream',
    'contract-paths',
    'assertions',
    'fixtures',
  ];

  for (const key of requiredKeys) {
    const dep = validDependency();
    delete dep[key];
    const errors = validateManifest({ dependencies: [dep] });

    assert.ok(errors.length > 0, `expected an error when '${key}' is missing`);
    const label = key === 'name' ? 'dependencies[0]' : 'sample-cli';
    const matching = errors.some((e) => e.includes(label) && e.includes(`'${key}'`));
    assert.ok(matching, `expected an error naming '${label}' and '${key}', got: ${JSON.stringify(errors)}`);
  }
});

// ─── 7. a duplicate name produces an error ──────────────────────────────

test('a duplicate dependency name produces a validation error', () => {
  const dep1 = validDependency();
  const dep2 = validDependency();
  dep2.pinned = '2.0.0';

  const errors = validateManifest({ dependencies: [dep1, dep2] });
  assert.ok(errors.some((e) => /duplicate/i.test(e) && e.includes('sample-cli')));
});

// ─── 8. an assertion missing must-match produces an error ──────────────

test('an assertion missing must-match produces a validation error', () => {
  const dep = validDependency();
  delete dep.assertions[0]['must-match'];

  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('assertions[0]') && e.includes('must-match')));
});

// ─── 9. a fixture with an invalid expect.stream produces an error ──────

test('a fixture whose expect.stream is neither stdout nor stderr produces a validation error', () => {
  const dep = validDependency();
  dep.fixtures[0].expect.stream = 'both';

  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('fixtures[0]') && e.includes('stream')));
});

// ─── 10. fixtures: [] and contract-paths: [] are valid ─────────────────

test('an empty list is valid for contract-paths, assertions, fixtures, and expect.keys — distinct from missing', () => {
  const dep = validDependency();
  dep['contract-paths'] = [];
  dep.assertions = [];
  dep.fixtures = [];

  assert.deepStrictEqual(validateManifest({ dependencies: [dep] }), []);
});

test('loadManifest succeeds end-to-end on a fixture file using empty lists for contract-paths/assertions/fixtures', () => {
  const result = loadManifest(path.join(FIXTURES_DIR, 'minimal-valid.yml'));
  assert.deepStrictEqual(result.dependencies[0]['contract-paths'], []);
  assert.deepStrictEqual(result.dependencies[0].assertions, []);
  assert.deepStrictEqual(result.dependencies[0].fixtures, []);
});

// ─── 11. quoted pinned value parses as a string, never a number ────────

test('a quoted pinned value like "3.5.0" parses as the string, never a number', () => {
  assert.deepStrictEqual(parseManifest('pinned: "3.5.0"\n'), { pinned: '3.5.0' });
});

test('a quoted integer-looking value stays a string; the bare form becomes a number', () => {
  const text = ['quoted: "5"', 'bare: 5', ''].join('\n');
  const result = parseManifest(text);
  assert.strictEqual(result.quoted, '5');
  assert.strictEqual(typeof result.quoted, 'string');
  assert.strictEqual(result.bare, 5);
  assert.strictEqual(typeof result.bare, 'number');
});

// ─── 12. conformance: the real manifest.yml loads and validates ────────

test('conformance: loadManifest succeeds on the real tools/upstream-drift/manifest.yml', () => {
  const realManifestPath = path.join(__dirname, '..', 'manifest.yml');
  const result = loadManifest(realManifestPath);

  assert.ok(Array.isArray(result.dependencies));
  assert.ok(result.dependencies.length > 0);
  for (const dep of result.dependencies) {
    assert.ok(typeof dep.name === 'string' && dep.name.trim() !== '');
  }
});

// ─── additional coverage: loadManifest reports every failure, not just the first ─

test('loadManifest throws an error message naming every validation failure, not just the first', () => {
  const dep = validDependency();
  delete dep.kind;
  delete dep.pinned;

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-manifest-'));
  const tmpFile = path.join(tmpDir, 'bad-manifest.yml');
  // Build the bad manifest as YAML text so this exercises loadManifest's
  // real file-reading path, not just validateManifest on a JS object.
  const yaml = [
    'dependencies:',
    '  - name: sample-cli',
    '    installed-probe:',
    '      type: command',
    '      run: "npx sample --version"',
    '    upstream:',
    '      repo: "example/sample"',
    '      tag-prefix: "v"',
    '    contract-paths: []',
    '    assertions: []',
    '    fixtures: []',
    '',
  ].join('\n');
  fs.writeFileSync(tmpFile, yaml);

  assert.throws(() => loadManifest(tmpFile), (err) => {
    assert.match(err.message, /kind/);
    assert.match(err.message, /pinned/);
    return true;
  });
});

// ─── additional coverage: a reserved bare YAML construct throws rather than misparsing ─

test('a bare scalar starting with a reserved YAML indicator (e.g. a block-scalar leader) throws', () => {
  const text = 'run: |\n  echo hi\n';
  assert.throws(() => parseManifest(text), /line 1/);
});

// ─── additional coverage: unterminated quotes and mismatched keys throw ─

test('an unterminated double-quoted scalar throws, naming the line', () => {
  const text = 'run: "npx thing --flag\n';
  assert.throws(() => parseManifest(text), (err) => {
    assert.match(err.message, /line 1/);
    assert.match(err.message, /unterminated/i);
    return true;
  });
});

test('an unknown installed-probe.type produces a validation error', () => {
  const dep = validDependency();
  dep['installed-probe'] = { type: 'ftp', run: 'x' };

  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('installed-probe.type')));
});

// ─── #2277: version-mode (optional; 'exact' | 'floor') ──────────────────

test('a probe-class entry with no version-mode key validates clean (defaults to exact)', () => {
  const dep = validDependency();
  const errors = validateManifest({ dependencies: [dep] });
  assert.deepStrictEqual(errors, []);
});

test('version-mode: "floor" validates clean', () => {
  const dep = validDependency();
  dep['version-mode'] = 'floor';
  const errors = validateManifest({ dependencies: [dep] });
  assert.deepStrictEqual(errors, []);
});

test('an unknown version-mode value produces a validation error naming the bad value', () => {
  const dep = validDependency();
  dep['version-mode'] = 'ceiling';
  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes("'version-mode'") && e.includes('ceiling')));
});

test('conformance: the real impeccable-cli entry is version-mode: floor', () => {
  const realManifestPath = path.join(__dirname, '..', 'manifest.yml');
  const result = loadManifest(realManifestPath);
  const cli = result.dependencies.find((d) => d.name === 'impeccable-cli');
  assert.ok(cli, 'impeccable-cli entry exists');
  assert.strictEqual(cli['version-mode'], 'floor');
});

// ─── P1: bare null/Null/NULL/~ and an empty value parse as JS null ─────

test('P1: bare null, Null, NULL, and ~ all parse as JavaScript null, not the string "null"', () => {
  assert.deepStrictEqual(parseManifest('pinned: null\n'), { pinned: null });
  assert.deepStrictEqual(parseManifest('pinned: Null\n'), { pinned: null });
  assert.deepStrictEqual(parseManifest('pinned: NULL\n'), { pinned: null });
  assert.deepStrictEqual(parseManifest('pinned: ~\n'), { pinned: null });
});

test('P1: a quoted "null" stays the literal string, never JavaScript null', () => {
  const result = parseManifest('pinned: "null"\n');
  assert.strictEqual(result.pinned, 'null');
  assert.notStrictEqual(result.pinned, null);
});

test('P1: a key with nothing after it (no nested block following) parses as JavaScript null', () => {
  assert.deepStrictEqual(parseManifest('pinned:\n'), { pinned: null });
});

test('P1: validateManifest rejects a null pinned value via its existing non-empty-string check', () => {
  const dep = validDependency();
  dep.pinned = null;
  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('sample-cli') && e.includes("'pinned'")));
});

// ─── P2: '#' only starts a comment at line-start or after whitespace ───

test('P2: a # glued to the preceding character is part of the value, not a comment', () => {
  assert.deepStrictEqual(parseManifest('pinned: 3.5.0#build123\n'), { pinned: '3.5.0#build123' });
});

test('P2: a # preceded by whitespace still starts a real comment', () => {
  assert.deepStrictEqual(parseManifest('pinned: 3.5.0 # a real comment\n'), { pinned: '3.5.0' });
});

// ─── P3: a bare scalar with a further outside-quote ": " throws ────────

test('P3: a bare scalar containing a further outside-quote ": " throws, naming the line', () => {
  const text = 'run: npx thing: do stuff\n';
  assert.throws(() => parseManifest(text), (err) => {
    assert.match(err.message, /line 1/);
    assert.match(err.message, /quote/i);
    return true;
  });
});

test('P3: quoted values containing colons are unaffected, and the real manifest.yml still loads', () => {
  const text = 'claims: "findings JSON is written to stdout, not stderr"\n';
  assert.deepStrictEqual(parseManifest(text), {
    claims: 'findings JSON is written to stdout, not stderr',
  });

  const realManifestPath = path.join(__dirname, '..', 'manifest.yml');
  const result = loadManifest(realManifestPath);
  assert.deepStrictEqual(
    result.dependencies.map((d) => d.name),
    ['impeccable-cli', 'impeccable-plugin', 'superpowers', 'emilkowalski-skills'],
  );
});

// ─── content-pinned entry class (`versioning: none`) ────────────────────

// A known-valid content-pinned dependency, mirroring validDependency()'s
// role for the probe class: tests delete/mutate exactly one field per case.
function validContentPinnedDependency() {
  return {
    name: 'sample-skills',
    kind: 'skill-repo',
    pin: { commit: 'a'.repeat(40), versioning: 'none' },
    upstream: { repo: 'example/skills' },
    consumed: [{ path: 'skills/one/SKILL.md', sha256: 'b'.repeat(64) }],
  };
}

test('a valid content-pinned (versioning: none) entry validates clean without any probe-class key', () => {
  assert.deepStrictEqual(validateManifest({ dependencies: [validContentPinnedDependency()] }), []);
});

test('a content-pinned entry with a malformed pin.commit produces a validation error', () => {
  const dep = validContentPinnedDependency();
  dep.pin.commit = 'not-a-sha';
  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('sample-skills') && e.includes('pin.commit')));
});

test('a content-pinned entry with a malformed consumed sha256 produces a validation error', () => {
  const dep = validContentPinnedDependency();
  dep.consumed[0].sha256 = 'deadbeef';
  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes('consumed[0].sha256')));
});

test('a content-pinned entry with an empty consumed list produces a validation error', () => {
  const dep = validContentPinnedDependency();
  dep.consumed = [];
  const errors = validateManifest({ dependencies: [dep] });
  assert.ok(errors.some((e) => e.includes("'consumed'") && /non-empty/.test(e)));
});

test('probe-machinery keys on a content-pinned entry each produce a validation error — silently-dead config fails loudly', () => {
  // A plausible value per key — the error must come from the key being
  // present on this entry class at all, never from the value being junk.
  const probeMachineryKeys = {
    'installed-probe': { type: 'command', run: 'x' },
    pinned: '1.0.0',
    'version-mode': 'floor',
    'contract-paths': [],
    assertions: [],
    fixtures: [],
  };
  for (const [key, value] of Object.entries(probeMachineryKeys)) {
    const dep = validContentPinnedDependency();
    dep[key] = value;
    const errors = validateManifest({ dependencies: [dep] });
    assert.ok(
      errors.some((e) => e.includes(`'${key}'`) && e.includes('versioning: none')),
      `expected an error naming '${key}', got: ${JSON.stringify(errors)}`,
    );
  }
});

test('conformance: the real emilkowalski-skills entry is content-pinned, with its own pin block shared by no other entry', () => {
  const realManifestPath = path.join(__dirname, '..', 'manifest.yml');
  const result = loadManifest(realManifestPath);
  const emil = result.dependencies.find((d) => d.name === 'emilkowalski-skills');

  assert.ok(emil, 'emilkowalski-skills entry exists');
  assert.strictEqual(emil.pin.versioning, 'none');
  assert.match(emil.pin.commit, /^[0-9a-f]{40}$/);
  assert.ok(Array.isArray(emil.consumed) && emil.consumed.length > 0);
  for (const c of emil.consumed) {
    assert.match(c.sha256, /^[0-9a-f]{64}$/);
    assert.match(c.path, /\/SKILL\.md$/, 'scope: only SKILL.md files are pinned');
  }

  // No two entries share a pin: the emil pin object belongs to exactly one
  // entry, and the probe-class entries carry their own distinct `pinned`
  // scalars rather than any `pin` block at all.
  const sharingPin = result.dependencies.filter((d) => d.pin === emil.pin);
  assert.strictEqual(sharingPin.length, 1);
  for (const d of result.dependencies) {
    if (d.name === 'emilkowalski-skills') continue;
    assert.strictEqual(d.pin, undefined, `${d.name} must not carry a 'pin' block`);
  }
});

test('content-class keys on a probe-class entry each produce a validation error — the reciprocal dead-config guard', () => {
  for (const key of ['pin', 'consumed']) {
    const dep = validDependency();
    dep[key] = key === 'pin' ? { commit: 'a'.repeat(40), versioning: 'nnone' } : [];
    const errors = validateManifest({ dependencies: [dep] });
    assert.ok(
      errors.some((e) => e.includes(`'${key}'`) && e.includes('versioning: none')),
      `expected an error naming '${key}', got: ${JSON.stringify(errors)}`,
    );
  }
});

test('YAML anchors are rejected by the parser, so entries cannot share a pin block via anchor/alias', () => {
  assert.throws(() => parseManifest('pin: &shared { commit: x }\n'), /line 1/);
  assert.throws(() => parseManifest('pin: *shared\n'), /line 1/);
});
