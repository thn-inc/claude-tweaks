'use strict';
// #3595 D4: a multi-spec run's wrap-up ceremony escape hatch downgrades only the
// spec's own spec-level config.yml (its $PIPELINE_RUN_DIR is spec-{N}/), so the
// run-level ceremony-profile is no longer uniform across specs. The batch pass
// must read every spec's value: standard when any spec downgraded.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => fs.readFileSync(path.join(SKILLS, rel), 'utf8').replace(/\s+/g, ' ');

test('AC4.1: both files name the spec-level config.yml and one downgraded spec runs the batch pass at standard', () => {
  const wrapUp = read('wrap-up/SKILL.md');
  assert.match(wrapUp, /the downgrade writes the spec-level `config\.yml` only — never the parent run dir's/);
  assert.match(wrapUp, /which in a single-spec run is the only remaining consumer \(under `MULTISPEC_CURATION_DEFER=1` per-spec Phase 2 is skipped and the batch pass/);
  assert.doesNotMatch(wrapUp, /as `--ceremony`, which is the only remaining consumer/);

  const batch = read('flow/multispec-batch-curation.md');
  assert.match(batch, /\*\*Batch ceremony \(#3595\)\.\*\*/);
  assert.match(batch, /its own spec-level `config\.yml` only/);
  assert.match(batch, /runs at `standard` when any `spec-\{N\}\/config\.yml` reads `ceremony-profile: standard`/);
  assert.match(batch, /--ceremony "\{batch ceremony\}"/);
  assert.doesNotMatch(batch, /already uniform across every spec/);
  assert.doesNotMatch(batch, /\{ceremony-profile from config\.yml\}/);
});
