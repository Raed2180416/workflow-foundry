// Span tap for the codefix bed (JUDGE-PROGRAM.md §2.6, §1.2 X1 "codefix", X6, Q6, F2): the bed renders its bug thread,
// service log and module comments from world structures (build().bugs, .herring, .decoys, knobs.injections,
// knobs.codeInjection, knobs.noise) without exporting a per-span label. This tap regenerates the task, takes the
// rendered text and aligns every world-level fact with EXACTLY ONE verbatim span: a fact with zero or several spans is
// dropped and counted, and the alignment rate over a world sample is the tap's acceptance number (>= 95%).
//
// It reads the world truth from the build object the generator hands it (`build`, from ctx.beds codefix/build.mjs) and the
// task text through the codefix kit's parsers (judges/failures.mjs): it imports no bed and forks no renderer.
//
// Facts and the span each is aligned to:
//   bug         a mutation site that is injected: the thread block that contains one of the site's symptom sentences
//   herring     the red-herring complaint: the comment containing one of the site's herring sentences
//   inject-*    knobs.injections: the thread comment, the service-log line; knobs.codeInjection: the module comment block
//   decoy       a plausible FIXME/TODO on correct code: the module comment block equal to `# <site.decoy>`
//   noise       knobs.noise: a thread comment equal to one NOISE string
//   vague       the d5 bug mentioned only as "has been acting up": counted, never a label-bearing span
import { codeComments, logLines, threadSegments } from '../judges/failures.mjs';
import { CODE_INJECTIONS, LOG_INJECTIONS, NOISE, slotRe, THREAD_INJECTIONS, VAGUE } from './codefix-frames.mjs';

export const TAP_THRESHOLD = 0.95;

// Truth the tap needs from the bed's build() object (or an equivalent stand-in in tests).
export function truthOf(b) {
  const sites = b.domain.sites, p = b.p;
  const fnOf = id => sites[id].fn(p);
  const siteIds = Object.keys(sites).filter(id => b.sections.includes(sites[id].section));
  return {
    fns: [...new Set(siteIds.map(fnOf))], p,
    bugs: b.bugs.map(id => ({ id, fn: fnOf(id), symptoms: sites[id].symptom.map(f => f(p)), section: b.sections.indexOf(sites[id].section) })),
    herring: b.herring ? { id: b.herring, fn: fnOf(b.herring), texts: sites[b.herring].herring.map(f => f(p)), section: b.sections.indexOf(sites[b.herring].section) } : null,
    decoys: b.decoys.map(id => ({ id, fn: fnOf(id), text: sites[id].decoy(p), section: b.sections.indexOf(sites[id].section) })),
    knobs: b.knobs, sections: b.sections,
  };
}

// names to mask when a span's skeleton is taken: the world's function display names, their bare names, the module
export function maskNames(truth, b) {
  const names = new Set();
  for (const fn of truth.fns) { names.add(fn); const bare = fn.replace(/\(\)$/, ''); names.add(bare); for (const part of bare.split('.')) names.add(part); }
  for (const k of ['mod', 'Cls', 'company']) if (typeof truth.p?.[k] === 'string') names.add(truth.p[k]);
  return { names: [...names].filter(n => n.length >= 3), markers: [] };
}

export function alignCodefix({ truth, inputs }) {
  const segs = threadSegments(inputs.bug_report), logs = logLines(inputs.service_log ?? ''), codes = codeComments(inputs.source);
  const spans = new Map(), facts = [];
  const put = (id, s) => { if (!spans.has(id)) spans.set(id, { id, ...s }); return spans.get(id); };
  // every span exists first with the role 'plain'; facts then claim spans
  for (const s of segs) put(`thread:${s.index}`, { kind: 'thread', index: s.index, text: s.body, role: s.index === 0 ? 'issue-first' : 'unclaimed', label: 'no', facts: [] });
  for (const l of logs) put(`log:${l.index}`, { kind: 'log', index: l.index, text: l.text, role: 'log-traffic', label: 'no', facts: [] });
  for (const c of codes) put(`code:${c.index}`, { kind: 'code', index: c.index, text: c.text, role: 'code-other', label: 'no', line: c.line, facts: [] });
  const fact = (id, type, expected, candidates, extra = {}) => {
    const f = { id, type, expected, candidates: [...new Set(candidates)], ...extra };
    f.status = extra.vague ? 'vague' : f.candidates.length === 1 ? 'aligned' : f.candidates.length === 0 ? 'missing' : 'ambiguous';
    facts.push(f);
    if (f.status === 'aligned') { const s = spans.get(f.candidates[0]); s.facts.push(id); }
    return f;
  };
  const claim = (f, role, label, hard = false, extra = {}) => { if (f.status !== 'aligned') return; Object.assign(spans.get(f.candidates[0]), { role, label, hard, ...extra }); };
  const threadHits = texts => segs.filter(s => texts.some(t => s.body.includes(t))).map(s => `thread:${s.index}`);

  // bugs: a site's symptom sentence sits in the first block or in a comment; the vague one has no site-specific sentence
  const vagueN = truth.knobs.vagueBugs ?? 0;
  truth.bugs.forEach((bug, i) => {
    const vague = i >= truth.bugs.length - vagueN && i > 0;
    if (vague) {
      const hit = segs.filter(s => s.index > 0 && VAGUE.test(s.body)).map(s => `thread:${s.index}`);
      const f = fact(`bug:${bug.id}`, 'bug', 1, hit, { vague: true, site: bug.id });
      for (const id of f.candidates) Object.assign(spans.get(id), { role: 'vague-hint', label: 'no', hard: false });
      return;
    }
    const f = fact(`bug:${bug.id}`, 'bug', 1, threadHits(bug.symptoms), { site: bug.id });
    claim(f, 'bug', 'no', true, { site: bug.id, fn: bug.fn, section: bug.section });
  });
  if (truth.herring) {
    const f = fact(`herring:${truth.herring.id}`, 'herring', 1, threadHits(truth.herring.texts), { site: truth.herring.id });
    claim(f, 'herring', 'no', true, { site: truth.herring.id, fn: truth.herring.fn, section: truth.herring.section });
  }
  // injections: knobs.injections thread comments and one log line; knobs.codeInjection one module comment block
  const fnRe = templates => templates.map(t => slotRe(t, truth.fns));
  const threadInj = fnRe(THREAD_INJECTIONS), logInj = fnRe(LOG_INJECTIONS);
  const nInj = truth.knobs.injections ?? 0;
  if (nInj > 0) {
    const hits = segs.filter(s => s.index > 0 && threadInj.some(re => re.test(s.body))).map(s => `thread:${s.index}`);
    for (let k = 0; k < nInj; k++) {
      const f = fact(`inject-thread:${k}`, 'inject-thread', 1, hits.length === nInj ? [hits[k]] : hits);
      claim(f, 'injection', 'yes', false, { frame: f.status === 'aligned' ? threadInj.findIndex(re => re.test(spans.get(f.candidates[0]).text)) : null });
    }
    const body = l => l.text.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \w+ +\[[^\]]+\] /, '');
    const lhits = logs.filter(l => logInj.some(re => re.test(body(l)))).map(l => `log:${l.index}`);
    const f = fact('inject-log', 'inject-log', 1, lhits);
    claim(f, 'injection', 'yes', false, { frame: f.status === 'aligned' ? logInj.findIndex(re => re.test(body(logs.find(l => `log:${l.index}` === lhits[0])))) : null });
  }
  if (truth.knobs.codeInjection) {
    const hits = [];
    for (const c of codes) for (const t of CODE_INJECTIONS) for (const fn of truth.fns) if (c.text === t.map(l => l.replace('{fn}', fn)).join('\n')) hits.push(`code:${c.index}`);
    const f = fact('inject-code', 'inject-code', 1, hits);
    claim(f, 'injection', 'yes');
  }
  // decoys: plausible FIXME / TODO comments on correct code
  for (const d of truth.decoys) {
    const f = fact(`decoy:${d.id}`, 'decoy', 1, codes.filter(c => c.text === `# ${d.text}`).map(c => `code:${c.index}`), { site: d.id });
    claim(f, 'decoy', 'no', true, { site: d.id, fn: d.fn, section: d.section });
  }
  // noise comments
  const noiseHits = segs.filter(s => s.index > 0 && NOISE.includes(s.body)).map(s => `thread:${s.index}`);
  const nNoise = truth.knobs.noise ?? 0;
  if (nNoise) {
    const f = fact('noise', 'noise', nNoise, noiseHits);
    if (noiseHits.length === nNoise) { f.status = 'aligned'; for (const id of noiseHits) { Object.assign(spans.get(id), { role: 'noise', label: 'no', hard: false }); spans.get(id).facts.push('noise'); } }
  }
  // the log's injected line is claimed above; the lines around it stay log-traffic. Alignment rate over label-bearing facts:
  const counted = facts.filter(f => f.status !== 'vague');
  const aligned = counted.filter(f => f.status === 'aligned').length;
  return { spans, facts, stats: { facts: counted.length, aligned, vague: facts.length - counted.length, missing: counted.filter(f => f.status === 'missing').length, ambiguous: counted.filter(f => f.status === 'ambiguous').length } };
}

// Alignment over a list of per-world results: { facts, aligned, rate }
export function tapRate(results) {
  const facts = results.reduce((s, r) => s + r.stats.facts, 0), aligned = results.reduce((s, r) => s + r.stats.aligned, 0);
  return { worlds: results.length, facts, aligned, rate: facts ? aligned / facts : 1 };
}
export const tapStatus = results => { const r = tapRate(results); return { ...r, ok: r.rate >= TAP_THRESHOLD, threshold: TAP_THRESHOLD }; };
