// What the solver is told. Three variants of one job (README section 2):
//   T1 translate  the original workflow + the interfaces; judged on how the ORIGINAL behaves, odd inputs included;
//   T2 rebuild    only the author's description, the maintainers' rules and worked examples; judged on the maintainers' intent;
//   T3 improve    the original + the rules + a cost/latency target; judged on the maintainers' intent and the target.
// Nothing here is read by the oracle. Corpus text (the original) is data the solver reads, never instructions to follow.
import { COMPOSE_PATH, PR, REFERENCE_URL } from './spec.mjs';

export const DESCRIPTION = `SHAFT is a test-automation framework. It ships a docker-compose file that starts a Selenium Grid: a hub and Chrome, Edge and Firefox browser nodes (\`${COMPOSE_PATH}\`). The images in it are pinned to dated release tags such as \`selenium/node-chrome:4.35.0-20250909\`.

To keep that file from going stale, a maintainer bot runs every Monday at 08:00 UTC (and on demand). It looks at the Selenium project's own reference compose file, ${REFERENCE_URL}, reads the tags published there for \`selenium/node-chrome\`, \`selenium/node-edge\`, \`selenium/node-firefox\` and \`selenium/hub\`, and compares them with the tags in the repository's file. Only stable builds are wanted: never a nightly, beta or dev build. Where a tag differs, the bot rewrites the old tag to the new one, checks that the edited file still loads with \`docker compose config\`, and opens a pull request for a human to review. When nothing differs it does nothing at all: no commit and no pull request. The weekly job must not pile up pull requests: there is at most one bot pull request open at a time, and later runs update it.`;

export const RULES = `Rules the maintainers hold the bot to (the hidden scenarios check exactly these):

R1 Tags. The tag of an image in a compose file is the text after \`selenium/<image>:\` on that image's first real \`image:\` line, where "real" means not commented out. YAML quotes around the reference, a trailing comment and trailing white space are not part of the tag; a line may end in CRLF. A file with no such line has no tag for that image: report "".
R2 Stable builds only. A reference tag that contains nightly, beta or dev (any case) is reduced to its stable part, the first text of the form N.N.N-N (for example 4.36.0-20250915-nightly gives 4.36.0-20250915). If it has no such part, the run fails (R7).
R3 The edit. For every image that has a tag in the repository file and a different tag in the reference, rewrite every occurrence of \`selenium/<image>:<old tag>\` in the repository file to \`selenium/<image>:<new tag>\`: also in comments and on a second service that uses the same image. Nothing else in the file changes, byte for byte; quoting stays as it is. An image that is not in the repository file is not added.
R4 Nothing to do. If the edit (R3) leaves the repository file as it is, there is no commit and no pull request, and the status is "unchanged".
R5 The pull request. Otherwise open a pull request from branch \`${PR.branch}\` into \`${PR.base}\` that changes only \`${COMPOSE_PATH}\`, with title "${PR.title}", labels ${PR.labels.map(l => `\`${l}\``).join(' and ')}, and a commit message and a body that list every changed image with its old and its new tag.
R6 One pull request. If a pull request from that branch is already open, it is updated (the service does this when you use the same branch), never joined by a second one. Pull requests from other branches are not touched. With nothing to change, an open bot pull request is left alone.
R7 Failure. The run fails, changes nothing and opens nothing when: the reference cannot be fetched; the reference does not answer with a compose file that has a tag for all four images; a reference tag is a pre-release with no stable part (R2); or the edited file would not load. A failed run says what is wrong in its message: for a reference that could not be fetched, or does not have all four images, the message must name the reference file (say "reference") and, where an image is missing, that image; for a pre-release it must name the tag or say pre-release. Never open a pull request from a bad reference.
R8 Report. Whatever the outcome, report in \`versions\` the tag found for each image in the repository file ("current") and the tag taken from the reference after R2 ("latest"); "" for an image that has none. On a failed run report what you have.`;

export const CONTRACT = `## What you receive and what you return

Your solution is a function \`solve(inputs)\` that returns a plan (a JSON object). It cannot make network calls or touch files itself: the host has already done the one HTTP GET, and it applies your plan to a copy of the repository.

inputs = {
  trigger,                  // "schedule" or "workflow_dispatch" (it makes no difference to the job)
  repo_files,               // { path: content } of the checked-out repository: "${COMPOSE_PATH}" and "README.md"
  reference_fetch,          // the answer to GET ${REFERENCE_URL}:
                            //   { url, status, body }  (any HTTP status; the body is whatever came back)  or  { url, error }  (no answer)
  open_pull_requests        // [{ number, head, base, title }] already open in the repository
}

plan = {
  status,        // "updated" (a pull request is opened or updated), "unchanged" (nothing to do) or "failed"
  versions,      // { current: { chrome, edge, firefox, hub }, latest: { chrome, edge, firefox, hub } }  all strings, "" if none
  files,         // { path: complete new content } for every file you edit in the working tree ({} if none)
  pull_request,  // { open: false }  or  { open: true, branch, title, commit_message, body, labels: [..] }
  message        // what the run reports (on failure: what is wrong)
}

The host gives the pull-request service a working tree made of repo_files with your \`files\` laid over it. If \`pull_request.open\` is true the service opens a pull request from the difference between that tree and the repository, from \`branch\` into \`${PR.base}\`; it opens nothing when there is no difference and updates the open pull request of the same branch instead of opening another. A plan with status "failed" has no effects: its files and pull request are discarded. A plan is judged by those effects and by the \`versions\` it reports, not by how it was produced.`;

const FOUNDRY_NOTE = `Build it as a Foundry workflow (or any solver the harness can run). The workflow receives \`inputs\` and must end in a node "answer" whose output is the plan. A \`code\` node is pure (no network, no files), which is all this job needs once the host has fetched the reference.`;

export const TASK_TEXT = Object.freeze({
  T1: `# Translate a GitHub Actions workflow into a Foundry workflow

Attached is a GitHub Actions workflow that a maintainer of the SHAFT test-automation framework wrote, \`original/update-selenium-grid-versions.yml\` (MIT licence, \`original/LICENSE\`). Produce an equivalent solution: for any input it must do what the original does, including when the original does something odd or wrong with an odd input, because you are judged on equivalence with the original. The original's bash steps are the specification; the hidden scenarios were checked against the original actually running.

How the original's pieces map to your plan: the \`curl\` in step 2 is the host's fetch (\`inputs.reference_fetch\`); the files its \`sed -i\` edits are \`files\`; \`peter-evans/create-pull-request\` is \`pull_request\` (the action does nothing when the working tree has no difference, and updates the pull request of its branch when one is open); a step that fails (exit status not zero, or a line the runner cannot parse in $GITHUB_OUTPUT) is a plan with status "failed" and no effects; the original prints "Latest versions found:" and "Current versions:", which is what \`versions\` reports. The default shell of a \`run:\` step is \`bash -e\`.

${FOUNDRY_NOTE}`,
  T2: `# Rebuild a maintainer bot from its description

${DESCRIPTION}

Build a solution that does this job. You do not have the maintainer's workflow; you have the description, the rules below and three worked examples (\`inputs.examples\`: an input, and the plan that is correct for it).

${RULES}

${FOUNDRY_NOTE}`,
  T3: `# Improve a maintainer bot: same job, cheaper, faster, more reliable

Attached is the workflow a SHAFT maintainer wrote for this job, \`original/update-selenium-grid-versions.yml\` (MIT licence, \`original/LICENSE\`).

${DESCRIPTION}

Build a solution that does the job at least as well as the original and better where the original is unreliable. You are judged on the maintainers' rules below, not on equivalence with the original (the original does not meet all of them), and on a cost and latency target (\`budget.target\`): the steady-state run should need no model call, and the whole run should take no longer than the original's.

${RULES}

${FOUNDRY_NOTE}`,
});

export const SKELETON = `// solve(inputs) -> plan. See the task text for the shape of both. Pure: no network, no files, no model call needed.
export default function solve(inputs) {
  return {
    status: 'unchanged',
    versions: { current: { chrome: '', edge: '', firefox: '', hub: '' }, latest: { chrome: '', edge: '', firefox: '', hub: '' } },
    files: {},
    pull_request: { open: false },
    message: '',
  };
}
`;
