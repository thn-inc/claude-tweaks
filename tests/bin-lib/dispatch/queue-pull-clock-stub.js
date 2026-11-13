'use strict';
// #5227: the queue-pull oracle's frozen clock. Loaded into every node process the fence starts
// through NODE_OPTIONS=--require, so `new Date()`, `Date()` and `Date.now()` all read
// 2026-11-12T12:00:00.000Z; a Date built from an argument is unchanged.
const RealDate = Date;
const FIXED = RealDate.parse('2026-11-12T12:00:00.000Z');

function FrozenDate(...args) {
  if (!new.target) return new RealDate(FIXED).toString();
  return args.length === 0 ? new RealDate(FIXED) : new RealDate(...args);
}
FrozenDate.prototype = RealDate.prototype;
FrozenDate.now = () => FIXED;
FrozenDate.parse = RealDate.parse;
FrozenDate.UTC = RealDate.UTC;

global.Date = FrozenDate;
