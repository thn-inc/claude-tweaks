# Open Items — Let drift-only upstream-drift entries opt out of the upgrade-available finding

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD minor (Task 1): 'report-upgrades: false validates clean' test passes pre-implementation (unknown key was already ignored) — pins nothing alone | accepted | Final whole-branch review triage: acceptable as the positive control proving the typeof check accepts a real `false`; discrimination is carried by the non-boolean, dead-key and conformance tests (each mutation-proven red). |
| 2 | build | SDD minor (Task 1): non-boolean test omitted a null/empty value | fixed | `null` added to the bad-value list in tools/upstream-drift/tests/manifest.test.js — commit cc3927b7d |
| 3 | build | SDD minor (Task 2): real-manifest test dereferences `dep.upstream['tag-prefix']` without a guard | accepted | Final whole-branch review triage: not a real risk — loadManifest's validateManifest requires `upstream.tag-prefix` on every probe-class entry (manifest.js upstream check) and the test filters to probe-class entries. |
| 4 | build | SDD minor (Task 2): no unit test pinned the cmdDue/hasUpgrade agreement for an opted-out entry | fixed | Opted-out evaluation added to the 'hasUpgrade: due, findings, and the due-report all agree' loop in tools/upstream-drift/tests/run.test.js — commit cc3927b7d |
