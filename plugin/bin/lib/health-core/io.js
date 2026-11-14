'use strict';
const { spawnSync } = require('child_process');

// Injectable process seams for the health-core helpers (#5380). Every helper
// that used to write to process.stdout/process.stderr or read process.cwd()
// takes an optional `io` (or just `stderr`/`env`) and defaults to this object,
// so a caller that passes nothing behaves exactly as before while an
// in-process entry (run(argv, deps)) can capture output without spawning node.
const DEFAULT_IO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: () => process.cwd(),
};

// makeExec({ env, stderr }) -> exec(cmd, args, opts = {}) -> string
//
// Behaves as execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true,
// ...opts, env }): returns the child's stdout, throws on a non-zero exit with
// the usual err.status/err.stdout/err.stderr (and execFileSync's own
// `Command failed: ...\n<stderr>` message, which durable-state.js matches on).
// The difference is where the child's stderr goes. With no `stdio`,
// execFileSync buffers the child's stderr (maxBuffer included) and writes it to
// the parent's process.stderr after the child exits, which an in-process caller
// must not leak; here the same buffered text is handed to the injected
// `stderr` instead — on success, and before rethrowing on failure — so the
// output is identical, only the sink differs. spawnSync (not execFileSync)
// because execFileSync discards a successful child's piped stderr.
// Accepted `opts.stdio` shapes: omitted (stdin/stdout/stderr all piped); a
// string (it sets stdin and stdout, stderr stays piped), with 'ignore' meaning
// all three ignored; or an array [stdin, stdout, stderr], where only a third
// entry of 'ignore' is honoured (nothing to forward) and any other stderr entry
// is piped. A non-piped stdout makes the returned stdout null, as with
// execFileSync. `env` undefined -> inherited, as today.
function makeExec({ env, stderr = DEFAULT_IO.stderr } = {}) {
  return function exec(cmd, args, opts = {}) {
    let stdio;
    if (opts.stdio === 'ignore') {
      stdio = 'ignore';
    } else {
      const given = Array.isArray(opts.stdio) ? opts.stdio : [opts.stdio || 'pipe', opts.stdio || 'pipe', 'pipe'];
      stdio = [given[0], given[1], given[2] === 'ignore' ? 'ignore' : 'pipe'];
    }
    const options = { encoding: 'utf8', windowsHide: true, ...opts, stdio };
    if (env !== undefined) options.env = env;
    const ret = spawnSync(cmd, args, options);
    if (ret.stderr && ret.stderr.length > 0) stderr(String(ret.stderr));
    let err = null;
    if (ret.error) {
      err = ret.error;
      Object.assign(err, ret);
    } else if (ret.status !== 0) {
      let msg = `Command failed: ${[cmd, ...args].join(' ')}`;
      if (ret.stderr && ret.stderr.length > 0) msg += `\n${ret.stderr}`;
      err = Object.assign(new Error(msg), ret);
    }
    if (err) throw err;
    return ret.stdout;
  };
}

module.exports = { DEFAULT_IO, makeExec };
