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
       animations (body breathing, head wander, visor blink, neck
       status pulse, both arms' idle sway, both hands' idle flex, foot
       rock) — this is what's running whenever nothing else is.
     - greet() / wave() / think() / success() / attention(): one-shot
       gestures. Each temporarily cancels only the specific idle
       animations it needs exclusive control of, plays its own
       Animation objects, waits for them to finish, cancels them (they
       always end back at the neutral pose, so handing control back is
       seamless — no snap), then restarts idle for just those parts.
       Everything else keeps idling undisturbed throughout.

   CRITICAL: keep the right arm's shoulder and elbow animations on the
   same start/hold/return timing. An earlier version staggered them
   (elbow starting its bend later than the shoulder, or straightening
   out before the shoulder finished lowering) and — confirmed by
   measuring the actual rendered bounding box across the full
   animation with a headless browser — that transiently recreated a
   near-straight arm at a still-raised shoulder angle, reaching much
   further than either animation's own held values ever specified.
   Every gesture below keeps the shoulder and elbow moving in lockstep
   for exactly this reason. If you change amplitudes or add a new
   raised-arm gesture, re-verify with the same kind of sweep (sample
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
        loop(
          "body",
          [
            { transform: "translateY(0px)" },
            { transform: "translateY(-4px)", offset: 0.5 },
            { transform: "translateY(0px)" },
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
        // A brief brightness dip standing in for a blink, since the
        // face is one glass visor rather than a pair of eyes.
        loop(
          "face",
          [
            { opacity: 1 },
            { opacity: 1, offset: 0.9 },
            { opacity: 0.5, offset: 0.94 },
            { opacity: 1, offset: 0.97 },
            { opacity: 1 },
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
        loop(
          "leftArm",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(-2.5deg)", offset: 0.25 },
            { transform: "rotate(1deg)", offset: 0.5 },
            { transform: "rotate(-1.5deg)", offset: 0.75 },
            { transform: "rotate(0deg)" },
          ],
          3400
        );
      }
      if (want("rightArm")) {
        // Same idle sway as the left arm, but a different duration
        // (not a delay offset of the same period) so the two arms
        // drift in and out of phase over time instead of moving as a
        // mirrored pair — reads as more organic.
        loop(
          "rightArm",
          [
            { transform: "rotate(0deg)" },
            { transform: "rotate(2deg)", offset: 0.25 },
            { transform: "rotate(-1deg)", offset: 0.5 },
            { transform: "rotate(1.5deg)", offset: 0.75 },
            { transform: "rotate(0deg)" },
          ],
          3800
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

    // Cancels every currently-playing one-shot gesture animation
    // (used at the start of every gesture method so a new call always
    // takes over immediately, rather than being dropped or queued
    // behind a gesture already in flight).
    _cancelGesture() {
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

    // Runs a set of one-shot animations, tracks them for
    // interruption, waits for them all to finish, then cancels them
    // (every gesture below ends on its neutral pose, so cancelling —
    // which removes the WAAPI effect — hands back a visually identical
    // resting transform with no snap) and restarts idle for the given
    // keys.
    async _playGesture(idleKeysToRestart, animSpecs) {
      this._cancelGesture();
      // Must happen before creating the gesture's own animations below:
      // without this, the idle loop for these same elements is still
      // running underneath, and two Animation objects driving the same
      // element/property is fragile (relies on undefined-in-practice
      // composite-ordering behavior to even look right) and wastes
      // compositor work either way.
      this._pauseIdle(idleKeysToRestart);
      const anims = animSpecs
        .filter((spec) => this.el[spec.key])
        .map((spec) => this.el[spec.key].animate(spec.keyframes, spec.options));
      this._gestureAnims = anims;
      try {
        await Promise.all(anims.map((a) => a.finished));
      } catch (e) {
        // an in-flight animation was cancelled by a newer gesture call —
        // that's expected/fine, the newer call owns the elements now.
        return;
      }
      for (const a of anims) a.cancel();
      this.idle(idleKeysToRestart);
    }

    // ============ GESTURES ============

    // Page-load greeting: head glances over, the right arm raises with
    // a clearly bent elbow, a small two-beat wave, then everything
    // returns to idle. ~2s, matching a natural, unhurried greeting —
    // not a fast cartoon flourish.
    greet() {
      const dur = 2000;
      return this._playGesture(["head", "rightArm", "rightHand"], [
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.08 },
            { transform: "rotate(-10deg)", offset: 0.25 },
            { transform: "rotate(-8deg)", offset: 0.75 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Shoulder — raises the upper arm out to the side. Deliberately
          // NOT a full overhead swing: the elbow (below) folds the
          // forearm back up toward the head instead, which both reads as
          // a natural bent-elbow wave and needs far less canvas than
          // swinging one straight segment through the same arc would.
          key: "rightArm",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.2 },
            { transform: "rotate(-78deg)", offset: 0.45 },
            { transform: "rotate(-78deg)", offset: 0.78 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Elbow — starts bending at the SAME offset the shoulder
          // starts rising (not later), and finishes its bend before the
          // shoulder finishes rising. See the file header: staggering
          // these is what caused the arm to transiently overreach.
          key: "rightElbow",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.2 },
            { transform: "rotate(-50deg)", offset: 0.4 },
            { transform: "rotate(-50deg)", offset: 0.78 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Wrist — two small waves once the arm is raised (~1.1s, ~1.3s).
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.42 },
            { transform: "rotate(16deg)", offset: 0.55 },
            { transform: "rotate(-12deg)", offset: 0.62 },
            { transform: "rotate(14deg)", offset: 0.68 },
            { transform: "rotate(0deg)", offset: 0.8 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          // Hand — a very small synchronized flex during the wave beats.
          key: "rightHand",
          keyframes: [
            { transform: "scale(1)", offset: 0 },
            { transform: "scale(1)", offset: 0.42 },
            { transform: "scale(1.05)", offset: 0.55 },
            { transform: "scale(1)", offset: 0.65 },
            { transform: "scale(1.05)", offset: 0.72 },
            { transform: "scale(1)", offset: 0.8 },
            { transform: "scale(1)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
    }

    // A shorter, standalone friendly wave (no head movement) — reusable
    // on its own, e.g. for "user interaction" events.
    wave() {
      const dur = 1400;
      return this._playGesture(["rightArm", "rightHand"], [
        {
          key: "rightArm",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-78deg)", offset: 0.35 },
            { transform: "rotate(-78deg)", offset: 0.75 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-50deg)", offset: 0.3 },
            { transform: "rotate(-50deg)", offset: 0.75 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.35 },
            { transform: "rotate(16deg)", offset: 0.48 },
            { transform: "rotate(-12deg)", offset: 0.58 },
            { transform: "rotate(14deg)", offset: 0.68 },
            { transform: "rotate(0deg)", offset: 0.8 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "scale(1)", offset: 0 },
            { transform: "scale(1)", offset: 0.35 },
            { transform: "scale(1.05)", offset: 0.48 },
            { transform: "scale(1)", offset: 0.58 },
            { transform: "scale(1.05)", offset: 0.68 },
            { transform: "scale(1)", offset: 0.8 },
            { transform: "scale(1)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
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
          key: "leftArm",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-6deg)", offset: 0.3 },
            { transform: "rotate(-6deg)", offset: 0.7 },
            { transform: "rotate(0deg)", offset: 1 },
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

    // Cancels every animation (idle + any in-flight gesture) and
    // leaves the rig in its static neutral pose. Useful for cleanup
    // if the embedding page removes/hides the robot.
    stop() {
      this._cancelGesture();
      for (const k in this._idleAnims) this._idleAnims[k].cancel();
      this._idleAnims = Object.create(null);
    }
  }

  global.CMProRobotAnimator = CMProRobotAnimator;
})(window);
