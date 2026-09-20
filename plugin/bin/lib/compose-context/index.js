// bin/lib/compose-context/index.js — module entrypoint for the per-run
// skill-context composer (#1988): read the sources, resolve the run's
// conditions, compose, and atomically write {run}/context/{step}.md. Every
// source is read and every marker validated BEFORE anything touches disk, so a
// failing call is a no-op on disk (a prior bundle is never partially
// overwritten or deleted). Shells out to nothing of its own — the one shell-out
// lives in resolve-conditions.js behind deps.execFileSync.
'use strict';
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('../atomic-write');
const {
  compose, stripMarkers, MarkerError, KEYS, VOCAB, UNRESOLVED,
} = require('./compose');
const { resolveConditions } = require('./resolve-conditions');

class SourceReadError extends Error {
  constructor(file, cause) {
    super(`cannot read source ${file}: ${cause && cause.message}`);
    this.name = 'SourceReadError';
    this.file = file;
    this.cause = cause;
  }
}

const realDeps = {
  // readFile serves both the source-file reads below and resolve-conditions.js's
  // policy.yml/config.yml/CLAUDE.md reads — a caller overriding it overrides both.
  readFile: (p, enc) => fs.readFileSync(p, enc),
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  writeFileAtomic,
};

// { runDir, step, sources: [{label, file}], repoRoot } -> { path, bytes, sources, unresolved }
function composeContext({ runDir, step, sources, repoRoot }, deps = {}) {
  const d = { ...realDeps, ...deps };
  const read = sources.map(({ label, file }) => {
    let content;
    try { content = d.readFile(file, 'utf8'); } catch (err) { throw new SourceReadError(label, err); }
    return { path: label, content };
  });
  const { conditions, unresolved } = resolveConditions({ runDir, repoRoot }, d);
  const text = compose(read, conditions); // validates every marker of every source first
  const outDir = path.join(runDir, 'context');
  const outPath = path.join(outDir, `${step}.md`);
  d.mkdir(outDir);
  d.writeFileAtomic(outPath, text);
  return {
    path: outPath,
    bytes: Buffer.byteLength(text, 'utf8'),
    sources: sources.map((s) => s.label),
    unresolved,
  };
}

module.exports = {
  composeContext, SourceReadError, compose, stripMarkers, resolveConditions, MarkerError, KEYS, VOCAB, UNRESOLVED,
};
