'use strict';
// learned-skills capture (#5290) fault matrix, tracked target — no fault, singles, named chains and
// sampled higher orders (the pairs run from capture-matrix-tracked-pairs.test.js). Machinery:
// tests/helpers/learned-skills-capture.js.
const { registerMatrix } = require('../../helpers/learned-skills-capture.js');

registerMatrix('tracked', 'chains');
