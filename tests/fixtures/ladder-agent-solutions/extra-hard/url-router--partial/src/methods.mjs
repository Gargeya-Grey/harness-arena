// `found` is a list of method -> route maps, most specific first.

// Methods the path answers to, in alphabetical order: every registered method,
// HEAD wherever GET is, and OPTIONS.
export function allowList(found) {
  const methods = new Set(['OPTIONS']);
  for (const routes of found) {
    for (const method of routes.keys()) methods.add(method);
  }
  if (methods.has('GET')) methods.add('HEAD');
  return [...methods].sort();
}

// The first route for the method among all that fit the path. HEAD uses the GET route when no route has its own.
export function chooseRoute(found, method) {
  const wanted = method === 'HEAD' ? ['HEAD', 'GET'] : [method];
  for (const name of wanted) {
    for (const routes of found) if (routes.has(name)) return { route: routes.get(name), routes };
  }
  return null;
}
