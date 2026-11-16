import { MODES, createState, seek, retarget, togglePlayback, advance, describe, poseAt } from './timeline.mjs';

const $ = (id) => document.getElementById(id);
const state = createState();
const preference = matchMedia('(prefers-reduced-motion: reduce)');
let apartment;
let lastFrame;
let frame = 0;
let announcement = '';

function render() {
  apartment.apply(state.progress);
  const story = describe(state.progress);
  const pose = poseAt(state.progress);
  $('transformation').value = String(Math.round(state.progress * 100));
  $('transformation').setAttribute('aria-valuetext', `${Math.round(state.progress * 100)} percent, ${story.stage}`);
  $('progress-value').textContent = `${String(Math.round(state.progress * 100)).padStart(2, '0')}%`;
  $('play-label').textContent = state.playing ? 'Pause' : 'Play';
  $('play-icon').textContent = state.playing ? 'Ⅱ' : '▶';
  $('mode-label').textContent = story.mode.toUpperCase();
  $('story-title').textContent = story.title;
  $('story-copy').textContent = story.detail;
  $('stage-label').textContent = story.stage;
  $('scene-caption').textContent = `${story.stage}. ${state.progress < 0.82 ? 'The bed is folded against the back wall.' : 'The table and chairs are clear of the bed.'}`;
  $('chapter-number').textContent = state.progress < 0.35 ? '01' : state.progress < 0.82 ? '02' : '03';
  $('table-status').textContent = pose.table.x > 1.8 ? 'Parked' : pose.table.leafAngle < 0.05 ? 'Open' : pose.table.leafAngle > 1.5 ? 'Folded' : 'In motion';
  $('chairs-status').textContent = state.progress > 0.65 ? 'Parked' : state.progress > 0.28 ? 'At table' : 'At desk';
  $('bed-status').textContent = state.progress >= 0.98 ? 'Lowered' : state.progress <= 0.82 ? 'Stowed' : 'In motion';
  $('table-dot').classList.toggle('active', state.progress > 0.02 && state.progress < 0.82);
  $('chairs-dot').classList.toggle('active', state.progress > 0.53 && state.progress < 0.65);
  $('bed-dot').classList.toggle('active', state.progress > 0.82);
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-pressed', String(Math.abs(MODES[button.dataset.mode] - state.progress) < 1e-9));
  if (!state.playing && story.stage !== announcement) {
    announcement = story.stage;
    $('announcement').textContent = story.stage;
  }
}

function animate(now) {
  frame = 0;
  advance(state, lastFrame === undefined ? 0 : (now - lastFrame) / 1000);
  lastFrame = now;
  render();
  if (state.playing) frame = requestAnimationFrame(animate);
  else lastFrame = undefined;
}

function update() {
  if (!state.playing && frame) { cancelAnimationFrame(frame); frame = 0; lastFrame = undefined; }
  render();
  if (state.playing && !frame) { lastFrame = undefined; frame = requestAnimationFrame(animate); }
}

try {
  const { makeApartment } = await import('./scene.mjs');
  apartment = makeApartment($('scene'));
  window.__apartment = { scene: apartment.scene, camera: apartment.camera, renderer: apartment.renderer, state };
  $('load-message').remove();
  for (const button of document.querySelectorAll('[data-mode]')) {
    button.setAttribute('aria-label', button.dataset.mode);
    button.addEventListener('click', () => { retarget(state, MODES[button.dataset.mode], preference.matches); update(); });
  }
  $('transformation').addEventListener('input', (event) => { seek(state, Number(event.target.value) / 100); update(); });
  $('play').addEventListener('click', () => { togglePlayback(state, preference.matches); update(); });
  $('reset').addEventListener('click', () => { seek(state, 0); update(); });
  $('view').addEventListener('click', () => { $('view').textContent = apartment.toggleView() ? 'View in perspective' : 'View from above'; });
  const changed = () => {
    $('motion-note').hidden = !preference.matches;
    if (preference.matches && state.playing) seek(state, state.progress);
    update();
  };
  preference.addEventListener('change', changed);
  changed();
} catch (error) {
  console.error(error);
  $('load-message').textContent = 'The 3D apartment could not open. Check that WebGL is available and the Three.js module can load, then reload the page.';
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  $('transformation').disabled = true;
}
