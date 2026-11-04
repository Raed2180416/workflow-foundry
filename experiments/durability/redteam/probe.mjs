// DUR-1 J2 red team, the probe service (PREREG-DUR-1 §8.3; BUILD-PLAN row 15). A red-team session (white-box, oracle-
// assisted: the strongest affordable adversary) writes a scenario (a WC-1 knob vector, at most 16 arriving orders) to
// `probes/req-<n>.json` and runs `node probe.mjs <scenario.json>`; this harness side answers with the target's effects and
// per-case oracle verdicts in `probes/res-<n>.json`. At most 25 probes per session: the 26th is refused. Every world it
// makes is registered red-team (never in an evidence or regression set). $0 per probe.
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from 'node:fs';
import { vectorBundle, checkVector } from '../knobs.mjs';
import { registerRedTeam } from '../heal-adapter.mjs';
import { referencePools, gradeRun } from '../oracle.mjs';
import { runBundle } from '../arms.mjs';

export const MAX_PROBES = 25, MAX_ORDERS = 16, MAX_SCENARIOS = 8;

/** The client a session runs inside its sandbox (file mailbox only). */
export const PROBE_CLIENT = `// Run a scenario against the target and print its effects and per-case verdicts. Usage: node probe.mjs scenario.json
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
mkdirSync('probes', { recursive: true });
const n = readdirSync('probes').filter(f => f.startsWith('req-')).length + 1;
writeFileSync(\`probes/req-\${n}.json\`, readFileSync(process.argv[2], 'utf8'));
const t = Date.now();
while (Date.now() - t < 10 * 60_000) {
  if (existsSync(\`probes/res-\${n}.json\`)) { process.stdout.write(readFileSync(\`probes/res-\${n}.json\`, 'utf8') + '\\n'); process.exit(0); }
  await new Promise(r => setTimeout(r, 1000));
}
console.log('no answer within 10 min'); process.exit(1);
`;

/** Answer one probe: run the scenario (knob vector) against the target version; effects and verdicts per case. */
export async function answerProbe({ targetId, version, scenario, sealed = null }) {
  const v = { base: 1301, salt: 0, difficulty: 3, mix: 'tail', size: 12, transforms: [], fault: 'none', overlays: [], ...scenario };
  try { checkVector(v); } catch (e) { return { ok: false, error: e.message }; }
  if (v.size > MAX_ORDERS) return { ok: false, error: `at most ${MAX_ORDERS} arriving orders per scenario` };
  const b = await vectorBundle(`rt-${targetId}`, v, { sealed });
  registerRedTeam(b.key);
  const ref = await referencePools(b);
  if (!ref.control.ok) return { ok: true, valid: false, note: 'the reference fails this world: a bed finding candidate (excluded from scores)', problems: ref.control.problems.slice(0, 3) };
  const r = await runBundle(b, { version });
  const g = gradeRun(b, r.rows, ref.pools);
  const effects = r.rows.filter(x => x.type === 'ledger').slice(0, 400).map(x => [x.at, `${x.system}.${x.op}`, x.committed ? 'ok' : `${x.error?.code ?? ''} ${x.error?.reason ?? ''}`]);
  return { ok: true, valid: true, key: b.key, status: r.status, cases: g.cases.filter(c => c.graded).map(c => ({ case: c.case, order: c.subject, class: c.class, pass: c.pass, critical: c.critical, first: c.first })), effects };
}

/** Serve a session's probe mailbox; refuses past MAX_PROBES. Returns { stop, count }. */
export function serveProbes({ workdir, targetId, version, sealed = null, journal = null, pollMs = 1000 }) {
  const box = path.join(workdir, 'probes');
  mkdirSync(box, { recursive: true });
  let busy = false, stopped = false, count = 0;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      for (const f of readdirSync(box).filter(x => /^req-\d+\.json$/.test(x)).sort((a, b) => Number(a.slice(4, -5)) - Number(b.slice(4, -5)))) {
        const n = f.slice(4, -5), res = path.join(box, `res-${n}.json`);
        if (existsSync(res)) continue;
        let out;
        if (count >= MAX_PROBES) out = { ok: false, error: `probe budget exhausted (${MAX_PROBES})` };
        else {
          count += 1;
          try { out = await answerProbe({ targetId, version, scenario: JSON.parse(readFileSync(path.join(box, f), 'utf8')), sealed }); } catch (e) { out = { ok: false, error: String(e?.message ?? e).slice(0, 300) }; }
        }
        writeFileSync(`${res}.tmp`, JSON.stringify(out)); renameSync(`${res}.tmp`, res);
        if (journal) appendFileSync(journal, JSON.stringify({ n: Number(n), ok: out.ok, valid: out.valid ?? null, key: out.key ?? null }) + '\n');
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
  return { stop: async () => { stopped = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 100)); return count; }, tick, get count() { return count; } };
}
