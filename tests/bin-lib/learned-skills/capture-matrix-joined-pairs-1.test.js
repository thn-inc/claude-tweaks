'use strict';
// learned-skills capture (#5290) fault matrix, joined target — every pair of fault points, first of
// two shards (capture-matrix-joined-pairs-2.test.js runs the rest). Machinery:
// tests/helpers/learned-skills-capture.js.
const { registerMatrix } = require('../../helpers/learned-skills-capture.js');

registerMatrix('joined', 'pairs', { shard: 1, of: 2 });
