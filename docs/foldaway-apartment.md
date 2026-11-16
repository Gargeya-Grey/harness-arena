# Foldaway Apartment

One apartment becomes a studio, a dining room and a bedroom. A drop-leaf table opens, two chairs follow separate tracks, the table parks, a slatted screen slides and a wall-bed lowers into the cleared space. The reference opens in a static, usable scene. Visitors can choose a mode, play or pause, scrub the mechanism or reset it during movement.

The playable reference is in `examples/foldaway-apartment/index.html`. Serve that directory with a local static HTTP server; ES modules do not reliably load from a `file:` URL. The page uses plain HTML, CSS and JavaScript with no build or dependencies. It loads the pinned Three.js 0.180.0 ES module from jsDelivr. A failed module request or unavailable WebGL is displayed as a load error. This example is an authored reference, never evidence of a model's performance.

## A harder task family

`datasets/foldaway-apartment/` contains three variants. They reuse the frozen `visual-web@1` prompt and are separate from the original five visual cases and the canonical 80-task ladder.

| Case | What gets harder | Estimated expert time |
| --- | --- | --- |
| `foldaway-apartment-guided` | Three recognizable arrangements, actual 3D geometry, spatial clearances, phone framing and accessible mode controls. | Extra-hard, 90 minutes. |
| `foldaway-apartment-scrubbable` | One continuous deterministic trajectory, exact manual scrubbing, forward playback, pause and safe intermediate geometry. | Supreme, 180 minutes. |
| `foldaway-apartment-reversible` | In-flight retargeting and reversal, pause/resume, reset cancellation and preservation of the actual pose under rapid control changes. | Supreme, 300 minutes. |

The live pilot used frozen suite 1.0.0. Frozen 1.1.0 clarifies the already permitted paused target-selection and scrub-target choices. Current 1.2.0 records browser observation version 2 and makes the guided bounding-box rule explicit. The revised wording has not been rerun through the models. These are untimed estimates, without calibrated human baselines or predictions of model pass rates. The variants hold the domain constant so that increased temporal and spatial requirements are easier to interpret. Each prompt leaves visual composition, materials and the mechanism's exact dimensions to the model. All machine-inspected names, controls and behaviors appear in the prompt. Starter workspaces contain only a README; they expose no reference solution.

The current `workspace-tests@3` evaluator has dimension `format`. It checks only that a nonempty `index.html` was delivered. It cannot establish working HTML, WebGL, choreography or visual quality. Browser observations and screenshot reviews remain separate evidence. Historical version 2 scores retain their original meaning.

## Interaction and geometry contract

The public hook is `window.__apartment = { scene, camera, renderer, state }`. It contains the actual Three.js objects and a live state object with `progress`, `target` and `playing`. Studio is progress 0, Dining is 0.5 and Bedroom is 1. Mode buttons expose `aria-pressed` only when their pose is reached. Initial playback is stopped. Reset restores the initial pose and cancels pending playback.

The advanced prompts say that mode choices update the target. They permit a paused destination selector followed by Play, as well as immediate playback. The inspector starts Play when a selected target remains paused; it does not mistake selecting a destination for failed movement. Pause is checked during an explicit journey from Studio toward Dining, so it does not assume that scrubbing must replace the selected target.

The room is 6 × 5 meters. Its floor spans x = -3…3 and z = -2.5…2.5 at y = 0. The scene groups `bed`, `table`, `chair-left`, `chair-right` and `partition` contain visible meshes at every stage. Their visible geometry remains inside those floor bounds and above it. The bed clears the table and both chairs; the chairs clear each other. Each prompt explicitly requires their visible world-axis bounding boxes to stay separate. This conservative rule excludes nesting between those pairs even when physical meshes could clear. Contacts within a single assembly's hinges and components are allowed. The camera shows all five groups at both required viewport sizes. These are stylized benchmark constraints, not a claim of engineered furniture safety. The browser samples 41 progress values in each of two viewport sizes; that is sampled evidence, not a proof for every continuous instant.

The two advanced variants add a range named Transformation, with min 0, max 100, step 1, mapped to progress divided by 100. Scrubbing immediately pauses. The same progress gives the same geometry. Play moves toward the current target, or chooses the next mode when the target is already reached; Pause freezes the pose. Playback takes 4 to 12 seconds for the full forward journey. Reduced motion makes mode selection and optional Play immediate, with no automatic interpolation; the slider still inspects intermediate poses. A preference change while playback is active stops playback at its actual pose in the reference.

In the reference, `timeline.mjs` owns the state transitions and pure `poseAt(progress)` mapping. `scene.mjs` constructs and applies actual geometry. `app.mjs` connects native controls and schedules frames only while playing. A mode change changes the target without changing progress, so reversing follows the same geometric path. Manual seeking and reset cancel the active frame. Rendering is event-driven while paused; there is no continuous idle animation loop.

The reference stages the journey as follows. The second chair reaches the table and the leaves open by progress 0.35. After Dining, both chairs park by 0.65 and the leaves fold by 0.67. The table slides and the screen moves from 0.68 to 0.80. The bed lowers from 0.82 to 0.98. Reversal traverses those same stages backwards. Different implementations may choose other stages if they meet the observable contract.

## Design decisions to review

Two approaches were considered. Independent tweens per mode make a three-state demo easy, but interrupted or reversed movement can begin from inconsistent poses. One normalized timeline keeps the actual pose reproducible and gives the verifier a clear sampling surface. The latter was chosen.

Bartlett's Law 18 shaped the first screen: the actual apartment and the three mode actions are available immediately. Law 10 shaped the memorable event: an identifiable wall becomes a bed as the other pieces make room. Law 17 shaped the controls: visitors can manipulate the mechanism without a tutorial gate. These are design hypotheses. The first useful audience test is whether someone can identify the transformation and operate it after seeing the first screen. No retention or attention result is claimed, and oddness is useful only when it fits the room's logic.

For visual review, inspect the Studio, Dining, intermediate bed sweep and Bedroom on desktop and phone. Check recognizable furniture and arrangements, geometry continuity, framing, materials, lighting, readable states and a transformation that remains understandable in reverse. A nonblank framebuffer, state hook or file-delivery pass is insufficient.

## Run and verify

```powershell
node --test tests/foldaway-apartment.test.mjs tests/foldaway-browser.test.mjs
node lab validate
node lab run experiments/foldaway-apartment-reversible-repaired-explicit-effort.yaml --dry-run
node tools/foldaway-apartment/verify-reference.mjs --variant guided --out .cache/verify/<new-guided-directory>
node tools/foldaway-apartment/verify-reference.mjs --out .cache/verify/<new-reversible-directory>
```

Each repaired explicit-effort apartment preset selects one variant and one repeat per requested configuration, with high effort and no generation deadline. It makes at most three calls when all harnesses are selected. Use `--harness opencode` or `--harness claude-code` for a smaller comparison. Codex setup and sandbox requirements follow `docs/visual-testing.md` and the adapter's preflight checks; do not silently substitute a loaded setup for an isolated setup. Historical loaded/pilot experiments remain distinct configurations. No model call is needed to prove the authored reference or the browser inspector.

Browser observation version 2 keeps blocked or incomplete assertions outside the judged denominator. Guided movement is sampled between destinations. Reversible retargeting checks the actual mesh pose atomically before and after changing the target. The 15 second automatic-completion guard can produce a judged failure because all public briefs require completion within 12 seconds. It is separate from model-generation timeouts. Sampled clearance and pose checks do not prove continuous collision freedom.

After any case is run, freeze the current suite before changing its records. Preserve raw runs and captured artifacts. Record actual browser checks and visual judgments alongside source/checker hashes and run IDs. One repeat cannot establish reliability, model rankings or a calibrated difficulty label.

## Pilot evidence

The single reversible-case pilot completed Beam and Terra attempts; Haiku reached the 600-second timeout. Against the reviewed browser contract, Beam passed 9 of 14 assertions and Terra passed 14 of 14. The recovered Terra fifth configurator also passed 14 of 14 on its unchanged visual-web 1.0.0 inputs. These describe configurations and one attempt, not a general model ranking. Design review is separate: the Terra apartment is coherent and functional, while its bed reads as a bare platform in the captured Bedroom state. The authored reference has stronger furniture detail.

The first derived apartment observation was retained. A second report corrects an inspector assumption that all mode choices must autoplay and that scrub changes the playback target. Both choices were allowed by the original prompt. No new model calls or raw-result edits were used for the correction.

The final observation also fixes state reading for a valid non-enumerable progress getter. It reads the public numeric fields explicitly rather than spreading state. Beam's final remaining defects are an ineffective Pause action and folded-bed bounds outside the floor; selection plus Play and reversal work. Earlier derived reports remain retained with their checker hashes. A real-browser regression covers getter-backed state, aria-labelledby controls, a paused target selector, thin panels, translucent surfaces and hidden descendants.

For new calls, use `foldaway-apartment-guided-repaired-explicit-effort.yaml`, `foldaway-apartment-scrubbable-repaired-explicit-effort.yaml` or `foldaway-apartment-reversible-repaired-explicit-effort.yaml`. Earlier pilot observations above describe their recorded checker and suite versions. They are not results on the repaired versions.
