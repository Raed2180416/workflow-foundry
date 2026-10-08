// The simulated world a tiny Foundry workflow runs in (F1 exec-injected family). One World per scenario: fixture
// capabilities (a flaky fetch, a store, a module loader, a report writer, an authenticated API, a system under
// test), a scripted model double, the environment facets a fingerprint reads, and the fault that was injected.
//
// The runtime is the frozen copy of src/ (exec/frozen-src.mjs); the fixtures register through its public
// CapabilityRegistry and the model double is its ScriptedProvider behind its ModelPort, with model ids from the
// owner policy (policy/models.json in the frozen copy). Nothing here calls a model, a network or a clock for a value
// that reaches a record: faults are functions of the plan key and the number of calls made so far.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { scratchRoot } from './frozen-src.mjs';
import { makeRnd, sha } from './util.mjs';
import { runSut } from './sut.mjs';

export const APP_ROOT = '/srv/app';          // what scratch paths are called in error texts
const nodeIdOf = key => String(key ?? '').split('/').pop();
const mkErr = (code, message, extra = {}) => Object.assign(new Error(message), { code }, extra);

export class World {
  constructor(plan, rt, rb) {
    this.plan = plan; this.rt = rt; this.rb = rb;
    this.key = plan.key;
    this.rnd = makeRnd(`${plan.key}|world`);
    this.fault = rb.fault;                                 // {type, cap, facet?, make(), length?, ...} (see recipes.mjs)
    this.sutCrash = rb.sut?.crash ?? null; this.apiCredential = rb.apiCredential ?? null;
    this.build = 'N';                                      // the SUT build the next run uses: N (under test) or N-1 (control)
    this.outage = 0; this.draws = 0; this.faulty = false; this.runKind = null; this.calls = {};
    this.facets = this.initialFacets();
    this.models = new Map(rb.models ?? []);                 // node id -> model behaviour
    this.scope = rb.scope ?? [];                            // facet keys the failing node depends on (the node-scoped fingerprint)
    this.forced = null;                                     // 'pass' | 'fail': forces the next stochastic draw
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------
  async open() {
    const rt = this.rt;
    this.workspace = mkdtempSync(path.join(scratchRoot(), 'kev-exec-'));
    this.modDir = path.join(this.workspace, 'mods'); this.outDirs = {};
    mkdirSync(this.modDir, { recursive: true });
    for (const m of Object.keys(this.facets.module)) writeFileSync(path.join(this.modDir, `${m}.mjs`), `export default (x) => x; // ${m}\n`);
    for (const d of Object.keys(this.facets.dir)) { this.outDirs[d] = path.join(this.workspace, d); mkdirSync(this.outDirs[d], { recursive: true }); }
    const registry = rt.createDefaultRegistry();
    this.registerFixtures(registry);
    const loaded = rt.loadPolicy();
    this.policy = loaded;
    this.provider = new rt.ScriptedProvider((args, index) => this.modelScript(args, index));
    this.foundry = new rt.Foundry(path.join(this.workspace, 'work'), {
      registry, modelPolicy: loaded,
      models: store => new rt.ModelPort({ policy: loaded.policy, providers: { 'claude-cli': this.provider }, journal: new rt.Journal(store) }),
    });
    return this;
  }
  async close() {
    try { await this.foundry?.close(); } catch { /* the store may already be closed */ }
    if (this.workspace) rmSync(this.workspace, { recursive: true, force: true });
  }
  clean(text) { return String(text ?? '').split(this.workspace).join(APP_ROOT); }

  // ---- facets (what an environment fingerprint reads) ----------------------------------------------------------------
  initialFacets() {
    const p = this.plan.env;
    const f = { service: {}, module: {}, credential: {}, dir: {}, disk: { [APP_ROOT]: 'ok' }, tool: {} };
    for (const s of p.services) f.service[s.name] = 'up';
    for (const m of p.modules) f.module[m] = 'present';
    for (const c of p.credentials) f.credential[c] = 'set';
    for (const d of p.dirs) f.dir[d] = 'writable';
    for (const [kind, name] of p.bystanders) f[kind][name] = kind === 'credential' ? 'set' : kind === 'dir' ? 'writable' : kind === 'service' ? 'up' : 'present';
    return f;
  }
  // flat {"kind name": value}; `scope` limits it to some facet keys, `kinds` to some kinds
  fingerprint({ scope = null, kinds = null } = {}) {
    const out = {};
    for (const [kind, table] of Object.entries(this.facets)) {
      if (kinds && !kinds.includes(kind)) continue;
      for (const [name, value] of Object.entries(table)) { const k = `${kind} ${name}`; if (!scope || scope.includes(k)) out[k] = value; }
    }
    return out;
  }
  static diff(before, after) {
    const out = [];
    for (const k of Object.keys(after).sort()) if (before[k] !== undefined && before[k] !== after[k]) out.push(`${k}: ${before[k]} -> ${after[k]}`);
    return out;
  }

  // ---- phases: the injected fault is on or off ----------------------------------------------------------------------------
  setPhase(phase) {
    const f = this.fault, on = phase === 'faulty';
    this.faulty = on;
    if (!f) return;
    switch (f.type) {
      case 'transient': this.outage = on ? f.length : 0; break;
      case 'service': this.facets.service[f.facet] = on ? 'down' : 'up'; break;
      case 'module': {
        this.facets.module[f.facet] = on ? 'missing' : 'present';
        const file = path.join(this.modDir, `${f.facet}.mjs`);
        if (on) rmSync(file, { force: true }); else writeFileSync(file, `export default (x) => x; // ${f.facet}\n`);
        break;
      }
      case 'dir': {
        this.facets.dir[f.facet] = on ? 'blocked' : 'writable';
        const d = this.outDirs[f.facet];
        rmSync(d, { recursive: true, force: true });
        if (on) writeFileSync(d, 'not a directory\n'); else mkdirSync(d, { recursive: true });
        break;
      }
      case 'disk': this.facets.disk[APP_ROOT] = on ? 'full' : 'ok'; break;
      case 'credential': this.facets.credential[f.facet] = on ? 'unset' : 'set'; break;
      case 'sut': this.build = on ? 'N' : 'N-1'; break;
      default: break;                                              // stochastic, none: no phase
    }
  }
  useBuild(build) { this.build = build; }
  beginRun(kind) { this.runKind = kind; this.calls = {}; }
  logRun(entry) { (this.runLog ??= []).push(entry); }
  nth(cap) { return (this.calls[cap] = (this.calls[cap] ?? 0) + 1); }

  // The error an injected fault raises for a call of `cap`, or null.
  intercept(cap) {
    const f = this.fault;
    if (!f || f.cap !== cap) return null;
    if (f.type === 'transient') { if (this.outage > 0) { this.outage--; return f.make(); } return null; }
    if (f.type === 'service' && this.facets.service[f.facet] === 'down') return f.make();
    return null;
  }

  // ---- fixture data -------------------------------------------------------------------------------------------------------
  payload(source, count) {
    const p = this.plan.payload, n = Math.max(1, count ?? p.rows.length);
    return { source: p.source, rows: p.rows.slice(0, n), total: p.rows.slice(0, n).reduce((s, r) => s + r.amount, 0) };
  }

  // ---- capabilities --------------------------------------------------------------------------------------------------------
  registerFixtures(registry) {
    const add = (name, description, execute, extra = {}) => registry.register({
      name, description, version: '1', implementation: `kev-data/exec/${name}`, inputSchema: { type: 'object' }, outputSchema: {},
      effects: 'none', risk: 'low', requiresApproval: false, maxTimeoutMs: 20000, cost: 0, cancellation: 'cooperative', execute, ...extra });
    add('fx.fetch', 'Fetch rows from a named source over the network (fixture).', async args => {
      this.nth('fetch'); const e = this.intercept('fetch'); if (e) throw e;
      return this.payload(args.source, args.count);
    });
    add('fx.load', 'Load a batch of rows from the local staging area (fixture, never faulty).', async args => this.payload(args.source, args.count));
    add('fx.store', 'Read a key from the local state store (fixture).', async args => {
      this.nth('store'); const e = this.intercept('store'); if (e) throw e;
      return { key: String(args.key ?? 'k'), rows: this.payload('store', args.count).rows, total: this.payload('store', args.count).total, source: this.plan.payload.source };
    });
    add('fx.load_module', 'Load a helper module from the module directory (fixture).', async args => {
      const file = path.join(this.modDir, `${args.module}.mjs`);
      try { const text = readFileSync(file, 'utf8'); return { module: String(args.module), bytes: text.length }; }
      catch (error) { throw mkErr(error.code ?? 'ERROR', this.clean(error.message)); }
    });
    add('fx.write_report', 'Write a report file into a working directory (fixture).', async args => {
      if (this.facets.disk[APP_ROOT] === 'full') throw mkErr('ENOSPC', `ENOSPC: no space left on device, write '${APP_ROOT}/${args.dir}/${args.name}'`);
      const dir = this.outDirs[args.dir];
      try {
        const file = path.join(dir, String(args.name));
        writeFileSync(file, JSON.stringify(args.rows ?? []));
        return { path: `${args.dir}/${args.name}`, bytes: statSync(file).size };
      } catch (error) { throw mkErr(error.code ?? 'ERROR', this.clean(error.message)); }
    });
    add('fx.call_api', 'Call an authenticated HTTP API (fixture).', async args => {
      this.nth('api');
      const e = this.intercept('api'); if (e) throw e;
      const cred = this.apiCredential;
      if (cred && this.facets.credential[cred] === 'unset') throw this.fault.make();
      return { ok: true, service: String(args.service), echo: args.op ?? null, ...this.payload(args.service, args.count) };
    });
    add('fx.sut', 'Call one operation of the system under test (fixture).', async args => {
      this.nth('sut');
      if (this.sutCrash && this.build === 'N') throw mkErr(this.sutCrash.code, this.sutCrash.message);
      return { op: String(args.op), result: runSut(String(args.op), args.args, this.build) };
    });
    add('fx.oracle', 'Compare a result with its expected value (an effect-free verification oracle, fixture).', async args => {
      const ok = JSON.stringify(args.result) === JSON.stringify(args.expected);
      return { pass: ok, score: ok ? 1 : 0, reasons: ok ? [] : ['the result differs from the specified value'] };
    });
  }

  // ---- the model double ---------------------------------------------------------------------------------------------------
  // Behaviours by node id: { kind: 'healthy' | 'stochastic' | 'transient' | 'service', labels, truth, p }
  setModel(nodeId, behaviour) { this.models.set(nodeId, behaviour); }
  force(outcome) { this.forced = outcome; }
  modelScript(args) {
    const id = nodeIdOf(args.nodeKey), b = this.models.get(id) ?? { kind: 'healthy', labels: this.plan.agentLabels, truth: this.plan.truth };
    this.nth('model');
    if (b.kind === 'transient' && this.fault?.cap === 'agent' && this.outage > 0) { this.outage--; const e = this.fault.make(); return { error: { code: e.code, message: e.message } }; }
    if (b.kind === 'service' && this.facets.service[this.fault.facet] === 'down') { const e = this.fault.make(); return { error: { code: e.code, message: e.message } }; }
    if (b.kind === 'invalid') return { value: { label: 'not-a-listed-label' } };
    if (b.kind === 'truncated') return { text: '{"label": "', finishReason: 'length' };
    if (b.kind === 'refusal') return { text: '', finishReason: 'refusal' };
    if (b.kind === 'stochastic') {
      let u = this.rnd.unit(`draw|${this.draws++}`);
      if (this.forced) { u = this.forced === 'fail' ? u * b.p : b.p + u * (1 - b.p); this.forced = null; }
      const others = b.labels.filter(l => l !== b.truth);
      const label = u < b.p ? others[Math.floor((u / b.p) * others.length) % others.length] : b.truth;
      return { value: { label } };
    }
    return { value: { label: b.truth } };
  }
}

export const stableId = (...parts) => sha(parts.join('|')).slice(0, 8);
export { existsSync, unlinkSync };
