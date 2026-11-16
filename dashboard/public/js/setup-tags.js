import { html } from './util.js';

export const effortValue = (cfg) => cfg.effort || 'not-recorded';
export const effortText = (value) => value === 'not-recorded' ? 'not recorded' : value;

export function setupTags(cfg) {
  return html`<span class="setup-tags"><span class="setup-tag tag-harness" data-harness="${cfg.harness?.name || ''}"><span class="tag-label">Harness</span>${cfg.harness?.name || 'not recorded'}${cfg.harness?.version ? html`<span class="tag-version">${cfg.harness.version}</span>` : ''}</span><span class="setup-tag tag-effort" data-effort="${effortValue(cfg)}"><span class="tag-label">Effort</span>${effortText(effortValue(cfg))}</span></span>`;
}
