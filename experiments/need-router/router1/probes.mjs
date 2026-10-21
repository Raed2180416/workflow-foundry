// ROUTER-1 synthetic probes: requests written by the router author AFTER the router freeze (f9641ff9) and BEFORE any test-split
// output was computed, to find detector defects of the kind a product test exposed ("Every Monday ..., pull last week's ...").
// They are author-written tuning data for v1.1 (PREREG-ROUTER-1 §8 D4), never evidence. Labels follow RUBRIC.md.
//
//   node experiments/need-router/router1/probes.mjs     # prints each probe whose router mode disagrees with its label
export const PROBES = [
  // recurring
  ['recurring', "Every Monday at 9, pull last week's signups from Stripe, post the count to #growth and email the CFO."],
  ['recurring', "Each morning, summarize yesterday's support tickets and send the summary to the support lead."],
  ['recurring', 'At the end of every month, reconcile the Amex statement against Expensify and flag anything unmatched to me.'],
  ['recurring', 'Whenever a candidate moves to onsite in Greenhouse, book the panel, send the prep doc and remind interviewers the day before.'],
  ['recurring', 'Please keep our status page in sync with PagerDuty incidents from now on.'],
  ['recurring', 'can you watch the competitor pricing page and tell me when they change anything'],
  ['recurring', 'Run the nightly data quality checks on the warehouse and open a Jira ticket for every failed check.'],
  ['recurring', 'Every quarter, collect the access reviews from each team lead, chase the late ones, and file the evidence for SOC 2.'],
  // workflow
  ['workflow', 'Get three quotes for the new office chairs, send them to Dana for approval, and place the order once she approves.'],
  ['workflow', 'Offboard Marcus: revoke his Okta, GitHub and Slack access on his last day (Friday), collect his laptop, and send final pay to payroll.'],
  ['workflow', 'Migrate our 40 customer databases to the new cluster in waves of five, verifying row counts after each wave and stopping if any check fails.'],
  ['workflow', 'Run our preregistered evaluation: freeze the test cases, run all four arms, score them with the frozen oracle and report every deviation.'],
  ['workflow', 'Collect signed NDAs from all 12 vendors in the attached list, chase anyone who has not signed after three days, and file each signed copy in Drive.'],
  // checklist
  ['checklist', 'Rotate the production database password tonight and update the secret in Vault.'],
  ['checklist', 'Wire $85,000 to the new supplier account for the deposit.'],
  ['checklist', 'Send the outage apology email to all 12,000 affected customers.'],
  // none: coding, questions, writing, one actions, configs
  ['none', 'Write a cron expression that runs at 9am every weekday.'],
  ['none', 'Add a GitHub Actions job that deploys to staging on every merge to main.'],
  ['none', 'Set up a Grafana alert that fires when p99 latency is above 500 ms for five minutes.'],
  ['none', 'How do I make a Zapier zap run every hour?'],
  ['none', 'What did we spend on AWS each month last year? The bills are attached.'],
  ['none', 'Write a weekly newsletter template for our customers.'],
  ['none', 'Explain how approval workflows work in SAP Ariba.'],
  ['none', 'Draft a policy for how we handle refunds over $500.'],
  ['none', 'Refactor the billing module to use the new tax API and keep all tests passing.'],
  ['none', 'Our nightly build has been failing since Tuesday; find out why and fix it.'],
  ['none', 'Email Priya the Q3 deck.'],
  ['none', 'Create a Jira ticket for the login bug and assign it to Sam.'],
  ['none', 'Summarize the 30 interview transcripts in the folder and list the top five themes.'],
  ['none', 'Every time I open the app it crashes on launch; here is the stack trace.'],
  ['none', 'Translate the attached contract into German.'],
  ['none', 'What should our approval process for expenses over $1,000 look like?'],
  ['none', 'Compare our weekly active users this month with last month using the attached CSV.'],
  ['none', 'I review PRs every day; give me a checklist for a good code review.'],
  ['none', 'Book a dentist appointment for next Tuesday afternoon.'],
  ['none', 'Write a Python script that emails me the weather every morning.'],
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const { needCheck } = await import('../../../src/need/router.mjs');
  let wrongBinary = 0, wrongMode = 0;
  for (const [mode, text] of PROBES) {
    const c = needCheck(text);
    const needs = mode === 'workflow' || mode === 'recurring';
    if (c.needsWorkflow !== needs) wrongBinary++;
    if (c.mode !== mode) { wrongMode++; console.log(`${c.needsWorkflow !== needs ? 'BINARY' : 'mode  '} gold ${mode.padEnd(9)} got ${c.mode.padEnd(9)} p ${c.p.toFixed(3)}  ${text.slice(0, 100)}\n        ${c.primitives.slice(0, 4).map(x => `${x.name}=${x.score.toFixed(2)}[${x.cues.slice(0, 2).map(q => q.id).join(',')}]`).join(' ')} | ${c.dampeners.slice(0, 3).map(x => `${x.name}=${x.score.toFixed(2)}`).join(' ')}`); }
  }
  console.log(`${PROBES.length} probes: ${wrongBinary} binary errors, ${wrongMode} mode errors`);
}
