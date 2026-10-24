# Open Items — reflect's integration-branch probe reads a failed fetch or git grep error as "content absent" (#4069)

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | `-e '{phrase}'` assertion in tests/reflect-integration-branch-probe.test.js duplicates the full grep-command pin, so it is not an independent discriminator for `-e` | deferred | origin: SDD task review (minor); files: tests/reflect-integration-branch-probe.test.js; trigger: revisit if the full grep-command assertion is ever loosened |
| 2 | build | Probe prose's "exits other than 0 or 1" admits exit 1 for `git log -S`, which never exits 1 in normal operation (harmless) | deferred | origin: SDD scoped re-review (out-of-scope minor); files: plugin/skills/reflect/SKILL.md; trigger: revisit if the probe paragraph's exit-code rule is reworded |
| 3 | build | SDD ruling — Task 1 minor (empty `git log -S` result unstated) taken into one fix round under the deferral gate's fix-now test: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | |
