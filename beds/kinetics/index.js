// Shim so that `node --test beds/kinetics/` works: Node resolves a directory argument to its
// index.js, which loads the bed's test file. The bed interface itself is index.mjs.
import './kinetics.test.mjs';
