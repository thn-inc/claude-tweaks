'use strict';

// A fixture home for spawned children: os.homedir() reads USERPROFILE on
// Windows, so both are set; CLAUDE_CONFIG_DIR is dropped so the developer's
// own config dir cannot redirect the transcript lookup away from the fixture.
// Returns a new object; `base` is never mutated.
function fixtureHomeEnv(home, base = process.env) {
  const { CLAUDE_CONFIG_DIR, ...rest } = base;
  return { ...rest, HOME: home, USERPROFILE: home };
}

module.exports = { fixtureHomeEnv };
