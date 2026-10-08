#!/usr/bin/env node
// Re-records fixtures/docker-probes.json: a battery of small compose files run through the REAL `docker compose -f FILE config`
// (offline: the command needs no daemon). The recording is what the validation stub (mocks/compose-validate.mjs) is held to by
// item.test.mjs; run it again when the Docker client changes:  node controls/record-docker-probes.mjs
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCRATCH } from '../runner.mjs';

const svc = img => `services:\n  hub:\n    image: ${img}\n`;
export const PROBES = {
  'ok-basic': 'services:\n  selenium-hub:\n    image: selenium/hub:4.35.0-20250909\n    ports:\n      - "4442:4442"\n  chrome:\n    image: selenium/node-chrome:4.35.0-20250909\n    shm_size: 2gb\n    depends_on:\n      - selenium-hub\n    environment:\n      - SE_EVENT_BUS_HOST=selenium-hub\n',
  'comment-header': `# a comment\n${svc('selenium/hub:4.35.0-20250909')}`,
  'trailing-comment': svc('selenium/hub:4.35.0-20250909 # pinned'),
  'quoted-image': svc('"selenium/hub:4.35.0-20250909"'),
  'single-quoted-image': svc("'selenium/hub:4.35.0-20250909'"),
  'empty-tag': svc('selenium/hub:'),
  'quote-in-tag': svc('selenium/hub:4.35.0-20250909"'),
  'unterminated-double': svc('"selenium/hub:4.35.0-20250909'),
  'unterminated-single': svc("'selenium/hub:4.35.0-20250909"),
  'space-after-colon': svc('selenium/hub: 4.35'),
  'tag-with-space': svc('selenium/hub:4.35.0 20250909'),
  'upper-case-image': svc('Selenium/Hub:1'),
  'mangled-tag-quoted': svc('"selenium/hub:4.36.0-202509154.35.0-20250909"'),
  html: '<!DOCTYPE html>\n<html><body>404</body></html>\n',
  'not-found-text': '404: Not Found',
  'json-error': '{"message":"Server Error"}\n',
  empty: '',
  'only-comment': '# nothing here\n',
  'version-only': 'version: "3"\n',
  'services-null': 'services:\n',
  'services-empty-flow': 'services: {}\n',
  'no-image-no-build': 'services:\n  hub:\n    container_name: xyz-hub\n',
  'unknown-top-key': 'foo: bar\nservices:\n  hub:\n    image: a:1\n',
  'top-level-list': '- a\n- b\n',
  'top-level-scalar': 'hello\n',
  'duplicate-key': 'services:\n  hub:\n    image: a:1\n    image: a:2\n',
  'tab-indent': 'services:\n\thub:\n\t\timage: a:1\n',
  crlf: 'services:\r\n  hub:\r\n    image: selenium/hub:4.35.0-20250909\r\n',
  'version-header': 'version: "3"\nservices:\n  hub:\n    image: selenium/hub:4.35.0-20250909\n',
  'image-null': 'services:\n  hub:\n    image:\n',
  'service-null': 'services:\n  hub:\n',
  'ports-scalar': 'services:\n  hub:\n    image: a:1\n    ports: 4444\n',
  'depends-undefined': 'services:\n  hub:\n    image: a:1\n    depends_on:\n      - ghost\n',
  'other-compose': 'services:\n  cache:\n    image: redis:7\n',
};
// Probes the stub does not model; it must refuse (flow collections) or is known to differ (checks it does not make).
export const OUT_OF_SCOPE = {
  'services-empty-flow': 'flow collection: the stub refuses to read it',
  'json-error': 'flow collection: the stub refuses to read it',
  'ports-scalar': 'the stub does not check the type of ports',
  'depends-undefined': 'the stub does not resolve depends_on',
};

export function dockerAvailable() {
  const r = spawnSync('docker', ['compose', 'version', '--short'], { encoding: 'utf8', timeout: 20000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
export function realCompose(text, dir) {
  const file = path.join(dir, 'probe.yml');
  writeFileSync(file, text);
  const r = spawnSync('docker', ['compose', '-f', file, 'config'], { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, HOME: dir, DOCKER_CONFIG: dir } });
  const firstError = (r.stderr || '').split('\n').filter(l => l && !/level=warning/.test(l))[0] ?? '';
  return { rc: r.status, firstError: firstError.replaceAll(file, '<file>').replaceAll(dir, '<dir>').slice(0, 240) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = dockerAvailable();
  if (!version) { console.error('docker compose is not available here; fixtures/docker-probes.json left as it is'); process.exit(1); }
  const dir = mkdtempSync(path.join(SCRATCH, 'probe-'));
  const probes = Object.entries(PROBES).map(([name, text]) => ({ name, text, ...realCompose(text, dir), ...(OUT_OF_SCOPE[name] ? { outOfScope: OUT_OF_SCOPE[name] } : {}) }));
  rmSync(dir, { recursive: true, force: true });
  const out = { schema: 'rbench-docker-probes/1', recordedOn: '2026-10-08', command: 'docker compose -f FILE config (no daemon needed)', composeVersion: version, probes };
  writeFileSync(new URL('../fixtures/docker-probes.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
  console.log(`recorded ${probes.length} probes with Docker Compose ${version}`);
}
