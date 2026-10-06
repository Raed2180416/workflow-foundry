// Append-only, resumable trial records (one JSON object per line). A trial is identified by
// (experiment, arm, taskKey, trial); re-running an experiment skips completed trials.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export class Results {
  constructor(file) {
    this.file = file; mkdirSync(path.dirname(file), { recursive: true });
    this.done = new Map();
    if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
      try { const r = JSON.parse(line); this.done.set(Results.key(r), r); } catch {}
    }
  }
  static key(r) { return `${r.arm}|${r.taskKey}|${r.trial}`; }
  has(arm, taskKey, trial) { return this.done.has(`${arm}|${taskKey}|${trial}`); }
  append(record) {
    const r = { ...record, at: new Date().toISOString() };
    appendFileSync(this.file, JSON.stringify(r) + '\n');
    this.done.set(Results.key(r), r);
    return r;
  }
  all() { return [...this.done.values()]; }
}
