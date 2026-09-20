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
// Both anchored to a '/' or string boundary so a path merely CONTAINING
// "test" as a substring (e.g. 'src/latest/widget.js', 'src/contest.js')
// never false-positives.
const TEST_PATH_RE = /(^|\/)tests?\//;
const TEST_SUFFIX_RE = /\.(test|spec)\.(jsx?|tsx?)$|_test\.go$|(^|\/)test_[^/]+\.py$|[^/]+_test\.py$/;

function isTestPath(path) {
  return TEST_PATH_RE.test(path) || TEST_SUFFIX_RE.test(path);
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

module.exports = { classifyDiffFiles, blastRadiusSummary, isSensitivePath, globToRegExp };
