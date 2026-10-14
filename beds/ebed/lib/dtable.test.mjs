// Unit tests for dtable.mjs: DMN 1.3 hit policies on the spec's own tables (Figures 8-19, 11-15, 11-17) and
// hand-derived cases for each reading R1-R8 stated in the module header. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, evaluate, compileTable, checkTable, parseUnaryTests, parseLiteral, firstLevel, parseCsv, tableFromCsv } from './dtable.mjs';
import { codeOf } from './errors.mjs';
import { ROUTING_RULES, PRE_BUREAU_RISK, APPLICATION_RISK_SCORE } from './fixtures.mjs';

const R = (o, rv, why) => ({ Routing: o, 'Review level': rv, Reason: why });
const AGE17 = { Age: 17, 'Risk category': 'HIGH', 'Debt review': true };
const withPolicy = (t, hitPolicy, extra = {}) => ({ ...t, hitPolicy, ...extra });

test('DMN 1.3 Figure 8-19: OUTPUT ORDER over a compound output returns rules 2, 4, 3, 1', () => {
  const d = decide(ROUTING_RULES, AGE17);
  assert.deepEqual(d.hits, ['2', '4', '3', '1']);
  assert.deepEqual(d.matched, ['1', '2', '3', '4']);
  assert.throws(() => { ROUTING_RULES.rules[0].when[0] = '< 0'; }, TypeError); // nested parts frozen too
  assert.deepEqual(d.result, [R('DECLINE', 'NONE', 'Applicant too young'), R('REFER', 'LEVEL 2', 'Applicant under debt review'),
    R('REFER', 'LEVEL 1', 'High risk application'), R('ACCEPT', 'NONE', 'Acceptable')]);
  assert.deepEqual(evaluate(ROUTING_RULES, { Age: 30, 'Risk category': 'LOW', 'Debt review': false }), [R('ACCEPT', 'NONE', 'Acceptable')]);
});

test('the same table under every other hit policy (hand-derived from §8.2.10)', () => {
  // PRIORITY: DECLINE outranks REFER outranks ACCEPT -> rule 2.
  assert.deepEqual(decide(withPolicy(ROUTING_RULES, 'P'), AGE17).hits, ['2']);
  // Two REFER rules: Review level breaks the tie (LEVEL 2 first) -> rule 4 (age 30).
  assert.deepEqual(evaluate(withPolicy(ROUTING_RULES, 'P'), { ...AGE17, Age: 30 }), R('REFER', 'LEVEL 2', 'Applicant under debt review'));
  // FIRST: rule 1 matches everything -> ACCEPT (the reading a FIRST/PRIORITY swap gets wrong).
  assert.deepEqual(evaluate(withPolicy(ROUTING_RULES, 'F'), AGE17), R('ACCEPT', 'NONE', 'Acceptable'));
  assert.deepEqual(decide(withPolicy(ROUTING_RULES, 'R'), AGE17).hits, ['1', '2', '3', '4']);
  assert.deepEqual(decide(withPolicy(ROUTING_RULES, 'C'), AGE17).hits, ['1', '2', '3', '4']);
  assert.equal(codeOf(() => evaluate(withPolicy(ROUTING_RULES, 'U'), AGE17)), 'HIT_POLICY'); // R8
  assert.equal(codeOf(() => evaluate(withPolicy(ROUTING_RULES, 'A'), AGE17)), 'HIT_POLICY'); // R8
  assert.deepEqual(evaluate(withPolicy(ROUTING_RULES, 'U'), { Age: 30, 'Risk category': 'LOW', 'Debt review': false }), R('ACCEPT', 'NONE', 'Acceptable'));
  // Aggregation is undefined over compound outputs.
  for (const hp of ['C+', 'C#', 'C<', 'C>']) assert.equal(codeOf(() => compileTable(withPolicy(ROUTING_RULES, hp))), 'HIT_POLICY', hp);
});

test('DMN 1.3 Figure 11-15: complete UNIQUE table, boundaries exact, checker silent', () => {
  const cat = (c, s) => evaluate(PRE_BUREAU_RISK, { 'Existing Customer': c, 'Application Risk Score': s });
  const cases = [[false, 99.5, 'HIGH'], [false, 100, 'MEDIUM'], [false, 119.99, 'MEDIUM'], [false, 120, 'LOW'], [false, 130, 'LOW'],
    [false, 130.01, 'VERY LOW'], [true, 79, 'DECLINE'], [true, 80, 'HIGH'], [true, 90, 'MEDIUM'], [true, 110, 'MEDIUM'], [true, 110.5, 'LOW']];
  for (const [c, s, want] of cases) assert.equal(cat(c, s), want, `${c} ${s}`);
  assert.deepEqual(checkTable(PRE_BUREAU_RISK), []);
  // Mutant: rule 2 closed at 120 overlaps rule 3 at exactly 120.
  const overlap = structuredClone(PRE_BUREAU_RISK); overlap.rules[1].when[1] = '[100..120]';
  assert.deepEqual(checkTable(overlap).map(i => [i.code, i.rules, i.witness]), [['TABLE_OVERLAP', ['2', '3'], { 'Existing Customer': false, 'Application Risk Score': 120 }]]);
  assert.equal(codeOf(() => evaluate(overlap, { 'Existing Customer': false, 'Application Risk Score': 120 })), 'HIT_POLICY');
  // Mutant: rule 4 removed leaves (130, inf) uncovered for existing = false.
  const gap = structuredClone(PRE_BUREAU_RISK); gap.rules.splice(3, 1);
  const gi = checkTable(gap);
  assert.deepEqual(gi.map(i => i.code), ['TABLE_GAP']);
  assert.equal(evaluate(gap, gi[0].witness), null);
  assert.deepEqual(gi[0].witness, { 'Existing Customer': false, 'Application Risk Score': 131 });
});

test('DMN 1.3 Figure 11-17: C+ scorecard, input values enforced, other aggregations', () => {
  const s = (a, m, e, t = APPLICATION_RISK_SCORE) => evaluate(t, { Age: a, 'Marital Status': m, 'Employment Status': e });
  assert.equal(s(51, 'M', 'EMPLOYED'), 48 + 45 + 45);
  assert.equal(s(22, 'S', 'STUDENT'), 35 + 25 + 18); // 22 is in [22..26), not [18..22)
  assert.equal(s(18, 'S', 'UNEMPLOYED'), 32 + 25 + 15);
  assert.equal(s(50, 'M', 'SELF-EMPLOYED'), 48 + 45 + 36); // 50 is >= 50, not [36..50)
  assert.equal(s(120, 'S', 'EMPLOYED'), 48 + 25 + 45);
  assert.equal(codeOf(() => s(17, 'S', 'EMPLOYED')), 'DT_DOMAIN');
  assert.equal(codeOf(() => s(121, 'S', 'EMPLOYED')), 'DT_DOMAIN');
  assert.equal(codeOf(() => s(30, 'D', 'EMPLOYED')), 'DT_DOMAIN');
  assert.equal(codeOf(() => s('30', 'S', 'EMPLOYED')), 'DT_TYPE');
  assert.equal(s(30, 'S', 'STUDENT', withPolicy(APPLICATION_RISK_SCORE, 'C#')), 3); // R3: count of outputs
  assert.equal(s(30, 'S', 'STUDENT', withPolicy(APPLICATION_RISK_SCORE, 'C<')), 18);
  assert.equal(s(30, 'S', 'STUDENT', withPolicy(APPLICATION_RISK_SCORE, 'C>')), 40);
  assert.deepEqual(s(30, 'S', 'STUDENT', withPolicy(APPLICATION_RISK_SCORE, 'C')), [40, 25, 18]); // R4: rule order
  assert.equal(s(30, 'S', 'STUDENT', withPolicy(APPLICATION_RISK_SCORE, 'C', { aggregation: 'SUM' })), 83);
  assert.equal(codeOf(() => compileTable(withPolicy(APPLICATION_RISK_SCORE, 'C+', { aggregation: 'MAX' }))), 'HIT_POLICY');
  assert.equal(codeOf(() => compileTable(withPolicy(APPLICATION_RISK_SCORE, 'R', { aggregation: 'SUM' }))), 'HIT_POLICY');
  assert.deepEqual(checkTable(APPLICATION_RISK_SCORE), []); // complete over its input values
});

test('R2: no hit gives the default output, else null, for every hit policy', () => {
  const t = { id: 't', hitPolicy: 'U', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y', type: 'integer' }], rules: [{ when: ['< 0'], then: 1 }, { when: ['> 10'], then: 2 }] };
  for (const hp of ['U', 'A', 'P', 'F', 'R', 'O', 'C', 'C+', 'C#', 'C<', 'C>']) {
    const tt = withPolicy(t, hp);
    if (hp === 'P' || hp === 'O') tt.outputs = [{ name: 'y', type: 'integer', values: [2, 1] }];
    assert.equal(evaluate(tt, { x: 5 }), null, hp);
    assert.deepEqual(decide({ ...tt, default: 1 }, { x: 5 }), { result: 1, matched: [], hits: [], usedDefault: true }, hp);
  }
  const compound = { id: 'c', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'a' }, { name: 'b' }], rules: [{ when: ['1'], then: ['p', 'q'] }], default: { a: 'z', b: 'w' } };
  assert.deepEqual(evaluate(compound, { x: 2 }), { a: 'z', b: 'w' });
  assert.equal(codeOf(() => compileTable({ ...compound, default: { a: 'z' } })), 'DT_INVALID');
});

test('R1: "-" does not match null unless dashMatchesNull; nulls only for nullable inputs', () => {
  const t = { id: 'n', hitPolicy: 'F', inputs: [{ name: 'x', type: 'string', nullable: true }], outputs: [{ name: 'y' }],
    rules: [{ when: ['"A"'], then: 'a' }, { when: ['-'], then: 'any' }, { when: ['null'], then: 'was null' }] };
  assert.equal(evaluate(t, { x: 'B' }), 'any');
  assert.equal(evaluate(t, { x: null }), 'was null'); // §10.3.2.10: '-' requires e != null
  assert.equal(evaluate(t, {}), 'was null'); // a missing input is null
  assert.equal(evaluate(t, { x: null }, { dashMatchesNull: true }), 'any'); // §9 reading
  const strict = { ...t, inputs: [{ name: 'x', type: 'string' }] };
  assert.equal(codeOf(() => evaluate(strict, { x: null })), 'DT_TYPE');
  // not(...) is satisfied only when the inner list is false; null makes it null, not true.
  const n = { id: 'not', hitPolicy: 'F', inputs: [{ name: 'x', type: 'integer', nullable: true }], outputs: [{ name: 'y' }], rules: [{ when: ['not(< 5)'], then: 'big' }] };
  assert.equal(evaluate(n, { x: 7 }), 'big');
  assert.equal(evaluate(n, { x: 3 }), null);
  assert.equal(evaluate(n, { x: null }), null);
  // §10.3.2.10 grammar rule 15.c with input values v: '-' is satisfied iff FEEL(e in (v)) (review P2: it ignored v).
  const v = { id: 'v', hitPolicy: 'F', inputs: [{ name: 'x', type: 'integer', nullable: true, values: '1, 2, null' }], outputs: [{ name: 'y' }], rules: [{ when: ['-'], then: 'any' }] };
  assert.equal(evaluate(v, { x: null }), 'any'); // null is in (1, 2, null)
  assert.equal(evaluate(v, { x: 2 }), 'any');
  assert.equal(evaluate({ ...v, inputs: [{ ...v.inputs[0], values: '[1..2]' }] }, { x: null }), null); // null in [1..2] is null, not true
  assert.deepEqual(checkTable(v), []); // the checker uses the same reading: no gap at null
  assert.equal(codeOf(() => evaluate(v, { x: 3 })), 'DT_DOMAIN'); // outside the input values: refused (R1, stricter than 15.c)
});

test('R5: a PRIORITY tie at the top between different outputs is refused; OUTPUT ORDER ties keep rule order; FIRST shadowing is reported', () => {
  const t = { id: 'tie', hitPolicy: 'P', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'level', values: ['HIGH', 'LOW'] }, { name: 'note' }],
    rules: [{ when: ['>= 0'], then: ['LOW', 'first'] }, { when: ['>= 5'], then: ['HIGH', 'second'] }, { when: ['>= 5'], then: ['HIGH', 'third'] }] };
  // Review P2: this returned 'second' (or 'third' with the rules permuted); the result is undefined, so it is refused.
  assert.equal(codeOf(() => evaluate(t, { x: 7 })), 'HIT_POLICY');
  assert.equal(codeOf(() => evaluate({ ...t, rules: [t.rules[0], t.rules[2], t.rules[1]] }, { x: 7 })), 'HIT_POLICY');
  assert.deepEqual(evaluate(t, { x: 1 }), { level: 'LOW', note: 'first' });
  const issues = checkTable(t);
  assert.deepEqual(issues.map(i => [i.code, i.severity, i.rules]), [['HIT_POLICY', 'error', ['2', '3']], ['TABLE_GAP', 'warning', undefined], ['TABLE_SHADOWED', 'warning', ['3']]]);
  assert.equal(issues[0].witness.x, 5);
  assert.equal(issues[1].witness.x, -1);
  // Equal outputs at the top are no tie; a tie below the top is never the result.
  assert.deepEqual(evaluate({ ...t, rules: [t.rules[0], t.rules[1], { when: ['>= 6'], then: ['HIGH', 'second'] }] }, { x: 7 }), { level: 'HIGH', note: 'second' });
  const low = { ...t, rules: [{ when: ['>= 0'], then: ['LOW', 'a'] }, { when: ['>= 0'], then: ['LOW', 'b'] }, { when: ['>= 5'], then: ['HIGH', 'c'] }] };
  assert.deepEqual(evaluate(low, { x: 7 }), { level: 'HIGH', note: 'c' });
  assert.deepEqual(checkTable(low).filter(i => i.code === 'HIT_POLICY').map(i => [i.severity, i.rules, i.witness.x]), [['error', ['1', '2'], 0]]); // at x < 5 the tie is on top
  // OUTPUT ORDER: tied rules are listed in rule order, a warning.
  const o = { ...t, hitPolicy: 'O' };
  assert.deepEqual(evaluate(o, { x: 7 }).map(r => r.note), ['second', 'third', 'first']);
  assert.deepEqual(checkTable(o).filter(i => i.code === 'HIT_POLICY').map(i => [i.severity, i.rules]), [['warning', ['2', '3']]]);
  // Number inputs: the midpoint witness finds the gap (1, 2) between '<= 1' and '>= 2' (review P2: no golden had it).
  const mid = { id: 'mid', inputs: [{ name: 'x', type: 'number' }], outputs: [{ name: 'y' }], rules: [{ when: ['<= 1'], then: 'a' }, { when: ['>= 2'], then: 'b' }] };
  assert.deepEqual(checkTable(mid).map(i => [i.code, i.witness]), [['TABLE_GAP', { x: 1.5 }]]);
  assert.deepEqual(checkTable({ ...mid, inputs: [{ name: 'x', type: 'integer' }] }), []); // no integer lies in (1, 2)
  const f = { id: 'first', hitPolicy: 'F', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y' }], rules: [{ when: ['< 20'], then: 'a' }, { when: ['< 10'], then: 'b' }, { when: ['-'], then: 'c' }] };
  assert.deepEqual(checkTable(f).map(i => [i.code, i.rules]), [['TABLE_SHADOWED', ['2']]]);
  assert.equal(codeOf(() => compileTable({ ...t, outputs: [{ name: 'level' }, { name: 'note' }] })), 'HIT_POLICY'); // no priorities
});

test('ANY: equal outputs pass, unequal outputs are an overlap error', () => {
  const t = { id: 'any', hitPolicy: 'A', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y' }],
    rules: [{ when: ['[0..10]'], then: 'ok' }, { when: ['[5..15]'], then: 'ok' }, { when: ['> 15'], then: 'high' }, { when: ['>= 15'], then: 'hi' }] };
  assert.equal(evaluate(t, { x: 7 }), 'ok'); // rules 1 and 2 agree
  assert.equal(codeOf(() => evaluate(t, { x: 16 })), 'HIT_POLICY'); // rules 3 and 4 disagree
  assert.equal(codeOf(() => evaluate(t, { x: 15 })), 'HIT_POLICY'); // rule 2 [5..15] and rule 4 >= 15 disagree
  const codes = checkTable(t).map(i => [i.code, i.severity, i.rules, i.witness?.x]);
  assert.deepEqual(codes, [['TABLE_OVERLAP', 'error', ['2', '4'], 15], ['TABLE_OVERLAP', 'error', ['3', '4'], 16], ['TABLE_GAP', 'warning', undefined, -1]]);
});

test('S-FEEL unary tests: grammar, intervals, types, refusals', () => {
  const one = (src, type, x) => evaluate({ id: 's', hitPolicy: 'F', inputs: [{ name: 'x', type }], outputs: [{ name: 'y' }], rules: [{ when: [src], then: 'hit' }] }, { x }) === 'hit';
  assert.equal(one('(1..5)', 'number', 1), false);
  assert.equal(one(']1..5[', 'number', 1.5), true);
  assert.equal(one(']1..5[', 'number', 5), false);
  assert.equal(one('[1..5[', 'number', 1), true);
  assert.equal(one('(1..5]', 'number', 5), true);
  assert.equal(one('< -2.5', 'number', -3), true);
  assert.equal(one('1, 3, > 10', 'integer', 3), true);
  assert.equal(one('1, 3, > 10', 'integer', 2), false);
  assert.equal(one('not("A", "B")', 'string', 'C'), true);
  assert.equal(one('not("A", "B")', 'string', 'A'), false);
  assert.equal(one('"say \\"hi\\""', 'string', 'say "hi"'), true);
  assert.equal(one('>= date("2026-07-01")', 'date', '2026-07-01'), true);
  assert.equal(one('[date("2026-01-01")..date("2026-06-30")]', 'date', '2026-07-01'), false);
  assert.equal(one('false', 'boolean', false), true);
  for (const [src, type, code] of [
    ['"5"', 'number', 'DT_TYPE'], ['< "a"', 'string', 'DT_TYPE'], ['[1..2]', 'string', 'DT_TYPE'], ['"2026-01-01"', 'date', 'DT_TYPE'],
    ['< null', 'number', 'DT_TYPE'], ['foo', 'string', 'DT_SYNTAX'], ['"open', 'string', 'DT_SYNTAX'], ['1 + 2', 'number', 'DT_SYNTAX'],
    ['[1..2', 'number', 'DT_SYNTAX'], ['', 'number', 'DT_SYNTAX'], ['- 5', 'number', 'DT_SYNTAX'], ['.5', 'number', 'DT_SYNTAX'],
    ['date("2026-02-30")', 'date', 'DATE_INVALID'], ['"a\\n"', 'string', 'DT_SYNTAX'],
  ]) assert.equal(codeOf(() => one(src, type, null)), code, src);
  assert.deepEqual(parseUnaryTests('-'), { k: 'any' });
  assert.equal(parseLiteral('date("2026-03-01")'), '2026-03-01');
  assert.equal(parseLiteral('-12.50'), -12.5);
  assert.equal(codeOf(() => parseLiteral('< 3')), 'DT_SYNTAX');
});

test('table validation: output values, arity, types, SUM exactness', () => {
  const base = { id: 'v', hitPolicy: 'U', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y', type: 'string', values: ['A', 'B'] }], rules: [{ when: ['1'], then: 'A' }] };
  assert.equal(codeOf(() => compileTable({ ...base, rules: [{ when: ['1'], then: 'C' }] })), 'DT_OUTPUT_VALUE');
  assert.equal(codeOf(() => compileTable({ ...base, default: 'C' })), 'DT_OUTPUT_VALUE');
  assert.equal(codeOf(() => compileTable({ ...base, rules: [{ when: ['1', '2'], then: 'A' }] })), 'DT_INVALID');
  assert.equal(codeOf(() => compileTable({ ...base, rules: [{ when: ['1'], then: 3 }] })), 'DT_TYPE');
  assert.equal(codeOf(() => compileTable({ ...base, hitPolicy: 'X' })), 'HIT_POLICY');
  assert.equal(codeOf(() => compileTable({ ...base, inputs: [{ name: 'x', type: 'money' }] })), 'DT_TYPE');
  assert.equal(codeOf(() => compileTable({ ...base, outputs: [{ name: 'x' }] })), 'DT_INVALID'); // duplicate column name
  assert.equal(codeOf(() => compileTable({ ...base, rules: [{ id: 'r', when: ['1'], then: 'A' }, { id: 'r', when: ['2'], then: 'B' }] })), 'DT_INVALID');
  const sum = { id: 's', hitPolicy: 'C+', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y' }], rules: [{ when: ['-'], then: 0.1 }, { when: ['-'], then: 0.2 }] };
  assert.equal(codeOf(() => compileTable(sum)), 'DT_TYPE'); // R7: no float sums (0.1 + 0.2 != 0.3)
  const big = { ...sum, rules: [{ when: ['-'], then: Number.MAX_SAFE_INTEGER }, { when: ['-'], then: 1 }] };
  assert.equal(codeOf(() => evaluate(big, { x: 1 })), 'DT_TYPE');
  assert.equal(evaluate({ ...sum, rules: [{ when: ['-'], then: 999999999999 }, { when: ['-'], then: 1 }] }, { x: 1 }), 1000000000000);
  const dates = { id: 'd', hitPolicy: 'C<', inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'due', type: 'date' }], rules: [{ when: ['-'], then: '2026-03-01' }, { when: ['> 0'], then: '2026-02-28' }] };
  assert.equal(evaluate(dates, { x: 1 }), '2026-02-28');
  assert.equal(evaluate({ ...dates, hitPolicy: 'C>' }, { x: 1 }), '2026-03-01');
  assert.equal(compileTable(base), compileTable(base)); // memoised per table object
  assert.throws(() => { base.rules.push({ when: ['2'], then: 'B' }); }, TypeError); // frozen on first use: no stale cache
});

test('precedence levels: the first level with a hit decides (item+vendor > vendor > all)', () => {
  const lvl = (id, rules) => ({ id, table: { id, hitPolicy: 'U', inputs: [{ name: 'vendor', type: 'string' }, { name: 'item', type: 'string' }], outputs: [{ name: 'pct', type: 'integer' }], rules } });
  const levels = [
    lvl('item+vendor', [{ when: ['"V1"', '"I1"'], then: 2 }]),
    lvl('vendor', [{ when: ['"V1"', '-'], then: 5 }, { when: ['"V2"', '-'], then: 7 }]),
    lvl('all', [{ when: ['-', '-'], then: 10 }]),
  ];
  assert.deepEqual([firstLevel(levels, { vendor: 'V1', item: 'I1' }).level, firstLevel(levels, { vendor: 'V1', item: 'I1' }).result], ['item+vendor', 2]);
  assert.equal(firstLevel(levels, { vendor: 'V1', item: 'I9' }).result, 5);
  assert.equal(firstLevel(levels, { vendor: 'V3', item: 'I9' }).result, 10);
  assert.deepEqual(firstLevel(levels.slice(0, 2), { vendor: 'V3', item: 'I9' }), { level: null, result: null, decision: null });
  const withDefault = [{ id: 'd', table: { ...levels[0].table, default: 0 } }];
  assert.equal(codeOf(() => firstLevel(withDefault, { vendor: 'V1', item: 'I1' })), 'HIT_POLICY');
});

test('CSV tables: strict parsing and the Figure 11-15 table from CSV', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x,1","say ""hi"""\n'), [['a', 'b'], ['x,1', 'say "hi"']]);
  assert.deepEqual(parseCsv('a,b\n1,\n'), [['a', 'b'], ['1', '']]);
  for (const bad of ['a,b\n1\n', 'a,"b\n', 'a,b"c\n', 'a,"b"c\n']) assert.equal(codeOf(() => parseCsv(bad)), 'DT_SYNTAX', bad);
  const csv = [
    'Existing Customer,Application Risk Score,Pre-bureau risk category,why',
    'false,< 100,"""HIGH""",r1', 'false,[100..120),"""MEDIUM""",r2', 'false,[120..130],"""LOW""",r3', 'false,> 130,"""VERY LOW""",r4',
    'true,< 80,"""DECLINE""",r5', 'true,[80..90),"""HIGH""",r6', 'true,[90..110],"""MEDIUM""",r7', 'true,> 110,"""LOW""",r8',
  ].join('\n');
  const t = tableFromCsv(csv, { id: 'pre-csv', hitPolicy: 'U', inputs: PRE_BUREAU_RISK.inputs, outputs: PRE_BUREAU_RISK.outputs, annotations: ['why'] });
  for (const [c, s] of [[false, 120], [false, 131], [true, 80], [true, 110.5]]) {
    assert.equal(evaluate(t, { 'Existing Customer': c, 'Application Risk Score': s }), evaluate(PRE_BUREAU_RISK, { 'Existing Customer': c, 'Application Risk Score': s }));
  }
  assert.deepEqual(checkTable(t), []);
  assert.equal(codeOf(() => tableFromCsv('x,y\n1,2\n', { inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'z' }] })), 'DT_SYNTAX');
  assert.equal(codeOf(() => tableFromCsv('x,y\n1,HIGH\n', { inputs: [{ name: 'x', type: 'integer' }], outputs: [{ name: 'y' }] })), 'DT_SYNTAX'); // unquoted output text
});
