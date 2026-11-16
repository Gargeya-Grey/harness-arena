import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { launchBrowser, chromePath, serve } from '../tools/visual-web/browser.mjs';
import { inspectApartment, waitForApartment, apartmentSnapshot, clearanceProblems } from '../tools/foldaway-apartment/checks.mjs';

let available = false;
try { chromePath(); available = true; } catch { /* Source checks can run without a local Chromium. */ }
const reference = fileURLToPath(new URL('../examples/foldaway-apartment/',import.meta.url));

test('the reference apartment supports the complete reversible user flow in a real browser', {skip:!available,timeout:120000}, async () => {
  const server = await serve(reference);
  let browser;
  let page;
  try {
    browser = await launchBrowser(); page = await browser.page();
    await page.viewport(1440,900); await page.navigate(server.url); await waitForApartment(page);
    await page.send('Page.addScriptToEvaluateOnNewDocument',{source:`addEventListener('load',()=>{const rename=()=>{
      if(!window.__apartment){setTimeout(rename,20);return;}
      let progress=__apartment.state.progress;
      Object.defineProperty(__apartment.state,'progress',{get(){return progress;},set(value){progress=value;},enumerable:false,configurable:true});
      for(const mode of ['Studio','Dining','Bedroom']) {
        const button=document.querySelector('[data-mode="'+mode+'"]');
        const label=document.createElement('span'); label.id='named-'+mode; label.textContent=mode; label.hidden=true; document.body.append(label);
        button.removeAttribute('aria-label'); button.setAttribute('aria-labelledby',label.id);
        button.addEventListener('click',event=>{
          if(!__apartment.state.playing&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
            event.stopImmediatePropagation();__apartment.state.target={Studio:0,Dining:0.5,Bedroom:1}[mode];
          }
        },{capture:true});
      }
      const range=document.querySelector('input[type="range"]');
      const label=document.createElement('span'); label.id='named-range'; label.textContent='Transformation'; label.hidden=true; document.body.append(label);
      range.setAttribute('aria-labelledby',label.id);
      document.querySelector('label[for="'+range.id+'"]').removeAttribute('for');
      document.body.dataset.labNamesReady='true';
    };rename();});`});
    await page.navigate(server.url); await waitForApartment(page);
    await page.evaluate(()=>new Promise((resolve,reject)=>{const end=Date.now()+2000;const ready=()=>{if(document.body.dataset.labNamesReady)resolve();else if(Date.now()>end)reject(new Error('Named-control fixture did not initialize'));else setTimeout(ready,20);};ready();}));
    assert.equal(await page.evaluate(()=>document.querySelector('[data-mode="Dining"]').hasAttribute('aria-label')),false,'exercise aria-labelledby rather than a fallback label');
    assert.equal(await page.evaluate(()=>Object.keys(__apartment.state).includes('progress')),false,'the public state may use a non-enumerable numeric getter');
    await page.evaluate(()=>document.querySelector('input[type="range"]').focus());
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,nativeVirtualKeyCode:39});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39,nativeVirtualKeyCode:39});
    assert.equal(await page.evaluate(()=>__apartment.state.progress),0.01,'the native slider works from the keyboard');
    await page.click('#reset');
    const checks = await inspectApartment(page,{case_id:'foldaway-apartment-reversible'});
    assert.ok(checks.length >= 14);
    assert.deepEqual(checks.filter((item) => !item.passed),[]);
  } finally { try { await page?.close(); } finally { try { await browser?.close(); } finally { await server.close(); } } }
});

test('the geometry check rejects a hidden piece and real furniture moved into another piece', {skip:!available,timeout:45000}, async () => {
  const server = await serve(reference);
  let browser;
  let page;
  try {
    browser = await launchBrowser(); page = await browser.page();
    await page.viewport(1440,900); await page.navigate(server.url); await waitForApartment(page);
    const good = await apartmentSnapshot(page);
    assert.deepEqual(clearanceProblems(good),[]);
    await page.evaluate(async()=>{
      const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      const partition=__apartment.scene.getObjectByName('partition');partition.clear();
      const panel=new THREE.Mesh(new THREE.PlaneGeometry(0.5,2),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));panel.position.y=1;partition.add(panel);
    });
    assert.deepEqual(clearanceProblems(await apartmentSnapshot(page)),[],'a visible thin panel is valid furniture geometry');
    await page.evaluate(async () => {
      const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      const glass=new THREE.Mesh(new THREE.BoxGeometry(1,0.1,1),new THREE.MeshBasicMaterial({transparent:true,opacity:0.4}));
      glass.name='lab-glass-marker'; glass.position.x=20; __apartment.scene.getObjectByName('table').add(glass);
    });
    assert.ok(clearanceProblems(await apartmentSnapshot(page)).some((problem)=>problem.includes('table: outside room')),'visible translucent geometry is included');
    await page.evaluate(async()=>{
      const glass=__apartment.scene.getObjectByName('lab-glass-marker'); glass.removeFromParent(); glass.geometry.dispose(); glass.material.dispose();
      const THREE=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      let parent; __apartment.scene.getObjectByName('table').traverse((part)=>{if(!parent&&part.isMesh) parent=part;});
      const hidden=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
      hidden.visible=false; hidden.position.x=20; parent.add(hidden);
    });
    assert.deepEqual(clearanceProblems(await apartmentSnapshot(page)),[],'hidden descendants of a visible mesh do not enlarge its bounds');
    await page.evaluate(() => { __apartment.scene.getObjectByName('bed').visible = false; });
    assert.ok(clearanceProblems(await apartmentSnapshot(page)).some((problem) => problem.includes('bed: no visible furniture geometry')));
    await page.evaluate(async () => {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      const bed = __apartment.scene.getObjectByName('bed'); bed.visible = true;
      const chair = __apartment.scene.getObjectByName('chair-left');
      __apartment.scene.updateMatrixWorld(true);
      const destination = new THREE.Box3().setFromObject(bed).getCenter(new THREE.Vector3());
      const origin = new THREE.Box3().setFromObject(chair).getCenter(new THREE.Vector3());
      const delta = chair.parent.worldToLocal(destination).sub(chair.parent.worldToLocal(origin));
      chair.position.add(delta); chair.updateMatrixWorld(true);
    });
    assert.ok(clearanceProblems(await apartmentSnapshot(page)).some((problem) => problem.includes('bed/chair-left: overlapping bounds')));
  } finally { try { await page?.close(); } finally { try { await browser?.close(); } finally { await server.close(); } } }
});
