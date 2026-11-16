import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchBrowser, serve } from '../visual-web/browser.mjs';
import { listTree, treeHash } from '../../lab/lib/workspace.mjs';
import { labRoot } from '../../lab/lib/repo.mjs';
import { reportDestination } from '../visual-web/inspect.mjs';
import { inspectApartment, waitForApartment } from './checks.mjs';

export async function verifyReference({ root, out, variant = 'reversible' }) {
  if (!['guided', 'scrubbable', 'reversible'].includes(variant)) throw new Error('Reference variant must be guided, scrubbable or reversible');
  const source = path.resolve(root);
  const output = reportDestination(labRoot(),out);
  if (fs.existsSync(output)) throw new Error('Choose a new reference evidence directory');
  fs.mkdirSync(output,{recursive:true});
  const report = {
    kind: 'foldaway-reference-observation', version: '2', variant, created_at: new Date().toISOString(),
    source, source_sha256: treeHash(source), reference_not_model_output: true,
    checker_sha256: crypto.createHash('sha256').update(fs.readFileSync(new URL('./checks.mjs',import.meta.url))).digest('hex'),
    checks: [], screenshots: [], limitations: ['Sampled bounding-box checks do not prove collision freedom at every possible instant.', 'Visual quality and first-screen comprehension need separate review.', 'Headless software WebGL is not physical GPU or touch evidence.'], cleanup: {},
  };
  const server = await serve(source);
  let browser;
  let page;
  try {
    browser = await launchBrowser(); report.browser = browser.version;
    page = await browser.page(); await page.viewport(1440,900);
    await page.navigate(server.url); await waitForApartment(page);
    report.checks = await inspectApartment(page,{case_id:`foldaway-apartment-${variant}`},{onState:async (state) => {
      const name = `${state}.png`; await page.screenshot(path.join(output,name),true); report.screenshots.push({state,path:name});
    }});
    report.console_errors = [...page.errors];
  } catch (error) { report.error = error.stack; }
  finally {
    try { await page?.close(); report.cleanup.page_closed = true; }
    catch (error) { report.cleanup.page_error = error.message; }
    try { Object.assign(report.cleanup,await browser?.close()); }
    catch (error) { report.cleanup.browser_error = error.message; }
    try { await server.close(); report.cleanup.server_closed = true; }
    catch (error) { report.cleanup.server_error = error.message; }
    report.evidence_bytes = listTree(output).reduce((sum,rel) => sum+fs.statSync(path.join(output,rel)).size,0);
    fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!args.includes('--out')) { console.error('Usage: node tools/foldaway-apartment/verify-reference.mjs --out <new-evidence-directory> [--variant guided|scrubbable|reversible]'); process.exitCode = 1; }
  else {
    const root = fileURLToPath(new URL('../../examples/foldaway-apartment/',import.meta.url));
    const variant = args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'reversible';
    const report = await verifyReference({root,out:args[args.indexOf('--out')+1],variant});
    for (const item of report.checks) console.log(`${item.passed === true ? 'PASS' : item.passed === false ? 'FAIL' : item.status.toUpperCase()} ${item.name}${item.error?`: ${item.error}`:''}`);
    if (report.error) console.error(report.error);
    console.log(`Reference evidence: ${args[args.indexOf('--out')+1]}`);
    if (report.error || report.checks.some((item) => !item.passed) || !report.cleanup.browser_closed || !report.cleanup.server_closed) process.exitCode = 1;
  }
}
