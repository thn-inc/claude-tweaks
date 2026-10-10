# Dispatch Step 3 — Unreadable Exclusions Report (`#N` form)

Referenced by `skills/dispatch/SKILL.md` Step 3's `#N` bullet (#3104). Read it only when a named
record clears the label checks, is absent from `dispatch-groups.json`, and has no
`dispatch-exclusions.json` entry naming it. That is the one case where "absent from this firing's
queue" would otherwise be reported. A `#N,#M` member reaches this file through "named as the `#N`
bullet above names it": a list member hitting this branch is reported the same way while the rest of
the list proceeds.

`readExclusions` returns `[]` both when the file is missing and when it is corrupt, unreadable or
not a JSON array. An empty read therefore cannot tell "nothing excluded this record" from "the
list that would say why could not be read". Probe the file's status first, as one line. It resolves
the session-scoped path itself (the shell variable `queue-pull-script.md` set does not survive into
this call) and prints one JSON object `{path, status, entries, error}`:

```bash
node -e "const r=process.argv[1];const {sessionTmpPath}=require(r+'/bin/lib/session-tmp.js');const os=require('os'),path=require('path');const p=sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID,'dispatch-exclusions.json')||path.join(os.tmpdir(),'dispatch-exclusions.json');console.log(JSON.stringify(Object.assign({path:p},require(r+'/bin/lib/dispatch/exclusions.js').readExclusionsStatus(p))))" "${CLAUDE_PLUGIN_ROOT}"
```

- `status: "ok"`: the file was read, and no entry names the record, so it really has no exclusion
  entry. Report it as absent from this firing's queue, as the `#N` bullet says.
- `status: "absent"` or `status: "unreadable"`: report

  `#{N} — exclusion reason unknown: this firing's dispatch-exclusions.json at {path} {could not be read ({error}) | was not found}. Re-run the queue pull (Step 2), then name #{N} again.`

  and stop; never report it as absent from this firing's queue: a record the queue pull really
  excluded (e.g. `not-spec-shaped`) would read as merely missing, which is the misreport class
  #3084 removed. `absent` is never "nothing excluded" here: Step 2 always writes the file, so a
  missing file at this point means the wrong path or a cleared tmp dir.
