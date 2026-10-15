// AGENTV-E8 (FIRST-CLASS-PROGRAMS §1.5): the contract-and-refusal validator of the "agent-H + validator" arm.
//
// What it checks: a draft TickOutput against the tick contract's TickOutput rules as the host enforces them, i.e. the
// host's own pre-commit validation (beds/ebed/host/output.mjs validateCaseOutput, BED-CONTRACT-v1.1 §3.1) with the item's
// own schemas (the `schemas` the host binds: decisions schema and per-op effect schemas). The problems it returns are the
// host's own words ("effects[2].key: a batch op keys its items, not the batch", "close: must be true when present").
//
// What it never uses: the oracle, the reference transition or policy, the grader, truth labels, the world or the
// generator. Its static import closure is beds/ebed/host/{output,schema,time}.mjs and beds/lib/canonical.mjs only (a test
// walks it). It judges the form of an output, never whether a business decision is right.
//
// One thing the arm side cannot see: `merge` is legal only in the first round of a wake-up and only on an instance
// started by an inbound event (round and inbound are host state, not in the tick input). The validator is permissive
// there (it never refuses a merge on those grounds) and says so in `notes`; the host still enforces both at commit.
import { readdirSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { validateCaseOutput } from '../../beds/ebed/host/output.mjs';

export const MERGE_NOTE = 'merge: whether this tick is in the first round of its wake-up and whether this instance was started by an inbound message cannot be checked here; the platform checks both when it applies the output';

/**
 * validateDraft(draft, { schemas, self, openInstances }) → { valid, problems, notes }
 *   schemas        the host's item schemas ({ decisions, effects, ... }: bindItem(binding).schemas)
 *   self           the tick's instance id (input.instance)
 *   openInstances  ctx.instances() rows ({ instance, ... }) as the arm sees them, or null when unknown (then any
 *                  merge target other than self counts as open: permissive, never a false refusal)
 */
export function validateDraft(draft, { schemas, self, openInstances = null }) {
  if (!schemas?.effects) throw new Error('validateDraft needs the host item schemas (schemas.effects)');
  const open = Array.isArray(openInstances) ? new Map(openInstances.filter(r => r && typeof r.instance === 'string').map(r => [r.instance, { closed: false }])) : null;
  const instances = { get: id => (open ? open.get(id) : (typeof id === 'string' && id !== self ? { closed: false } : undefined)) };
  const { errors } = validateCaseOutput(draft, { schemas, round: 1, inbound: true, instances, self });
  const notes = draft && typeof draft === 'object' && !Array.isArray(draft) && Object.prototype.hasOwnProperty.call(draft, 'merge') ? [MERGE_NOTE] : [];
  return { valid: errors.length === 0, problems: errors, notes };
}

/** The sandbox client: `node validate.mjs [draft.json]` asks the arm (through the .val/ file mailbox) to check a draft. */
export const VALIDATE_CLIENT = `// Check a draft TickOutput with the platform's own output checks BEFORE you write output.json. Usage:
//   node validate.mjs [file]        (default: draft.json)
// Exit 0 and VALID when the platform would accept the output's form; exit 1 and the list of problems otherwise.
// It checks the form of the output (the tick contract and the platform's validation), not whether your decisions are right.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
const file = process.argv[2] ?? 'draft.json';
let draft;
try { draft = JSON.parse(readFileSync(file, 'utf8')); }
catch (e) { console.log('INVALID: ' + file + ' is not readable JSON (' + String(e.message).slice(0, 200) + '). The platform refuses an output that is not JSON.'); process.exit(1); }
mkdirSync('.val', { recursive: true });
const id = process.pid + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
writeFileSync('.val/req-' + id + '.tmp', JSON.stringify({ draft }));
renameSync('.val/req-' + id + '.tmp', '.val/req-' + id + '.json');
const t = Date.now();
while (Date.now() - t < 60_000) {
  if (existsSync('.val/res-' + id + '.json')) {
    const r = JSON.parse(readFileSync('.val/res-' + id + '.json', 'utf8'));
    if (r.error) { console.error('validator error: ' + r.error); process.exit(2); }
    for (const n of r.notes ?? []) console.log('note: ' + n);
    if (r.valid) { console.log('VALID: the platform\\'s output checks found no problems in ' + file + '. (They check the form only, not whether your decisions are right.)'); process.exit(0); }
    console.log('INVALID: ' + r.problems.length + ' problem(s) the platform would refuse. Fix each one, check again, and only then write output.json:');
    for (const p of r.problems) console.log('- ' + p);
    process.exit(1);
  }
  await new Promise(r => setTimeout(r, 100));
}
console.error('no answer from the validator within 60 s'); process.exit(2);
`;

/**
 * Serve one session's validator mailbox (<dir>/.val/). `check(draft)` → { valid, problems, notes }. Every answered
 * request is passed to onCall({ valid, problems }) (the arm counts them). Returns { stop } → number served.
 */
export function serveValidator(dir, check, { pollMs = 100, onCall = () => {} } = {}) {
  const box = path.join(dir, '.val');
  mkdirSync(box, { recursive: true });
  let stopped = false, served = 0;
  const step = () => {
    if (stopped) return;
    for (const f of readdirSync(box).filter(x => /^req-[\w-]+\.json$/.test(x))) {
      const id = f.slice(4, -5), res = path.join(box, `res-${id}.json`);
      if (existsSync(res)) continue;
      let out;
      try {
        const { draft } = JSON.parse(readFileSync(path.join(box, f), 'utf8'));
        const r = check(draft);
        out = { valid: r.valid, problems: r.problems, notes: r.notes ?? [] };
      } catch (e) { out = { error: String(e?.message ?? e).slice(0, 400) }; }
      writeFileSync(`${res}.tmp`, JSON.stringify(out));
      renameSync(`${res}.tmp`, res);
      served += 1;
      try { onCall(out); } catch { /* accounting must never break a session */ }
    }
  };
  const timer = setInterval(() => { try { step(); } catch { /* next poll */ } }, pollMs);
  return { stop: () => { stopped = true; clearInterval(timer); return served; } };
}
