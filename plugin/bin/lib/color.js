const ESC = '\x1b[';
const RESET = `${ESC}0m`;

// The env colorEnabled reads by default: process.env, except during a
// withEnv(env, fn) call, which scopes it to an injected env (a CLI's deps.env).
let activeEnv = process.env;

function colorEnabled(env = activeEnv) {
  // Per the NO_COLOR convention (https://no-color.org/), the variable's mere
  // presence suppresses color, regardless of its value — including
  // `NO_COLOR=` (present but empty).
  const noColor = env.NO_COLOR;
  if (noColor !== undefined) return false;
  return true;
}

// Runs fn synchronously with `env` as the default colorEnabled reads, and
// restores the previous one afterwards, even when fn throws.
function withEnv(env, fn) {
  const previous = activeEnv;
  activeEnv = env;
  try {
    return fn();
  } finally {
    activeEnv = previous;
  }
}

function wrap(code, s) {
  if (!colorEnabled()) return s;
  return `${ESC}${code}m${s}${RESET}`;
}

const red = (s) => wrap('31', s);
const yellow = (s) => wrap('33', s);
const green = (s) => wrap('32', s);
const dim = (s) => wrap('2', s);

// OSC 8 hyperlink, BEL-terminated (the form Claude Code's statusline docs
// show). Not gated on NO_COLOR — that convention governs color (SGR), not
// hyperlinks — and terminals without OSC 8 support render the text plain.
const link = (url, s) => `\x1b]8;;${url}\x07${s}\x1b]8;;\x07`;

module.exports = { red, yellow, green, dim, link, colorEnabled, withEnv };
