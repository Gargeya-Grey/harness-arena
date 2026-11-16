import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, chromePath, serve } from '../tools/visual-web/browser.mjs';
import { inspectPage } from '../tools/visual-web/checks.mjs';
import { inspectApartment, waitForApartment } from '../tools/foldaway-apartment/checks.mjs';

let available = false;
try { chromePath(); available = true; } catch {}
const apartment = fileURLToPath(new URL('../examples/foldaway-apartment/', import.meta.url));

async function withPage(root, run) {
  const server = await serve(root);
  let browser;
  let page;
  try {
    browser = await launchBrowser();
    page = await browser.page();
    await page.viewport(1440, 900);
    await page.navigate(server.url);
    return await run(page, server.url);
  } finally {
    try { await page?.close(); } finally {
      try { await browser?.close(); } finally { await server.close(); }
    }
  }
}

const planner = `<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;margin:20px}#preview{width:min(540px,90vw);aspect-ratio:1;transition:aspect-ratio 250ms linear;background:#ddd}button,select,input{max-width:90vw}</style><main><h1>Planner</h1><label for="furniture">Furniture</label><select id="furniture"><option>Sofa</option><option>Chair</option><option>Table</option></select><button id="add">Add furniture</button><label>Room width<input id="width" type="range" min="3" max="8" value="4"></label><button id="remove" disabled>Remove selected</button><div id="preview" aria-label="Room preview"></div><div id="items"></div></main><script>window.__planner={items:[],width:4,total:0};let next=1,selected;const prices={Sofa:600,Chair:120,Table:300};function render(){__planner.total=__planner.items.reduce((n,i)=>n+prices[i.type],0);items.replaceChildren(...__planner.items.map(i=>{const b=document.createElement('button');b.textContent=i.type+' '+i.id;b.onclick=()=>{selected=i.id;remove.disabled=false};return b}));remove.disabled=!selected}add.onclick=()=>{__planner.items.push({id:next++,type:furniture.value});render()};remove.onclick=()=>{__planner.items=__planner.items.filter(i=>i.id!==selected);selected=undefined;render()};width.oninput=()=>{__planner.width=Number(width.value);preview.style.aspectRatio=__planner.width+'/4'};</script>`;

test('planner accepts a settling aspect-ratio transition and rejects an unchanged square', { skip: !available, timeout: 45000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-planner-regression-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), planner);
    await withPage(root, async (page, url) => {
      const good = await inspectPage(page, { case_id: 'visual-web-room-planner' });
      assert.equal(good.find(value => value.name === 'width changes preview aspect ratio').passed, true, JSON.stringify(good));
      fs.writeFileSync(path.join(root, 'index.html'), planner.replace("preview.style.aspectRatio=__planner.width+'/4'", "preview.style.aspectRatio='1'"));
      await page.navigate(url);
      const broken = await inspectPage(page, { case_id: 'visual-web-room-planner' });
      assert.equal(broken.find(value => value.name === 'width changes preview aspect ratio').passed, false);
      fs.writeFileSync(path.join(root, 'index.html'), planner.replace('250ms', '3s'));
      await page.navigate(url);
      const unfinished = await inspectPage(page, { case_id: 'visual-web-room-planner' });
      const transition = unfinished.find(value => value.name === 'width changes preview aspect ratio');
      assert.equal(transition.passed, null);
      assert.equal(transition.status, 'incomplete');
    });
  } finally {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function adaptRoom(page) {
  await waitForApartment(page);
  await page.evaluate(() => {
    const { scene, camera, renderer } = __apartment;
    window.__scene = { scene, camera, renderer, selectedId: 'table' };
    scene.getObjectByName('floor-lamp').name = 'lamp';
    const light = scene.getObjectByName('room-light');
    const intensity = light.intensity;
    const night = document.createElement('button');
    night.textContent = 'Night mode';
    night.setAttribute('aria-pressed', 'false');
    night.onclick = () => {
      const enabled = night.getAttribute('aria-pressed') !== 'true';
      night.setAttribute('aria-pressed', String(enabled));
      light.intensity = enabled ? intensity / 10 : intensity;
      renderer.render(scene, camera);
    };
    const rotate = document.createElement('button');
    rotate.textContent = 'Rotate view';
    rotate.onclick = () => { camera.position.x += 0.25; camera.lookAt(0, 1, 0); camera.updateMatrixWorld(); renderer.render(scene, camera); };
    document.querySelector('main').append(night, rotate);
  });
}

test('room furniture must be effectively visible and framed, not merely contain meshes', { skip: !available, timeout: 90000 }, async () => {
  await withPage(apartment, async (page, url) => {
    await adaptRoom(page);
    const baseline = await inspectPage(page, { case_id: 'visual-web-three-room' });
    assert.equal(baseline.find(value => value.name === 'furnished room geometry and light').passed, true);
    for (const mutation of ['hidden-parent', 'hidden-group', 'hidden-children', 'transparent', 'out-of-camera']) {
      await page.navigate(url);
      await adaptRoom(page);
      await page.evaluate(async (mutation) => {
        const chair = __scene.scene.getObjectByName('chair-left');
        if (mutation === 'hidden-group') chair.visible = false;
        if (mutation === 'hidden-children') chair.traverse(part => { if (part.isMesh) part.visible = false; });
        if (mutation === 'transparent') chair.traverse(part => { if (part.isMesh) for (const material of Array.isArray(part.material) ? part.material : [part.material]) { material.transparent = true; material.opacity = 0; } });
        if (mutation === 'out-of-camera') chair.position.x = 20;
        if (mutation === 'hidden-parent') {
          const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
          const holder = new THREE.Group();
          holder.visible = false;
          __scene.scene.add(holder);
          holder.add(chair);
        }
      }, mutation);
      const checks = await inspectPage(page, { case_id: 'visual-web-three-room' });
      assert.equal(checks.find(value => value.name === 'furnished room geometry and light').passed, false, mutation);
    }
  });
});

test('guided animation cannot leave the room between valid endpoint poses', { skip: !available, timeout: 120000 }, async () => {
  await withPage(apartment, async page => {
    await waitForApartment(page);
    await page.evaluate(() => {
      const position = __apartment.scene.getObjectByName('bed').position;
      const original = position.set.bind(position);
      position.set = function(x, y, z) { return original(__apartment.state.progress > 0.1 && __apartment.state.progress < 0.4 ? 10 : x, y, z); };
    });
    const checks = await inspectApartment(page, { case_id: 'foldaway-apartment-guided' });
    assert.equal(checks.every(value => value.passed), false, 'a scene with an illegal intermediate bed pose must not pass every browser check');
    assert.equal(checks.find(value => value.name === 'guided movement keeps furniture inside, clear and framed').passed, false);
  });
});

test('reversible mode changes reject even a small synchronous progress and geometry jump', { skip: !available, timeout: 120000 }, async () => {
  await withPage(apartment, async page => {
    await waitForApartment(page);
    await page.evaluate(() => {
      document.querySelector('[data-mode="Studio"]').addEventListener('click', () => {
        if (__apartment.state.playing) __apartment.state.progress = Math.min(1, __apartment.state.progress + 0.05);
      }, { capture: true });
    });
    const checks = await inspectApartment(page, { case_id: 'foldaway-apartment-reversible' });
    assert.equal(checks.find(value => value.name === 'retargeting reverses from the actual pose without teleporting').passed, false);
  });
});

function configurator(mutation = '') {
  return `<!doctype html><meta name="viewport" content="width=device-width"><style>body{font:16px system-ui;margin:12px}#canvas{width:min(740px,100%);height:min(600px,80vw)}label{display:inline-block;margin:8px}input{width:90px}canvas{display:block;width:100%;height:100%}</style><main><h1>Room</h1><div id="canvas"></div><label for="selected">Selected furniture</label><select id="selected"><option value="table">Table</option><option value="chair-left">Chair left</option><option value="chair-right">Chair right</option><option value="lamp">Lamp</option></select><label for="x">Position X</label><input id="x" type="number"><label for="z">Position Z</label><input id="z" type="number"><label for="rotation">Rotation</label><input id="rotation" type="number"><label for="color">Color</label><input id="color" type="color"><button id="night" aria-pressed="false">Night mode</button><button id="rotate">Rotate view</button><button id="reset">Reset room</button></main><script type="module">
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
const mutation=${JSON.stringify(mutation)},scene=new THREE.Scene();scene.background=new THREE.Color('#dadbd4');
const camera=new THREE.OrthographicCamera(-5,5,5,-5,.1,100);camera.position.set(7,7,9);camera.lookAt(0,1,0);
const renderer=new THREE.WebGLRenderer({antialias:true});document.getElementById('canvas').append(renderer.domElement);
const material=c=>new THREE.MeshStandardMaterial({color:c});
function box(parent,name,w,h,d,x,y,z,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);mesh.position.set(x,y,z);mesh.name=name;parent.add(mesh);return mesh}
box(scene,'floor',6,.1,6,0,-.1,0,material('#cbb38c'));box(scene,'wall-back',6,2.8,.12,0,1.3,-3,material('#c9c9bc'));box(scene,'wall-left',.12,2.8,6,-3,1.3,0,material('#d7d7cd'));
const initial={selected:'table',night:false,items:{table:{x:0,z:0,r:0,c:'#906234'},'chair-left':{x:-1.3,z:1,r:0,c:'#516a58'},'chair-right':{x:1.3,z:1,r:0,c:'#707b91'},lamp:{x:1.8,z:-1.8,r:0,c:'#c59b58'}}};
const groups={};for(const [name,info] of Object.entries(initial.items)){const g=new THREE.Group();g.name=name;groups[name]=g;scene.add(g);const mat=material(info.c);if(name==='table'){box(g,'',1.5,.12,.85,0,.9,0,mat);for(const x of [-.55,.55])box(g,'',.1,.85,.55,x,.425,0,mat)}else if(name.startsWith('chair')){box(g,'',.55,.1,.55,0,.5,0,mat);box(g,'',.55,.6,.1,0,.8,-.22,mat);box(g,'',.1,.5,.4,0,.25,0,mat)}else{box(g,'',.15,1.5,.15,0,.75,0,mat);box(g,'',.55,.35,.55,0,1.65,0,mat)}}
const light=new THREE.DirectionalLight('#fff0d5',3);light.name='room-light';light.position.set(3,6,5);scene.add(light,new THREE.AmbientLight('#fff4df',.6));
let data=JSON.parse(localStorage.getItem('visual-web-room')||'null')||structuredClone(initial);const field=id=>document.getElementById(id);
window.__scene={scene,camera,renderer,get selectedId(){return data.selected}};
function draw(){renderer.render(scene,camera)}
function resize(){const b=field('canvas').getBoundingClientRect();renderer.setSize(b.width,b.height,false);const a=b.width/b.height;camera.left=-5*a;camera.right=5*a;camera.updateProjectionMatrix();draw()}new ResizeObserver(resize).observe(field('canvas'));
function save(){const stored=structuredClone(data);if(mutation==='selection-storage')stored.selected='table';localStorage.setItem('visual-web-room',JSON.stringify(stored))}
function sync(){for(const [name,info]of Object.entries(data.items)){const g=groups[name];g.position.x=info.x;g.position.z=info.z;g.rotation.y=info.r*Math.PI/180;g.traverse(p=>{if(p.isMesh)p.material.color.set(info.c)})}const info=data.items[data.selected];field('selected').value=data.selected;field('x').value=info.x;field('z').value=info.z;field('rotation').value=info.r;field('color').value=info.c;field('night').setAttribute('aria-pressed',String(data.night));light.intensity=data.night ? 0.3 : 3;draw()}
field('selected').onchange=()=>{data.selected=field('selected').value;sync();save()};
for(const [id,key]of [['x','x'],['z','z'],['rotation','r'],['color','c']])field(id).oninput=()=>{const info=data.items[mutation==='table-only'?'table':data.selected];let value=id==='color'?field(id).value:Number(field(id).value);if(id==='x'||id==='z')value=mutation==='negative-z'&&id==='z'&&value<0?value:Math.max(-2,Math.min(2,value));info[key]=value;sync();save()};
field('night').onclick=()=>{data.night=!data.night;sync();save()};field('rotate').onclick=()=>{camera.position.x+=.3;camera.lookAt(0,1,0);camera.updateMatrixWorld();draw()};field('reset').onclick=()=>{data=structuredClone(initial);sync();save()};
function frame(){if(mutation==='reduced-animation'&&matchMedia('(prefers-reduced-motion: reduce)').matches){camera.position.x+=.002;camera.lookAt(0,1,0);camera.updateMatrixWorld();draw()}requestAnimationFrame(frame)}sync();resize();frame();
</script>`;
}

test('configurator exercises every object, both clamp signs, selection storage and reduced motion', { skip: !available, timeout: 120000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-visual-configurator-regression-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), configurator());
    await withPage(root, async (page, url) => {
      const ready = async () => page.evaluate(() => new Promise((resolve, reject) => { const end = Date.now() + 15000; const sample = () => window.__scene?.renderer ? resolve() : Date.now() > end ? reject(new Error('Fixture scene not ready')) : setTimeout(sample, 30); sample(); }));
      await ready();
      const baseline = await inspectPage(page, { case_id: 'visual-web-three-configurator' });
      assert.deepEqual(baseline.filter(value => value.passed === false), [], JSON.stringify(baseline));
      for (const [mutation, checkName] of [['table-only', 'each furniture choice edits independently and reflects its values'], ['negative-z', 'room boundary clamps furniture'], ['selection-storage', 'reload restores furniture and lighting'], ['reduced-animation', 'reduced motion keeps the scene static after reload'], ['missing-night', 'night mode changes rendered lighting'], ['wrong-night-accessible-name', 'night mode changes rendered lighting']]) {
        await page.evaluate(() => localStorage.clear());
        await page.send('Emulation.setEmulatedMedia', { features: [] });
        fs.writeFileSync(path.join(root, 'index.html'), configurator(mutation));
        await page.navigate(url);
        await ready();
        if (mutation === 'missing-night') await page.evaluate(() => { document.getElementById('night').textContent = 'Night mode extra'; });
        if (mutation === 'wrong-night-accessible-name') await page.evaluate(() => { document.getElementById('night').setAttribute('aria-label', 'Night mode extra'); });
        const checks = await inspectPage(page, { case_id: 'visual-web-three-configurator' });
        assert.equal(checks.find(value => value.name === checkName)?.passed, false, `${mutation}: ${JSON.stringify(checks)}`);
        if (mutation === 'missing-night') {
          assert.equal(checks.find(value => value.name.startsWith('configurator starts with table selected')).passed, true, 'a missing Night control must not create a duplicate initial-selection defect');
          const restoration = checks.find(value => value.name === 'reload restores furniture and lighting');
          assert.equal(restoration.passed, null);
          assert.equal(restoration.status, 'blocked');
          assert.ok(restoration.blocked_by.includes('night mode changes rendered lighting'));
        }
      }
    });
  } finally {
    assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
