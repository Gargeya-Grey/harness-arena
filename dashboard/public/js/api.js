// The only network calls: the read-only state, annotations and boards. All on this origin.

async function parse(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = body && body.error ? body.error : `HTTP ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return body;
}

export const fetchState = () => fetch('/api/state', { cache: 'no-store' }).then(parse);

export const postAnnotation = (body) =>
  fetch('/api/annotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(parse);

export const postBoard = (body) =>
  fetch('/api/boards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(parse);

export const deleteBoard = (id) => fetch(`/api/boards/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(parse);
