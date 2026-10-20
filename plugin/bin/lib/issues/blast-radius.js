'use strict';

// Pure: the mechanical half of assess-agent-autonomy's merge-check verdict mode. Classifies a
// diff's files (test vs. implementation, sensitive vs. not) and reduces that to the summary the
// merge-check verdict weighs as one input alongside review findings and diff content — never a pass/fail gate on its
// own. Was docs/superpowers/specs/2026-08-03-mechanical-vs-substantive-merge-judgment-design.md
// — deleted (d83f0720).

// Recognizes multiple ecosystems' test-path conventions, since
// classifyDiffFiles/blastRadiusSummary judge diffs from arbitrary downstream
// projects assess-agent-autonomy's merge-check verdict reviews, not just this
// plugin's own JS 'tests/*.test.js' shape:
//   - a 'test' or 'tests' path segment (this plugin's own convention, and
//     Maven/Gradle Java's canonical singular 'src/test/java/...')
//   - a .test./.spec. filename suffix for js/jsx/ts/tsx
//   - Go's '_test.go' suffix
//   - Python's 'test_*.py' / '*_test.py' conventions
//   - a YAML file under a 'stories/' path segment (#3034) — this plugin's own
//     QA story-file convention (plugin/skills/stories/SKILL.md), the files
//     /claude-tweaks:stories writes by default
//   - exemption (#3680): prompt prose (markdown under skills/, agents/ or
//     commands/) is never a test file, even under a 'test/' directory — see
//     PROMPT_PROSE_DIRS below
// Both anchored to a '/' or string boundary so a path merely CONTAINING
// "test" as a substring (e.g. 'src/latest/widget.js', 'src/contest.js')
// never false-positives.
const TEST_PATH_RE = /(^|\/)tests?\//;
const TEST_SUFFIX_RE = /\.(test|spec)\.(jsx?|tsx?)$|_test\.go$|(^|\/)test_[^/]+\.py$|[^/]+_test\.py$/;
// Restricted to .yaml/.yml under a 'stories/' segment: the stories schema is
// YAML, and a bare 'stories/' directory match would misclassify unrelated
// content (a CMS or docs site's 'stories/' pages) in downstream projects.
const STORY_PATH_RE = /(^|\/)stories\/.*\.ya?ml$/;

// Prompt prose: markdown under a Claude Code component directory (`skills/`,
// `agents/`, `commands/`, at any prefix). It is the shipped product of a
// plugin or a project's own harness, so it counts as production for the
// low-surface gate. Keyed on Claude Code's directory conventions, not on
// `plugin/`, so it is project-agnostic. Erring toward production costs only a
// `standard` wrap-up, and, since `implFiles` also feeds `profiles.js`'s
// diff-ceiling, can lift a small prose diff's whole-branch reviewer from
// Standard to Capable — still the safe direction.
// #3477: run `2026-10-17T194130-record-3005` (#3005's four prose files plus
// one test) derived `fast-lane` when it should not have.
// The directory names are exported so tests can pin the prose twins that
// restate them (`build/micro-plan.md`, `wrap-up/ceremony-derivation.md`).
// isTestPath also consults it (#3680): a prose file under a `skills/test/`
// directory would otherwise match TEST_PATH_RE and understate implementation
// blast radius in merge-check.
const PROMPT_PROSE_DIRS = Object.freeze(['skills', 'agents', 'commands']);
const PROMPT_PROSE_RE = new RegExp(`(^|/)(${PROMPT_PROSE_DIRS.join('|')})/.+\\.md$`, 'i');
function isPromptProsePath(path) {
  return PROMPT_PROSE_RE.test(path);
}

function isTestPath(path) {
  if (isPromptProsePath(path)) return false;
  return TEST_PATH_RE.test(path) || TEST_SUFFIX_RE.test(path) || STORY_PATH_RE.test(path);
}

// Glob support: '*' matches within a path segment (not '/'), while '**' crosses path segments.
// Sufficient for this project's own sensitive-path shapes (e.g. 'skills/_shared/*.md',
// 'skills/**' to match any depth, 'bin/hooks.js' as a literal). Every other ECMAScript
// regex metacharacter (including '?', which a maintainer could plausibly write into a
// config value as a literal character, given '*' and '?' are both standard single-char/
// wildcard shell-glob tokens elsewhere in this codebase's own bash conventions) is
// escaped so it can never be misinterpreted as regex syntax.
//
// Compiled RegExp objects are memoized per glob string: classifyDiffFiles calls
// isSensitivePath once per changed file, and without this cache every file in a
// diff would recompile the SAME sensitive-path globs from scratch (F files * G
// globs worth of redundant RegExp construction, for only G compilations that
// are actually needed).
const globRegExpCache = new Map();
function globToRegExp(glob) {
  let re = globRegExpCache.get(glob);
  if (!re) {
    // Tokenised left-to-right so '**' can span path segments while '*' stays
    // segment-bound (#727): '**/' matches zero or more whole segments, a
    // trailing '/**' matches the bare parent or anything under it, and a glob
    // that is exactly '**' matches everything. A '**' embedded mid-segment
    // ('a**b', 'a**/b') is not a documented form and falls through to the
    // single-'*' rule per star, preserving the pre-#727 behavior for that
    // degenerate shape.
    let source = '';
    if (glob === '**') {
      source = '.*';
    } else {
      let i = 0;
      while (i < glob.length) {
        if (glob.startsWith('/**', i) && i + 3 === glob.length) { source += '(?:/.*)?'; i += 3; continue; }
        if (glob.startsWith('**/', i) && (i === 0 || glob[i - 1] === '/')) { source += '(?:.*/)?'; i += 3; continue; }
        const ch = glob[i];
        source += ch === '*' ? '[^/]*' : ch.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
        i += 1;
      }
    }
    re = new RegExp(`^${source}$`);
    globRegExpCache.set(glob, re);
  }
  return re;
}

function isSensitivePath(path, sensitivePaths) {
  return sensitivePaths.some((glob) => globToRegExp(glob).test(path));
}

// #1906: pipeline-generated bookkeeping paths — a materialized spec
// (flow/materialize.md's single-record `{run-id}/work/{n}-spec.md` and
// multi-record `{run-id}/spec-{a}/work/{a}-spec.md` shapes) and a
// superpowers:writing-plans implementation plan doc
// (docs/superpowers/plans/*.md) — are conflated with real implementation
// risk if counted as impl lines/files. These globs are fixed claude-tweaks
// plugin conventions (not project-specific config), so they're hardcoded
// here rather than read from policy, the same way TEST_PATH_RE/TEST_SUFFIX_RE
// are hardcoded conventions rather than configurable.
const PIPELINE_ARTIFACT_GLOBS = ['.claude-tweaks/pipelines/**/work/*-spec.md', 'docs/superpowers/plans/*.md'];

function isPipelineArtifactPath(path) {
  return PIPELINE_ARTIFACT_GLOBS.some((glob) => globToRegExp(glob).test(path));
}

function classifyDiffFiles(files, sensitivePaths = []) {
  return (files || []).map((f) => ({
    path: f.path,
    isTest: isTestPath(f.path),
    isPipelineArtifact: isPipelineArtifactPath(f.path),
    isSensitive: isSensitivePath(f.path, sensitivePaths),
    additions: f.additions || 0,
    deletions: f.deletions || 0,
  }));
}

function blastRadiusSummary(classifiedFiles) {
  const summary = {
    implLines: 0,
    testLines: 0,
    implFiles: 0,
    testFiles: 0,
    pipelineArtifactLines: 0,
    pipelineArtifactFiles: 0,
    sensitiveFilesTouched: [],
  };
  for (const f of classifiedFiles || []) {
    const lines = f.additions + f.deletions;
    if (f.isPipelineArtifact) {
      summary.pipelineArtifactLines += lines;
      summary.pipelineArtifactFiles += 1;
    } else if (f.isTest) {
      summary.testLines += lines;
      summary.testFiles += 1;
    } else {
      summary.implLines += lines;
      summary.implFiles += 1;
    }
    if (f.isSensitive) summary.sensitiveFilesTouched.push(f.path);
  }
  return summary;
}

module.exports = { classifyDiffFiles, blastRadiusSummary, isSensitivePath, globToRegExp, isPromptProsePath, PROMPT_PROSE_DIRS };
