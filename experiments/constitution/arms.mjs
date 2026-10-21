// Constitution-aware arms (W-C, A-HV, A-F; research/org-20261021/PREDICTION.md §1): what such an arm gets on top of E8.
//   withConstitutionFiles(arm, registry) puts the registry's arm-visible files (time-gated: proposals and approvals up to
//     the tick's `now`, no gate decision) into ctx.files under constitution/; the host itself is unchanged.
//   CONSTITUTION_ARM_TEXT is the builder- and agent-facing text (builder/CONSTITUTION-ARM.md, frozen with the prereg).
//   constitutionRunner(run) prepends that text to every agent tick prompt (A-HV, A-F): "the constitution in its prompt".
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const CONSTITUTION_ARM_FILE = fileURLToPath(new URL('./builder/CONSTITUTION-ARM.md', import.meta.url));
export const CONSTITUTION_ARM_TEXT = readFileSync(CONSTITUTION_ARM_FILE, 'utf8');

/** The arm with the constitution registry's files in its ctx (as of each tick's `now`). */
export function withConstitutionFiles(arm, registry) {
  return {
    ...arm,
    id: arm.id,
    tick(input, ctx) {
      const extra = registry.filesAt(Date.parse(input.now));
      return arm.tick(input, { ...ctx, files: { ...ctx.files, ...extra } });
    },
    close: () => arm.close?.(),
  };
}

/** A session runner that puts the constitution text in front of each tick prompt. `run` is the model's executor run. */
export const constitutionRunner = run => opts => run({ ...opts, prompt: `${CONSTITUTION_ARM_TEXT}\n\n---\n\n${opts.prompt}` });

/** The contract text for constitution-aware agents: the B1 contract plus the constitution (CONTRACT.md in their workdir). */
export const contractWithConstitution = contract => `${contract}\n\n${CONSTITUTION_ARM_TEXT}`;
