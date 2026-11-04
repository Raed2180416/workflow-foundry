// Child process for scenario S13: runs a named scenario with the runtime's own fault injection (extra.crashAfterModel), which kills this
// process with SIGKILL right after the model call's journal row commits. The parent then reads a run that says "running" with a dead owner.
//   node app/eval/run-graph/crash-child.mjs DIR SCENARIO
import { NAMED, scenarioRegistry } from './scenarios.mjs';
import { environment } from '../../../tools/run-view/make-fixtures.mjs';

const [dir, name] = process.argv.slice(2);
const sc = NAMED[name]();
const env = environment(dir, sc.script, {}, sc.registry ?? scenarioRegistry());
env.store.saveWorkflow(sc.workflow);
const run = env.runtime.create(sc.workflow, sc.input, { extra: { crashAfterModel: sc.crashAfterModel } });
process.stdout.write(`${run.id}\n`);
await env.runtime.execute(run.id);
process.stdout.write('not-crashed\n');
