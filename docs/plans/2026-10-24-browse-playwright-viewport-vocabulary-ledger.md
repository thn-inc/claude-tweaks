# Open Items — browse: replace the retired backend's `set viewport`/`set device` vocabulary with playwright-cli forms

| # | Phase | Item | Status | Resolution |
|---|-------|------|--------|------------|
| 1 | build | SDD task-review minor: `plugin/skills/browse/SKILL.md:44` device example writes "iPhone 15" while `playwright-cli --help open`'s example is lowercase "iphone 15" | observation | Controller checked: the CLI's bundled self-docs ("Open parameters") write `--device="iPhone 15"`, so the casing matches upstream docs; not a defect. SDD `minor (deferred)` line, recorded as observation rather than a staged deferral |
| 2 | build | SDD task-review minor: `plugin/skills/browse/playwright-cli-reference.md:76` cites the bundled self-docs' "Open parameters" section, which the reviewer could not verify from the diff | observation | Controller verified the section exists and shows `playwright-cli open --device="iPhone 15"`; the row already says "not spike-tested" |
