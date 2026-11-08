// `found` is a list of method -> route maps, most specific first.
export function allowList(found) {
  return [...new Set(found.flatMap((routes) => [...routes.keys()]))];
}

export function chooseRoute(found, method) {
  const routes = found[0];
  if (!routes || !routes.has(method)) return null;
  return { route: routes.get(method), routes };
}
