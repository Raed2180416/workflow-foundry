// Fixtures for the oracle-side library tests: public worked examples transcribed from their sources (with page or
// figure), and hand-built cases. Test data only; no item oracle imports this file.

// OMG DMN 1.3 (https://www.omg.org/spec/DMN/1.3/PDF, sha256 b591d241...bf6a6), §8.2.10, printed p. 74, Figure 8-19
// "Output order with compound output". The text states: called with Age = 17, Risk category = "HIGH" and Debt review =
// true, the table "would return the outputs of all four rules, in the order 2, 4, 3, 1".
export const ROUTING_RULES = Object.freeze({
  id: 'routing-rules', hitPolicy: 'O',
  inputs: [
    { name: 'Age', type: 'number' },
    { name: 'Risk category', type: 'string', values: '"LOW", "MEDIUM", "HIGH"' },
    { name: 'Debt review', type: 'boolean' },
  ],
  outputs: [
    { name: 'Routing', type: 'string', values: ['DECLINE', 'REFER', 'ACCEPT'] },
    { name: 'Review level', type: 'string', values: ['LEVEL 2', 'LEVEL 1', 'NONE'] },
    { name: 'Reason', type: 'string' },
  ],
  rules: [
    { when: ['-', '-', '-'], then: ['ACCEPT', 'NONE', 'Acceptable'] },
    { when: ['< 18', '-', '-'], then: ['DECLINE', 'NONE', 'Applicant too young'] },
    { when: ['-', '"HIGH"', '-'], then: ['REFER', 'LEVEL 1', 'High risk application'] },
    { when: ['-', '-', 'true'], then: ['REFER', 'LEVEL 2', 'Applicant under debt review'] },
  ],
});

// DMN 1.3 §11 example, printed p. 174, Figure 11-15 "Pre-bureau risk category table": a complete UNIQUE table.
export const PRE_BUREAU_RISK = Object.freeze({
  id: 'pre-bureau-risk-category', hitPolicy: 'U',
  inputs: [{ name: 'Existing Customer', type: 'boolean' }, { name: 'Application Risk Score', type: 'number' }],
  outputs: [{ name: 'Pre-bureau risk category', type: 'string', values: ['DECLINE', 'HIGH', 'MEDIUM', 'LOW', 'VERY LOW'] }],
  rules: [
    ['false', '< 100', 'HIGH'], ['false', '[100..120)', 'MEDIUM'], ['false', '[120..130]', 'LOW'], ['false', '> 130', 'VERY LOW'],
    ['true', '< 80', 'DECLINE'], ['true', '[80..90)', 'HIGH'], ['true', '[90..110]', 'MEDIUM'], ['true', '> 110', 'LOW'],
  ].map(([a, b, o]) => ({ when: [a, b], then: o })),
});

// DMN 1.3 §11 example, printed p. 175, Figure 11-17 "Application risk score model": a C+ scorecard with input values.
export const APPLICATION_RISK_SCORE = Object.freeze({
  id: 'application-risk-score-model', hitPolicy: 'C+',
  inputs: [
    { name: 'Age', type: 'number', values: '[18..120]' },
    { name: 'Marital Status', type: 'string', values: '"S", "M"' },
    { name: 'Employment Status', type: 'string', values: '"UNEMPLOYED", "STUDENT", "EMPLOYED", "SELF-EMPLOYED"' },
  ],
  outputs: [{ name: 'Application risk score model', type: 'integer' }],
  rules: [
    ['[18..22)', '-', '-', 32], ['[22..26)', '-', '-', 35], ['[26..36)', '-', '-', 40], ['[36..50)', '-', '-', 43], ['>=50', '-', '-', 48],
    ['-', '"S"', '-', 25], ['-', '"M"', '-', 45],
    ['-', '-', '"UNEMPLOYED"', 15], ['-', '-', '"STUDENT"', 18], ['-', '-', '"EMPLOYED"', 45], ['-', '-', '"SELF-EMPLOYED"', 36],
  ].map(r => ({ when: r.slice(0, 3), then: r[3] })),
});

// A hand-built X12 835 remittance in cents. Claim C1: two lines with contractual (CO-45), deductible (PR-1) and
// coinsurance (PR-2) adjustments; claim C2 denied at claim level (CO-97). Provider-level: interest L6 -150 (increases
// the payment), overpayment recovery WO 2,000. BPR02 = (17,200 + 0) - (-150 + 2,000) = 15,350.
export const REMIT_835 = Object.freeze({
  bpr02: 15350,
  claims: [
    { id: 'C1', clp03: 25000, clp04: 17200, adjustments: [], lines: [
      { id: 'L1', svc02: 15000, svc03: 10000, adjustments: [{ group: 'CO', reason: '45', amount: 3000 }, { group: 'PR', reason: '1', amount: 2000 }] },
      { id: 'L2', svc02: 10000, svc03: 7200, adjustments: [{ group: 'CO', reason: '45', amount: 1000 }, { group: 'PR', reason: '2', amount: 1800 }] },
    ] },
    { id: 'C2', clp03: 5000, clp04: 0, adjustments: [{ group: 'CO', reason: '97', amount: 5000 }], lines: [] },
  ],
  plb: [{ reason: 'L6', amount: -150 }, { reason: 'WO', amount: 2000 }],
});

// The order-fulfilment saga shape of E-BED §3 E8 (bar version): reserve, charge, ship; a notification with nothing to
// undo. Hand-built; no item semantics beyond the step order.
export const ORDER_SAGA = Object.freeze({
  id: 'order-1',
  steps: [
    { id: 'reserve', do: { system: 'inventory', op: 'reserve' }, undo: { system: 'inventory', op: 'release' }, subject: { orderId: 'O-1' }, itemArg: 'sku' },
    { id: 'charge', do: { system: 'billing', op: 'charge' }, undo: { system: 'billing', op: 'refund' }, subject: { orderId: 'O-1' } },
    { id: 'ship', do: { system: 'carrier', op: 'create' }, undo: { system: 'carrier', op: 'cancel' }, subject: { orderId: 'O-1' } },
    { id: 'notify', do: { system: 'notify', op: 'send' }, undo: null, subject: { orderId: 'O-1' } },
  ],
});
