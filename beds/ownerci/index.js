// Shim so that `node --test beds/ownerci/` works: Node resolves a directory argument to its
// index.js, which loads the bed's test files. The bed interface itself is index.mjs. The frozen
// fixture suites under fixtures/ are never run directly; the oracle runs them in a child process.
import './ownerci.test.mjs';
import './ownerci.controls.test.mjs';
import './ownerci.audit.test.mjs';
