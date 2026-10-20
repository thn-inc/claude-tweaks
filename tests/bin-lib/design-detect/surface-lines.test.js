// tests/bin-lib/design-detect/surface-lines.test.js — pins the design-surface
// gate classifier (skills/design-wrapper/modes/review.md Step 3.8 (b),
// #1863): whether a unified diff touched JSX/TSX markup, a className/style
// attribute, a rendered text node, or any line in a style/template file.
// Fixture-only diffs — never a real repo's live git diff (IL-80's
// fixture-not-live-corpus rule).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const sl = require('../../../plugin/bin/lib/design-detect/surface-lines');

// --- classifyFileKind ---

test('classifyFileKind: style extensions', () => {
  for (const f of ['a.css', 'a.scss', 'a.sass', 'a.less']) {
    assert.equal(sl.classifyFileKind(f), 'style');
  }
});
test('classifyFileKind: template extensions', () => {
  for (const f of ['a.html', 'a.vue', 'a.svelte']) {
    assert.equal(sl.classifyFileKind(f), 'template');
  }
});
test('classifyFileKind: jsx extensions', () => {
  assert.equal(sl.classifyFileKind('a.jsx'), 'jsx');
  assert.equal(sl.classifyFileKind('a.tsx'), 'jsx');
});
test('classifyFileKind: .module.* filename is style regardless of extension', () => {
  assert.equal(sl.classifyFileKind('Button.module.css'), 'style');
  assert.equal(sl.classifyFileKind('Button.module.ts'), 'style');
});
test('classifyFileKind: other extensions', () => {
  assert.equal(sl.classifyFileKind('a.ts'), 'other');
  assert.equal(sl.classifyFileKind('a.js'), 'other');
  assert.equal(sl.classifyFileKind('a.py'), 'other');
});

// --- lineHasJsxSurface ---

test('lineHasJsxSurface: html tag is surface', () => {
  assert.equal(sl.lineHasJsxSurface('  return <div>Hello</div>;'), true);
});
test('lineHasJsxSurface: component tag is surface', () => {
  assert.equal(sl.lineHasJsxSurface('  return <Button onClick={onClick} />;'), true);
});
test('lineHasJsxSurface: className attribute is surface', () => {
  assert.equal(sl.lineHasJsxSurface('    <div className="card">'), true);
});
test('lineHasJsxSurface: style attribute is surface', () => {
  assert.equal(sl.lineHasJsxSurface('    <div style={{ color: "red" }}>'), true);
});
test('lineHasJsxSurface: JSX fragment is surface', () => {
  assert.equal(sl.lineHasJsxSurface('  return <>'), true);
});
test('lineHasJsxSurface: rendered text node is surface', () => {
  assert.equal(sl.lineHasJsxSurface('  <p>Save changes</p>'), true);
});
test('lineHasJsxSurface: import statement is not surface', () => {
  assert.equal(sl.lineHasJsxSurface("import { useEffect } from 'react';"), false);
});
test('lineHasJsxSurface: hook call is not surface', () => {
  assert.equal(sl.lineHasJsxSurface('  const [data, setData] = useState(null);'), false);
});
test('lineHasJsxSurface: fetch call is not surface', () => {
  assert.equal(sl.lineHasJsxSurface("  const res = await fetch('/api/data');"), false);
});
test('lineHasJsxSurface: plain conditional is not surface', () => {
  assert.equal(sl.lineHasJsxSurface('  if (loading) return null;'), false);
});
test('lineHasJsxSurface: generic type parameter is not surface (Array<string>)', () => {
  assert.equal(sl.lineHasJsxSurface('  const items: Array<string> = [];'), false);
});
test('lineHasJsxSurface: generic hook with type parameter is not surface', () => {
  assert.equal(sl.lineHasJsxSurface('  const ref = useRef<HTMLDivElement>(null);'), false);
});

// --- isSurfaceLine ---

test('isSurfaceLine: any line in a style file is surface', () => {
  assert.equal(sl.isSurfaceLine('.card { color: red; }', 'style'), true);
});
test('isSurfaceLine: any line in a template file is surface', () => {
  assert.equal(sl.isSurfaceLine('<div>x</div>', 'template'), true);
});
test('isSurfaceLine: jsx kind defers to lineHasJsxSurface', () => {
  assert.equal(sl.isSurfaceLine('  const x = 1;', 'jsx'), false);
  assert.equal(sl.isSurfaceLine('  <div>x</div>', 'jsx'), true);
});
test('isSurfaceLine: other kind is never surface', () => {
  assert.equal(sl.isSurfaceLine('  const x = 1;', 'other'), false);
});

// --- analyzeDiff / hasSurfaceChange ---

const CONTROL_FLOW_ONLY_DIFF = `diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx
index 1111111..2222222 100644
--- a/src/components/Widget.tsx
+++ b/src/components/Widget.tsx
@@ -10,7 +10,7 @@ export function Widget() {
-  const res = await fetch('/api/widget');
+  const res = await fetch('/api/widget', { cache: 'no-store' });
@@ -20,3 +20,5 @@ export function Widget() {
-  return data;
+  if (!data) return null;
+  return data;
`;

const JSX_ATTR_DIFF = `diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx
index 1111111..2222222 100644
--- a/src/components/Widget.tsx
+++ b/src/components/Widget.tsx
@@ -30,3 +30,3 @@ export function Widget() {
-  <div className="widget">
+  <div className="widget widget--active">
`;

const STYLE_ONLY_DIFF = `diff --git a/src/components/Widget.module.css b/src/components/Widget.module.css
index 1111111..2222222 100644
--- a/src/components/Widget.module.css
+++ b/src/components/Widget.module.css
@@ -1,3 +1,3 @@
-.widget { padding: 8px; }
+.widget { padding: 12px; }
`;

test('analyzeDiff: control-flow-only .tsx diff has no surface files', () => {
  const files = sl.analyzeDiff(CONTROL_FLOW_ONLY_DIFF);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/components/Widget.tsx');
  assert.equal(files[0].kind, 'jsx');
  assert.equal(files[0].surface, false);
  assert.equal(files[0].changedLines, 5);
});
test('hasSurfaceChange: control-flow-only diff is false', () => {
  assert.equal(sl.hasSurfaceChange(CONTROL_FLOW_ONLY_DIFF), false);
});

test('analyzeDiff: a JSX attribute change marks the file as surface', () => {
  const files = sl.analyzeDiff(JSX_ATTR_DIFF);
  assert.equal(files[0].surface, true);
});
test('hasSurfaceChange: JSX attribute change is true', () => {
  assert.equal(sl.hasSurfaceChange(JSX_ATTR_DIFF), true);
});

test('analyzeDiff: a style-only diff is surface regardless of line content', () => {
  const files = sl.analyzeDiff(STYLE_ONLY_DIFF);
  assert.equal(files[0].kind, 'style');
  assert.equal(files[0].surface, true);
});
test('hasSurfaceChange: style-only diff is true', () => {
  assert.equal(sl.hasSurfaceChange(STYLE_ONLY_DIFF), true);
});

test('analyzeDiff: multi-file diff — surface true if any file is surface', () => {
  const combined = CONTROL_FLOW_ONLY_DIFF + JSX_ATTR_DIFF.replaceAll('Widget.tsx', 'Other.tsx');
  const files = sl.analyzeDiff(combined);
  assert.equal(files.length, 2);
  assert.equal(files[0].surface, false);
  assert.equal(files[1].surface, true);
  assert.equal(sl.hasSurfaceChange(combined), true);
});

test('analyzeDiff: empty diff yields no files and hasSurfaceChange is false', () => {
  assert.deepEqual(sl.analyzeDiff(''), []);
  assert.equal(sl.hasSurfaceChange(''), false);
});
test('analyzeDiff: non-string input degrades to empty rather than throwing', () => {
  assert.deepEqual(sl.analyzeDiff(undefined), []);
  assert.deepEqual(sl.analyzeDiff(null), []);
});

const TRIPLE_CHAR_CONTENT_DIFF = `diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx
index 1111111..2222222 100644
--- a/src/components/Widget.tsx
+++ b/src/components/Widget.tsx
@@ -10,3 +10,4 @@ export function Widget() {
+++counter;
+  return <div className="widget">{counter}</div>;
---marker;
`;

test('analyzeDiff: a content line starting with +++ or --- is counted, not mistaken for a header', () => {
  const files = sl.analyzeDiff(TRIPLE_CHAR_CONTENT_DIFF);
  assert.equal(files.length, 1);
  assert.equal(files[0].changedLines, 3);
  assert.equal(files[0].surface, true);
});

const QUOTED_HEADER_LOOKALIKE_DIFF = `diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx
index 1111111..2222222 100644
--- a/src/components/Widget.tsx
+++ b/src/components/Widget.tsx
@@ -10,2 +10,3 @@ export function Widget() {
+++ "b/src/evil.css"
+  return <div className="widget">{counter}</div>;
`;

test('analyzeDiff: a hunk line shaped like a quoted +++ header is counted as content and opens no phantom file', () => {
  const files = sl.analyzeDiff(QUOTED_HEADER_LOOKALIKE_DIFF);
  assert.deepEqual(files.map((f) => f.file), ['src/components/Widget.tsx']);
  assert.equal(files[0].changedLines, 2);
  assert.equal(files[0].surface, true);
});

test('analyzeDiff: a non-jsx/style/template file (.ts) is never surface', () => {
  const diff = `diff --git a/src/hooks/useWidget.ts b/src/hooks/useWidget.ts
index 1111111..2222222 100644
--- a/src/hooks/useWidget.ts
+++ b/src/hooks/useWidget.ts
@@ -1,2 +1,2 @@
-export function useWidget() { return 1; }
+export function useWidget() { return 2; }
`;
  const files = sl.analyzeDiff(diff);
  assert.equal(files[0].kind, 'other');
  assert.equal(files[0].surface, false);
  assert.equal(sl.hasSurfaceChange(diff), false);
});

// --- patch-header path decoding (#3651) ---
// git C-quotes a header path holding non-ASCII bytes (core.quotepath on) or a
// control character; analyzeDiff must name the raw path, not drop the file.

test('characterization: an unquoted header with a space in the path keeps the greedy match', () => {
  const files = sl.analyzeDiff('diff --git a/src/my comp.tsx b/src/my comp.tsx\n--- a/src/my comp.tsx\n+++ b/src/my comp.tsx\n@@ -1 +1 @@\n-<div className="a" />\n+<div className="b" />\n');
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/my comp.tsx');
  assert.equal(files[0].surface, true);
});

test('characterization: a +++ header alone (no diff --git line) names the file; +++ /dev/null does not', () => {
  const files = sl.analyzeDiff('--- a/src/x.css\n+++ b/src/x.css\n@@ -1 +1 @@\n-a\n+b\n');
  assert.deepEqual(files.map((f) => f.file), ['src/x.css']);
  assert.deepEqual(sl.analyzeDiff('--- a/src/x.css\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n'), []);
});

test('AC1.1: a C-quoted header names the raw path', () => {
  const diff = 'diff --git "a/src/caf\\303\\251.tsx" "b/src/caf\\303\\251.tsx"\n'
    + '--- "a/src/caf\\303\\251.tsx"\n'
    + '+++ "b/src/caf\\303\\251.tsx"\n'
    + '@@ -1 +1 @@\n-<div className="a" />\n+<div className="b" />\n';
  const files = sl.analyzeDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/café.tsx');
  assert.equal(files[0].surface, true);
  assert.equal(sl.hasSurfaceChange(diff), true);
});

test('AC1.1: a C-quoted +++ header alone names the raw path', () => {
  const files = sl.analyzeDiff('--- "a/src/caf\\303\\251.css"\n+++ "b/src/caf\\303\\251.css"\n@@ -1 +1 @@\n-a\n+b\n');
  assert.deepEqual(files.map((f) => f.file), ['src/café.css']);
  assert.equal(files[0].kind, 'style');
});

test('AC1.1: a rename to a non-ASCII name with mixed quoting names the new path', () => {
  const diff = 'diff --git a/src/old.tsx "b/src/n\\303\\251w.tsx"\n'
    + 'similarity index 100%\nrename from src/old.tsx\nrename to "src/n\\303\\251w.tsx"\n'
    + '@@ -1 +1 @@\n-<div className="a" />\n+<div className="b" />\n';
  const files = sl.analyzeDiff(diff);
  assert.equal(files.length, 1);
  assert.equal(files[0].file, 'src/néw.tsx');
  assert.equal(files[0].kind, 'jsx');
  assert.equal(files[0].surface, true);
});

test('AC1.1: a quoted path with an escaped quote and tab decodes via the C escapes', () => {
  const files = sl.analyzeDiff('diff --git "a/src/a\\"b\\tc.css" "b/src/a\\"b\\tc.css"\n@@ -1 +1 @@\n-a\n+b\n');
  assert.deepEqual(files.map((f) => f.file), ['src/a"b\tc.css']);
});
