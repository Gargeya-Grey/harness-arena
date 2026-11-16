import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
import { poseAt } from './timeline.mjs';

export function makeApartment(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8ede4');
  const camera = new THREE.OrthographicCamera(-5, 5, 3.6, -3.6, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.24;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.append(renderer.domElement);

  const material = (color, roughness = 0.8, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const m = {
    plaster: material('#dedccf'), lightPlaster: material('#ede9df'), edge: material('#c5c5b6'),
    oak: material('#af8254'), oakLight: material('#c29765'), oakDark: material('#846442'),
    green: material('#778a6f'), deepGreen: material('#425f4b'), fabric: material('#aaa98b'),
    coral: material('#b95440'), terracotta: material('#d58868'), linen: material('#e5d8bd'),
    brass: material('#ab8a50', 0.4, 0.55), charcoal: material('#34463b'), leaves: material('#577349'),
    paper: material('#efdfb9'), rug: material('#c6b89a'), sky: material('#b7cfcc'),
  };
  function box(parent, width, height, depth, x, y, z, mat, name) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    parent.add(mesh);
    return mesh;
  }
  function cylinder(parent, top, bottom, height, x, y, z, mat, radial = 24) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, radial), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function group(name, parent = scene) {
    const result = new THREE.Group();
    result.name = name;
    parent.add(result);
    return result;
  }
  function cushion(parent, width, height, depth, x, y, z, mat) {
    const radius = Math.min(0.065, height / 2.5);
    const shape = new THREE.Shape();
    const left = -width / 2, right = width / 2, back = -depth / 2, front = depth / 2;
    shape.moveTo(left + radius, back);
    shape.lineTo(right - radius, back);
    shape.quadraticCurveTo(right, back, right, back + radius);
    shape.lineTo(right, front - radius);
    shape.quadraticCurveTo(right, front, right - radius, front);
    shape.lineTo(left + radius, front);
    shape.quadraticCurveTo(left, front, left, front - radius);
    shape.lineTo(left, back + radius);
    shape.quadraticCurveTo(left, back, left + radius, back);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height - 2 * radius, bevelEnabled: true, bevelSize: radius, bevelThickness: radius, bevelSegments: 3, steps: 1, curveSegments: 6 });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, -height / 2 + radius, 0);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const floor = box(scene, 6, 0.18, 5, 0, -0.10, 0, m.edge, 'floor');
  floor.receiveShadow = true;
  for (let i = 0; i < 19; i++) {
    const shade = material(new THREE.Color('#bb956b').offsetHSL(0, 0, ((i * 13) % 7 - 3) * 0.007));
    box(scene, 5.96, 0.025, 4.96 / 19 - 0.012, 0, 0.003, -2.48 + (i + 0.5) * 4.96 / 19, shade);
  }
  box(scene, 6.13, 2.88, 0.12, 0, 1.42, -2.53, m.plaster, 'wall-back');
  box(scene, 0.12, 2.88, 2.15, -3.05, 1.42, -1.48, m.lightPlaster, 'wall-left');
  box(scene, 0.12, 0.18, 2.9, -3.05, 0.06, 1.04, m.edge);
  box(scene, 6, 0.085, 0.045, 0, 0.07, -2.43, m.lightPlaster);

  const windowFrame = group('window');
  box(windowFrame, 0.035, 1.65, 1.35, -2.978, 1.64, -1.31, m.sky);
  for (const z of [-2.025, -1.31, -0.595]) box(windowFrame, 0.075, 1.78, 0.055, -2.925, 1.64, z, m.lightPlaster);
  for (const y of [0.77, 1.64, 2.51]) box(windowFrame, 0.075, 0.055, 1.5, -2.925, y, -1.31, m.lightPlaster);
  box(windowFrame, 0.25, 0.07, 1.58, -2.88, 0.735, -1.31, m.oakLight);

  const bedCabinet = group('bed-cabinet');
  box(bedCabinet, 0.105, 2.75, 0.37, -2.12, 1.375, -2.24, m.oak);
  box(bedCabinet, 0.105, 2.75, 0.37, -0.18, 1.375, -2.24, m.oak);
  box(bedCabinet, 2.05, 0.11, 0.37, -1.15, 2.72, -2.24, m.oak);
  box(bedCabinet, 1.82, 2.56, 0.035, -1.15, 1.38, -2.43, m.deepGreen);

  const bed = group('bed');
  box(bed, 1.72, 0.13, 2.18, 0, -0.04, 1.09, m.oakDark, 'bed-frame');
  cushion(bed, 1.62, 0.21, 2.08, 0, 0.12, 1.08, m.linen);
  cushion(bed, 1.64, 0.095, 1.39, 0, 0.265, 1.45, m.coral);
  for (let i = 0; i < 10; i++) box(bed, 0.014, 0.004, 1.31, -0.71 + i * 0.155, 0.316, 1.45, m.terracotta);
  cushion(bed, 0.62, 0.17, 0.39, -0.4, 0.28, 0.32, m.paper);
  cushion(bed, 0.62, 0.17, 0.39, 0.4, 0.28, 0.32, m.paper);
  for (const x of [-0.70, 0.70]) box(bed, 0.07, 0.32, 0.07, x, -0.26, 2.01, m.brass);

  const table = group('table');
  box(table, 1.55, 0.09, 0.62, 0, 0.77, 0, m.oakLight, 'table-top');
  for (const x of [-0.61, 0.61]) for (const z of [-0.21, 0.21]) box(table, 0.06, 0.72, 0.06, x, 0.36, z, m.oakDark);
  box(table, 1.3, 0.10, 0.035, 0, 0.61, 0, m.oakDark);
  const frontLeaf = group('table-leaf-front', table);
  frontLeaf.position.set(0, 0.77, 0.31);
  box(frontLeaf, 1.55, 0.055, 0.44, 0, 0, 0.22, m.oakLight);
  const backLeaf = group('table-leaf-back', table);
  backLeaf.position.set(0, 0.77, -0.31);
  box(backLeaf, 1.55, 0.055, 0.44, 0, 0, -0.22, m.oakLight);
  for (const z of [-0.28, 0.28]) cylinder(table, 0.055, 0.055, 0.10, 0.5, 0.865, z * 0.25, m.paper);
  box(table, 0.36, 0.025, 0.23, -0.39, 0.83, 0.03, m.deepGreen);
  box(table, 0.30, 0.02, 0.22, -0.37, 0.85, 0.03, m.paper);

  function chair(name) {
    const item = group(name);
    cushion(item, 0.46, 0.07, 0.43, 0, 0.47, 0, m.fabric);
    for (const x of [-0.18, 0.18]) for (const z of [-0.17, 0.17]) box(item, 0.045, 0.44, 0.045, x, 0.22, z, m.oakDark);
    for (const x of [-0.18, 0.18]) box(item, 0.04, 0.41, 0.04, x, 0.70, 0.18, m.oakDark);
    cushion(item, 0.47, 0.26, 0.075, 0, 0.82, 0.19, m.green);
    return item;
  }
  const chairLeft = chair('chair-left');
  const chairRight = chair('chair-right');

  const partition = group('partition');
  for (let i = 0; i < 6; i++) box(partition, 0.047, 2.23, 0.085, -0.22 + i * 0.088, 1.16, 0, m.oak);
  box(partition, 0.52, 0.06, 0.14, 0, 0.075, 0, m.oakDark);
  box(partition, 0.52, 0.06, 0.14, 0, 2.28, 0, m.oakDark);
  box(scene, 1.45, 0.045, 0.06, 0.49, 2.40, -2.05, m.brass);

  const sofa = group('sofa');
  sofa.position.set(-2.58, 0, 1.25);
  box(sofa, 0.62, 0.18, 1.74, 0, 0.22, 0, m.oakDark);
  cushion(sofa, 0.57, 0.20, 0.78, 0.02, 0.41, -0.42, m.fabric);
  cushion(sofa, 0.57, 0.20, 0.78, 0.02, 0.41, 0.42, m.fabric);
  cushion(sofa, 0.13, 0.45, 1.73, -0.27, 0.65, 0, m.green);
  for (const z of [-0.84, 0.84]) cushion(sofa, 0.63, 0.26, 0.14, 0.01, 0.52, z, m.green);
  cushion(sofa, 0.13, 0.30, 0.30, -0.1, 0.68, 0.57, m.coral).rotation.x = -0.25;

  const cabinets = group('cabinet');
  box(cabinets, 1.85, 0.86, 0.54, 1.98, 0.43, -2.15, m.green);
  box(cabinets, 1.91, 0.065, 0.58, 1.98, 0.89, -2.15, m.oakLight);
  for (const x of [1.38, 1.99, 2.60]) {
    box(cabinets, 0.55, 0.69, 0.025, x, 0.47, -1.864, m.deepGreen);
    box(cabinets, 0.17, 0.018, 0.025, x, 0.71, -1.839, m.brass);
  }
  for (const y of [1.47, 2.06]) box(cabinets, 1.78, 0.055, 0.34, 2.00, y, -2.24, m.oak);
  for (let i = 0; i < 7; i++) box(cabinets, 0.07 + (i % 2) * 0.02, 0.26 + (i % 3) * 0.04, 0.18, 1.32 + i * 0.09, 1.63, -2.21, [m.paper, m.coral, m.deepGreen][i % 3]);
  cylinder(cabinets, 0.11, 0.08, 0.23, 2.42, 1.62, -2.21, m.terracotta);
  cylinder(cabinets, 0.08, 0.10, 0.14, 2.65, 2.16, -2.22, m.paper);

  const art = group('wall-art');
  box(art, 0.75, 0.84, 0.04, 0.62, 1.75, -2.44, m.oakDark);
  box(art, 0.66, 0.75, 0.02, 0.62, 1.75, -2.41, m.paper);
  const artCircle = new THREE.Mesh(new THREE.CircleGeometry(0.20, 32), m.coral);
  artCircle.position.set(0.65, 1.84, -2.39);
  art.add(artCircle);
  box(art, 0.50, 0.075, 0.015, 0.59, 1.52, -2.38, m.deepGreen);

  const plant = group('plant');
  plant.position.set(2.57, 0, 1.95);
  cylinder(plant, 0.22, 0.17, 0.38, 0, 0.19, 0, m.terracotta);
  cylinder(plant, 0.17, 0.17, 0.015, 0, 0.39, 0, m.oakDark);
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI * 0.77;
    const height = 0.80 + (i % 3) * 0.16;
    const stem = cylinder(plant, 0.012, 0.012, height - 0.37, Math.cos(angle) * 0.055, (height + 0.37) / 2, Math.sin(angle) * 0.055, m.deepGreen, 6);
    stem.rotation.z = 0.08 * Math.cos(angle);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), m.leaves);
    leaf.scale.set(0.17, 0.035, 0.31);
    leaf.rotation.set(0.25, angle, 0.40);
    leaf.position.set(Math.cos(angle) * 0.14, height, Math.sin(angle) * 0.14);
    leaf.castShadow = true;
    plant.add(leaf);
  }
  const lamp = group('floor-lamp');
  lamp.position.set(-2.47, 0, 0.03);
  cylinder(lamp, 0.16, 0.17, 0.04, 0, 0.025, 0, m.brass);
  cylinder(lamp, 0.018, 0.018, 1.40, 0, 0.72, 0, m.brass, 12);
  cylinder(lamp, 0.20, 0.30, 0.32, 0, 1.48, 0, m.paper);

  const light = new THREE.DirectionalLight('#fff1ce', 3.3);
  light.name = 'room-light';
  light.position.set(-3.5, 8, 5);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -6; light.shadow.camera.right = 6;
  light.shadow.camera.top = 6; light.shadow.camera.bottom = -6;
  light.shadow.normalBias = 0.035;
  light.shadow.bias = -0.00015;
  scene.add(light, new THREE.HemisphereLight('#fff5dc', '#6e8262', 2.0));
  const fill = new THREE.DirectionalLight('#d5e4df', 1.0);
  fill.position.set(6, 4, -2);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), material('#e8ede4'));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.21;
  ground.receiveShadow = true;
  scene.add(ground);

  const objects = { bed, table, 'chair-left': chairLeft, 'chair-right': chairRight, partition };
  function apply(progress) {
    const pose = poseAt(progress);
    for (const [name, object] of Object.entries(objects)) {
      const transform = pose[name];
      object.position.set(transform.x, transform.y, transform.z);
      object.rotation.set(transform.rotationX || 0, transform.rotationY || 0, 0);
    }
    frontLeaf.rotation.x = pose.table.leafAngle;
    backLeaf.rotation.x = -pose.table.leafAngle;
    scene.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }
  let overhead = false;
  function fit() {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max(6.7, 7.9 / aspect);
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.position.set(...(overhead ? [6.5, 12, 8] : [8, 7.5, 10]));
    camera.lookAt(0, 1.0, -0.08);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }
  const observer = new ResizeObserver(fit);
  observer.observe(container);
  fit();
  apply(0);
  return { scene, camera, renderer, apply, toggleView() { overhead = !overhead; fit(); return overhead; }, dispose() { observer.disconnect(); renderer.dispose(); } };
}
