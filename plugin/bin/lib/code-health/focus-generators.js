'use strict';

// focus-generators.js — the framework's focus-vertical registry: focus value
// -> generator function returning the rich
// `{ candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason? }`
// shape, so SKILL.md's zero-candidates report (IL-115) works uniformly
// regardless of which focus fired.
//
// This is shared cross-vertical framework machinery (see `skills/code-health/
// focus-mode.md`'s "Known values" section and the parent design doc), not
// owned by any single vertical's own module. It previously lived inside
// `candidates-dead-code.js`, which reversed the framework->vertical
// dependency direction for every future vertical that would have had to
// require a sibling vertical's file just to reach the shared registry
// (review finding, `docs/plans/2026-08-09-code-health-focus-mode-dead-code-
// ledger.md` item #6). Each vertical now registers its own generator here
// instead — `dead-code` (`candidates-dead-code.js`) is the only entry that
// ships today; the other three verticals named in the parent design doc's
// Non-Goals (test-hygiene, abstraction-police, experiment-cleanup) add their
// own key via `registerGenerator` rather than inventing a second registry.

const FOCUS_GENERATORS = {};

// Registers `fn` under `name` in the shared registry. A vertical calls this
// once at require-time with its own generator function — see
// `candidates-dead-code.js`'s `registerGenerator('dead-code', scanDeadCode)`
// call for the shipped example.
function registerGenerator(name, fn) {
  FOCUS_GENERATORS[name] = fn;
}

module.exports = { FOCUS_GENERATORS, registerGenerator };

// Autoload every known vertical so a consumer that requires only this file
// (e.g. `skills/code-health/focus-mode.md`'s F1/"Known values" `node -e`
// snippets) gets a fully-populated registry without also having to know
// which vertical file(s) to require first. Placed after `module.exports`
// above so the circular require back from each vertical (`registerGenerator`
// from `./focus-generators`) resolves against the already-assigned exports
// rather than an empty in-progress object — `FOCUS_GENERATORS` is mutated in
// place either way, so this works regardless of which of the two files a
// caller requires first. Each new vertical adds one require line here
// alongside its own `registerGenerator` call in its own file.
require('./candidates-dead-code');
require('./candidates-abstraction-police');
require('./candidates-test-hygiene');
require('./candidates-experiment-cleanup');
require('./candidates-security-hardening');
