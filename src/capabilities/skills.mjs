// Skill loader (Agent Skills `SKILL.md` directories), ARCHITECTURE.md §2.8 and §3.4. A skill is procedural knowledge a node may read, not
// authority: its frontmatter is parsed by a restricted parser, its files are pinned by a manifest digest, `allowed-tools` is stripped
// (a derivative digest plus a strip receipt), Claude Code-only keys and shell-injection markers are refused, and what it `requires` is a
// request the broker may refuse, never a grant. Delivery is progressive: a Foundry-generated index line, the body at bind (bounded),
// references only through skill.read with a path in the manifest. Scripts never run in place: an admitted script is a typed capability
// run by the existing no-network sandbox (src/sandbox.mjs runCode); Linux only, refused elsewhere (SANDBOX_UNAVAILABLE).
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { runCode } from '../sandbox.mjs';
import { validateData, compileDataSchema } from '../validate.mjs';
import { approxTokens, digest, fail, pinOf, sha256 } from './common.mjs';
import { memberRecord } from './members.mjs';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_KEYS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const CLAUDE_CODE_ONLY = new Set(['hooks', 'model', 'context', 'shell', 'paths', 'agent', 'disable-model-invocation', 'user-invocable', 'argument-hint']);
const SHELL_MARKER = /!`[^`]*`/;
const LIMITS = { files: 512, bytes: 16 * 1024 * 1024 };

/** Restricted frontmatter: `key: scalar` lines and one level of `metadata:` string map. Anything else is unsupported, not guessed at. */
export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) fail('SKILL_FRONTMATTER_UNSUPPORTED', 'SKILL.md must start with a --- frontmatter block');
  const end = text.indexOf('\n---', 4);
  if (end < 0) fail('SKILL_FRONTMATTER_UNSUPPORTED', 'Unterminated frontmatter');
  const lines = text.slice(4, end).split('\n'), fields = {}, raw = {};
  let inMetadata = false;
  const scalar = value => {
    const v = value.trim();
    if (/^["'].*["']$/.test(v) && v.length >= 2) return v.slice(1, -1);
    if (/^[|>[{&*!%@`]/.test(v)) fail('SKILL_FRONTMATTER_UNSUPPORTED', 'Only plain or quoted scalar values are supported');
    return v;
  };
  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (inMetadata && /^ {2}[A-Za-z0-9_.-]+:\s/.test(line)) {
      const [, key, value] = /^ {2}([A-Za-z0-9_.-]+):\s(.*)$/.exec(line);
      fields.metadata[key] = scalar(value); continue;
    }
    inMetadata = false;
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s(.*))?$/.exec(line);
    if (!match) fail('SKILL_FRONTMATTER_UNSUPPORTED', `Unsupported frontmatter line: ${line.slice(0, 60)}`);
    const [, key, value = ''] = match;
    if (Object.hasOwn(fields, key)) fail('SKILL_FRONTMATTER_UNSUPPORTED', `Duplicate frontmatter key ${key}`);
    if (CLAUDE_CODE_ONLY.has(key)) fail('SKILL_KEY_REFUSED', `Frontmatter key ${key} is a Claude Code extension that can run code or change the model; refused`);
    if (!ALLOWED_KEYS.has(key)) fail('SKILL_FRONTMATTER_UNSUPPORTED', `Frontmatter key ${key} is outside the Agent Skills fields`);
    if (key === 'metadata') { if (value.trim()) fail('SKILL_FRONTMATTER_UNSUPPORTED', 'metadata is a map'); fields.metadata = {}; inMetadata = true; continue; }
    fields[key] = scalar(value); raw[key] = line;
  }
  return { fields, body: text.slice(text.indexOf('\n', end + 1) + 1), raw };
}

function walk(root) {
  const files = [];
  let bytes = 0;
  const visit = dir => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name), rel = path.relative(root, full).split(path.sep).join('/'), info = lstatSync(full);
      if (info.isSymbolicLink()) fail('SKILL_SYMLINK', `Skill file ${rel} is a symlink; refused`);
      if (info.isDirectory()) { visit(full); continue; }
      if (!info.isFile()) fail('SKILL_FILE', `Skill entry ${rel} is not a regular file`);
      if (files.length >= LIMITS.files) fail('SKILL_SIZE', `A skill holds at most ${LIMITS.files} files`);
      bytes += info.size;
      if (bytes > LIMITS.bytes) fail('SKILL_SIZE', 'A skill holds at most 16 MiB');
      const data = readFileSync(full);
      files.push({ path: rel, sha256: sha256(data), size: data.length, data });
    }
  };
  visit(root);
  return files;
}
export const manifestOf = files => pinOf(files.map(({ path: p, sha256: h, size }) => ({ path: p, sha256: h, size })).sort((a, b) => a.path < b.path ? -1 : 1));

/** Load and vet one skill directory. `expectedManifest`: the catalog pin (SKILL_PIN_MISMATCH on a difference). */
export function loadSkill(root, { expectedManifest = null } = {}) {
  const info = lstatSync(root);
  if (info.isSymbolicLink() || !info.isDirectory()) fail('SKILL_PATH', 'A skill root is a real directory');
  const real = realpathSync(root), files = walk(real), skillFile = files.find(f => f.path === 'SKILL.md');
  if (!skillFile) fail('SKILL_FILE', 'SKILL.md is missing');
  const text = skillFile.data.toString('utf8'), { fields, body, raw } = parseFrontmatter(text);
  if (!NAME.test(fields.name ?? '') || fields.name.length > 64) fail('SKILL_NAME', 'name: 1-64 lowercase letters, digits and single hyphens');
  if (fields.name !== path.basename(real)) fail('SKILL_NAME', `name ${fields.name} must match its directory ${path.basename(real)}`);
  if (!fields.description || fields.description.length > 1024) fail('SKILL_DESCRIPTION', 'description: 1-1024 characters');
  if (fields.compatibility !== undefined && fields.compatibility.length > 500) fail('SKILL_COMPATIBILITY', 'compatibility: at most 500 characters');
  if (SHELL_MARKER.test(text)) fail('SKILL_SHELL_MARKER', 'The skill carries a shell-injection marker (!`...`); refused');
  const manifest = manifestOf(files);
  if (expectedManifest && expectedManifest !== manifest) fail('SKILL_PIN_MISMATCH', 'The skill files differ from the pinned manifest', { expected: expectedManifest, observed: manifest });
  let derivative = null, stripReceipt = null, effectiveText = text;
  if (Object.hasOwn(fields, 'allowed-tools')) {
    // A skill does not pre-approve tools in Foundry: the field is removed from the delivered copy, with a receipt of what was removed.
    effectiveText = text.replace(`${raw['allowed-tools']}\n`, '');
    const stripped = files.map(f => f.path === 'SKILL.md' ? { ...f, sha256: sha256(effectiveText), size: Buffer.byteLength(effectiveText) } : f);
    derivative = manifestOf(stripped);
    stripReceipt = { kind: 'skill.strip', skill: fields.name, from: manifest, to: derivative, stripped: ['allowed-tools'], value: fields['allowed-tools'].slice(0, 200) };
    delete fields['allowed-tools'];
  }
  const urls = [...new Set(text.match(/https?:\/\/[^\s)>\]"']+/g) ?? [])].slice(0, 20);
  return { name: fields.name, description: fields.description, frontmatter: fields, root: real, files: files.map(({ data, ...rest }) => rest), manifest, derivative, stripReceipt,
    body: parseFrontmatter(effectiveText).body, urls, scripts: files.filter(f => f.path.startsWith('scripts/')).map(f => f.path), text: path => files.find(f => f.path === path)?.data.toString('utf8') ?? null };
}

/** The Foundry-generated index line (never the skill's own description for an untrusted skill): at most ~30 tokens. */
export function renderIndexLine(entry) {
  const line = `skill.${entry.id}: ${entry.view.summary}`;
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
export function renderBody(skill, { maxTokens = 1200 } = {}) {
  if (approxTokens(skill.body) > maxTokens) fail('SKILL_BUDGET', `Skill ${skill.name} body is about ${approxTokens(skill.body)} tokens; the limit is ${maxTokens}`);
  return skill.body;
}
export function readReference(skill, file) {
  if (typeof file !== 'string' || file.includes('..') || file.startsWith('/') || !skill.files.some(f => f.path === file) || file === 'SKILL.md' || file.startsWith('scripts/'))
    fail('SKILL_REFERENCE', 'Only reference files listed in the skill manifest can be read');
  return skill.text(file);
}
/** A skill's requirements must lie inside what the node already holds; a skill never widens a node. */
export function checkSkillRequires(entry, held) {
  const tools = entry.requires?.tools ?? [], missing = tools.filter(t => !held.has(t));
  if (missing.length || (entry.requires?.egress ?? []).length || (entry.requires?.credentials ?? []).length) fail('SKILL_REQUIRES_EXCEEDS_GRANT', `Skill ${entry.id} requires what the node does not hold`, { missing, egress: entry.requires?.egress ?? [], credentials: entry.requires?.credentials ?? [] });
  return true;
}

/** Member records of one skill entry: the skill itself (body / references) and each admitted script. */
export function skillMembers(entry, skill, { maxTokens = entry.maxTokens ?? 1200 } = {}) {
  const label = entry.label ?? (entry.trust === 'T0' ? 'trusted' : `untrusted:skill.${entry.id}`);
  if (entry.trust !== 'T0' && label === 'trusted') fail('SKILL_LABEL', `Skill ${entry.id} is not an owner skill; its output is untrusted`);
  const references = skill.files.map(f => f.path).filter(p => p !== 'SKILL.md' && !p.startsWith('scripts/'));
  const base = { type: entry.type, system: entry.system, verbs: entry.verbs ?? ['read'], objects: entry.objects ?? ['procedure'], intents: entry.intents ?? [],
    effects: 'none', risk: 'low', requiresApproval: false, dataClass: 'internal', egress: 'local', maxTimeoutMs: 10000, cost: 0, outputMode: 'structured' };
  const members = [memberRecord({ entry, name: entry.id, id: `skill.${entry.id}`, adapter: 'nodecap-skill/1', pins: { manifest: skill.manifest, derivative: skill.derivative },
    attestation: { ...base, outputLabel: label, outputSchema: { type: 'object', required: ['skill', 'text'], properties: { skill: { type: 'string' }, text: { type: 'string' }, reference: { type: 'string' } } },
      view: { name: entry.view.name, summary: entry.view.summary, inputSchema: { type: 'object', additionalProperties: false, properties: references.length ? { reference: { enum: references } } : {} } } },
    extra: { skillMaxTokens: maxTokens } })];
  for (const [name, script] of Object.entries(entry.scripts ?? {})) {
    if (!skill.scripts.includes(script.path)) fail('SKILL_SCRIPT', `Script ${script.path} is not in the skill`);
    const source = skill.text(script.path);
    if (sha256(source) !== script.sha256) fail('SKILL_PIN_MISMATCH', `Script ${script.path} differs from its pinned hash`);
    compileDataSchema(script.inputSchema); compileDataSchema(script.outputSchema);
    members.push(memberRecord({ entry, name, id: `skill.${entry.id}.${name}`, adapter: 'nodecap-skill-script/1', pins: { manifest: skill.manifest, script: script.sha256 },
      attestation: { ...base, type: script.type, system: script.system, verbs: script.verbs, objects: script.objects, intents: script.intents ?? [],
        maxTimeoutMs: script.maxTimeoutMs ?? 10000, outputLabel: label, outputSchema: script.outputSchema, view: script.view },
      extra: { script: { lang: script.lang, path: script.path, sha256: script.sha256, inputSchema: script.inputSchema } } }));
  }
  return members;
}

/** Invoke a skill member: read the body (bounded) or one reference, or run an admitted script in the no-network sandbox. */
export async function invokeSkill(member, skill, args, { signal, codeRunner = runCode } = {}) {
  if (member.script) {
    validateData(member.script.inputSchema, args, `${member.id} input`);
    const source = skill.text(member.script.path);
    if (sha256(source) !== member.script.sha256) fail('SKILL_PIN_MISMATCH', `Script ${member.script.path} changed since admission`);
    if (process.platform !== 'linux') fail('SANDBOX_UNAVAILABLE', 'Skill scripts run only in the Linux namespace sandbox');
    const { value } = await codeRunner({ lang: member.script.lang, source, input: args, timeoutMs: member.maxTimeoutMs, signal });
    validateData(member.outputSchema, value, `${member.id} output`);
    return value;
  }
  if (args?.reference) return { skill: skill.name, reference: args.reference, text: readReference(skill, args.reference) };
  return { skill: skill.name, text: renderBody(skill, { maxTokens: member.skillMaxTokens }) };
}
export { digest };
