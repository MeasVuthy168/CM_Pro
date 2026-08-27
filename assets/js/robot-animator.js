/* =========================================================
   CM_Pro ROBOT ANIMATOR
   =========================================================
   Drives all motion for the robot rig defined in
   assets/images/robot.svg — that file has no animation of its own
   (no <style>/@keyframes) specifically so this can be triggered
   programmatically from app code, which a plain <img>-embedded SVG
   can never support (script in the parent page cannot reach into an
   <img>'s SVG document at all). assets/js/robot-embed.js fetches the
   SVG and injects it inline for exactly this reason, then hands the
   injected root element to `new CMProRobotAnimator(root)`.

   ARCHITECTURE
   Every joint is animated with the Web Animations API
   (Element.animate()) rather than CSS @keyframes, because gestures
   need to be started/interrupted from JS on demand:
     - idle(): a set of small, continuous, infinitely-looping
       animations (body breathing + weight-shift, head wander, a face
       "look" parallax + blink, neck status pulse, both arms' idle
       sway resting hand-on-hip, both hands' idle flex, foot rock) —
       this is what's running whenever nothing else is.
     - welcome() / wave() / think() / success() / attention(): gestures
       triggered from JS. welcome() and wave() are multi-PHASE async
       sequences (see PHASES below) rather than a single flat
       animate() call each, so the motion reads as anticipation → rise
       → hold/wave → return rather than "rotate → stop → rotate".
       think()/success()/attention() stay single-phase (see
       _playGesture) since they don't need the same choreography.
     - startWelcomeLoop(): welcome() by itself only plays ONCE — it
       rises, waves, returns to the hip rest, and hands back to idle(),
       same as any other one-shot gesture. startWelcomeLoop() is what
       makes the greeting repeat: it just calls welcome(), waits a
       short "relaxed at the waist" pause, and calls welcome() again,
       forever, until stopWelcomeLoop() is called. Each cycle is an
       ordinary welcome() call starting from wherever the arm actually
       is (idle's hip rest — welcome() always ends there), so looping
       never resets/teleports anything; it's "greet again", not
       "restart the whole animation". If another gesture interrupts a
       cycle mid-flight, welcome() reports that back and the loop stops
       itself rather than fighting for control — see welcome()'s and
       startWelcomeLoop()'s own comments below.

   PHASES (welcome() and wave())
   Both are built from the same three shared phases, just at
   different speeds/amplitudes:
     1. _riseToWelcome() — a brief ANTICIPATION dip (the shoulder/elbow
        coil slightly deeper into the hip rest before the big move,
        like a small wind-up), then the RISE itself (shoulder+elbow
        ease from hip to the welcome stance), while the wrist/hand
        trail slightly behind and briefly overshoot past their resting
        wave-ready tilt before settling — a FOLLOW-THROUGH, simulating
        inertia in the lighter distal joints. The head turns/tilts
        toward the rising arm and the torso takes a very small
        weight-shift lean the opposite way, both holding through the
        next phase.
     2. _waveCycles2() / _waveCycles1() — the shoulder/elbow hold at
        the welcome stance with only a tiny sway (stable, per the
        brief); the wrist does the actual waving (left → center →
        right → center, repeated), with the hand/fingers doing a
        small synchronized open/close flex. Head and torso stay as
        phase 1 left them.
     3. _lowerToHip() — the REVERSE cascade the brief asks for: the
        wrist/hand snap back to neutral quickly, within the first part
        of this phase's own duration, while the shoulder/elbow take
        the phase's FULL duration to ease back down to the hip rest —
        so the distal joints visibly settle well before the proximal
        ones finish, joint by joint from the hand inward. Head and
        torso un-tilt back to neutral in step with the arm lowering.

   Every phase is cancellable mid-flight: welcome()/wave() bump
   `_gestureGen` and each `await` between phases re-checks it, so a
   newer gesture call (or think()/success()/attention()) always wins
   immediately rather than fighting the old sequence for control.

   CRITICAL: keep the right arm's shoulder and elbow keyframes on
   IDENTICAL offsets within any single phase. An earlier version
   staggered them (elbow bending later than the shoulder, or
   straightening out before the shoulder finished lowering) and —
   confirmed by measuring the actual rendered bounding box across the
   full animation with a headless browser — that transiently recreated
   a near-straight arm at a still-raised shoulder angle, reaching much
   further than either animation's own held values ever specified.
   The wrist/hand are free to run on their own independent offsets
   (that's exactly how the follow-through/reverse-cascade above work)
   because wrist rotation doesn't extend the arm's reach the way a
   desynced shoulder/elbow pair does — but if you touch the shoulder
   or elbow keyframes, re-verify with the same kind of sweep (sample
   getBoundingClientRect() of #cm-pro-robot every ~50-100ms across a
   full playthrough) rather than eyeballing it.

   PERFORMANCE: every animation here only ever touches `transform` and
   `opacity` — both compositor-only properties in every evergreen
   browser, so this stays cheap even on lower-end mobile hardware; no
   layout/paint is triggered per frame. No canvas, no filters, no
   requestAnimationFrame loop — the browser's own compositor drives
   everything between the keyframes we hand it. =========================================================
*/

(function (global) {
  "use strict";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Element ids this animator needs, and the transform-origin (in the
  // SVG's own user-space units, matching robot.svg's viewBox — NOT
  // percentages) each one rotates/scales around. These match each
  // part's actual mechanical joint location in robot.svg exactly; if
  // you move a joint there, update the matching origin here too.
  const ORIGINS = {
    body: "240px 737px",
    shadowEllipse: "240px 737px",
    head: "240px 168px",
    face: "240px 76px",
    visorHalo: "240px 76px",
    neckStatus: "center",
    leftArm: "160px 200px",
    leftElbow: "160px 330px",
    leftWrist: "160px 400px",
    leftHand: "160px 417px",
    leftFoot: "207px 673px",
    rightArm: "320px 200px",
    rightElbow: "320px 330px",
    rightWrist: "320px 400px",
    rightHand: "320px 417px",
    rightFoot: "273px 673px",
  };

  // Maps the camelCase keys above to the element ids in robot.svg.
  const ELEMENT_IDS = {
    body: "body",
    shadowEllipse: "shadow-ellipse",
    head: "head",
    face: "face",
    visorHalo: "visor-halo",
    neckStatus: "neck-status",
    leftArm: "left-arm",
    leftElbow: "left-elbow",
    leftWrist: "left-wrist",
    leftHand: "left-hand",
    leftFoot: "left-foot",
    rightArm: "right-arm",
    rightElbow: "right-elbow",
    rightWrist: "right-wrist",
    rightHand: "right-hand",
    rightFoot: "right-foot",
  };

  const GESTURE_EASE = "cubic-bezier(0.42, 0, 0.2, 1)"; // a controlled, motor-like ease — no bounce/overshoot
  const WAVE_EASE = "ease-in-out"; // gentler, more organic than GESTURE_EASE for the wrist's own oscillation

  // Permanent resting-pose bases for the two arms (not momentary
  // gesture peaks — these are the angles idle() holds at all times).
  // Both arms rest hand-on-hip by default. RIGHT_HIP_BASE is the exact
  // mirror of LEFT_HIP_BASE (robot.svg's right arm is a literal mirror
  // of the left about x=240, so mirroring the pose just negates both
  // angles).
  const LEFT_HIP_BASE = { shoulder: 32, elbow: -92 };
  const RIGHT_HIP_BASE = { shoulder: -32, elbow: 92 };
  // The momentary peak welcome()/wave() raise the right arm to before
  // lowering it back to its hip rest — clipping-verified.
  const RIGHT_WELCOME_BASE = { shoulder: -78, elbow: -50 };
  // A small "coil" deeper into the hip rest than RIGHT_HIP_BASE itself
  // — the anticipation dip right before the arm commits to rising.
  const RIGHT_ANTICIPATION = { shoulder: RIGHT_HIP_BASE.shoulder - 4, elbow: RIGHT_HIP_BASE.elbow + 6 };

  class CMProRobotAnimator {
    /**
     * @param {SVGSVGElement} svgRoot - the injected, inline robot.svg root <svg>.
     */
    constructor(svgRoot) {
      this.svg = svgRoot;
      this.el = {};
      for (const key in ELEMENT_IDS) {
        const found = svgRoot.querySelector("#" + ELEMENT_IDS[key]);
        if (!found) {
          console.warn("[robot-animator] missing element #" + ELEMENT_IDS[key]);
          continue;
        }
        found.style.transformOrigin = ORIGINS[key];
        this.el[key] = found;
      }

      this._idleAnims = Object.create(null); // key -> Animation
      this._gestureAnims = []; // Animation[] currently playing a one-shot gesture
      this._gestureGen = 0; // bumped on every top-level gesture call; async phase chains check it to bail out when superseded

      this.idle(); // start continuously — the robot should never look frozen
    }

    // ============ IDLE ============
    // Restart the continuous idle motion. Pass an array of the keys
    // below to restart only those parts (used by gestures handing
    // control back after they finish); omit it to (re)start all of
    // idle, e.g. on first construction.
    idle(only) {
      const want = (k) => !only || only.indexOf(k) !== -1;
      const loop = (name, keyframes, duration, delay) => {
        if (this._idleAnims[name]) this._idleAnims[name].cancel();
        const el = this.el[name];
        if (!el) return;
        this._idleAnims[name] = el.animate(keyframes, {
          duration,
          delay: delay || 0,
          iterations: Infinity,
          easing: "ease-in-out",
        });
      };

      if (want("body")) {
        // Breathing bob plus a whisper of horizontal weight-shift on
        // the same cycle (not a plain up/down) — reads as a body with
        // a little physical weight to it, not a sprite bobbing in place.
        loop(
          "body",
          [
            { transform: "translate(0px, 0px)" },
            { transform: "translate(0.6px, -2px)", offset: 0.25 },
            { transform: "translate(0px, -4px)", offset: 0.5 },
            { transform: "translate(-0.6px, -2px)", offset: 0.75 },
            { transform: "translate(0px, 0px)" },
          ],
          4000
        );
      }
      if (want("shadowEllipse")) {
        loop(
          "shadowEllipse",
          [
            { transform: "scale(1)", opacity: 0.3 },
            { transform: "scale(0.96)", opacity: 0.24, offset: 0.5 },
            { transform: "scale(1)", opacity: 0.3 },
          ],
          4000
        );
      }
      if (want("head")) {
        loop(
          "head",
          [
            { transform: "rotate(-3deg)" },
            { transform: "rotate(2deg)", offset: 0.3 },
            { transform: "rotate(4deg)", offset: 0.6 },
            { transform: "rotate(-1deg)", offset: 0.8 },
            { transform: "rotate(-3deg)" },
          ],
          5500
        );
      }
      if (want("face")) {
        // A subtle side-to-side "look" (independent of the head's own
        // rotation above) plus the existing brief brightness dip
        // standing in for a blink, since the face is one glass visor
        // rather than a pair of eyes.
        loop(
          "face",
          [
            { transform: "translateX(0px)", opacity: 1, offset: 0 },
            { transform: "translateX(1.5px)", opacity: 1, offset: 0.28 },
            { transform: "translateX(1.5px)", opacity: 1, offset: 0.5 },
            { transform: "translateX(-1.5px)", opacity: 1, offset: 0.72 },
            { transform: "translateX(0px)", opacity: 1, offset: 0.9 },
            { transform: "translateX(0px)", opacity: 0.5, offset: 0.94 },
            { transform: "translateX(0px)", opacity: 1, offset: 0.97 },
            { transform: "translateX(0px)", opacity: 1, offset: 1 },
          ],
          4500
        );
      }
      if (want("neckStatus")) {
        loop(
          "neckStatus",
          [
            { opacity: 0.9, transform: "scale(1)" },
            { opacity: 0.45, transform: "scale(1.2)", offset: 0.5 },
            { opacity: 0.9, transform: "scale(1)" },
          ],
          2400
        );
      }
      if (want("leftArm")) {
        // Base pose: hand resting on the hip (LEFT_HIP_BASE), not
        // hanging straight down — see the constants above. Small
        // sway on top of that base, same technique as before. This
        // keeps running (unpaused) even while the right arm performs
        // its welcome/wave — the left side should never look frozen
        // while the right side is the one doing something.
        loop(
          "leftArm",
          [
            { transform: `rotate(${LEFT_HIP_BASE.shoulder}deg)` },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder - 2.5}deg)`, offset: 0.25 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder + 1}deg)`, offset: 0.5 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder - 1.5}deg)`, offset: 0.75 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder}deg)` },
          ],
          3400
        );
      }
      if (want("leftElbow")) {
        loop(
          "leftElbow",
          [
            { transform: `rotate(${LEFT_HIP_BASE.elbow}deg)` },
            { transform: `rotate(${LEFT_HIP_BASE.elbow + 3}deg)`, offset: 0.5 },
            { transform: `rotate(${LEFT_HIP_BASE.elbow}deg)` },
          ],
          3600,
          -600
        );
      }
      if (want("leftWrist")) {
        loop(
          "leftWrist",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(4deg)", offset: 0.5 },
            { transform: "rotate(0deg)" },
          ],
          3000,
          -900
        );
      }
      if (want("rightArm")) {
        // Base pose: hand resting on the hip (RIGHT_HIP_BASE), the
        // mirror of the left arm's rest. Small sway on top, mirrored
        // direction from the left arm's and a different duration so
        // the two don't move as an obviously mirrored pair.
        loop(
          "rightArm",
          [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)` },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder + 2.5}deg)`, offset: 0.25 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder - 1}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder + 1.5}deg)`, offset: 0.75 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)` },
          ],
          3800
        );
      }
      if (want("rightElbow")) {
        loop(
          "rightElbow",
          [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)` },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow - 3}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)` },
          ],
          3200,
          -1100
        );
      }
      if (want("rightWrist")) {
        loop(
          "rightWrist",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(-6deg)", offset: 0.5 },
            { transform: "rotate(0deg)" },
          ],
          3400,
          -1700
        );
      }
      if (want("leftHand")) {
        loop(
          "leftHand",
          [
            { transform: "rotate(0deg) scale(1)" },
            { transform: "rotate(5deg) scale(1.04)", offset: 0.5 },
            { transform: "rotate(0deg) scale(1)" },
          ],
          2200
        );
      }
      if (want("rightHand")) {
        loop(
          "rightHand",
          [
            { transform: "rotate(0deg) scale(1)" },
            { transform: "rotate(5deg) scale(1.04)", offset: 0.5 },
            { transform: "rotate(0deg) scale(1)" },
          ],
          2400,
          -400
        );
      }
      if (want("leftFoot")) {
        loop(
          "leftFoot",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(1.5deg)", offset: 0.5 },
            { transform: "rotate(0deg)" },
          ],
          2800
        );
      }
      if (want("rightFoot")) {
        loop(
          "rightFoot",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(1.5deg)", offset: 0.5 },
            { transform: "rotate(0deg)" },
          ],
          2800,
          -1400
        );
      }
    }

    // Cancels every currently-playing one-shot gesture animation and
    // bumps the generation counter so any in-flight async phase chain
    // (welcome()/wave()) notices at its next checkpoint and stops
    // advancing instead of fighting the new gesture for control.
    _cancelGesture() {
      this._gestureGen++;
      for (const anim of this._gestureAnims) anim.cancel();
      this._gestureAnims = [];
    }

    // Cancels the named idle loops so a gesture can drive those parts
    // directly without the two fighting over the same transform.
    _pauseIdle(keys) {
      for (const k of keys) {
        if (this._idleAnims[k]) {
          this._idleAnims[k].cancel();
          delete this._idleAnims[k];
        }
      }
    }

    // Low-level: plays a batch of animate() calls in parallel, tracks
    // them on _gestureAnims (so _cancelGesture() can interrupt them),
    // and resolves once they've all finished — or immediately, without
    // throwing, if one gets cancelled out from under it by a newer
    // gesture call.
    _run(specs) {
      const anims = specs
        .filter((spec) => this.el[spec.key])
        .map((spec) => this.el[spec.key].animate(spec.keyframes, spec.options));
      this._gestureAnims.push(...anims);
      return Promise.all(anims.map((a) => a.finished)).catch(() => {});
    }

    // Runs a single-phase gesture (used by think()/success()/
    // attention(), which don't need the multi-phase choreography):
    // cancels whatever's in flight, pauses idle for just these parts,
    // plays the animations, waits for them, then cancels them (they
    // always end back at the neutral pose, so handing control back is
    // seamless — no snap) and restarts idle for the given keys.
    async _playGesture(idleKeysToRestart, animSpecs) {
      this._cancelGesture();
      this._pauseIdle(idleKeysToRestart);
      await this._run(animSpecs);
      this._finishGesture(idleKeysToRestart);
    }

    // Hands control of `keys` back to idle(): starts fresh idle loops
    // for them (which — since every gesture phase below ends exactly
    // on idle's own resting values — takes over with no visible jump),
    // then cleans up the now-superseded gesture Animation objects.
    _finishGesture(keys) {
      const stale = this._gestureAnims;
      this._gestureAnims = [];
      this.idle(keys);
      for (const a of stale) a.cancel();
    }

    // ============ WELCOME / WAVE PHASES ============
    // Shared building blocks for welcome() and wave() — see the file
    // header for what each phase represents. `duration` lets the two
    // gestures reuse identical motion *shapes* at different speeds
    // (welcome() slower/more deliberate, wave() a quicker acknowledgment).
    // `includeHeadBody` skips the head/face/torso choreography for the
    // lighter wave() so a quick wave doesn't also commit the head to a
    // multi-second turn-and-return.

    _riseToWelcome(duration, includeHeadBody) {
      const specs = [
        {
          // Shoulder: a brief anticipation dip deeper into the hip
          // rest (a small "coil"), then the rise itself.
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_ANTICIPATION.shoulder}deg)`, offset: 0.12 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 0.62 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Elbow — SAME offsets as the shoulder above. See the file
          // header: staggering these is what causes the arm to
          // transiently overreach.
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_ANTICIPATION.elbow}deg)`, offset: 0.12 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0.62 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Wrist trails the shoulder/elbow's rise, briefly overshoots
          // past its resting wave-ready tilt, then settles — the
          // follow-through that makes the rise feel like it has mass,
          // rather than every joint arriving at the same instant.
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.12 },
            { transform: "rotate(-8deg)", offset: 0.66 },
            { transform: "rotate(-14deg)", offset: 0.76 },
            { transform: "rotate(-4deg)", offset: 0.92 },
            { transform: "rotate(-4deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          // Hand — palm turns slightly toward the user and opens a
          // touch as it arrives, with its own small follow-through.
          key: "rightHand",
          keyframes: [
            { transform: "rotate(0deg) scale(1)", offset: 0 },
            { transform: "rotate(0deg) scale(1)", offset: 0.15 },
            { transform: "rotate(6deg) scale(1.04)", offset: 0.7 },
            { transform: "rotate(6deg) scale(1.06)", offset: 0.82 },
            { transform: "rotate(4deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
      ];
      if (includeHeadBody) {
        specs.push(
          {
            // Head turns/tilts toward the rising arm, holding through
            // the wave phase that follows (returned to neutral only in
            // _lowerToHip) — the head should look like it's noticing
            // its own arm move, not sit disconnected from the action.
            key: "head",
            keyframes: [
              { transform: "rotate(0deg)", offset: 0 },
              { transform: "rotate(0deg)", offset: 0.1 },
              { transform: "rotate(6deg)", offset: 0.55 },
              { transform: "rotate(6deg)", offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            key: "face",
            keyframes: [
              { transform: "translateX(0px)", opacity: 1, offset: 0 },
              { transform: "translateX(0px)", opacity: 1, offset: 0.1 },
              { transform: "translateX(3px)", opacity: 1, offset: 0.55 },
              { transform: "translateX(3px)", opacity: 1, offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            // Torso: a very small weight-shift lean away from the
            // raised arm (physical counterbalance), on top of a single
            // breathing dip — holds through the wave phase too.
            key: "body",
            keyframes: [
              { transform: "translate(0px, 0px)", offset: 0 },
              { transform: "translate(0px, -2px)", offset: 0.3 },
              { transform: "translate(-2px, -3px)", offset: 0.62 },
              { transform: "translate(-2px, -3px)", offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          }
        );
      }
      return this._run(specs);
    }

    // Shoulder/elbow hold the welcome stance (small stable sway only,
    // per the brief — the shoulder should read as relatively stable),
    // while the wrist does two full left→center→right→center cycles
    // and the hand does a small synchronized flex. Ends with the wrist
    // back at the same -4deg tilt _riseToWelcome() settled it to, so
    // _lowerToHip() has a clean, matching starting point.
    _waveCycles2(duration) {
      return this._run([
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder - 1.5}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow + 2}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(-4deg)", offset: 0 },
            { transform: "rotate(-18deg)", offset: 0.12 },
            { transform: "rotate(-4deg)", offset: 0.28 },
            { transform: "rotate(10deg)", offset: 0.4 },
            { transform: "rotate(-4deg)", offset: 0.55 },
            { transform: "rotate(-18deg)", offset: 0.67 },
            { transform: "rotate(-4deg)", offset: 0.8 },
            { transform: "rotate(8deg)", offset: 0.9 },
            { transform: "rotate(-4deg)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(4deg) scale(1.02)", offset: 0 },
            { transform: "rotate(2deg) scale(1.05)", offset: 0.12 },
            { transform: "rotate(4deg) scale(1.02)", offset: 0.28 },
            { transform: "rotate(6deg) scale(1.05)", offset: 0.4 },
            { transform: "rotate(4deg) scale(1.02)", offset: 0.55 },
            { transform: "rotate(2deg) scale(1.05)", offset: 0.67 },
            { transform: "rotate(4deg) scale(1.02)", offset: 0.8 },
            { transform: "rotate(5deg) scale(1.04)", offset: 0.9 },
            { transform: "rotate(4deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
      ]);
    }

    // Lighter one-cycle version for the quicker standalone wave().
    _waveCycles1(duration) {
      return this._run([
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder - 1.5}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow + 2}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(-4deg)", offset: 0 },
            { transform: "rotate(-18deg)", offset: 0.22 },
            { transform: "rotate(-4deg)", offset: 0.5 },
            { transform: "rotate(10deg)", offset: 0.72 },
            { transform: "rotate(-4deg)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(4deg) scale(1.02)", offset: 0 },
            { transform: "rotate(2deg) scale(1.05)", offset: 0.22 },
            { transform: "rotate(4deg) scale(1.02)", offset: 0.5 },
            { transform: "rotate(6deg) scale(1.05)", offset: 0.72 },
            { transform: "rotate(4deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
      ]);
    }

    // Reverse cascade back to the hip rest: the wrist/hand snap back
    // to neutral quickly (within roughly the first third of this
    // phase's own duration), while the shoulder/elbow take the FULL
    // duration to ease back down — so the hand visibly settles well
    // before the shoulder finishes lowering, distal joints first.
    _lowerToHip(duration, includeHeadBody) {
      const specs = [
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 0.85 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 0.85 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(-4deg)", offset: 0 },
            { transform: "rotate(2deg)", offset: 0.18 },
            { transform: "rotate(0deg)", offset: 0.35 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(4deg) scale(1.02)", offset: 0 },
            { transform: "rotate(-1deg) scale(0.99)", offset: 0.2 },
            { transform: "rotate(0deg) scale(1)", offset: 0.38 },
            { transform: "rotate(0deg) scale(1)", offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
      ];
      if (includeHeadBody) {
        specs.push(
          {
            key: "head",
            keyframes: [
              { transform: "rotate(6deg)", offset: 0 },
              { transform: "rotate(0deg)", offset: 0.6 },
              { transform: "rotate(0deg)", offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            key: "face",
            keyframes: [
              { transform: "translateX(3px)", opacity: 1, offset: 0 },
              { transform: "translateX(0px)", opacity: 1, offset: 0.6 },
              { transform: "translateX(0px)", opacity: 1, offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            key: "body",
            keyframes: [
              { transform: "translate(-2px, -3px)", offset: 0 },
              { transform: "translate(0px, 0px)", offset: 0.85 },
              { transform: "translate(0px, 0px)", offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          }
        );
      }
      return this._run(specs);
    }

    // ============ GESTURES ============

    // The full, unhurried welcome ceremony: a short settle-pause
    // (hands are already resting at the waist from idle — this is the
    // brief confirming beat before committing to the gesture),
    // anticipation, rise, two wave cycles with head/torso coordination
    // throughout, then the full reverse-cascade return to the waist
    // (RIGHT_ARM_WAIST — see idle()'s rightArm/rightElbow keyframes).
    // Resolves `true` if it played all the way through, `false` if a
    // newer gesture call interrupted it partway — startWelcomeLoop()
    // below uses that to know whether it's still safe to keep looping.
    async welcome() {
      const keys = ["head", "face", "body", "rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);

      await sleep(450); // hands already at the waist — a brief pause before reaching out
      if (gen !== this._gestureGen) return false;

      await this._riseToWelcome(1900, true);
      if (gen !== this._gestureGen) return false;

      await this._waveCycles2(1700);
      if (gen !== this._gestureGen) return false;

      await sleep(220); // brief hold before returning, so the gesture doesn't feel clipped short
      if (gen !== this._gestureGen) return false;

      await this._lowerToHip(1700, true);
      if (gen !== this._gestureGen) return false;

      this._finishGesture(keys);
      return true;
    }

    // Backward-compatible alias — existing call sites (e.g. index.html's
    // page-load trigger) call robot.greet(). Plays the ceremony ONCE;
    // use startWelcomeLoop() (below) for the continuously-repeating
    // waist <-> welcome cycle.
    greet() {
      return this.welcome();
    }

    // Runs welcome() on a loop: RIGHT_ARM_WAIST -> RIGHT_ARM_WELCOME ->
    // wave -> RIGHT_ARM_WAIST -> pause -> RIGHT_ARM_WELCOME again ->
    // ... forever, until stopWelcomeLoop() is called. Each iteration is
    // a full, ordinary welcome() call — the arm always eases smoothly
    // from wherever it currently is (idle()'s hip rest, since
    // welcome() always hands back to idle() between cycles) rather than
    // ever being reset/teleported, so the loop is just "greet again"
    // repeated, not "restart the whole animation from frame 0".
    // If some OTHER gesture (think()/success()/attention()/a manual
    // wave()) interrupts a cycle mid-flight, welcome() resolves false
    // and the loop stops on its own instead of fighting for control —
    // call startWelcomeLoop() again afterward to resume it.
    async startWelcomeLoop(pauseMs) {
      if (this._welcomeLoopActive) return; // already looping — don't stack a second loop
      this._welcomeLoopActive = true;
      const restMs = typeof pauseMs === "number" ? pauseMs : 750; // "robot relaxed at the waist" beat between greetings
      while (this._welcomeLoopActive) {
        const completed = await this.welcome();
        if (!completed || !this._welcomeLoopActive) break;
        await sleep(restMs);
      }
      this._welcomeLoopActive = false;
    }

    // Stops startWelcomeLoop() after the in-flight welcome() finishes
    // its current cycle (it does not abort mid-gesture) — the loop
    // checks this flag at each of its own checkpoints, never mid-limb.
    stopWelcomeLoop() {
      this._welcomeLoopActive = false;
    }

    // A quicker, lighter acknowledgment wave — rises faster, waves
    // once, returns faster, and skips the head/torso choreography so
    // it reads as a quick "hi" rather than the full welcome ceremony.
    // Reusable standalone (e.g. "user opens a feature"). Resolves
    // `true`/`false` the same way welcome() does.
    async wave() {
      const keys = ["head", "face", "body", "rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);

      await this._riseToWelcome(1100, false);
      if (gen !== this._gestureGen) return false;

      await this._waveCycles1(900);
      if (gen !== this._gestureGen) return false;

      await sleep(150);
      if (gen !== this._gestureGen) return false;

      await this._lowerToHip(1000, false);
      if (gen !== this._gestureGen) return false;

      this._finishGesture(keys);
      return true;
    }

    // A small head-tilt "considering" gesture with a subtle hand
    // fidget on the resting (left) arm — deliberately doesn't raise a
    // hand to the chin, which would need new geometry/clipping
    // verification; the tilt alone reads clearly as "thinking".
    think() {
      const dur = 2000;
      return this._playGesture(["head", "leftArm", "leftHand"], [
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(9deg)", offset: 0.25 },
            { transform: "rotate(9deg)", offset: 0.75 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Small dip relative to the arm's already-resting hip-pose
          // base (idle() holds the shoulder there continuously).
          key: "leftArm",
          keyframes: [
            { transform: `rotate(${LEFT_HIP_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder - 6}deg)`, offset: 0.3 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder - 6}deg)`, offset: 0.7 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "leftHand",
          keyframes: [
            { transform: "rotate(0deg) scale(1)", offset: 0 },
            { transform: "rotate(8deg) scale(1.03)", offset: 0.35 },
            { transform: "rotate(-4deg) scale(1.03)", offset: 0.6 },
            { transform: "rotate(0deg) scale(1)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
    }

    // A brief, confident positive beat — a small body bounce, a quick
    // head nod, and the visor's halo flaring slightly — for a
    // completed/successful action. No arm movement, so it can layer
    // on top of any other gesture's ending without extra clipping risk.
    success() {
      const dur = 900;
      const bounceEase = "cubic-bezier(0.34, 1.2, 0.64, 1)"; // a small, restrained overshoot — pleased, not cartoonish
      return this._playGesture(["body", "head"], [
        {
          key: "body",
          keyframes: [
            { transform: "translateY(0px)", offset: 0 },
            { transform: "translateY(-8px)", offset: 0.35 },
            { transform: "translateY(1px)", offset: 0.6 },
            { transform: "translateY(0px)", offset: 1 },
          ],
          options: { duration: dur, easing: bounceEase, fill: "forwards" },
        },
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-6deg)", offset: 0.3 },
            { transform: "rotate(3deg)", offset: 0.55 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: bounceEase, fill: "forwards" },
        },
        {
          key: "visorHalo",
          keyframes: [
            { transform: "scale(1)", offset: 0 },
            { transform: "scale(1.35)", offset: 0.3 },
            { transform: "scale(1)", offset: 1 },
          ],
          options: { duration: dur, easing: "ease-out", fill: "forwards" },
        },
      ]);
    }

    // A brief "look here" cue for errors/alerts — the neck status
    // light pulses quickly and the head perks slightly. Short and
    // non-disruptive, not a big movement.
    attention() {
      const dur = 700;
      return this._playGesture(["head", "neckStatus"], [
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-5deg)", offset: 0.3 },
            { transform: "rotate(2deg)", offset: 0.6 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "neckStatus",
          keyframes: [
            { opacity: 0.9, transform: "scale(1)", offset: 0 },
            { opacity: 1, transform: "scale(1.4)", offset: 0.25 },
            { opacity: 0.6, transform: "scale(1)", offset: 0.5 },
            { opacity: 1, transform: "scale(1.4)", offset: 0.75 },
            { opacity: 0.9, transform: "scale(1)", offset: 1 },
          ],
          options: { duration: dur, easing: "ease-in-out", fill: "forwards" },
        },
      ]);
    }

    // Cancels every animation (idle + any in-flight gesture), stops
    // startWelcomeLoop() if it's running, and leaves the rig in its
    // static neutral pose. Useful for cleanup if the embedding page
    // removes/hides the robot.
    stop() {
      this.stopWelcomeLoop();
      this._cancelGesture();
      for (const k in this._idleAnims) this._idleAnims[k].cancel();
      this._idleAnims = Object.create(null);
    }
  }

  global.CMProRobotAnimator = CMProRobotAnimator;

  // Thin global dispatchers matching the app-event naming the robot
  // will eventually be wired to (page load, search, loading, success,
  // error, feature-open — see robot-embed.js). Each just forwards to
  // the live instance robot-embed.js assigns to window.cmProRobot once
  // the SVG is fetched/injected; calling one before that's ready is a
  // harmless no-op.
  global.robotIdle = function () {
    return global.cmProRobot && global.cmProRobot.idle();
  };
  global.robotWelcome = function () {
    return global.cmProRobot && global.cmProRobot.welcome();
  };
  global.robotStartWelcomeLoop = function (pauseMs) {
    return global.cmProRobot && global.cmProRobot.startWelcomeLoop(pauseMs);
  };
  global.robotStopWelcomeLoop = function () {
    return global.cmProRobot && global.cmProRobot.stopWelcomeLoop();
  };
  global.robotWave = function () {
    return global.cmProRobot && global.cmProRobot.wave();
  };
  global.robotThink = function () {
    return global.cmProRobot && global.cmProRobot.think();
  };
  global.robotSuccess = function () {
    return global.cmProRobot && global.cmProRobot.success();
  };
  global.robotAttention = function () {
    return global.cmProRobot && global.cmProRobot.attention();
  };
})(window);
