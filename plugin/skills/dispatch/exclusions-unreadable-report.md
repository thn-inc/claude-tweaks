# Dispatch Step 3 — Unreadable Exclusions Report (`#N` form)

Referenced by `skills/dispatch/SKILL.md` Step 3's `#N` bullet (#3104). Read it only when a named
record clears the label checks, is absent from `dispatch-groups.json`, and has no
`dispatch-exclusions.json` entry naming it. That is the one case where "absent from this firing's
queue" would otherwise be reported.

`readExclusions` returns `[]` both when the file is missing and when it is corrupt, unreadable or
not a JSON array. An empty read therefore cannot tell "nothing excluded this record" from "the
list that would say why could not be read". Probe the file's status first, as one line.
`$DISPATCH_EXCLUSIONS` is the session-scoped path `queue-pull-script.md` resolved. In a fresh shell,
re-resolve it the same way that script does, never by guessing a path.

```bash
node -e "console.log(JSON.stringify(require(process.argv[1]).readExclusionsStatus(process.argv[2])))" "${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js" "$DISPATCH_EXCLUSIONS"
```

- `status: "ok"` or `status: "absent"`: the file was read (or never written this firing), so the
  record really has no exclusion entry. Report it as absent from this firing's queue, as the `#N`
  bullet says.
- `status: "unreadable"`: report

  `#{N} — exclusion reason unknown: this firing's dispatch-exclusions.json could not be read ({error}). Re-run the queue pull (Step 2), then name #{N} again.`

  and stop; never report it as absent from this firing's queue: a record the queue pull really
  excluded (e.g. `not-spec-shaped`) would read as merely missing, which is the misreport class
  #3084 removed.
