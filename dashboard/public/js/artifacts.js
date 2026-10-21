// Render artifacts safely: SVG and images as <img>, HTML in a sandboxed frame, media with native controls.
import { html } from './util.js';

const VISUAL = new Set(['svg', 'image', 'html', 'video', 'audio']);

export function visualArtifacts(obs) {
  const all = (obs.artifacts || []).filter((a) => a.url && a.available !== false && VISUAL.has(a.kind));
  const primary = all.filter((a) => !a.derived);
  return primary.length ? primary : all;
}

export function artifactHtml(a, alt, big = false) {
  if (!a) return '';
  const cls = big ? ' art-big' : '';
  if (a.available === false || !a.url) {
    if (a.kind === 'text' && a.content) return html`<pre class="pre mono">${a.content}</pre>`;
    return html`<span class="muted">Artifact unavailable (${a.kind}).</span>`;
  }
  switch (a.kind) {
    case 'svg':
    case 'image':
      return html`<img class="art-img${cls}" src="${a.url}" alt="${alt}" loading="lazy">`;
    case 'html':
      return html`<iframe class="art-frame${cls}" sandbox="allow-scripts" src="${a.url}" title="${alt}" loading="lazy" referrerpolicy="no-referrer"></iframe>`;
    case 'video':
      return html`<video class="art-media${cls}" controls preload="metadata" src="${a.url}" aria-label="${alt}"></video>`;
    case 'audio':
      return html`<audio class="art-media${cls}" controls preload="metadata" src="${a.url}" aria-label="${alt}"></audio>`;
    default:
      return html`<a class="art-file" href="${a.url}" download>${a.role || 'artifact'} file (${a.mime || a.kind})</a>`;
  }
}

// A small preview for a grid cell. Only still images; other kinds open in the inspector.
export function thumbHtml(obs) {
  if (obs.status === 'error') return '';
  const a = visualArtifacts(obs).find((x) => (x.kind === 'svg' || x.kind === 'image') && x.url);
  return a ? html`<img class="art-thumb" src="${a.url}" alt="" loading="lazy">` : '';
}
