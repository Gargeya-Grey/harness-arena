import { setTimeout as delay } from 'node:timers/promises';

export async function waitForApartment(page) {
  const deadline = Date.now() + 25000;
  while (!(await page.evaluate(() => Boolean(window.__apartment?.renderer?.domElement?.isConnected)))) {
    if (page.errors.length) throw new Error(`Apartment startup failed: ${page.errors.join('; ').slice(0,700)}`);
    if (Date.now() > deadline) throw new Error('Apartment scene did not become ready within 25 seconds');
    await delay(75);
  }
}

export function apartmentSnapshot(page) {
  return page.evaluate(async () => {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
    const { scene, camera, renderer, state } = window.__apartment || {};
    if (!(scene instanceof THREE.Scene) || !(camera instanceof THREE.Camera) || !(renderer instanceof THREE.WebGLRenderer)) throw new Error('The hook must expose actual Three.js scene, camera and WebGLRenderer objects');
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
    const names = ['bed', 'table', 'chair-left', 'chair-right', 'partition'];
    const furniture = names.map((name) => {
      const group = scene.getObjectByName(name);
      if (!group) throw new Error(`Missing furniture group ${name}`);
      const box = new THREE.Box3();
      const meshTransforms = [];
      group.traverse((part) => {
        let shown = true;
        for (let parent = part; parent; parent = parent.parent) shown &&= parent.visible;
        const materials = Array.isArray(part.material) ? part.material : [part.material];
        if (part instanceof THREE.Mesh && shown && camera.layers.test(part.layers) && part.geometry.drawRange.count !== 0 && materials.some((material) => material && material.visible && material.colorWrite !== false && (!material.transparent || material.opacity > 0))) {
          const positions = part.geometry.getAttribute('position');
          for (let instance=0;instance<(part.isInstancedMesh?part.count:1);instance++) {
            const world = part.matrixWorld.clone();
            if (part.isInstancedMesh) { const transform=new THREE.Matrix4();part.getMatrixAt(instance,transform);world.multiply(transform); }
            const point = new THREE.Vector3();
            for (let vertex=0;vertex<(positions?.count||0);vertex++) box.expandByPoint(part.getVertexPosition(vertex,point).applyMatrix4(world));
            if (positions?.count) meshTransforms.push(world.toArray());
          }
        }
      });
      const bounds = [...box.min.toArray(), ...box.max.toArray()];
      const projected = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(new THREE.Vector3(x,y,z).project(camera).toArray());
      return { name, meshes: meshTransforms.length, bounds, projected, matrix: group.matrixWorld.toArray(), meshTransforms };
    });
    const gl = renderer.getContext();
    const colors = new Set();
    let checksum = 0;
    for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
      const pixel = new Uint8Array(4);
      gl.readPixels(Math.floor(gl.drawingBufferWidth * x / 10), Math.floor(gl.drawingBufferHeight * y / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      colors.add([...pixel].join(','));
      checksum = (checksum * 31 + pixel[0] * 3 + pixel[1] * 5 + pixel[2] * 7) >>> 0;
    }
    const canvas = renderer.domElement.getBoundingClientRect();
    const size = renderer.getSize(new THREE.Vector2());
    return {
      state: { progress: state?.progress, target: state?.target, playing: state?.playing }, furniture,
      pixels: { colors: colors.size, checksum },
      canvas: { width: canvas.width, height: canvas.height, renderWidth: size.x, renderHeight: size.y },
    };
  });
}

export function clearanceProblems(snapshot, pairs = [['bed','table'], ['bed','chair-left'], ['bed','chair-right'], ['chair-left','chair-right']]) {
  const problems = [];
  for (const item of snapshot.furniture) {
    const b = item.bounds;
    const spans=[0,1,2].map((axis)=>b[axis+3]-b[axis]);
    if (!item.meshes || !b.every(Number.isFinite) || spans.some((size)=>size<0) || spans.filter((size)=>size>0.02).length<2) problems.push(`${item.name}: no visible furniture geometry`);
    if (b[0] < -3.03 || b[3] > 3.03 || b[2] < -2.53 || b[5] > 2.53 || b[1] < -0.03) problems.push(`${item.name}: outside room`);
  }
  for (const [left,right] of pairs) {
    const a = snapshot.furniture.find((item) => item.name === left)?.bounds;
    const b = snapshot.furniture.find((item) => item.name === right)?.bounds;
    if (!a || !b) { problems.push(`${left}/${right}: missing bounds`); continue; }
    const overlap = [0,1,2].map((axis) => Math.min(a[axis+3],b[axis+3])-Math.max(a[axis],b[axis]));
    if (overlap.every((size) => size > 0.025)) problems.push(`${left}/${right}: overlapping bounds (${overlap.map((size) => size.toFixed(3)).join(',')})`);
  }
  return problems;
}

export async function inspectApartment(page, testCase, { onState } = {}) {
  const checks = [];
  const check = async (name, action, accept = (value) => value === true) => {
    try { const observed = await action(); checks.push({ name, passed: Boolean(accept(observed)), observed }); }
    catch (error) { checks.push({ name, passed: false, error: String(error.message).slice(0,700) }); }
  };
  const findControl = (selector,name) => page.evaluate(({selector,name}) => {
      const el = [...document.querySelectorAll(selector)].find((item) => {
        const copy = item.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach((part) => part.remove());
        const labelled = item.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        const labels = item.labels?.length ? [...item.labels].map((label) => label.textContent).join(' ') : '';
        return (labelled || item.getAttribute('aria-label') || labels || copy.textContent).replace(/\s+/g,' ').trim() === name;
      });
      if (!el) throw new Error(`Missing ${selector} named ${name}`);
      el.dataset.labApartmentControl = name;
      return `[data-lab-apartment-control=${JSON.stringify(name)}]`;
    }, {selector,name});
  const button = async (name) => page.click(await findControl('button',name));
  const scrub = async (progress) => page.evaluate(({progress,selector}) => {
    const el = document.querySelector(selector);
    el.value = String(progress * 100);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, {progress,selector:await findControl('input[type="range"]','Transformation')});
  const waitStopped = async () => {
    const deadline = Date.now()+15000;
    while (await page.evaluate(() => __apartment.state.playing)) {
      if (Date.now()>deadline) throw new Error('Transformation did not finish within 15 seconds');
      await delay(60);
    }
  };
  const posesMatch = (a,b) => a.furniture.every((item,i) => item.matrix.every((n,j) => Math.abs(n-b.furniture[i].matrix[j]) < 1e-6) && item.bounds.every((n,j) => Math.abs(n-b.furniture[i].bounds[j]) < 1e-6) && item.meshTransforms.length === b.furniture[i].meshTransforms.length && item.meshTransforms.every((matrix,m) => matrix.every((n,j) => Math.abs(n-b.furniture[i].meshTransforms[m][j]) < 1e-6)));
  const framed = snapshot => snapshot.furniture.every(item => item.projected.every(([x, y, z]) => Math.abs(x) <= 1.02 && Math.abs(y) <= 1.02 && z >= -1 && z <= 1));
  const observeMovement = async () => {
    const deadline = Date.now() + 15000;
    const problems = [];
    let samples = 0;
    let intermediate = 0;
    for (;;) {
      const snapshot = await apartmentSnapshot(page);
      samples++;
      if (snapshot.state.progress > 0 && snapshot.state.progress < 1) intermediate++;
      const errors = clearanceProblems(snapshot);
      if (!framed(snapshot)) errors.push('camera clips furniture bounds');
      if (errors.length && problems.length < 20) {
        if (!problems.length) await onState?.('guided-invalid-midpath');
        problems.push({ progress: snapshot.state.progress, errors });
      }
      if (!snapshot.state.playing) return { samples, intermediate, problems };
      if (Date.now() > deadline) throw new Error('Guided movement did not finish within 15 seconds');
      await delay(75);
    }
  };
  const kind = testCase.metadata?.browser?.variant || testCase.case_id.split('-').at(-1);
  const hasTimeline = kind !== 'guided';
  const startToward = async (mode) => {
    await button(mode);
    const selected = await page.evaluate(()=>({progress:__apartment.state.progress,target:__apartment.state.target,playing:__apartment.state.playing}));
    if (hasTimeline && !selected.playing && Math.abs(selected.target-selected.progress)>1e-6) await button('Play');
    return selected;
  };
  await check('real visible apartment starts paused in Studio', async () => {
    const value = await apartmentSnapshot(page);
    return { state: value.state, pixels: value.pixels, problems: clearanceProblems(value) };
  }, (v) => v.state.progress === 0 && v.state.target === 0 && v.state.playing === false && v.pixels.colors > 5 && !v.problems.length);
  for (const [width,height] of [[1440,900],[390,844]]) {
    await page.viewport(width,height);
    await check(`fitted apartment and no overflow at ${width}px`, async () => {
      const value = await apartmentSnapshot(page);
      return { canvas: value.canvas, fits: value.furniture.every((item) => item.projected.every(([x,y,z]) => Math.abs(x) <= 1.02 && Math.abs(y) <= 1.02 && z >= -1 && z <= 1)), document: await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth })) };
    }, (v) => v.canvas.width > 200 && v.canvas.height > 200 && Math.abs(v.canvas.width-v.canvas.renderWidth) <= 2 && Math.abs(v.canvas.height-v.canvas.renderHeight) <= 2 && v.fits && v.document.scroll <= v.document.width+1);
    await onState?.(width === 390 ? 'mobile-studio' : 'desktop-studio');
  }
  await page.viewport(1440,900);
  const endpoints = [];
  const guidedPaths = [];
  for (const [mode,progress] of [['Dining',0.5],['Bedroom',1],['Studio',0]]) {
    await check(`${mode} reaches its declared mode`, async () => {
      const requested = await startToward(mode);
      if (hasTimeline) await waitStopped();
      else guidedPaths.push({ viewport: 1440, mode, ...await observeMovement() });
      const snapshot = await apartmentSnapshot(page);
      endpoints.push(snapshot);
      await onState?.(mode.toLowerCase());
      if (onState) { await page.viewport(390,844); await onState(`mobile-${mode.toLowerCase()}`); await page.viewport(1440,900); }
      return { requested:requested.target,state: snapshot.state, problems: clearanceProblems(snapshot), active: await page.evaluate((selector) => document.querySelector(selector)?.getAttribute('aria-pressed') === 'true',await findControl('button',mode)) };
    }, (v) => v.requested===progress && Math.abs(v.state.progress-progress) < 0.001 && v.state.target === progress && !v.state.playing && v.active && !v.problems.length);
  }
  await check('modes change actual furniture geometry', () => endpoints.length === 3 && !posesMatch(endpoints[0],endpoints[1]) && !posesMatch(endpoints[1],endpoints[2]));
  if (!hasTimeline) {
    await check('guided movement keeps furniture inside, clear and framed', async () => {
      await page.viewport(390, 844);
      for (const mode of ['Bedroom', 'Studio']) {
        await startToward(mode);
        guidedPaths.push({ viewport: 390, mode, ...await observeMovement() });
      }
      await page.viewport(1440, 900);
      return guidedPaths;
    }, paths => paths.length === 5 && paths.every(path => path.samples > 0 && path.problems.length === 0));
  }
  if (hasTimeline) {
    await check('scrubbing is deterministic and pauses playback', async () => {
      await scrub(0.35); const before = await apartmentSnapshot(page);
      await scrub(0.9); await scrub(0.35); const after = await apartmentSnapshot(page);
      await onState?.('mid-transformation');
      return { before: before.state, after: after.state, samePose: posesMatch(before,after) };
    }, (v) => Math.abs(v.after.progress-0.35) < 0.001 && !v.before.playing && !v.after.playing && v.samePose);
    await check('furniture stays visible, inside and clear throughout the sampled timeline', async () => {
      const problems = [];
      for (const [width,height] of [[1440,900],[390,844]]) {
        await page.viewport(width,height);
        for (let i=0;i<=40;i++) {
          await scrub(i/40); const value = await apartmentSnapshot(page); const errors = clearanceProblems(value);
          if (!value.furniture.every((item) => item.projected.every(([x,y,z]) => Math.abs(x) <= 1.02 && Math.abs(y) <= 1.02 && z >= -1 && z <= 1))) errors.push('camera clips furniture bounds');
          if (errors.length) problems.push({ viewport:width, progress:i/40, errors });
        }
      }
      await page.viewport(1440,900);
      return problems;
    }, (v) => v.length === 0);
    await check('Pause freezes the current pose', async () => {
      await startToward('Studio'); await waitStopped(); await button('Play'); await delay(350); await button('Pause');
      const before = await apartmentSnapshot(page); await delay(250); const after = await apartmentSnapshot(page);
      return { before: before.state, after: after.state, samePose: posesMatch(before,after) };
    }, (v) => !v.after.playing && v.before.progress > 0 && v.after.progress < 0.5 && v.before.progress === v.after.progress && v.samePose);
    if (kind === 'reversible') {
      await check('retargeting reverses from the actual pose without teleporting', async () => {
        await scrub(0.65); await startToward('Bedroom'); await delay(180);
        const selectors = [];
        for (const mode of ['Studio', 'Dining', 'Studio']) selectors.push(await findControl('button', mode));
        const atomic = await page.evaluate(async selectors => {
          const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
          const capture = () => {
            const { scene, state } = __apartment;
            scene.updateMatrixWorld(true);
            return { state: { progress: state.progress, target: state.target, playing: state.playing }, furniture: ['bed', 'table', 'chair-left', 'chair-right', 'partition'].map(name => {
              const object = scene.getObjectByName(name);
              const box = new THREE.Box3().setFromObject(object, true);
              const meshes = [];
              object.traverse(part => { if (part.isMesh) meshes.push({ id: part.uuid, matrix: part.matrixWorld.toArray() }); });
              return { name, matrix: object.matrixWorld.toArray(), bounds: [...box.min.toArray(), ...box.max.toArray()], meshes };
            }) };
          };
          return new Promise(resolve => requestAnimationFrame(() => {
            const before = capture();
            const after = selectors.map(selector => { document.querySelector(selector).click(); return capture(); });
            resolve({ before, after });
          }));
        }, selectors);
        await waitStopped(); const end = await apartmentSnapshot(page);
        const same = (left, right) => left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) < 1e-6);
        const preserved = atomic.after.every(snapshot => Math.abs(snapshot.state.progress - atomic.before.state.progress) < 1e-9 && snapshot.furniture.every((item, index) => {
          const before = atomic.before.furniture[index];
          return same(item.matrix, before.matrix) && same(item.bounds, before.bounds) && item.meshes.length === before.meshes.length && item.meshes.every((mesh, part) => mesh.id === before.meshes[part].id && same(mesh.matrix, before.meshes[part].matrix));
        }));
        return { before: atomic.before.state, after: atomic.after.map(snapshot => snapshot.state), preserved, end: end.state };
      }, (v) => v.before.progress > 0.65 && v.before.progress < 1 && v.after.map(state => state.target).join() === '0,0.5,0' && v.preserved && v.end.progress === 0 && !v.end.playing);
    }
  }
  await check('Reset returns to a paused Studio and cancels pending movement', async () => {
    await startToward('Bedroom'); await delay(120); await button('Reset');
    const before = await apartmentSnapshot(page); await delay(1200); const after = await apartmentSnapshot(page);
    return {before:before.state,after:after.state,samePose:posesMatch(before,after),studioPose:endpoints.length===3&&posesMatch(endpoints[2],after)};
  }, (v) => v.before.progress === 0 && v.after.progress === 0 && v.after.target === 0 && !v.after.playing && v.samePose && v.studioPose);
  await check('reduced motion makes mode selection immediate and static', async () => {
    await page.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await page.navigate(await page.evaluate(() => location.href)); await waitForApartment(page);
    await button('Bedroom'); const before = await apartmentSnapshot(page); await delay(300); const after = await apartmentSnapshot(page);
    return { before: before.state, after: after.state, samePose: posesMatch(before,after) };
  }, (v) => v.before.progress === 1 && !v.before.playing && v.after.progress === 1 && !v.after.playing && v.samePose);
  await page.send('Emulation.setEmulatedMedia',{features:[]});
  await button('Reset');
  await check('no JavaScript or WebGL console errors', () => [...page.errors], (v) => v.length === 0);
  return checks;
}
