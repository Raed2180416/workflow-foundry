// Coverage ledger: the engine-owned check that a fan-out covered its whole inventory (verify method "ledger").
//
// A large job is partitioned into shards that readers (usually model nodes inside a map) work through. A reader's
// own statement that it "covered everything" is not evidence. Each reader returns the unit ids it actually read, and
// this check compares them, in code, with the inventory that code produced before the fan-out:
//   - every inventory unit is read at least once;
//   - no unit is read more than maxReads times (redundant reading is cost, and a sign the partition overlaps);
//   - no read names a unit outside the inventory (a reader inventing or mis-copying ids);
//   - no item failed and no item lacks a readable list of ids (a failed shard covers nothing provable).
// The verdict is the usual {pass, score, reasons}; score is the covered share. It adds a `ledger` record (counts plus
// the first ids of each kind) that a run viewer can show as the coverage view.
//
// The skill pack teaches this check (skills/foundry-construct/references/scale.md, step 5). It replaces the hand-written
// reconcile code each builder used to write (research/skillpack-20261104/ANSWER.md, engine gap 4).

export const LEDGER_LIMITS = Object.freeze({ maxIdLength: 1024, listedIds: 50, reasonIds: 10, maxReads: 16 });
const PATH = /^[A-Za-z_$][A-Za-z0-9_$-]*(\.[A-Za-z_$][A-Za-z0-9_$-]*)*$/;

export function validLedgerPath(path) { return typeof path === 'string' && path.length <= 256 && PATH.test(path); }

function at(value, path) {
  let current = value;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

const shown = ids => {
  const head = ids.slice(0, LEDGER_LIMITS.reasonIds).map(id => JSON.stringify(id.length > 80 ? `${id.slice(0, 77)}...` : id)).join(', ');
  return ids.length > LEDGER_LIMITS.reasonIds ? `${head} and ${ids.length - LEDGER_LIMITS.reasonIds} more` : head;
};
const isId = id => typeof id === 'string' && id.length > 0 && id.length <= LEDGER_LIMITS.maxIdLength;

// subject: an array of items, or a map output {items, count, failed?}. inventory: the unit ids (strings).
// options: { reads: dotted path inside each item to its array of read ids, maxReads = 1, allowEmpty = false }.
export function ledgerVerdict(subject, inventory, { reads, maxReads = 1, allowEmpty = false } = {}) {
  const reasons = [];
  const items = Array.isArray(subject) ? subject : (subject && typeof subject === 'object' && Array.isArray(subject.items) ? subject.items : null);
  const fail = reason => ({ pass: false, score: 0, reasons: [reason], ledger: { units: Array.isArray(inventory) ? inventory.length : 0, covered: 0 } });
  if (!items) return fail('The subject is not a list of items or a map output with items: nothing can be counted');
  if (!Array.isArray(inventory) || !inventory.every(isId)) return fail(`The inventory must be a list of unit ids (non-empty strings of at most ${LEDGER_LIMITS.maxIdLength} characters)`);
  if (!validLedgerPath(reads)) return fail('ledger.reads must be a dotted path to each item\'s list of read unit ids');
  const units = new Set(inventory);
  if (units.size !== inventory.length) {
    const seen = new Set(), repeated = [];
    for (const id of inventory) { if (seen.has(id) && !repeated.includes(id)) repeated.push(id); seen.add(id); }
    return fail(`The inventory lists ${repeated.length} unit id${repeated.length === 1 ? '' : 's'} more than once (${shown(repeated)}): coverage of a unit cannot be counted twice`);
  }
  const counts = new Map(), unknown = new Set();
  let failedItems = 0, malformedItems = 0;
  for (const item of items) {
    if (item && typeof item === 'object' && Object.hasOwn(item, '$error')) { failedItems += 1; continue; }
    const ids = at(item, reads);
    if (!Array.isArray(ids) || !ids.every(isId)) { malformedItems += 1; continue; }
    // A unit listed twice by one reader is one reading of it.
    for (const id of new Set(ids)) {
      if (units.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      else unknown.add(id);
    }
  }
  const declaredFailed = subject && !Array.isArray(subject) && Number.isInteger(subject.failed) ? subject.failed : 0;
  failedItems = Math.max(failedItems, declaredFailed);
  const missing = inventory.filter(id => !counts.has(id));
  const overRead = inventory.filter(id => (counts.get(id) ?? 0) > maxReads);
  const unknownIds = [...unknown];
  const covered = inventory.length - missing.length;

  if (!inventory.length && !allowEmpty) reasons.push('The inventory is empty, so no coverage was proved; set ledger.allowEmpty only when an empty job is a valid outcome');
  if (failedItems) reasons.push(`${failedItems} item${failedItems === 1 ? '' : 's'} failed; the units they held are not covered`);
  if (malformedItems) reasons.push(`${malformedItems} item${malformedItems === 1 ? '' : 's'} returned no readable list of unit ids at ${reads}`);
  if (missing.length) reasons.push(`${missing.length} of ${inventory.length} units were never read: ${shown(missing)}`);
  if (overRead.length) reasons.push(`${overRead.length} unit${overRead.length === 1 ? ' was' : 's were'} read more than ${maxReads} time${maxReads === 1 ? '' : 's'}: ${shown(overRead)}`);
  if (unknownIds.length) reasons.push(`${unknownIds.length} read unit id${unknownIds.length === 1 ? ' is' : 's are'} not in the inventory: ${shown(unknownIds)}`);
  const pass = reasons.length === 0;
  const score = inventory.length ? covered / inventory.length : (pass ? 1 : 0);
  const list = ids => ids.slice(0, LEDGER_LIMITS.listedIds);
  return {
    pass, score, reasons: reasons.map(r => r.slice(0, 1000)),
    ledger: { units: inventory.length, covered, items: items.length, failedItems, malformedItems, maxReads,
      missing: missing.length, missingIds: list(missing), overRead: overRead.length, overReadIds: list(overRead),
      unknown: unknownIds.length, unknownIds: list(unknownIds) }
  };
}
