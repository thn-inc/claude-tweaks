'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PHASES, NESTED_PARENT } = require('../plugin/bin/lib/timing/derive');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const SCAN_DIRS = ['build', 'test', 'review', 'design-wrapper', 'wrap-up', 'flow', '_shared']
  .map((d) => path.join(SKILLS, d));

// A short, commented allowlist of skill names that appear in phase-skill
// prose as descriptive mentions (upstream pointers, orchestrator/caller
// descriptions, "see /claude-tweaks:x" cross-references) but are never
// actually Skill-tool-invoked from inside a phase's own step body. Keep
// this short — a growing allowlist is the roster-drift problem moved, not
// solved (spec #2030's Gotchas).
const ALLOWLIST = Object.freeze({
  specify: 'cited as the upstream step ("run /claude-tweaks:specify first") — never invoked from within a phase body',
  dispatch: 'cited as the caller/orchestrator that hands off to flow — flow never invokes dispatch',
  sweep: 'cited as the orchestrator that calls flow\'s component skills in its own hygiene pipeline, never invoked from within a phase body',
  flow: 'derive.js itself excludes flow skill_invoked events from the NESTED_PARENT/topLevel attribution entirely (derivePhases\' topLevel.forEach skips name === "flow" — handled separately via the call-N mechanism), so self-references to /claude-tweaks:flow throughout its own corpus (resume-command templates, multi-spec recursion mentions) need no roster entry',
  help: 'cited only as a suggestion to the user ("run /claude-tweaks:help to find it") or descriptively listing what it does — never Skill-tool-invoked from within a phase',
  init: 'cited only inside reason strings/suggestions ("re-run /claude-tweaks:init", "run /claude-tweaks:init to enable") — never Skill-tool-invoked from within a phase',
  tidy: 'cited only as a caller-list/consumer description ("invoked by ... and /claude-tweaks:tidy", "/claude-tweaks:tidy runs this scope") — tidy invokes these files\' shared procedures, not the reverse',
  demo: 'cited only descriptively (verification-brief routing prose, drift/feedback consumer lists) — never Skill-tool-invoked from within a phase',
  backlog: 'cited throughout policy/config/contract docs describing what backlog does with a given setting or grant — pure documentation, never Skill-tool-invoked from a phase body',
  browse: 'cited as the underlying agent-browser session convention QA procedures follow — never Skill-tool-invoked itself',
  research: 'cited only in policy-schema-model-profiles.md documenting research\'s own model-profile row — never Skill-tool-invoked from a phase',
  release: 'within the scanned corpus, cited only in _shared/policy-schema.md documenting what will read release-hook/release-train (the /claude-tweaks:release skill lands in a later unit of #2250) — pure documentation, never Skill-tool-invoked from a phase body',
  routine: 'cited only inside a routine-template-schema.md troubleshooting note suggesting a manual fallback command — never Skill-tool-invoked from a phase',
  'routine-kickoff': 'cited only in routine-template-schema.md describing the kickoff skill\'s own contract — never Skill-tool-invoked from a phase',
  triage: 'cited once in local-files-preflight-stop.md as a routing-option label, not a Skill-tool invocation',
  'code-health': 'cited only as the consumer of the shared _shared/criteria-*.md files ("Criteria file consumed by /claude-tweaks:code-health") and in review\'s judge-file prose reusing its criteria inline — never Skill-tool-invoked from within a phase',
  'harness-health': 'cited only as the consumer of the shared _shared/harness-health-*.md helper files and in wrap-up\'s skill-curation.md judge-file prose reusing its criteria inline — never Skill-tool-invoked from within a phase',
  'journey-health': 'cited only as the consumer of the shared _shared/journey-*.md helper files and in wrap-up\'s journey-curation.md judge-file prose reusing its criteria inline — never Skill-tool-invoked from within a phase',
  'docs-health': 'cited only as the consumer whose rotation/criteria wrap-up\'s docs-health-integration.md judge file reuses inline ("that\'s /claude-tweaks:docs-health\'s own rotation\'s job, not this sub-issue\'s") — never Skill-tool-invoked from within a phase',
  visualize: 'cited only in review\'s doc-freshness-lens.md as a suggested follow-up command, and in _shared/visual-html-output.md describing its own output convention — never Skill-tool-invoked from a phase',
  // The three below ARE real nested Skill-tool invocations not yet covered by NESTED_PARENT/PHASES
  // (flow/SKILL.md:80 "Run `/claude-tweaks:stories`"; flow/SKILL.md:195 "invoke `/claude-tweaks:deepen`";
  // wrap-up/review-console.md:126 + flow/multispec-review-console.md:115 "invoke `/claude-tweaks:feedback --pre-confirmed`").
  // This test's job is to catch and report such gaps, not to silently add roster entries for them
  // (a semantic phase-attribution decision out of this record's scope) — filed as a follow-up:
  // https://github.com/thomasholknielsen/claude-tweaks/issues/2249
  deepen: 'real nested invocation (flow Step 5 Depth Opportunities survey) not yet in NESTED_PARENT — tracked as follow-up #2249, not silently rostered here',
  stories: 'real nested invocation (flow\'s automatic story generation) not yet in NESTED_PARENT — tracked as follow-up #2249, not silently rostered here',
  feedback: 'real nested invocation (wrap-up/flow Review Console upstream-feedback filing) not yet in NESTED_PARENT — tracked as follow-up #2249, not silently rostered here',
});

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(p);
    if (entry.name.endsWith('.md')) return [p];
    return [];
  });
}

// Scan one file's lines, tracking fenced-code-block state (to exclude
// human-facing example command blocks) and the current heading (to exclude
// "## Next Actions" blocks — human launchers, not nested Skill-tool calls).
// Fence state settles first: template files fence their own example
// "## Next Actions" headings, and letting those flip the heading state
// would leak the exclusion past the closing fence. Returns [{file, line, skill}].
function scanFile(file) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const hits = [];
  let inNextActions = false;
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) { inFence = !inFence; return; }
    if (inFence) return;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) inNextActions = /next actions/i.test(heading[1]);
    if (inNextActions) return;
    for (const m of line.matchAll(/\/claude-tweaks:([a-zA-Z][a-zA-Z0-9-]*)/g)) {
      hits.push({ file: rel, line: i + 1, skill: m[1] });
    }
  });
  return hits;
}

const allHits = SCAN_DIRS.flatMap(walk).flatMap(scanFile);

function isRostered(skill) {
  return PHASES.includes(skill) || skill in NESTED_PARENT || skill in ALLOWLIST;
}

test('every /claude-tweaks:{name} call site outside Next Actions/fenced examples is a PHASES member, a NESTED_PARENT key, or a rostered allowlist mention (#2030)', () => {
  const offenders = allHits.filter((h) => !isRostered(h.skill));
  assert.deepStrictEqual(
    offenders.map((o) => `${o.file}:${o.line}: /claude-tweaks:${o.skill}`),
    [],
    'un-rostered nested-skill call site(s) — add to NESTED_PARENT in derive.js (if truly nested) or to this test\'s ALLOWLIST (if a descriptive-only mention)'
  );
});

test('every NESTED_PARENT key is invoked somewhere in the scanned corpus (#2030)', () => {
  const seen = new Set(allHits.map((h) => h.skill));
  const stale = Object.keys(NESTED_PARENT).filter((k) => !seen.has(k));
  assert.deepStrictEqual(stale, [], `stale NESTED_PARENT key(s) — no phase skill invokes: ${stale.join(', ')}`);
});
