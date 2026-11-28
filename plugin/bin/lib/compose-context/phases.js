// bin/lib/compose-context/phases.js — the phase registry (#4027): the one
// place that names which composed bundles each dispatched phase gets.
// `compose-context.js --phase <name>` composes them, and the composed-bytes
// rail scanner (bin/lib/skill-audit/context-cost.js) expands a `--phase` call
// line into these same bundles, so every phase bundle is measured.
// Pure: no fs, no shell.
//
// A bundle is { step, sources, load, sections? }: `step` names
// {run}/context/{step}.md, `sources` are plugin-root-relative paths composed
// in order, and `load` says whether the phase reads the bundle before its
// first step ('always') or only when a step needs it ('on-demand').
// `sections` (#5668), absent for a whole-file bundle, maps a source label to
// the selectors (./sections.js) naming the only slices that source contributes.
'use strict';
const path = require('path');

const bundle = (step, sources, load, sections) => Object.freeze({
  step,
  sources: Object.freeze(sources),
  load,
  ...(sections && {
    sections: Object.freeze(Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, Object.freeze(v)]))),
  }),
});

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
  // Child-facing bundles (#4359): a dispatched lens or SDD child reads the
  // `_shared` rules its prompt cites from one composed file, on demand. Only
  // the cited sections are composed (#5668); lens 3e reads lens-depth too.
  'review-lens-child': Object.freeze({
    bundles: Object.freeze([
      bundle('lens-child', ['skills/_shared/subagent-output-contract.md'], 'on-demand', {
        'skills/_shared/subagent-output-contract.md': ['**Scratch rule.**'],
      }),
      bundle('lens-depth', ['skills/_shared/criteria-architecture-depth.md'], 'on-demand'),
    ]),
  }),
  'sdd-child': Object.freeze({
    bundles: Object.freeze([
      bundle('sdd-child', ['skills/_shared/subagent-dispatch-core.md'], 'on-demand', {
        'skills/_shared/subagent-dispatch-core.md': [
          '**Never run `git stash` in any form.**',
          '**Never kill a process by image or name.**',
          '## Discrimination checks in a scratch checkout',
        ],
      }),
    ]),
  }),
});

// (phase, pluginRoot) -> [{ step, load, sources: [{ label, file, sections? }] }],
// or null for an unknown phase. `label` is the registry's plugin-relative path;
// `file` is that path resolved absolute under pluginRoot; `sections` (the
// selector list) is present only for a sectioned source.
function phaseBundles(phase, pluginRoot) {
  if (!Object.hasOwn(PHASES, phase)) return null;
  return PHASES[phase].bundles.map(({ step, load, sources, sections }) => ({
    step,
    load,
    sources: sources.map((label) => ({
      label,
      file: path.resolve(pluginRoot, label),
      ...(sections && Object.hasOwn(sections, label) && { sections: sections[label] }),
    })),
  }));
}

module.exports = { PHASES, phaseBundles };
