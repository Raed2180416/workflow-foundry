// Shim so that `node --test beds/incident/` works: Node resolves a directory argument to its
// index.js, which loads the bed's test file. The bed interface itself is index.mjs.
import './incident.test.mjs';
