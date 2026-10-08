// A stub of `docker compose -f FILE config` for compose files of the kind this item handles. It decides valid / invalid by the checks
// compose makes that matter here: YAML syntax, a mapping at the top, known top-level keys, a `services` mapping whose entries are
// mappings with a string `image` or a `build`. It does NOT check image reference syntax: the real command does not either (a tag
// containing a double quote, or a space, passed `docker compose config` of Docker Compose v5.6.0 offline; fixtures/docker-probes.json). It refuses
// (throws) on YAML it cannot read, instead of guessing. Cross-checked against the real command: see item.test.mjs ("docker stub").
import { parseYaml } from '../miniyaml.mjs';

const TOP_KEYS = new Set(['version', 'name', 'services', 'networks', 'volumes', 'configs', 'secrets', 'include']);
const fail = message => ({ ok: false, message });

export function validateCompose(text) {
  let doc;
  try { doc = parseYaml(text); }
  catch (error) {
    if (error.code !== 'SYNTAX') throw error;
    return fail(`go-yaml load error: ${error.message}`);
  }
  if (doc === null) return fail('empty compose file');
  if (typeof doc !== 'object' || Array.isArray(doc)) return fail('yaml: construct errors: line 1: cannot construct a non-mapping document into cli.named');
  for (const key of Object.keys(doc)) {
    if (/^[0-9]+$/.test(key)) return fail(`non-string key at top level: ${key}`);
    if (!TOP_KEYS.has(key) && !key.startsWith('x-')) return fail(`validating compose file: additional properties '${key}' not allowed`);
  }
  if (!('services' in doc)) return fail('empty compose file');
  if (doc.services === null || typeof doc.services !== 'object' || Array.isArray(doc.services)) return fail('services must be a mapping');
  for (const [name, svc] of Object.entries(doc.services)) {
    if (svc === null || typeof svc !== 'object' || Array.isArray(svc)) return fail(`validating compose file: services.${name} must be a mapping`);
    if (!('image' in svc) && !('build' in svc)) return fail(`service "${name}" has neither an image nor a build context specified: invalid compose project`);
    if ('image' in svc && typeof svc.image !== 'string') return fail(`validating compose file: services.${name}.image must be a string`);
  }
  return { ok: true, services: Object.keys(doc.services) };
}
