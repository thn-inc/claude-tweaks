// bin/lib/run-artifact/write.js — the sanctioned writer for run-dir artifacts
// a worktree-isolated session must place inside a pipeline run directory
// (#3044). The harness's tool-level pinning refuses Edit/Write to the run dir
// from a worktree session, so the run-dir file is written through this module
// (via a CLI wrapper) instead.
//
// Create/overwrite-only with a single writer per run: it uses the shared
// tmp+rename atomic primitive and deliberately takes no `withLock` — the
// cli-wrapper-contract's "create-only writer" rule.
//
// ARTIFACT_NAMES is the fail-closed gate. A new run-dir artifact must be added
// to it explicitly; a name outside the list is refused, so no traversal or
// sanitizing is needed. Today: sdd-dispatch-sample.txt, sdd-final-review.md,
// review-findings.json (the review's tiebreak finding list, #3945).
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');

const ARTIFACT_NAMES = Object.freeze(['sdd-dispatch-sample.txt', 'sdd-final-review.md', 'review-findings.json']);

// Exact membership — `name` is used as a bare filename directly under runDir.
function isArtifactName(name) {
  return ARTIFACT_NAMES.includes(name);
}

function artifactPath(runDir, name) {
  if (!isArtifactName(name)) {
    throw new Error(`run-artifact: ${JSON.stringify(name)} is not an allowlisted artifact name`);
  }
  return path.join(runDir, name);
}

// { runDir, name, content } -> { file }
function writeArtifact({ runDir, name, content }) {
  const file = artifactPath(runDir, name);
  writeFileAtomic(file, content);
  return { file };
}

// { runDir, name } -> { file, existed }. Idempotent: a missing file is not an error.
function deleteArtifact({ runDir, name }) {
  const file = artifactPath(runDir, name);
  try {
    fs.unlinkSync(file);
    return { file, existed: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { file, existed: false };
    throw err;
  }
}

module.exports = {
  ARTIFACT_NAMES, isArtifactName, writeArtifact, deleteArtifact,
};
