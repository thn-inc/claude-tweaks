'use strict';
// learned-skills capture (#5290) fault matrix, joined target — every pair of fault points, second of
// two shards (capture-matrix-joined-pairs-1.test.js runs the rest). Machinery:
// tests/helpers/learned-skills-capture.js.
const { registerMatrix } = require('../../helpers/learned-skills-capture.js');

registerMatrix('joined', 'pairs', { shard: 2, of: 2 });
