import { toHeaders } from './headers.mjs';

// Connect-style middleware: rateLimit(limiter, { key: (req) => req.ip, cost: (req) => 1 })
export function rateLimit(limiter, { key = (req) => req.ip, cost = () => 1 } = {}) {
  return (req, res, next) => {
    const result = limiter.check(key(req), cost(req));
    for (const [name, value] of Object.entries(toHeaders(result))) res.setHeader(name, value);
    if (result.allowed) {
      next();
      return;
    }
    res.statusCode = 429;
    res.end('Too Many Requests');
  };
}
