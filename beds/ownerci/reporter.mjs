// node:test custom reporter used by the ownerci runner. It runs in the `node --test` parent
// process, which never imports the module under test (every test file runs in its own child
// process), and writes one JSON document to the --test-reporter-destination file.
const text = (v, max) => (v === undefined || v === null ? null : String(v).slice(0, max));

function describe(error) {
  if (!error || typeof error !== 'object') return error === undefined ? null : { message: text(error, 2000) };
  const cause = error.cause && typeof error.cause === 'object' ? error.cause : error;
  return {
    code: text(error.code, 80),
    failureType: text(error.failureType, 80),
    name: text(cause.name, 120),
    causeCode: text(cause.code, 80),
    message: text(cause.message ?? cause, 4000),
    stack: text(cause.stack, 6000),
  };
}

export default async function* ownerciReporter(source) {
  const results = [];
  for await (const event of source) {
    const { type, data } = event;
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    if (data.details?.type === 'suite') continue;
    const status = type === 'test:fail' ? 'fail' : data.skip !== undefined && data.skip !== false ? 'skip'
      : data.todo !== undefined && data.todo !== false ? 'todo' : 'pass';
    results.push({
      name: text(data.name, 500), file: text(data.file, 1000), nesting: data.nesting ?? 0, line: data.line ?? null, status,
      error: status === 'fail' ? describe(data.details?.error) : null,
    });
  }
  yield `${JSON.stringify({ results })}\n`;
}
