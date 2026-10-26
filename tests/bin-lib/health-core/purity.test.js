'use strict';

// The pure/stateful split in health-core is real but was previously only a
// convention. dedup.js's own header claims purity and consumers rely on it,
// so this asserts the claim instead of trusting it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');

const PURE_MODULES = [
  'dedup.js', 'finding-validation.js', 'fingerprint.js', 'budget.js',
  'rotation.js', 'mark.js', 'churn-report.js', 'frontmatter-list.js', 'runs.js',
  'digest.js',
];
const FORBIDDEN = ['fs', 'node:fs', 'child_process', 'node:child_process', './durable-state', './cache'];

for (const mod of PURE_MODULES) {
  test(`${mod} imports nothing stateful`, () => {
    const src = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'health-core', mod));
    const imports = [...src.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
    const violations = imports.filter((i) => FORBIDDEN.includes(i));
    assert.deepStrictEqual(
      violations, [],
      `${mod} is in the pure set but requires ${violations.join(', ')}. `
      + 'Either the import is wrong, or this module belongs in the stateful set — '
      + 'moving it means auditing every consumer that relies on its purity (bin/lib/residue/, '
      + 'for example, requires fingerprint.js and finding-validation.js specifically).',
    );
  });
}

test('the pure module list matches what is on disk', () => {
  // A module renamed or deleted must fail loudly rather than silently
  // dropping out of the check.
  for (const mod of PURE_MODULES) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'health-core', mod)), `${mod} is listed as pure but does not exist`);
  }
});
