// Known-bad controls: each takes a task and returns an episode record the oracle must reject.
// Near misses are the call-for-call transcription of the original with ONE thing broken (so they fail for exactly the reason named).
import { driveSync } from '../env.mjs';
import { CONFIG } from '../scenarios.mjs';
import { makeFaithful } from './reference.mjs';
import { rng } from '../../../../../beds/lib/rng.mjs';
import { buildExamples } from '../examples.mjs';

const near = bugs => task => driveSync(task, makeFaithful(CONFIG, { bugs }));

// name -> { describe, expect: violation codes the oracle must raise on every seed, make }
export const BROKEN = [
  { name: 'empty', describe: 'do-nothing: every event is acknowledged and nothing is called', expect: ['MISSING_ZOHO', 'MISSING_KT'], make: () => ({ actions: [] }) },
  {
    name: 'shuffled-or-corrupted', describe: 'the correct call sequence with its actions shuffled',
    expect: [],
    make(task) {
      const good = driveSync(task, makeFaithful(CONFIG)).actions;
      return { actions: rng('rbench-shuffle', task.split, task.seed, task.difficulty).shuffle(good) };
    },
  },
  { name: 'plausible-but-wrong', describe: 'works except that every Zoho edit forces Email_Opt_Out=false, silently undoing a KlickTipp unsubscribe', expect: ['OPTOUT_MISMATCH'], make: near({ optOutIgnored: true }) },
  { name: 'no-ui-user-guard', describe: 'the loop guard is missing: the integration reacts to its own Zoho writes', expect: ['ECHO_LOOP'], make: near({ noGuard: true }) },
  { name: 'single-and-double-opt-in-swapped', describe: 'Zoho create/update uses the double opt-in list and web-form submissions the single opt-in list', expect: ['LIST_WRONG'], make: near({ swapOptIn: true }) },
  { name: 'zoho-delete-not-propagated', describe: 'a contact deleted in Zoho keeps its KlickTipp subscriber', expect: ['EXTRA_KT'], make: near({ noDeleteZ: true }) },
  { name: 'klicktipp-delete-not-propagated', describe: 'a subscriber deleted in KlickTipp keeps its Zoho contact', expect: ['EXTRA_ZOHO'], make: near({ noDeleteK: true }) },
  { name: 'ids-linked-one-way', describe: 'the cross-link ids are never written back (Zoho KlickTipp_ID and the subscriber Zoho-id field stay empty on one side)', expect: ['LINK_BROKEN'], make: near({ oneWayLink: true }) },
  { name: 'duplicate-on-every-edit', describe: 'a KlickTipp edit always creates a new Zoho contact instead of updating the linked one', expect: ['DUP_CREATE'], make: near({ alwaysCreate: true }) },
  { name: 'segments-not-synced', describe: 'segment tags are never carried over in either direction', expect: ['SEGMENT_MISMATCH:klicktipp', 'SEGMENT_MISMATCH:zoho'], make: near({ noSegments: true }) },
  { name: 'activation-tag-echo', describe: 'every KlickTipp subscriber the integration touches gets the activation tag, so KlickTipp posts it back', expect: ['ECHO_WRITE'], make: near({ activationEcho: true }) },
  {
    name: 'replayed-example-trace', describe: 'overfit: submits the call trace that solved the worked examples, for a task with different data',
    expect: [],
    make(task) { return { actions: buildExamples().replayTrace }; },
  },
];
