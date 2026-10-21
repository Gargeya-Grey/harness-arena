// Validates records against the JSON Schemas in schemas/. Implements the
// subset of Draft 2020-12 those files use: type, enum, const, required,
// properties, additionalProperties, items, minItems, minimum, maximum,
// pattern, format date-time, and $ref (local #/$defs and sibling files).

import fs from 'node:fs';
import path from 'node:path';

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(value, type) {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

export class SchemaSet {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
  }

  load(name) {
    if (!this.cache.has(name)) {
      const file = path.join(this.dir, name);
      this.cache.set(name, JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    return this.cache.get(name);
  }

  /** Returns a list of "path: message" strings; empty means valid. */
  validate(name, value) {
    const errors = [];
    const root = this.load(name);
    this.check(root, root, value, '$', errors);
    return errors;
  }

  resolve(root, ref) {
    if (ref.startsWith('#/')) {
      const target = ref
        .slice(2)
        .split('/')
        .reduce((node, key) => node?.[key], root);
      if (!target) throw new Error(`Unresolved $ref ${ref}`);
      return { root, schema: target };
    }
    const [file, pointer] = ref.split('#');
    const other = this.load(file);
    return pointer ? this.resolve(other, `#${pointer}`) : { root: other, schema: other };
  }

  check(root, schema, value, at, errors) {
    if (schema.$ref) {
      const target = this.resolve(root, schema.$ref);
      this.check(target.root, target.schema, value, at, errors);
      return;
    }
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((type) => typeMatches(value, type))) {
        errors.push(`${at}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
        return;
      }
    }
    if ('const' in schema && value !== schema.const) {
      errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
    }
    if (schema.enum && !schema.enum.some((item) => item === value)) {
      errors.push(`${at}: must be one of ${schema.enum.map((item) => JSON.stringify(item)).join(', ')}`);
    }
    if (typeof value === 'string') {
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${at}: does not match ${schema.pattern}`);
      }
      if (schema.format === 'date-time' && !DATE_TIME.test(value)) {
        errors.push(`${at}: not an ISO 8601 date-time`);
      }
    }
    if (typeof value === 'number') {
      if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: below minimum ${schema.minimum}`);
      if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: above maximum ${schema.maximum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems != null && value.length < schema.minItems) {
        errors.push(`${at}: needs at least ${schema.minItems} items`);
      }
      if (schema.items) {
        value.forEach((item, index) => this.check(root, schema.items, item, `${at}[${index}]`, errors));
      }
    }
    if (typeOf(value) === 'object') {
      for (const key of schema.required || []) {
        if (!(key in value)) errors.push(`${at}: missing required "${key}"`);
      }
      const properties = schema.properties || {};
      for (const [key, item] of Object.entries(value)) {
        if (properties[key]) {
          this.check(root, properties[key], item, `${at}.${key}`, errors);
        } else if (schema.additionalProperties === false) {
          errors.push(`${at}: unexpected property "${key}"`);
        } else if (typeof schema.additionalProperties === 'object') {
          this.check(root, schema.additionalProperties, item, `${at}.${key}`, errors);
        }
      }
    }
  }
}
