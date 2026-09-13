import { readFileSync } from 'node:fs';

export function langgraphFiles(specification) {
  const source = filename => readFileSync(new URL(filename, import.meta.url), 'utf8');
  const files = [
    { path: 'workflow.json', content: JSON.stringify(specification, null, 2) + '\n' },
    { path: 'foundry_values.py', content: source('values.py') },
    { path: 'foundry_worker.py', content: source('worker.py') },
    { path: 'foundry_langgraph.py', content: source('runtime.py') },
    { path: 'requirements.in', content: source('requirements.in') },
    { path: 'requirements.txt', content: source('requirements.txt') },
    { path: 'README.md', content: source('README.md') }
  ];
  return files;
}
