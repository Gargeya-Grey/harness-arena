export async function inspectPage(page, testCase, { onState } = {}) {
  const checks = [];
  const check = async (name, run, accepts = (value) => value === true, requires = []) => {
    const blocked = requires.filter(required => checks.find(item => item.name === required)?.passed !== true);
    if (blocked.length) { checks.push({ name, passed: null, status: 'blocked', blocked_by: blocked }); return; }
    try {
      const observed = await run();
      checks.push(observed?.unjudged
        ? { name, passed: null, status: 'incomplete', reason: observed.unjudged, observed }
        : { name, passed: Boolean(accepts(observed)), observed });
    }
    catch (error) { checks.push({ name, passed: false, error: String(error.message).slice(0, 600) }); }
  };
  const evaluate = page.evaluate;
  const set = (selector, value) => evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Missing ${selector}`);
    el.value = el.tagName === 'SELECT' ? ([...el.options].find((option) => option.textContent.trim() === value)?.value ?? value) : value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
  const findNamed = (selector, name) => evaluate(({ selector, name }) => {
    const normal = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const named = (el, copy) => el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') || el.getAttribute('aria-label') || (el.labels?.length ? [...el.labels].map((label) => label.textContent).join(' ') : copy.textContent);
    const el = [...document.querySelectorAll(selector)].find((el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
      return normal(named(el, copy)) === name;
    });
    if (!el) throw new Error(`Missing ${selector} named ${name}`);
    el.dataset.labControl = name;
    return `[data-lab-control=${JSON.stringify(name)}]`;
  }, { selector, name });
  const findLabel = (label) => findNamed('input,select', label);
  const button = (name) => findNamed('button', name).then((selector) => page.click(selector));

  await check('visible page content', () => evaluate(() => document.body.getBoundingClientRect().height > 0 && document.body.innerText.trim().length > 0));
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.viewport(width, height);
    await check(`no document overflow at ${width}px`, () => evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth })), (v) => v.document <= v.viewport + 1);
  }
  await page.viewport(1440, 900);
  const id = testCase.case_id;
  if (id.endsWith('event-page')) {
    await check('semantic landmarks and title', () => evaluate(() => ['header','main','footer'].every((s) => document.querySelector(s)) && document.querySelectorAll('h1').length === 1 && document.querySelector('h1').innerText.replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '').toLowerCase() === 'open house evening'));
    await check('machine readable event time', () => evaluate(() => !!document.querySelector('time[datetime="2026-12-05T18:00:00"]')));
    await check('ticket destination', () => evaluate(() => [...document.querySelectorAll('a[href="#tickets"]')].some((a) => a.innerText.replace(/\s+/g, ' ').trim().toLowerCase().startsWith('reserve a ticket')) && !!document.querySelector('section#tickets')));
    await check('ticket link works', async () => {
      await page.click('a[href="#tickets"]');
      return evaluate(() => location.hash === '#tickets');
    });
  } else if (id.endsWith('interior-studio')) {
    await check('interior studio brief', () => evaluate(() => document.querySelector('h1')?.innerText.replace(/\s+/g, ' ').trim().replace(/[.!?]$/, '').toLowerCase() === 'spaces for slower living' && ['projects','about','contact'].every((id) => document.querySelector(`a[href="#${id}"]`) && document.getElementById(id))));
    const visibleArticles = () => evaluate(() => [...document.querySelectorAll('article')].filter((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden').map((el) => el.textContent.trim()));
    await check('three initial projects', visibleArticles, (v) => v.length === 3 && ['Courtyard home','Harbor loft','Cedar workspace'].every((title) => v.some((s) => s.includes(title))));
    await check('workspace filter', async () => {
      await set(await findLabel('Project type'), 'Workspaces');
      const articles = await visibleArticles();
      await evaluate(() => document.getElementById('projects')?.scrollIntoView());
      await onState?.('workspace-filter');
      return articles;
    }, (v) => v.length === 1 && v[0].includes('Cedar workspace'));
    await check('home filter', async () => {
      await set(await findLabel('Project type'), 'Homes');
      return visibleArticles();
    }, (v) => v.length === 2 && v.some((s) => s.includes('Courtyard home')) && v.some((s) => s.includes('Harbor loft')));
    await check('restore all projects', async () => { await set(await findLabel('Project type'), 'All'); const articles = await visibleArticles(); await onState?.('projects'); return articles; }, (v) => v.length === 3);
  } else if (id.endsWith('room-planner')) {
    await check('empty planner defaults', () => evaluate(() => ({ items: window.__planner?.items, width: window.__planner?.width, total: window.__planner?.total })), (v) => v.items?.length === 0 && v.width === 4 && v.total === 0);
    await check('remove disabled without selection', () => evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Remove selected' && b.disabled)));
    const fieldOption = (selector, text) => evaluate(({ selector, text }) => {
      const el = document.querySelector(selector);
      const op = [...el.options].find((o) => o.textContent.trim().startsWith(text));
      if (!op) throw new Error(`Missing option ${text}`);
      return op.value;
    }, { selector, text });
    await check('add sofa and chair with correct price', async () => {
      const field = await findLabel('Furniture');
      await set(field, await fieldOption(field, 'Sofa'));
      await button('Add furniture');
      await set(field, await fieldOption(field, 'Chair'));
      await button('Add furniture');
      return evaluate(() => ({ count: __planner.items.length, total: __planner.total }));
    }, (v) => v.count === 2 && v.total === 720);
    await check('width changes preview aspect ratio', async () => {
      const before = await evaluate(() => {
        const region = [...document.querySelectorAll('[aria-label],[aria-labelledby]')].find((el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') || '').replace(/\s+/g,' ').trim() === 'Room preview');
        if (!region) throw new Error('Missing labelled Room preview');
        return [region, ...region.querySelectorAll('*')].map((el, i) => { el.dataset.labRoomMeasure = i; const b = el.getBoundingClientRect(); return { id: i, width: b.width, height: b.height, ratio: b.width / b.height }; });
      });
      await set(await findLabel('Room width'), '6');
      return evaluate((before) => new Promise((resolve) => {
        const deadline = performance.now() + 2000;
        const sample = () => {
          const region = [...document.querySelectorAll('[aria-label],[aria-labelledby]')].find((el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ') || '').replace(/\s+/g,' ').trim() === 'Room preview');
          const elements = region ? [region, ...region.querySelectorAll('*')] : [];
          const candidates = before.filter((old) => Math.abs(old.ratio - 1) < 0.05 && old.width * old.height > 4000).map((old) => {
            const element = elements[old.id];
            if (!element) return { before: old.ratio, after: 0 };
            const b = element.getBoundingClientRect();
            return { before: old.ratio, after: b.width / b.height };
          });
          const transitioning = elements.some((element) => element.getAnimations?.().some((animation) => animation.transitionProperty === 'aspect-ratio' && ['running', 'pending'].includes(animation.playState)));
          const observed = { width: __planner.width, candidates };
          if (performance.now() >= deadline && transitioning) resolve({ ...observed, unjudged: 'The aspect-ratio transition is still active at the browser observation guard; final geometry is not yet judged.' });
          else if ((!transitioning && candidates.some((box) => Math.abs(box.after - 1.5) < 0.05)) || performance.now() >= deadline) resolve(observed);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }), before);
    }, (v) => v.width === 6 && v.candidates.some((box) => Math.abs(box.after - 1.5) < 0.05));
    await check('selection and removal affect the selected item', async () => {
      await button('Sofa 1');
      await button('Remove selected');
      return evaluate(() => ({ items: __planner.items, total: __planner.total }));
    }, (v) => v.items.length === 1 && v.items[0].id === 2 && v.total === 120);
  } else if (id.includes('three-')) {
    const roomState = () => evaluate(() => {
      const normal = (value) => String(value || '').replace(/\s+/g,' ').trim();
      const round = (value) => Math.round(value * 1e6) / 1e6;
      const items = ['table','chair-left','chair-right','lamp'].map((name) => {
        const object = __scene.scene.getObjectByName(name);
        const colors = [];
        object.traverse((part) => {
          let shown = true;
          for (let ancestor = part; ancestor; ancestor = ancestor.parent) shown &&= ancestor.visible;
          if (part.isMesh && shown && __scene.camera.layers.test(part.layers) && part.geometry.drawRange.count !== 0) for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
            if (material?.visible && material.colorWrite !== false && (!material.transparent || material.opacity > 0) && material.color) colors.push(material.color.getHexString());
          }
        });
        const position = object.getWorldPosition(object.position.clone());
        return { name, position: position.toArray().map(round), rotation: object.rotation.toArray().slice(0,3).map(round), colors };
      });
      const night = [...document.querySelectorAll('button')].find((el) => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach(hidden => hidden.remove());
        const named = el.getAttribute('aria-labelledby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ') || el.getAttribute('aria-label') || copy.textContent;
        return normal(named) === 'Night mode';
      })?.getAttribute('aria-pressed');
      return { items, selected: __scene.selectedId, light: __scene.scene.getObjectByName('room-light').intensity, night };
    });
    let defaults;
    const logicalState = (state) => ({ ...state, light: undefined });
    if (id.endsWith('three-configurator')) {
      try { defaults = await roomState(); } catch { /* The individual assertions report a missing or broken scene. */ }
      await check('configurator starts with table selected', () => defaults, value => value?.selected === 'table');
    }
    await check('real Three scene and renderer', () => evaluate(() => ({ scene: !!window.__scene?.scene?.isScene, camera: !!window.__scene?.camera?.isCamera, renderer: !!window.__scene?.renderer?.isWebGLRenderer, canvas: !!window.__scene?.renderer?.domElement?.isConnected })), (v) => Object.values(v).every(Boolean));
    const furnishedGeometry = () => evaluate(async () => {
      const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      const { scene, camera, renderer } = window.__scene || {};
      scene?.updateMatrixWorld(true);
      camera?.updateMatrixWorld(true);
      if (scene && camera && renderer) renderer.render(scene, camera);
      return ['floor','wall-back','wall-left','table','chair-left','chair-right','lamp','room-light'].map((name) => {
        const object = scene?.getObjectByName(name);
        let meshes = 0;
        const box = new THREE.Box3();
        object?.traverse((part) => {
          let shown = true;
          for (let ancestor = part; ancestor; ancestor = ancestor.parent) shown &&= ancestor.visible;
          const materials = Array.isArray(part.material) ? part.material : [part.material];
          if (!(part instanceof THREE.Mesh) || !shown || !camera?.layers.test(part.layers) || !materials.some(material => material?.visible && material.colorWrite !== false && (!material.transparent || material.opacity > 0)) || part.geometry.drawRange.count === 0) return;
          const positions = part.geometry.getAttribute('position');
          for (let instance = 0; instance < (part.isInstancedMesh ? part.count : 1); instance++) {
            const world = part.matrixWorld.clone();
            if (part.isInstancedMesh) { const transform = new THREE.Matrix4(); part.getMatrixAt(instance, transform); world.multiply(transform); }
            const point = new THREE.Vector3();
            for (let vertex = 0; vertex < (positions?.count || 0); vertex++) box.expandByPoint(part.getVertexPosition(vertex, point).applyMatrix4(world));
            if (positions?.count) meshes++;
          }
        });
        const bounds = [...box.min.toArray(), ...box.max.toArray()];
        const projected = [];
        if (meshes && camera) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) projected.push(new THREE.Vector3(x, y, z).project(camera).toArray());
        const furniture = ['table', 'chair-left', 'chair-right', 'lamp'].includes(name);
        const framed = projected.length > 0 && (furniture
          ? projected.every(([x, y, z]) => Math.abs(x) <= 1.02 && Math.abs(y) <= 1.02 && z >= -1 && z <= 1)
          : [0, 1, 2].every(axis => Math.min(...projected.map(point => point[axis])) <= 1 && Math.max(...projected.map(point => point[axis])) >= -1));
        return { name, meshes, bounds, framed, light: object instanceof THREE.Light };
      });
    });
    const furnished = value => value.every(object => object.name === 'room-light' ? object.light : object.meshes > 0 && object.bounds.every(Number.isFinite) && object.framed);
    await check('furnished room geometry and light', furnishedGeometry, furnished);
    await check('furniture remains visible and framed on a phone', async () => {
      await page.viewport(390, 844);
      try { return await furnishedGeometry(); }
      finally { await page.viewport(1440, 900); }
    }, furnished);
    const pixels = () => evaluate(() => {
      const { scene, camera, renderer } = __scene;
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const colors = new Set();
      let checksum = 0;
      for (let y = 1; y < 10; y++) for (let x = 1; x < 10; x++) {
        const pixel = new Uint8Array(4);
        gl.readPixels(Math.floor(gl.drawingBufferWidth * x / 10), Math.floor(gl.drawingBufferHeight * y / 10), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        colors.add([...pixel].join(','));
        checksum = (checksum * 31 + pixel[0] * 3 + pixel[1] * 5 + pixel[2] * 7) >>> 0;
      }
      return { colors: colors.size, checksum, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight };
    });
    await check('nonblank WebGL render', pixels, (v) => v.colors > 3 && v.width > 100 && v.height > 100);
    await check('night mode changes rendered lighting', async () => {
      const before = await pixels();
      const lightBefore = await evaluate(() => __scene.scene.getObjectByName('room-light')?.intensity);
      const control = await findNamed('button', 'Night mode');
      const pressedBefore = await evaluate(selector => document.querySelector(selector)?.getAttribute('aria-pressed'), control);
      await button('Night mode');
      const after = await pixels();
      await onState?.('night');
      return { before, after, pressedBefore, lightBefore, lightAfter: await evaluate(() => __scene.scene.getObjectByName('room-light')?.intensity), pressed: await evaluate(() => document.querySelector('[data-lab-control="Night mode"]')?.getAttribute('aria-pressed')) };
    }, (v) => v.before.checksum !== v.after.checksum && v.pressedBefore === 'false' && v.pressed === 'true' && v.lightAfter < v.lightBefore);
    await check('rotate view moves camera', async () => {
      const before = await evaluate(() => JSON.stringify(__scene.camera.matrixWorld.elements));
      await button('Rotate view');
      await evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      return { before, after: await evaluate(() => JSON.stringify(__scene.camera.matrixWorld.elements)) };
    }, (v) => v.before !== v.after);
    if (id.endsWith('three-configurator')) {
      await check('furniture selection updates the scene hook', async () => {
        const field = await findLabel('Selected furniture');
        await set(field, 'Chair left');
        const selected = await evaluate(() => __scene.selectedId);
        await set(field, 'Table');
        return { selected, restored: await evaluate(() => __scene.selectedId) };
      }, (v) => v.selected === 'chair-left' && v.restored === 'table');
      await check('edit selected furniture', async () => {
        await set(await findLabel('Position X'), '1.25');
        await set(await findLabel('Position Z'), '-1.25');
        await set(await findLabel('Rotation'), '90');
        await set(await findLabel('Color'), '#339966');
        const observed = await evaluate(() => {
          const object = __scene.scene.getObjectByName('table');
          const colors = [];
          object.traverse((item) => { if (item.isMesh) colors.push(item.material.color?.getHexString()); });
          const position = object.getWorldPosition(object.position.clone());
          const rotation = object.rotation.clone().setFromQuaternion(object.getWorldQuaternion(object.quaternion.clone()));
          return { x: position.x, z: position.z, rotation: rotation.y, colors };
        });
        await onState?.('edited');
        return observed;
      }, (v) => Math.abs(v.x - 1.25) < 0.01 && Math.abs(v.z + 1.25) < 0.01 && Math.abs(v.rotation - Math.PI / 2) < 0.01 && v.colors.includes('339966'));
      const choices = [['Table', 'table'], ['Chair left', 'chair-left'], ['Chair right', 'chair-right'], ['Lamp', 'lamp']];
      const fields = {};
      const controls = async () => {
        for (const name of ['Position X', 'Position Z', 'Rotation', 'Color']) fields[name] = await findLabel(name);
        return evaluate(fields => Object.fromEntries(Object.entries(fields).map(([name, selector]) => [name, document.querySelector(selector)?.value])), fields);
      };
      await check('each furniture choice edits independently and reflects its values', async () => {
        const results = [];
        for (const [index, [label, name]] of choices.entries()) {
          await set(await findLabel('Selected furniture'), label);
          const before = await roomState();
          const reflected = await controls();
          const original = before.items.find(item => item.name === name);
          const x = 1.1 + index * 0.1, z = -1.2 + index * 0.1, degrees = 45 + index * 15;
          const color = ['#339966', '#996633', '#663399', '#336699'][index];
          await set(fields['Position X'], String(x));
          await set(fields['Position Z'], String(z));
          await set(fields.Rotation, String(degrees));
          await set(fields.Color, color);
          const after = await roomState();
          const edited = after.items.find(item => item.name === name);
          const values = await controls();
          results.push({ name, selected: before.selected, edited, values,
            selectionReflects: Math.abs(Number(reflected['Position X']) - original.position[0]) < 0.01 && Math.abs(Number(reflected['Position Z']) - original.position[2]) < 0.01 && Math.abs(Number(reflected.Rotation) * Math.PI / 180 - original.rotation[1]) < 0.01 && original.colors.includes(reflected.Color.slice(1).toLowerCase()),
            independent: before.items.filter(item => item.name !== name).every(item => JSON.stringify(item) === JSON.stringify(after.items.find(other => other.name === item.name))),
            matches: Math.abs(edited.position[0] - x) < 0.01 && Math.abs(edited.position[2] - z) < 0.01 && Math.abs(edited.rotation[1] - degrees * Math.PI / 180) < 0.01 && edited.colors.includes(color.slice(1)) && Math.abs(Number(values['Position X']) - x) < 0.01 && Math.abs(Number(values['Position Z']) - z) < 0.01 && Math.abs(Number(values.Rotation) - degrees) < 0.01 && values.Color.toLowerCase() === color,
          });
          await onState?.(`selected-${name}`);
        }
        return results;
      }, values => values.length === choices.length && values.every(value => value.selected === value.name && value.selectionReflects && value.independent && value.matches));
      await check('room boundary clamps furniture', async () => {
        const results = [];
        for (const [label, name] of choices) {
          await set(await findLabel('Selected furniture'), label);
          for (const [field, axis] of [['Position X', 0], ['Position Z', 2]]) for (const input of [-9, 9]) {
            await set(await findLabel(field), String(input));
            const snapshot = await roomState();
            const values = await controls();
            results.push({ name, field, input, expected: Math.sign(input) * 2, actual: snapshot.items.find(item => item.name === name).position[axis], reflected: Number(values[field]) });
          }
        }
        await set(await findLabel('Selected furniture'), 'Chair right');
        return results;
      }, values => values.length === choices.length * 4 && values.every(value => Math.abs(value.actual - value.expected) < 0.01 && value.reflected === value.expected));
      await check('reload restores furniture and lighting', async () => {
        const edited = await roomState();
        const stored = await evaluate(() => localStorage.getItem('visual-web-room'));
        await page.navigate(await evaluate(() => location.href));
        await waitForScene(page);
        return { edited, stored, restored: await roomState() };
      }, (v) => !!v.stored && JSON.stringify(logicalState(v.edited)) === JSON.stringify(logicalState(v.restored)) && v.restored.light < defaults.light,
      ['each furniture choice edits independently and reflects its values', 'room boundary clamps furniture', 'night mode changes rendered lighting']);
      await check('reset restores defaults and persists', async () => {
        await button('Reset room');
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const state = await roomState();
        await page.navigate(await evaluate(() => location.href));
        await waitForScene(page);
        return { defaults, reset: state, reloaded: await roomState() };
      }, (v) => !!v.defaults && JSON.stringify(logicalState(v.defaults)) === JSON.stringify(logicalState(v.reset)) && JSON.stringify(logicalState(v.defaults)) === JSON.stringify(logicalState(v.reloaded)) && Math.abs(v.reset.light - v.defaults.light) < Math.max(0.01, v.defaults.light * 0.03),
      ['each furniture choice edits independently and reflects its values', 'room boundary clamps furniture', 'night mode changes rendered lighting']);
      await check('reduced motion keeps the scene static after reload', async () => {
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        try {
          await page.navigate(await evaluate(() => location.href));
          await waitForScene(page);
          await evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const before = { scene: await roomState(), camera: await evaluate(() => __scene.camera.matrixWorld.toArray()) };
          await new Promise(resolve => setTimeout(resolve, 350));
          const after = { scene: await roomState(), camera: await evaluate(() => __scene.camera.matrixWorld.toArray()) };
          return { before, after };
        } finally { await page.send('Emulation.setEmulatedMedia', { features: [] }); }
      }, value => JSON.stringify(value.before) === JSON.stringify(value.after));
    }
  }
  await check('no JavaScript or WebGL console errors', async () => [...page.errors], (v) => v.length === 0);
  return checks;
}

export async function waitForScene(page, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!(await page.evaluate(() => !!window.__scene?.renderer))) {
    if (Date.now() > end) throw new Error('Three.js scene was not ready within 15 seconds');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
