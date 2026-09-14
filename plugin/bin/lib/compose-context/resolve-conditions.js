// bin/lib/compose-context/resolve-conditions.js — resolve the six-key condition
// set a run already knows (#1988). Reads policy.yml + the run's config.yml
// through policy-schema.js's own resolver (never a bespoke parse), CLAUDE.md's
// work-backend: line from $RUN_ROOT (the main checkout — never a worktree's cwd,
// [IL-127]), and probes `gh --version` for transport.
//
// integration-model resolves ONLY from the run's own config.yml pin (every
// `/flow` run writes one at the Manifesto) or from .claude-tweaks/policy.yml —
// never from policy-schema.js's forge detection (detectIntegrationModel).
// Detection fails open to local-merge on any error (offline, an expired
// token, no `gh` on PATH), which is indistinguishable from a real answer and
// would silently drop every pr-first branch a source composes on; it also
// spawns `git remote get-url` plus a live `gh repo view` on every call,
// against a composer regenerated per step. An unpinned key resolves
// 'unresolved' instead (below), never a guess.
//
// The `gh --version` probe (transport) now calls the shared ghAvailable()
// helper (the six-call-site consolidation, #2017), with deps.execFileSync
// injected so tests never spawn (gh-api-module-pattern's injectable-runner seam).
//
// A key nobody set resolves to 'unresolved' — never a guessed default — so the
// composer keeps both branches for it (the record's unresolvable-key rule).
//
// An unreadable-but-present file is a real error surfaced to the caller,
// never silently read as unresolved — only an absent file (ENOENT/ENOTDIR)
// is swallowed.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync: realExecFileSync } = require('child_process');
const { parseFlatLines, resolvePolicyKeys } = require('../policy-schema');
const { KEYS, VOCAB, UNRESOLVED } = require('./compose');
const { ghAvailable } = require('../repo-resolve');

const realDeps = {
  readFile: (p, enc) => fs.readFileSync(p, enc),
  execFileSync: realExecFileSync,
};

function readFileSafe(p, readFile) {
  try {
    return readFile(p, 'utf8');
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

// { runDir, repoRoot } -> { conditions, unresolved }
function resolveConditions({ runDir, repoRoot }, deps = {}) {
  const d = { ...realDeps, ...deps };
  const policyRaw = readFileSafe(path.join(repoRoot, '.claude-tweaks', 'policy.yml'), d.readFile);
  const runConfigRaw = readFileSafe(path.join(runDir, 'config.yml'), d.readFile);
  const claudeMdRaw = readFileSafe(path.join(repoRoot, 'CLAUDE.md'), d.readFile);
  const policy = resolvePolicyKeys(['integration-model', 'autonomy', 'worktree-always'], { policyRaw, runConfigRaw });
  const isSet = (entry) => entry && !entry.error && entry.source !== 'default';

  const conditions = {};
  // The run's own pin (config.yml) or policy.yml wins; unresolved otherwise —
  // no forge detection (see the header comment for why).
  conditions['integration-model'] = isSet(policy['integration-model'])
    ? policy['integration-model'].value
    : UNRESOLVED;

  const mode = parseFlatLines(runConfigRaw).mode;
  conditions.mode = VOCAB.mode.includes(mode) ? mode : UNRESOLVED;

  conditions.attendance = isSet(policy.autonomy)
    ? (policy.autonomy.value === 'unattended' ? 'headless' : 'attended')
    : UNRESOLVED;

  conditions.transport = ghAvailable({ execFileSync: d.execFileSync }) ? 'gh' : 'mcp';

  conditions['worktree-policy'] = isSet(policy['worktree-always'])
    ? (policy['worktree-always'].value === true ? 'always' : 'optional')
    : UNRESOLVED;

  const wb = parseFlatLines(claudeMdRaw)['work-backend'];
  conditions['work-backend'] = VOCAB['work-backend'].includes(wb) ? wb : UNRESOLVED;

  return { conditions, unresolved: KEYS.filter((key) => conditions[key] === UNRESOLVED) };
}

module.exports = { resolveConditions };
