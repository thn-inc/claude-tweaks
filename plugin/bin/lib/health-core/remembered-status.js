'use strict';
const { DEFAULT_IO } = require('./io');

// Minimal `status` command for a health-sweep CLI that writes the durable
// `remembered` cache tier (sub-threshold findings held back rather than
// filed — see each domain's cache.js `includeRemembered` flag) but, unlike
// code-health, has no existing `status` subcommand of its own. #239 found
// harness-health and docs-health writing `remembered` every firing with
// zero readers anywhere — not even the narrow informational count
// code-health's own `status` command already exposes. This gives them the
// same narrow-but-real consumer rather than leaving the write orphaned.
//
// Deliberately does not replicate code-health's full `status` (open/
// regressed/closed counts, the `--fail-on` CI gate) — that machinery reads
// the *local* gitignored cache's per-fingerprint `status` field, which is a
// code-health-specific vocabulary this module has no business assuming.
// This command only ever reports the durable `remembered` count.
function makeCmdStatus({ readDurableState, io = DEFAULT_IO }) {
  return function cmdStatus(args) {
    const root = (args && args.root) || io.cwd();
    const remembered = Object.keys(readDurableState(root).remembered).length;
    io.stdout(`remembered:${remembered}\n`);
    return 0;
  };
}

module.exports = { makeCmdStatus };
