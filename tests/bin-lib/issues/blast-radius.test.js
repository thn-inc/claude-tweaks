'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyDiffFiles, blastRadiusSummary, globToRegExp } = require('../../../plugin/bin/lib/issues/blast-radius');

test('classifyDiffFiles marks files under a tests/ directory as isTest', () => {
  const files = [{ path: 'bin/lib/issues/tests/grouping.test.js', additions: 38, deletions: 1 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isTest, true);
});

test('classifyDiffFiles marks .test.js files as isTest even outside a tests/ directory', () => {
  const files = [{ path: 'src/widget.test.js', additions: 10, deletions: 0 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isTest, true);
});

test('classifyDiffFiles marks ordinary implementation files as not isTest', () => {
  const files = [{ path: 'bin/lib/issues/grouping.js', additions: 28, deletions: 5 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isTest, false);
});

test('classifyDiffFiles marks a file matching merge-sensitive-paths as isSensitive', () => {
  const files = [{ path: 'bin/hooks.js', additions: 3, deletions: 1 }];
  const result = classifyDiffFiles(files, ['bin/hooks.js', 'skills/_shared/*.md']);
  assert.strictEqual(result[0].isSensitive, true);
});

test('classifyDiffFiles matches a glob-style sensitive path against a nested file', () => {
  const files = [{ path: 'skills/_shared/work-record.md', additions: 2, deletions: 0 }];
  const result = classifyDiffFiles(files, ['skills/_shared/*.md']);
  assert.strictEqual(result[0].isSensitive, true);
});

test('classifyDiffFiles marks a file not matching any sensitive path as not isSensitive', () => {
  const files = [{ path: 'bin/lib/issues/grouping.js', additions: 28, deletions: 5 }];
  const result = classifyDiffFiles(files, ['bin/hooks.js']);
  assert.strictEqual(result[0].isSensitive, false);
});

test('classifyDiffFiles defaults sensitivePaths to an empty list when omitted', () => {
  const files = [{ path: 'bin/hooks.js', additions: 1, deletions: 0 }];
  const result = classifyDiffFiles(files);
  assert.strictEqual(result[0].isSensitive, false);
});

// --- #18: broader test-path recognition across ecosystems ---

test('classifyDiffFiles recognizes Java/Gradle\'s singular src/test/java/... convention as isTest', () => {
  const files = [{ path: 'src/test/java/com/example/FooTest.java', additions: 100, deletions: 0 }];
  assert.strictEqual(classifyDiffFiles(files, [])[0].isTest, true);
});

test('classifyDiffFiles recognizes Go\'s _test.go suffix as isTest', () => {
  const files = [{ path: 'pkg/foo_test.go', additions: 20, deletions: 0 }];
  assert.strictEqual(classifyDiffFiles(files, [])[0].isTest, true);
});

test('classifyDiffFiles recognizes Python\'s test_*.py and *_test.py conventions as isTest', () => {
  assert.strictEqual(classifyDiffFiles([{ path: 'tests/test_foo.py', additions: 1, deletions: 0 }], [])[0].isTest, true);
  assert.strictEqual(classifyDiffFiles([{ path: 'pkg/foo_test.py', additions: 1, deletions: 0 }], [])[0].isTest, true);
  assert.strictEqual(classifyDiffFiles([{ path: 'test_bare.py', additions: 1, deletions: 0 }], [])[0].isTest, true);
});

test('classifyDiffFiles recognizes .spec.ts/.test.tsx TypeScript suffixes as isTest', () => {
  assert.strictEqual(classifyDiffFiles([{ path: 'src/widget.spec.ts', additions: 1, deletions: 0 }], [])[0].isTest, true);
  assert.strictEqual(classifyDiffFiles([{ path: 'src/widget.test.tsx', additions: 1, deletions: 0 }], [])[0].isTest, true);
});

test('classifyDiffFiles does not false-positive on a path merely containing "test" as a substring', () => {
  assert.strictEqual(classifyDiffFiles([{ path: 'src/latest/widget.js', additions: 1, deletions: 0 }], [])[0].isTest, false);
  assert.strictEqual(classifyDiffFiles([{ path: 'src/contest.js', additions: 1, deletions: 0 }], [])[0].isTest, false);
});

// --- #9: '?' in a sensitive-path glob must be a literal character ---

test('a literal "?" in a sensitive-path glob does not act as a regex "optional preceding character" quantifier', () => {
  // Before the fix, '?' was unescaped regex syntax: 'skills/foo?/file.md'
  // would match paths WITHOUT the '?' character too (the preceding char
  // becomes optional), even though a maintainer writing '?' into config
  // almost certainly means it as a literal (as '*' and '?' both are in this
  // codebase's own shell-glob conventions elsewhere).
  const files = [{ path: 'skills/foo/file.md', additions: 1, deletions: 0 }];
  const result = classifyDiffFiles(files, ['skills/foo?/file.md']);
  assert.strictEqual(result[0].isSensitive, false, 'must not match a path missing the literal "?" character');
});

test('a sensitive-path glob containing a literal "?" still matches a path that actually has that character', () => {
  const files = [{ path: 'skills/foo?/file.md', additions: 1, deletions: 0 }];
  const result = classifyDiffFiles(files, ['skills/foo?/file.md']);
  assert.strictEqual(result[0].isSensitive, true);
});

// --- #14: glob->RegExp compilation is memoized, not redone per file ---

test('the same sensitive-path glob is compiled to a RegExp only once, reused across multiple files, not recompiled per file', () => {
  const originalRegExp = global.RegExp;
  let compileCount = 0;
  class CountingRegExp extends originalRegExp {
    constructor(...args) {
      super(...args);
      compileCount += 1;
    }
  }
  global.RegExp = CountingRegExp;
  // A glob string unique to this test (not reused by any other test in this
  // file) — globToRegExp's memoization cache is module-level and persists
  // across tests/requires, so reusing an already-seen glob here would find
  // it pre-cached from an earlier test and report a false compileCount of 0
  // regardless of whether the fix works.
  const uniqueGlob = 'skills/_only-this-test-uses-me/*.md';
  let files;
  try {
    files = classifyDiffFiles(
      [
        { path: 'skills/_only-this-test-uses-me/a.md', additions: 1, deletions: 0 },
        { path: 'skills/_only-this-test-uses-me/b.md', additions: 1, deletions: 0 },
        { path: 'skills/_only-this-test-uses-me/c.md', additions: 1, deletions: 0 },
      ],
      [uniqueGlob],
    );
  } finally {
    global.RegExp = originalRegExp;
  }
  assert.strictEqual(compileCount, 1, 'the same glob must be compiled to a RegExp exactly once across the whole file batch, not once per file');
  assert.ok(files.every((f) => f.isSensitive), 'sanity check: memoization must not have broken correctness');
});

test('blastRadiusSummary sums impl and test lines separately, #18-shaped fixture', () => {
  const classified = classifyDiffFiles(
    [
      { path: 'bin/lib/issues/grouping.js', additions: 28, deletions: 5 },
      { path: 'bin/lib/issues/tests/grouping.test.js', additions: 38, deletions: 1 },
    ],
    [],
  );
  assert.deepStrictEqual(blastRadiusSummary(classified), {
    implLines: 33,
    testLines: 39,
    implFiles: 1,
    testFiles: 1,
    pipelineArtifactLines: 0,
    pipelineArtifactFiles: 0,
    sensitiveFilesTouched: [],
  });
});

test('blastRadiusSummary lists sensitiveFilesTouched by path', () => {
  const classified = classifyDiffFiles(
    [{ path: 'bin/hooks.js', additions: 3, deletions: 1 }],
    ['bin/hooks.js'],
  );
  assert.deepStrictEqual(blastRadiusSummary(classified).sensitiveFilesTouched, ['bin/hooks.js']);
});

test('blastRadiusSummary returns all-zero summary for an empty file list', () => {
  assert.deepStrictEqual(blastRadiusSummary([]), {
    implLines: 0,
    testLines: 0,
    implFiles: 0,
    testFiles: 0,
    pipelineArtifactLines: 0,
    pipelineArtifactFiles: 0,
    sensitiveFilesTouched: [],
  });
});

// --- #727: '**' must cross path segments; '*' must not ---

test('a "skills/**" sensitive path matches nested files several segments deep', () => {
  const files = [
    { path: 'skills/backlog/overview-mode.md', additions: 1, deletions: 0 },
    { path: 'bin/lib/issues/record.js', additions: 1, deletions: 0 },
  ];
  const result = classifyDiffFiles(files, ['skills/**', 'bin/**']);
  assert.strictEqual(result[0].isSensitive, true, 'skills/** must cross the backlog/ segment');
  assert.strictEqual(result[1].isSensitive, true, 'bin/** must cross lib/issues/');
});

test('a trailing "/**" also matches the bare parent path itself', () => {
  const result = classifyDiffFiles([{ path: 'skills', additions: 1, deletions: 0 }], ['skills/**']);
  assert.strictEqual(result[0].isSensitive, true);
});

test('"bin/lib/hooks/**" matches arbitrarily deep descendants', () => {
  const result = classifyDiffFiles([{ path: 'bin/lib/hooks/deep/x.js', additions: 1, deletions: 0 }], ['bin/lib/hooks/**']);
  assert.strictEqual(result[0].isSensitive, true);
});

test('"src/**/*.test.js" matches nested tests at any depth, including zero intermediate segments', () => {
  const nested = classifyDiffFiles([{ path: 'src/a/b/widget.test.js', additions: 1, deletions: 0 }], ['src/**/*.test.js']);
  const flat = classifyDiffFiles([{ path: 'src/widget.test.js', additions: 1, deletions: 0 }], ['src/**/*.test.js']);
  assert.strictEqual(nested[0].isSensitive, true);
  assert.strictEqual(flat[0].isSensitive, true);
});

test('the merge-sensitive-paths shape "src/auth/**" trips on a nested file while "src/auth/*" still does not', () => {
  const doubled = classifyDiffFiles([{ path: 'src/auth/session/token.ts', additions: 1, deletions: 0 }], ['src/auth/**']);
  const single = classifyDiffFiles([{ path: 'src/auth/session/token.ts', additions: 1, deletions: 0 }], ['src/auth/*']);
  assert.strictEqual(doubled[0].isSensitive, true, 'src/auth/** must cross the session/ segment');
  assert.strictEqual(single[0].isSensitive, false, 'single * must stay segment-bound');
});

test('single "*" still does not cross a path segment', () => {
  const result = classifyDiffFiles([{ path: 'skills/backlog/overview-mode.md', additions: 1, deletions: 0 }], ['skills/*']);
  assert.strictEqual(result[0].isSensitive, false);
});

// --- #1906: pipeline-artifact paths (materialized spec + writing-plans doc)
// excluded from impl counting ---

test('classifyDiffFiles marks a materialized spec path (single-record shape) as isPipelineArtifact', () => {
  const files = [{ path: '.claude-tweaks/pipelines/2026-09-08T041856-record-1906/work/1906-spec.md', additions: 39, deletions: 0 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isPipelineArtifact, true);
});

test('classifyDiffFiles marks a materialized spec path (multi-record shape) as isPipelineArtifact', () => {
  const files = [{ path: '.claude-tweaks/pipelines/2026-09-08T041856-spec-1-2/spec-1/work/1-spec.md', additions: 20, deletions: 0 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isPipelineArtifact, true);
});

test('classifyDiffFiles marks a writing-plans doc path as isPipelineArtifact', () => {
  const files = [{ path: 'docs/superpowers/plans/2026-09-08-some-feature.md', additions: 111, deletions: 0 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isPipelineArtifact, true);
});

test('classifyDiffFiles marks an ordinary docs file outside plans/ as not isPipelineArtifact', () => {
  const files = [{ path: 'docs/README.md', additions: 5, deletions: 0 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isPipelineArtifact, false);
});

test('classifyDiffFiles marks an ordinary implementation file as not isPipelineArtifact', () => {
  const files = [{ path: 'bin/lib/issues/grouping.js', additions: 28, deletions: 5 }];
  const result = classifyDiffFiles(files, []);
  assert.strictEqual(result[0].isPipelineArtifact, false);
});

test('blastRadiusSummary routes pipeline-artifact files into pipelineArtifactLines/pipelineArtifactFiles, not impl (#1906 AC-1: spec + plan doc only, no real code)', () => {
  const classified = classifyDiffFiles(
    [
      { path: '.claude-tweaks/pipelines/2026-09-08T041856-record-1906/work/1906-spec.md', additions: 39, deletions: 0 },
      { path: 'docs/superpowers/plans/2026-09-08-blast-radius-pipeline-artifact-exclusion.md', additions: 111, deletions: 0 },
    ],
    [],
  );
  assert.deepStrictEqual(blastRadiusSummary(classified), {
    implLines: 0,
    testLines: 0,
    implFiles: 0,
    testFiles: 0,
    pipelineArtifactLines: 150,
    pipelineArtifactFiles: 2,
    sensitiveFilesTouched: [],
  });
});

test('blastRadiusSummary separates a mixed diff: one pipeline-artifact path plus one ordinary impl file', () => {
  const classified = classifyDiffFiles(
    [
      { path: '.claude-tweaks/pipelines/2026-09-08T041856-record-1906/work/1906-spec.md', additions: 39, deletions: 0 },
      { path: 'plugin/bin/lib/issues/blast-radius.js', additions: 20, deletions: 3 },
    ],
    [],
  );
  const summary = blastRadiusSummary(classified);
  assert.strictEqual(summary.implLines, 23);
  assert.strictEqual(summary.implFiles, 1);
  assert.strictEqual(summary.pipelineArtifactLines, 39);
  assert.strictEqual(summary.pipelineArtifactFiles, 1);
});

test('globToRegExp is exported so the verify scope engine can reuse the one matcher (#1922)', () => {
  assert.strictEqual(typeof globToRegExp, 'function');
  assert.ok(globToRegExp('docs/**/*.md').test('docs/a/b/c.md'));
  assert.ok(!globToRegExp('docs/**/*.md').test('src/a.md'));
  assert.ok(globToRegExp('apps/api/**').test('apps/api'));
  assert.ok(globToRegExp('apps/api/**').test('apps/api/src/a.ts'));
  assert.ok(!globToRegExp('apps/*/x.ts').test('apps/a/b/x.ts'));
});
