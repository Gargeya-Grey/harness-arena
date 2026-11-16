import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as moduleApi from 'node:module';
import * as testApi from 'node:test';
import { randomUUID } from 'node:crypto';

const parse = JSON.parse;
const stringify = JSON.stringify;
const writeSync = fs.writeSync; // not a run file: writes trusted observations to stdout only
const define = Object.defineProperty;
const own = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const apply = Reflect.apply;
const construct = Reflect.construct;
const get = Reflect.get;
const ProxyType = Proxy;
const MapType = Map;
const WeakMapType = WeakMap;
const ErrorType = Error;
const StringType = String;
const isFiniteNumber = Number.isFinite;
const mapHas = Function.prototype.call.bind(Map.prototype.has);
const mapGet = Function.prototype.call.bind(Map.prototype.get);
const mapSet = Function.prototype.call.bind(Map.prototype.set);
const weakHas = Function.prototype.call.bind(WeakMap.prototype.has);
const weakGet = Function.prototype.call.bind(WeakMap.prototype.get);
const weakSet = Function.prototype.call.bind(WeakMap.prototype.set);
const { run, getTestContext } = testApi;
const { nonce, bridge, workspace, rule } = parse(fs.readFileSync(0, 'utf8'));
const quoted = value => stringify(StringType(value));
const number = value => typeof value === 'number' && isFiniteNumber(value) ? StringType(value) : 'null';
const report = result => {
  let json = `\n{"nonce":${quoted(nonce)},"result":{"ok":${result.ok === true}`;
  if (result.unjudged === true) json += ',"unjudged":true';
  if (typeof result.error === 'string') json += `,"error":${quoted(result.error)}`;
  if (result.details) {
    const details = result.details;
    json += `,"details":{"executed":${number(details.executed)},"failed":${number(details.failed)},"skipped":${number(details.skipped)},"required_call_counts":[`;
    for (let index = 0; index < counts.length; index += 1) json += `${index ? ',' : ''}${number(counts[index])}`;
    json += ']}';
  }
  writeSync(1, json + '}}\n');
};
if (typeof moduleApi.registerHooks !== 'function' || typeof getTestContext !== 'function') {
  report({ ok: false, unjudged: true, error: 'executable call observation requires Node module.registerHooks and test.getTestContext support' });
  process.exit(0);
}

const counts = rule.required_calls.map(() => 0);
let unsupported = null;
let prototypeAccessed = false;
let prototypeUnobservable = false;
const bridgeName = `__lab_test_bridge_${bridge.replaceAll('-', '_')}`;
const bridgeUrl = `lab-required-calls:${randomUUID()}`;
const capability = randomUUID();
const moduleRules = new MapType();
const authorizations = new MapType();
const wrapperExports = new MapType();
const wrapperNamespaces = new MapType();
const preloadUrls = [];
const keyOf = url => {
  const parsed = new URL(url);
  parsed.search = '';
  return process.platform === 'win32' ? parsed.href.toLowerCase() : parsed.href;
};
rule.required_calls.forEach((required, index) => {
  const url = pathToFileURL(path.join(workspace, required.module)).href;
  const key = keyOf(url);
  if (!moduleRules.has(key)) {
    moduleRules.set(key, new MapType());
    preloadUrls.push(url);
  }
  const exports = moduleRules.get(key);
  if (!exports.has(required.export)) exports.set(required.export, { token: randomUUID(), required: [] });
  exports.get(required.export).required.push({ method: required.method, testFile: keyOf(pathToFileURL(path.join(workspace, required.test_file)).href), index });
});
for (const [key, exports] of moduleRules) {
  const wrappers = [];
  for (const [name, authorization] of exports) {
    authorizations.set(authorization.token, authorization.required);
    wrappers.push({ name, token: authorization.token });
  }
  wrapperExports.set(key, wrappers);
}

const track = (presentedCapability, Constructor, authorization) => {
  if (presentedCapability !== capability || !mapHas(authorizations, authorization)) throw new ErrorType('unauthorized executable-call observation');
  const required = mapGet(authorizations, authorization);
  const record = method => {
    const context = getTestContext();
    const testFile = typeof context?.test === 'function' && context.filePath ? keyOf(pathToFileURL(context.filePath).href) : null;
    for (let index = 0; index < required.length; index += 1) {
      const call = required[index];
      if (method === call.method && testFile === call.testFile) counts[call.index] += 1;
    }
  };
  const instrumented = new MapType();
  const targets = new WeakMapType();
  const prototype = Constructor.prototype;
  for (let index = 0; index < required.length; index += 1) {
    const method = required[index].method;
    if (mapHas(instrumented, method)) continue;
    const descriptor = own(prototype, method);
    if (!descriptor || typeof descriptor.value !== 'function' || (!descriptor.configurable && !descriptor.writable)) {
      if (typeof get(prototype, method) === 'function') prototypeUnobservable = true;
      continue;
    }
    const value = descriptor.value;
    const wrapped = function (...args) { record(method); return apply(value, weakHas(targets, this) ? weakGet(targets, this) : this, args); };
    define(prototype, method, { ...descriptor, value: wrapped });
    mapSet(instrumented, method, wrapped);
  }
  const instances = new WeakMapType();
  let trackedConstructor;
  const wrap = target => {
    if (weakHas(instances, target)) return weakGet(instances, target);
    const methods = new MapType();
    let proxy;
    proxy = new ProxyType(target, {
      getPrototypeOf(object) {
        prototypeAccessed = true;
        return getPrototype(object);
      },
      get(object, key) {
        if (key === '__proto__') prototypeAccessed = true;
        const value = get(object, key, object);
        if (key === 'constructor' && value === Constructor) return trackedConstructor;
        if (typeof value !== 'function') return value;
        const descriptor = own(object, key);
        if (descriptor && !descriptor.configurable && !descriptor.writable && 'value' in descriptor) {
          unsupported = 'immutable own instance methods cannot be observed without changing their semantics';
          return value;
        }
        if (mapGet(methods, key)?.original === value) return mapGet(methods, key).wrapped;
        const wrapped = function (...args) {
          if (mapGet(instrumented, key) !== value) record(key);
          const result = apply(value, this === proxy ? object : this, args);
          return result === object ? proxy : result;
        };
        mapSet(methods, key, { original: value, wrapped });
        return wrapped;
      },
    });
    weakSet(instances, target, proxy);
    weakSet(targets, proxy, target);
    return proxy;
  };
  trackedConstructor = new ProxyType(Constructor, {
    get(target, key, receiver) {
      if (key === 'prototype') prototypeAccessed = true;
      return get(target, key, receiver);
    },
    construct(target, args, newTarget) {
      return wrap(construct(target, args, newTarget === trackedConstructor ? target : newTarget));
    },
  });
  return trackedConstructor;
};
define(globalThis, bridgeName, { value: track, configurable: true });
moduleApi.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === bridgeUrl) return { url: bridgeUrl, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === bridgeUrl) return { format: 'module', shortCircuit: true, source: `const invoke = globalThis[${stringify(bridgeName)}]; delete globalThis[${stringify(bridgeName)}]; const track = (Constructor, authorization) => invoke(${stringify(capability)}, Constructor, authorization); export { track };` };
    if (!url.startsWith('file:')) return nextLoad(url, context);
    const parsed = new URL(url);
    if (parsed.searchParams.get('__lab_original') === bridge) return nextLoad(url, context);
    const exports = mapGet(wrapperExports, keyOf(url));
    if (!exports) return nextLoad(url, context);
    const namespace = mapGet(wrapperNamespaces, keyOf(url));
    if (!namespace) {
      unsupported = 'cyclic tracked-module loading cannot preserve complete export observation';
      return nextLoad(url, context);
    }
    parsed.searchParams.set('__lab_original', bridge);
    let source = `import { track } from ${quoted(bridgeUrl)};\nimport * as original from ${quoted(parsed.href)};\nexport * from ${quoted(parsed.href)};\n`;
    for (let index = 0; index < exports.length; index += 1) {
      const { name, token } = exports[index];
      source += `export const ${name} = track(original[${quoted(name)}], ${quoted(token)});\n`;
    }
    if (own(namespace, 'default')) {
      let alias;
      for (let index = 0; index < exports.length; index += 1) if (namespace.default === namespace[exports[index].name]) alias = exports[index].name;
      source += alias ? `export { ${alias} as default };\n` : `export { default } from ${quoted(parsed.href)};\n`;
    }
    return { format: 'module', shortCircuit: true, source };
  },
});

// Starting synchronously avoids node:test's initial-turn deadlock after an awaited stdin read.
const stream = run({ files: rule.files.map(file => path.join(workspace, file)), isolation: 'none', async setup() {
  for (let index = 0; index < preloadUrls.length; index += 1) {
    const url = new URL(preloadUrls[index]);
    url.searchParams.set('__lab_original', bridge);
    const namespace = await import(url.href);
    mapSet(wrapperNamespaces, keyOf(preloadUrls[index]), namespace);
  }
} });
let summary;
for await (const event of stream) {
  if (event.type === 'test:summary') summary = event.data;
  if (event.type === 'test:fail') {
    const type = event.data.details?.error?.failureType;
    if (type === 'testCodeFailure' || type === 'hookFailed' || type === 'subtestsFailed') writeSync(1, `\n{"nonce":${quoted(nonce)},"event":"definite-test-failure"}\n`);
  }
}
if (unsupported) report({ ok: false, unjudged: true, error: unsupported });
else {
  const executed = summary?.counts?.passed ?? 0;
  let observed = true;
  for (let index = 0; index < counts.length; index += 1) if (!(counts[index] > 0)) observed = false;
  const valid = summary?.success === true && executed >= rule.minimum_tests && summary.counts.skipped === 0 && summary.counts.todo === 0 && observed;
  const unobservedPrototype = !observed && prototypeAccessed && prototypeUnobservable;
  report({ ok: valid, ...(unobservedPrototype ? { unjudged: true, error: 'prototype access prevents complete required-call observation' } : valid ? {} : { error: 'required passing tests and observed instance calls were not established' }), details: { executed, failed: summary?.counts?.failed ?? null, skipped: summary?.counts?.skipped ?? null, required_call_counts: counts } });
}
