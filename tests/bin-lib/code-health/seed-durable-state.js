'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const { cleanGitEnv } = require('../../helpers/git-fixtures');

// Every setup git call runs without an inherited GIT_DIR and friends, so they cannot land in another repo.
const GIT_OPTS = { env: cleanGitEnv(process.env) };

// Shared git-fixture-seeding helper for code-health/tests. Seeds a local
// bare repo as `origin`, commits `code-health/<filename>` directly onto a
// `health-state` branch, then points `root`'s own `origin` remote at it.
// readDurableState's read path is pure git plumbing (fetch + show), so it CAN
// be exercised for real without gh/network this way; only the WRITE path (gh
// api blob/tree/commit/ref calls) requires live GitHub credentials, and this
// helper never touches it.
//
// Previously this same ~15-line sequence was copy-pasted once per durable
// filename across cli-nextslice.test.js (cursors.json), churn-v2.test.js
// (runs.json), and status-v2.test.js (remembered.json) -- identical except
// for the filename. This is the shared implementation; call it with the
// filename that varies per call site.
function seedDurableState(root, filename, data) {
  const bareDir = scratchDir('code-health-durable-bare-');
  execFileSync('git', ['init', '--bare', '-q', bareDir], GIT_OPTS);
  const seedDir = scratchDir('code-health-durable-seed-');
  execFileSync('git', ['init', '-q', seedDir], GIT_OPTS);
  execFileSync('git', ['-C', seedDir, 'checkout', '-q', '-b', 'health-state'], GIT_OPTS);
  fs.mkdirSync(path.join(seedDir, 'code-health'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'code-health', filename), JSON.stringify(data));
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
