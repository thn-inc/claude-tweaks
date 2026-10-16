## Staged: Archive clean pipeline run directories

Finding: [git] 17 run dirs report run-state status clean but were never moved under .claude-tweaks/pipelines/archive/ (bin/residue.js kind: pipeline-run). Excluded: 2026-10-15T085915-sweep-standalone (still holds unapproved staged items) and record-3070 / record-3111 / record-3129 runs (their PRs #3151 / #3186 / #3209 are still open).
Proposed: archive each per wrap-up/cleanup-procedures.md Section B.

Commands:
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-01T073046-release-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-01T210227-record-2768
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-03T095429-record-2762
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-04T144339-record-2840
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-04T180137-dispatch-standalone-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-05T023815-backlog-refine-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T124038-dispatch-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T153100-specify-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T153353-backlog-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T154440-backlog-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T160702-backlog-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T165603-dispatch-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T165612-dispatch-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T165702-dispatch-standalone
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T165908-record-3071
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-15T171116-record-3130
node "$CLAUDE_PLUGIN_ROOT/bin/hooks.js" archive-run --run .claude-tweaks/pipelines/2026-10-16T055157-dispatch-standalone
