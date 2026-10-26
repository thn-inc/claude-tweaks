// bin/lib/compose-context/phases.js — the phase registry (#4027): the one
// place that names which composed bundles each dispatched phase gets.
// `compose-context.js --phase <name>` composes them, and the composed-bytes
// rail scanner (bin/lib/skill-audit/context-cost.js) expands a `--phase` call
// line into these same bundles, so every phase bundle is measured.
// Pure: no fs, no shell.
//
// A bundle is { step, sources, load }: `step` names {run}/context/{step}.md,
// `sources` are plugin-root-relative paths composed in order, and `load` says
// whether the phase reads the bundle before its first step ('always') or only
// when a step needs it ('on-demand').
'use strict';
const path = require('path');

const bundle = (step, sources, load) => Object.freeze({ step, sources: Object.freeze(sources), load });

const PHASES = Object.freeze({
  'first-call': Object.freeze({
    bundles: Object.freeze([
      bundle('claims', ['skills/_shared/issue-claims.md'], 'on-demand'),
    ]),
  }),
  'second-call': Object.freeze({
    bundles: Object.freeze([
      bundle('claims', ['skills/_shared/issue-claims.md'], 'on-demand'),
      bundle('merge', ['skills/_shared/pr-first-merge.md', 'skills/_shared/pr-checklist-refresh.md'], 'always'),
    ]),
  }),
  'review-lens': Object.freeze({
    bundles: Object.freeze([
      bundle('review-dispatch', ['skills/_shared/subagent-dispatch-core.md', 'skills/_shared/run-dir-resolution.md'], 'always'),
    ]),
  }),
});

// (phase, pluginRoot) -> [{ step, load, sources: [{ label, file }] }], or null
// for an unknown phase. `label` is the registry's plugin-relative path; `file`
// is that path resolved absolute under pluginRoot.
function phaseBundles(phase, pluginRoot) {
  if (!Object.hasOwn(PHASES, phase)) return null;
  return PHASES[phase].bundles.map(({ step, load, sources }) => ({
    step,
    load,
    sources: sources.map((label) => ({ label, file: path.resolve(pluginRoot, label) })),
  }));
}

module.exports = { PHASES, phaseBundles };
