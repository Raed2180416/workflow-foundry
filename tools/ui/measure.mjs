// Prints the tier-0 capability numbers (development evidence, $0, deterministic for a seed):
//   - completability: share of generated valid answers whose canonical form round-trips exactly, per route;
//   - differential agreement of the host validator with the engine validator (src/validate.mjs, ajv 8);
//   - planted number text accepted by the host vs two simple client rules (OpenUI numeric, web/app.js Number());
//   - per-field controls on the compile fixtures vs the current web/app.js answer control (one control per answer).
//   node tools/ui/measure.mjs [--seed 20261014] [--schemas 1000]
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { validateData } from '../../src/validate.mjs';
import { compileForm } from './compile.mjs';
import { acceptSubmission, answerFromFormState, canonicalAnswer, formStateFromAnswer, submissionFromAnswer } from './formstate.mjs';
import { listCases } from './fixtures.mjs';
import { genSchema, genValid, mutate, openuiNumeric, PLANTED_NUMBER_TEXT, rng, webAppNumber } from './generate.mjs';
import { validateAnswer } from './validate.mjs';

const engineAccepts = (schema, value) => { try { validateData(schema, value, 'answer', { trustedSchema: true }); return true; } catch { return false; } };

export function measure({ seed = 20261014, schemas = 1000 } = {}) {
  const r = rng(seed);
  const out = { seed, schemas, answers: 0, canonicalExact: { typed: 0, text: 0, browser: 0 }, pairs: 0, agree: 0, acceptedUnsound: 0 };
  for (let i = 0; i < schemas; i++) {
    const schema = genSchema(r);
    const spec = compileForm({ answerSchema: schema, question: `Generated ${i}?`, formName: 'm' });
    for (let k = 0; k < 3; k++) {
      const answer = genValid(r, schema), canonical = canonicalAnswer(spec, answer);
      out.answers++;
      // A route counts only when the encoder reports no gap: a gap means a real widget could not hold the value
      // (for example a line break in a single-line input), even if the host would accept the bytes.
      const routes = {
        typed: () => { const { event, gaps } = formStateFromAnswer(spec, canonical); return { gaps, result: answerFromFormState(spec, event) }; },
        text: () => { const { event, gaps } = formStateFromAnswer(spec, canonical, { mode: 'text' }); return { gaps, result: answerFromFormState(spec, event) }; },
        browser: () => { const { body, gaps } = submissionFromAnswer(spec, canonical); return { gaps, result: acceptSubmission(spec, body) }; },
      };
      for (const [route, run] of Object.entries(routes)) {
        const { gaps, result } = run();
        if (gaps.length === 0 && result.ok && isDeepStrictEqual(result.answer, canonical)) out.canonicalExact[route]++;
        if (result.ok && !engineAccepts(schema, result.answer)) out.acceptedUnsound++;
      }
      for (const value of [answer, mutate(r, schema, answer)]) {
        out.pairs++;
        if ((validateAnswer(spec, value).length === 0) === engineAccepts(schema, value)) out.agree++;
      }
    }
  }
  out.completability = Object.fromEntries(Object.entries(out.canonicalExact).map(([k, v]) => [k, Math.round((v / out.answers) * 10000) / 10000]));
  out.planted = {
    entries: PLANTED_NUMBER_TEXT.length,
    hostAccepts: PLANTED_NUMBER_TEXT.filter(text => answerFromFormState(compileForm({ answerSchema: { type: 'number' }, question: 'n', formName: 'n' }), { n: { answer: { value: text } } }).ok).length,
    openuiNumericAccepts: PLANTED_NUMBER_TEXT.filter(openuiNumeric).length,
    webAppNumberAccepts: PLANTED_NUMBER_TEXT.filter(webAppNumber).length,
  };
  // web/app.js draftControl: an enum, boolean, number or string answer gets one control; anything else is one JSON textarea.
  let leaves = 0, baselineLeafControls = 0;
  for (const c of listCases().filter(x => x.area === 'compile')) {
    const spec = compileForm(c.input);
    leaves += spec.fields.length;
    const s = c.input.answerSchema;
    if (spec.rootKind === 'leaf' && (Array.isArray(s.enum) || ['boolean', 'number', 'integer', 'string'].includes(s.type))) baselineLeafControls += 1;
  }
  out.fixtureControls = { leaves, tier0: leaves, webAppBaseline: baselineLeafControls };
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { seed: { type: 'string', default: '20261014' }, schemas: { type: 'string', default: '1000' } } });
  console.log(JSON.stringify(measure({ seed: Number(values.seed), schemas: Number(values.schemas) }), null, 2));
}
