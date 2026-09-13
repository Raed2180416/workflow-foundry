import { createHash } from 'node:crypto';

export class FoundryError extends Error {
  constructor(code, message, details = undefined) {
    super(message); this.name = 'FoundryError'; this.code = code; this.details = details;
  }
}

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function checkData(value, { maxBytes = 2 * 1024 * 1024, maxDepth = 40 } = {}) {
  let count = 0;
  const walk = (v, depth) => {
    if (++count > 200000 || depth > maxDepth) throw new FoundryError('DATA_LIMIT', 'JSON structure exceeds the supported limit');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw new FoundryError('INVALID_NUMBER', 'Numbers must be finite');
      return;
    }
    if (typeof v !== 'object') throw new FoundryError('INVALID_JSON', 'Only JSON data is accepted');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
      throw new FoundryError('INVALID_OBJECT', 'Class instances are not JSON');
    }
    for (const [k, child] of Object.entries(v)) {
      if (forbidden.has(k)) throw new FoundryError('UNSAFE_KEY', `Forbidden object key: ${k}`);
      walk(child, depth + 1);
    }
  };
  walk(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw new FoundryError('DATA_LIMIT', 'JSON bytes exceed the supported limit');
  return value;
}

export function canonical(value) {
  checkData(value, { maxBytes: 16 * 1024 * 1024 });
  const visit = v => Array.isArray(v) ? v.map(visit) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, visit(v[k])])) : v;
  return JSON.stringify(visit(value));
}
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const clone = value => JSON.parse(JSON.stringify(checkData(value, { maxBytes: 16 * 1024 * 1024 })));
export const errorData = error => ({ code: error.code ?? 'ERROR', message: String(error.message ?? error).slice(0, 3000) });

export function refParts(reference) {
  if (typeof reference !== 'string' || !/^(input|nodes|item|index|iteration|previous)(\.[A-Za-z0-9_-]+)*$/.test(reference)) {
    throw new FoundryError('INVALID_REFERENCE', `Invalid JSON reference: ${String(reference)}`);
  }
  const parts = reference.split('.');
  if (parts.some(p => forbidden.has(p))) throw new FoundryError('INVALID_REFERENCE', 'Prototype traversal is forbidden');
  return parts;
}

export function resolve(template, context) {
  if (Array.isArray(template)) return template.map(x => resolve(x, context));
  if (template && typeof template === 'object') {
    if (Object.hasOwn(template, '$ref')) {
      if (Object.keys(template).some(k => k !== '$ref' && k !== 'default')) throw new FoundryError('INVALID_REFERENCE', 'A reference may contain only $ref and default');
      const parts = refParts(template.$ref);
      let v = context;
      for (const part of parts) {
        if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) {
          if (Object.hasOwn(template, 'default')) return clone(template.default);
          throw new FoundryError('MISSING_REFERENCE', `Missing value at ${template.$ref}`);
        }
        v = v[part];
      }
      return clone(v);
    }
    return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, resolve(v, context)]));
  }
  return template;
}

export function condition(expression, context) {
  if (!expression || typeof expression !== 'object') throw new FoundryError('INVALID_CONDITION', 'A structured condition is required');
  const { op } = expression;
  if (op === 'all') return expression.conditions.every(c => condition(c, context));
  if (op === 'any') return expression.conditions.some(c => condition(c, context));
  if (op === 'not') return !condition(expression.condition, context);
  if (op === 'exists') {
    try { return resolve(expression.value, context) !== undefined; }
    catch (e) { if (e.code === 'MISSING_REFERENCE') return false; throw e; }
  }
  const left = resolve(expression.left, context), right = resolve(expression.right, context);
  if (op === 'eq') return canonical(left) === canonical(right);
  if (op === 'ne') return canonical(left) !== canonical(right);
  if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
    if (typeof left !== 'number' || typeof right !== 'number') throw new FoundryError('CONDITION_TYPE', `${op} requires numbers, without coercion`);
    return ({ gt: () => left > right, gte: () => left >= right, lt: () => left < right, lte: () => left <= right })[op]();
  }
  if (op === 'in') {
    if (!Array.isArray(right)) throw new FoundryError('CONDITION_TYPE', 'in requires an array on the right');
    return right.some(x => canonical(x) === canonical(left));
  }
  if (op === 'contains') {
    if (Array.isArray(left)) return left.some(x => canonical(x) === canonical(right));
    if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
    throw new FoundryError('CONDITION_TYPE', 'contains requires compatible strings or an array');
  }
  throw new FoundryError('INVALID_CONDITION', `Unknown condition operator: ${op}`);
}

export function references(value, found = []) {
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, '$ref')) { refParts(value.$ref); found.push(value.$ref); }
    for (const child of Object.values(value)) references(child, found);
  }
  return found;
}
