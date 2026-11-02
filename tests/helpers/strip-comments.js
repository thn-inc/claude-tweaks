'use strict';
// Shared literal-aware comment stripper for the source-scan conformance tests
// (#3536, #3585). The tests that call it per file, by test-file stem: `accept-label-reader`, `backfill-cli`,
// `cli`, `exit-code`, `gh-host-seam`, `git-status-optional-locks`, `hooks-harness-refusal`, `hooks-pre-tool-use`, `markdown-blocks`, `owner-pid-probe`,
// `path-containment`, `path-guard`, `phase-exit`, `phase-exit-call-sites`, `porcelain-cwd-compare`, `post-merge`, `precondition`, `raw-markdown-read`, `run-liveness-callers`, `staged-id-producers`,
// `subprocess-timing`, `wall-clock-budget` and `windows-hide-spawn`. tests/strip-comments-callers-twin.test.js
// pins this list to the tree. `raw-markdown-read` and `wall-clock-budget` (#3491),
// `gh-host-seam` (#4505), `hooks-pre-tool-use` (#4578), `phase-exit` (#4578) and
// `run-liveness-callers` also call it in `literals: 'blank'` mode. The implementation
// lives in plugin/bin/lib/strip-comments.js (#3903) so plugin code can call the same
// scanner; this file re-exports `stripComments` from it, so every test caller keeps its
// `./helpers/strip-comments` import path, and itself defines `stripperVerdict`, the
// compile oracle that only the tests use and the plugin payload does not ship (#4648).
// Fix a stripper defect in the implementation and add its planted case to
// tests/helpers-strip-comments.test.js.
const vm = require('node:vm');
const { stripComments } = require('../../plugin/bin/lib/strip-comments');

// Does `src` compile as a CommonJS module body? The wrapper matches how Node
// compiles a required file, so a hashbang and a top-level `return` are both valid.
// vm.Script compiles without running; a SyntaxError means "does not compile".
function compiles(src) {
  try {
    new vm.Script(
      '(function (exports, require, module, __filename, __dirname) {' + src.replace(/^#![^\n]*/, '') + '\n})',
    );
    return true;
  } catch (e) {
    if (e.name === 'SyntaxError') return false;
    throw e;
  }
}

// 'unparseable': the raw file does not compile, so no stripper verdict applies.
// 'misparsed': the raw file compiles but the stripped text does not, so the
// stripper blanked live code. 'ok': neither.
function stripperVerdict(raw, stripped = stripComments(raw)) {
  if (!compiles(raw)) return 'unparseable';
  if (!compiles(stripped)) return 'misparsed';
  return 'ok';
}

const STRIPPER_VERDICT_MESSAGES = {
  misparsed:
    'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned — see tests/helpers/strip-comments.js',
  unparseable:
    'this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it — see tests/helpers/strip-comments.js',
};

module.exports = { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES };
