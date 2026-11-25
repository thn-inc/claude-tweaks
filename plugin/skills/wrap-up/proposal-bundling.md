# Review Console — Proposal Bundling

Referenced by `skills/wrap-up/review-console.md`'s "Proposal bundling" section and `flow/multispec-review-console.md`'s "When to run" list. Staged `leftover-*`, `ledger-record-*` and `review-followup-*` proposals of one class whose Key Files overlap are composed into one `bundle-{n}.md` proposal, so the console files one record instead of N (#6283).

**When.** Once per console — single-spec: the run dir; multi-spec: the parent dir, once, never per spec — before `ledger-narrowing-auto-file.md` and before `console-resolve.js` writes `console.json`. Skip it under `--dry-run`: bundling moves files.

**Records file.** The bundler reads the open backlog, never `gh`. Under `work-backend: github-issues`, refresh the session record snapshot per `_shared/record-queue-fetch.md`'s read-fresh-or-fetch block and pass its path (`bin/lib/issues/record-snapshot.js`'s `snapshotPath`) as `--records-json`; under `work-backend: local-files` pass `--local`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/bundle-proposals.js" --run "{run-dir}" --records-json "{snapshot}" [--ledger "{ledger}"]
```

Pass `--ledger` whenever the run has a ledger, so a bundled `ledger-record-*` member's row is re-pointed (`_shared/ledger-format.md`). stdout is one JSON line, `{ bundles, singletons, skipped }`, paths relative to `--run`. Exit 0 is success, nothing-to-bundle included. Any non-zero exit (2 malformed call, 3 run dir not anchored or a write failed and rolled back, 4 open-backlog records unreadable or empty) bundles nothing. Re-run the identical command once: its start repairs a crashed earlier run's state, so an exit 4 or a stderr saying `ROLLBACK INCOMPLETE` (exit 3) is retried before it is trusted. Only a second non-zero exit logs one Degrade-trace line and carries on filing every proposal individually.

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "{run-dir}" --status SKIP --section "/wrap-up" --step "Proposal bundling" --reversibility n/a --text "condition: bundle-proposals.js exited {code} → fallback: every proposal files individually"
```

**Rendering.** Members are retired from `staged/` into a sibling `bundled/` dir, so a bundle renders as one `Q#` row whose title names the member count, and the members render nowhere. A console Skip that deletes a bundle file keeps its members in `bundled/`; they are not resurrected.

**Override.** `un-bundle {Q#}` (human-present only) runs `node "${CLAUDE_PLUGIN_ROOT}/bin/bundle-proposals.js" --run "{run-dir}" --unbundle bundle-{n}.md` (never with `--ledger`): every member returns to `staged/` with its ledger Resolution, the bundle goes, and the members render as ordinary `Q#` rows. It logs `un-bundled (override)`, and a later bundler pass leaves the members it names as singletons, never re-bundled.

**Failed create or carry.** Under control mode (`console-resolve.js --ceiling` prints `control-mode on` and `consoleAutoResolve true`, `review-console.md`'s "Control mode (#4620)"), a bundle whose create fails, or that is carried, settles every member's ledger row in one call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --set-item bundle-{n}.md --resolution carried --reason '{why}' --ledger "{ledger}" --run "{run-dir}"
```

Outside control mode `console-resolve.js` exits 2 for `carried` and `--ledger`, so do not call it: a failed bundle create follows `refused-proposals.md`'s failed-execution rewrite like any `Q#`. The bundle stays staged and its member rows keep naming `staged/bundle-{n}.md`, which still exists.
