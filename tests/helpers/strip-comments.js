'use strict';
// Shared literal-aware comment stripper for the source-scan conformance tests
// (#3536, #3585). The tests that call it per file, by test-file stem: `backfill-cli`,
// `cli`, `exit-code`, `git-status-optional-locks`, `hooks-harness-refusal`, `owner-pid-probe`,
// `path-containment`, `path-guard`, `phase-exit-call-sites`, `porcelain-cwd-compare`, `raw-markdown-read`, `run-liveness-callers`, `staged-id-producers`,
// `subprocess-timing`, `wall-clock-budget` and `windows-hide-spawn`. tests/strip-comments-callers-twin.test.js
// pins this list to the tree. `raw-markdown-read` and `wall-clock-budget` (#3491) also
// call it in `literals: 'blank'` mode. The implementation lives in
// plugin/bin/lib/strip-comments.js (#3903) so plugin code can call the same scanner;
// this file re-exports it so every test caller keeps its `./helpers/strip-comments`
// import path. Fix a stripper defect there and add its planted case to
// tests/helpers-strip-comments.test.js.
module.exports = require('../../plugin/bin/lib/strip-comments');
