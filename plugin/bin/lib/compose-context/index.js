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
  compose, stripMarkers, parseMarkers, MarkerError, KEYS, VOCAB, UNRESOLVED,
} = require('./compose');
const { resolveConditions } = require('./resolve-conditions');
const { PHASES, phaseBundles } = require('./phases');

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

// { runDir, step, sources: [{label, file}], repoRoot, resolved? } -> { path, bytes, sources, unresolved }
// `resolved` is an already-computed resolveConditions result (composePhase
// resolves once for the whole phase); absent, the call resolves its own.
function composeContext({ runDir, step, sources, repoRoot, resolved }, deps = {}) {
  const d = { ...realDeps, ...deps };
  const read = sources.map(({ label, file }) => {
    let content;
    try { content = d.readFile(file, 'utf8'); } catch (err) { throw new SourceReadError(label, err); }
    return { path: label, content };
  });
  const { conditions, unresolved } = resolved || resolveConditions({ runDir, repoRoot }, d);
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

// { runDir, phase, pluginRoot, repoRoot } -> { phase, bundles: [{ step, load, path, bytes, sources, unresolved }] }
// Composes every bundle the phase registry (./phases.js) names, through
// composeContext. Every source of every bundle is read, and every marker in
// them validated, before the first bundle is written — so a failing source
// anywhere in the phase writes no bundle at all, not just none of its own.
function composePhase({ runDir, phase, pluginRoot, repoRoot }, deps = {}) {
  const bundles = phaseBundles(phase, pluginRoot);
  if (!bundles) throw new TypeError(`unknown phase ${phase} (known: ${Object.keys(PHASES).join(', ')})`);
  const d = { ...realDeps, ...deps };
  const contents = new Map();
  for (const { sources } of bundles) {
    for (const { label, file } of sources) {
      if (contents.has(file)) continue;
      let content;
      try { content = d.readFile(file, 'utf8'); } catch (err) { throw new SourceReadError(label, err); }
      parseMarkers(content, label);
      contents.set(file, content);
    }
  }
  // composeContext re-reads each source through readFile; serve the contents
  // already read, so a file changing mid-call cannot split the phase.
  const readFile = (p, enc) => (contents.has(p) ? contents.get(p) : d.readFile(p, enc));
  // One condition set for the whole phase: the conditions are a property of the
  // run, not the bundle, and resolving them probes `gh --version`.
  const resolved = resolveConditions({ runDir, repoRoot }, d);
  return {
    phase,
    bundles: bundles.map(({ step, load, sources }) => ({
      step, load, ...composeContext({ runDir, step, sources, repoRoot, resolved }, { ...d, readFile }),
    })),
  };
}

module.exports = {
  composeContext, composePhase, SourceReadError, compose, stripMarkers, resolveConditions, MarkerError, KEYS, VOCAB, UNRESOLVED,
};
