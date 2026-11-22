'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { cleanGitEnv } = require('../../helpers/git-fixtures');

// Every setup git call runs without an inherited GIT_DIR and friends, so they cannot land in another repo.
const GIT_OPTS = { env: cleanGitEnv(process.env) };

// Shared health-state-branch git-fixture-seeding helper, for any subsystem
// built on bin/lib/health-core/durable-state.js (harness-health,
// journey-health, docs-health). Seeds a local bare repo as `origin`, commits
// `<subsystemDir>/<filename>` directly onto a `health-state` branch, then
// points `root`'s own `origin` remote at it -- letting readDurableState's
// real fetch+show git plumbing be exercised end-to-end without gh/network
// credentials (only the WRITE path, gh api blob/tree/commit/ref, requires
// those, and this helper never touches it).
//
// Previously this same ~15-line sequence was hand-duplicated once per
// subsystem/filename combination -- e.g.
// tests/bin-lib/harness-health/cli-next-target.test.js's seedDurableCursors
// (harness-health/cursors.json) and
// tests/bin-lib/harness-health/cli-validate-findings.test.js's
// seedDurableRuns (harness-health/runs.json) -- each independently spelling
// out the same 8-step sequence, with each file's own comment naming the
// others as precedent instead of extracting a shared helper. This is that
// shared implementation; call it with the subsystem dir and filename that
// vary per call site.
//
// tmpPrefix namespaces the throwaway bare/seed directories per caller so
// concurrent test files don't collide under os.tmpdir().
function seedDurableState(root, subsystemDir, filename, data, tmpPrefix) {
  const bareDir = scratchDir(`${tmpPrefix}-bare-`);
  execFileSync('git', ['init', '--bare', '-q', bareDir], GIT_OPTS);
  const seedDir = scratchDir(`${tmpPrefix}-seed-`);
  execFileSync('git', ['init', '-q', seedDir], GIT_OPTS);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state'], GIT_OPTS);
  fs.mkdirSync(path.join(seedDir, subsystemDir), { recursive: true });
  fs.writeFileSync(path.join(seedDir, subsystemDir, filename), JSON.stringify(data));
  execFileSync('git', ['-C', seedDir, 'add', '-A'], GIT_OPTS);
  execFileSync(
    'git',
    ['-C', seedDir, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-q', '-m', 'seed'],
    GIT_OPTS,
  );
  execFileSync('git', ['-C', seedDir, 'push', '-q', bareDir, 'health-state'], GIT_OPTS);
  execFileSync('git', ['init', '-q'], { cwd: root, ...GIT_OPTS });
  execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: root, ...GIT_OPTS });
}

module.exports = { seedDurableState };
