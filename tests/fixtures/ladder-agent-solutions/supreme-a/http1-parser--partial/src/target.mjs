const SHAPE = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+) ([\x21-\x7e]+) HTTP\/(\d)\.(\d)$/;

function validTarget(method, target) {
  if (target.includes('#')) return false;
  if (method === 'CONNECT') return /^[A-Za-z0-9.-]+:\d+$/.test(target);
  if (target === '*') return method === 'OPTIONS';
  return target.startsWith('/') || /^https?:\/\//.test(target);
}

export function parseRequestLine(line) {
  const match = SHAPE.exec(line);
  if (!match) return { code: 'bad-request-line' };
  const [, method, target, major, minor] = match;
  if (major !== '1' || (minor !== '0' && minor !== '1')) return { code: 'bad-version' };
  if (!validTarget(method, target)) return { code: 'bad-target' };
  return { method, target, version: `${major}.${minor}` };
}
