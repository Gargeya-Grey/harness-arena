export const MODES = Object.freeze({ Studio: 0, Dining: 0.5, Bedroom: 1 });
export const FURNITURE = Object.freeze(['bed', 'table', 'chair-left', 'chair-right', 'partition']);

export function clampProgress(value) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function stage(value, start, end) {
  const t = clampProgress((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

export function poseAt(value) {
  const p = clampProgress(value);
  const clearChairs = stage(p, 0.53, 0.65);
  const unfoldLeaves = stage(p, 0.08, 0.35) * (1 - stage(p, 0.53, 0.67));
  return {
    bed: { x: -1.15, y: 0.42, z: -2.08, rotationX: -(1 - stage(p, 0.82, 0.98)) * Math.PI / 2 },
    table: { x: -0.65 + 2.55 * stage(p, 0.68, 0.80), y: 0, z: 0, leafAngle: (1 - unfoldLeaves) * Math.PI / 2 },
    'chair-left': { x: -0.65 + 2.87 * clearChairs, y: 0, z: 1.35, rotationY: 0 },
    'chair-right': { x: 2.22 - 2.87 * stage(p, 0.02, 0.28) + 2.87 * clearChairs, y: 0, z: -1.25, rotationY: Math.PI },
    partition: { x: 0.15 + 0.65 * stage(p, 0.68, 0.80), y: 0, z: -2.05 },
  };
}

export function createState() {
  return { progress: 0, target: 0, playing: false };
}

export function seek(state, value) {
  state.progress = clampProgress(value);
  state.target = state.progress;
  state.playing = false;
}

export function retarget(state, value, reducedMotion = false) {
  state.target = clampProgress(value);
  if (reducedMotion) seek(state, state.target);
  else state.playing = Math.abs(state.target - state.progress) > 1e-9;
}

export function togglePlayback(state, reducedMotion = false) {
  if (state.playing) { state.playing = false; return; }
  if (Math.abs(state.target - state.progress) < 1e-9) {
    state.target = state.progress < 0.5 ? 0.5 : state.progress < 1 ? 1 : 0;
  }
  retarget(state, state.target, reducedMotion);
}

export function advance(state, seconds) {
  if (!state.playing || !Number.isFinite(seconds) || seconds <= 0) return;
  const distance = state.target - state.progress;
  const step = seconds / 12;
  if (Math.abs(distance) <= step + 1e-9) {
    state.progress = state.target;
    state.playing = false;
  } else state.progress += Math.sign(distance) * step;
}

export function describe(value) {
  const p = clampProgress(value);
  if (p < 0.02) return { mode: 'Studio', title: 'Make room for ideas.', detail: 'A compact desk, a quiet window and the whole afternoon ahead.', stage: 'Studio ready' };
  if (p < 0.35) return { mode: 'In motion', title: 'A little more room at the table.', detail: 'The second chair and table leaves share one coordinated movement.', stage: 'Dining table and chair track' };
  if (p <= 0.53) return { mode: 'Dining', title: 'Stay for one more conversation.', detail: 'Two places at the table. Nothing added to the floor plan.', stage: 'Dining ready' };
  if (p < 0.68) return { mode: 'In motion', title: 'Every piece has a place.', detail: 'The chairs travel between the table and their alcoves as the leaves fold or open.', stage: 'Chair tracks and table leaves' };
  if (p < 0.82) return { mode: 'In motion', title: 'The room takes a breath.', detail: 'The table and screen travel together. The bed stays upright.', stage: 'Table parking and sliding screen' };
  if (p < 0.98) return { mode: 'In motion', title: 'A room that folds around your day.', detail: 'The bed pivots only while the table and chairs are parked clear.', stage: 'Wall-bed hinge' };
  return { mode: 'Bedroom', title: 'Same room. A softer ending.', detail: 'A real bed, a reading corner and a slower kind of evening.', stage: 'Bedroom ready' };
}
