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
       makes the greeting repeat: it plays a one-time "notice the user"
       intro, then calls welcome() over and over, forever, until
       stopWelcomeLoop() is called. Each cycle is an ordinary welcome()
       call starting from wherever the arm actually is (idle's hip
       rest — welcome() always ends there), so looping never resets or
       teleports anything; it's "greet again", not "restart the whole
       animation". If another gesture interrupts a cycle mid-flight,
       welcome() reports that back and the loop stops itself rather
       than fighting for control — see welcome()'s and
       startWelcomeLoop()'s own comments below.

   PHASES (welcome() and wave())
   The right arm's greeting is NOT one rotate-the-whole-arm animation —
   it's a chain of small phases, each starting exactly where the
   previous one left off (every phase's offset-0 keyframe value matches
   the previous phase's offset-1 value, for every key it touches), so
   nothing ever snaps between them:
     _noticeAndSettle() [once, at startWelcomeLoop() start]
       -> _relaxHold() -> _anticipate() -> (brief sleep) ->
       _riseToWelcome() -> _settleAtWelcome() -> _waveCycles2() ->
       _followThrough() -> _lowerToHip() -> [loops back to _relaxHold()]
   See each phase's own comment below for what it does. The key
   structural idea, repeated throughout: within the RISE, the ELBOW
   LEADS the SHOULDER — it finishes bending well before the shoulder
   finishes its rise (offset 0.78 vs 1.0), then holds — rather than the
   two moving in lockstep, which is what made earlier versions read as
   "the whole arm rotating as one rigid object" instead of a shoulder
   initiating and an elbow following through. See CRITICAL below for
   why leading (not lagging) is the safe direction. Distal joints
   (wrist, then hand) start even later and settle even later, giving
   the shoulder -> elbow -> forearm -> wrist -> hand cascade the brief
   asks for. The RETURN phase (_lowerToHip) reverses this: hand/wrist
   snap back within the first third of its duration while shoulder/
   elbow take the phase's full duration — distal joints settle first,
   proximal joints last, exactly backwards from the rise.

   Every phase is cancellable mid-flight: welcome()/wave() bump
   `_gestureGen` and each `await` between phases re-checks it, so a
   newer gesture call (or think()/success()/attention()) always wins
   immediately rather than fighting the old sequence for control.

   CRITICAL: the shoulder must never LAG a raised elbow's implied reach,
   and the elbow must never LAG a raised shoulder's implied reach — an
   earlier version staggered shoulder/elbow the wrong way (elbow
   bending later than the shoulder rose, or straightening out before
   the shoulder finished lowering) and — confirmed by measuring the
   actual rendered bounding box across the full animation with a
   headless browser — that transiently recreated a near-straight arm at
   a still-raised shoulder angle, reaching much further than either
   animation's own held values ever specified. The fix isn't "keep them
   in lockstep forever" (that's what made the arm look rigid) — it's
   "the elbow may only ever be AHEAD of where lockstep would put it,
   never behind": a MORE-bent elbow than the naive interpolation can
   only pull the hand CLOSER to the shoulder, never further out, so
   _riseToWelcome() compresses the elbow's bend into an EARLIER offset
   window (0 to 0.78) than the shoulder's full rise (0 to 1) — the
   elbow is always at least as bent as it needs to be for the current
   shoulder angle. _lowerToHip() keeps shoulder/elbow on IDENTICAL
   offsets, because during the RETURN the dangerous direction flips
   (an elbow straightening out AHEAD of the shoulder lowering would be
   the unsafe one) and there's no motion-quality reason to stagger that
   direction anyway — the wrist/hand's reverse cascade already carries
   the "distal joints move independently" feeling for the return.
   The wrist/hand are always free to run on fully independent offsets
   from the shoulder/elbow (that's how the follow-through/reverse-
   cascade work) because wrist rotation doesn't extend the arm's reach
   the way a shoulder/elbow desync does. If you touch the shoulder or
   elbow keyframes, re-verify with the same kind of sweep (sample
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
  // Small bounded randomization so consecutive welcome() cycles aren't
  // pixel-identical (a head turn of 3deg one cycle, 4deg the next,
  // etc.) — keeps `range` small everywhere it's used so the variation
  // reads as organic rather than random/jittery.
  const jitter = (base, range) => base + (Math.random() * 2 - 1) * range;

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
    // Each finger bends at its own knuckle.
    leftFinger1: "148px 436px",
    leftFinger2: "160px 434px",
    leftFinger3: "172px 436px",
    leftThumb: "137px 411px",
    rightFinger1: "332px 436px",
    rightFinger2: "320px 434px",
    rightFinger3: "308px 436px",
    rightThumb: "343px 411px",
    // Leg chain (see LEGS in robot.svg): hip, the part below the knee,
    // the knee, the ankle.
    leftThigh: "207px 388px",
    leftLower: "207px 545px",
    leftShin: "207px 545px",
    leftAnkle: "207px 673px",
    rightThigh: "273px 388px",
    rightLower: "273px 545px",
    rightShin: "273px 545px",
    rightAnkle: "273px 673px",
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
    leftFinger1: "left-finger-1",
    leftFinger2: "left-finger-2",
    leftFinger3: "left-finger-3",
    leftThumb: "left-thumb",
    rightFinger1: "right-finger-1",
    rightFinger2: "right-finger-2",
    rightFinger3: "right-finger-3",
    rightThumb: "right-thumb",
    leftThigh: "left-thigh-pivot",
    leftLower: "left-lower-leg",
    leftShin: "left-shin-pivot",
    leftAnkle: "left-ankle-pivot",
    rightThigh: "right-thigh-pivot",
    rightLower: "right-lower-leg",
    rightShin: "right-shin-pivot",
    rightAnkle: "right-ankle-pivot",
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

  // The other arm targets used by the extra gestures (same sign rules as
  // the *_BASE constants above: the right arm swings outward with
  // negative angles, the left arm with positive ones).
  // Celebrating left arm: a "power fist" — elbow stays near the body and
  // the forearm curls up beside the shoulder. The elbow turns the inner
  // way (past -180, behind the torso) so the arm never sweeps out to the
  // left, where the robot has little room on Home.
  const LEFT_CHEER = { shoulder: 35, elbow: -190 };
  const RIGHT_POINT = { shoulder: -92, elbow: -4 }; // arm straight out to the side
  const RIGHT_THUMB = { shoulder: -25, elbow: -65 }; // forearm level, pointing out
  const RIGHT_SHRUG = { shoulder: -15, elbow: -70 }; // forearm out sideways
  const LEFT_SHRUG = { shoulder: 15, elbow: 70 };

  // Finger poses: [finger 1 (outer), finger 2 (middle), finger 3 (inner),
  // thumb]. Rotations are written for the right hand; the left hand
  // mirrors them. Fingers hang down from the knuckle, so scaleY < 1
  // reads as a finger curled into the palm.
  const HAND_POSES = {
    rest: ["rotate(0deg) scaleY(1)", "rotate(0deg) scaleY(1)", "rotate(0deg) scaleY(1)", "translate(0px, 0px) rotate(0deg) scale(1)"],
    open: ["rotate(-14deg) scaleY(1.05)", "rotate(0deg) scaleY(1.08)", "rotate(14deg) scaleY(1.05)", "rotate(-14deg) scale(1.05)"],
    fist: ["rotate(0deg) scaleY(0.45)", "rotate(0deg) scaleY(0.45)", "rotate(0deg) scaleY(0.45)", "translate(0px, 0px) rotate(20deg) scale(0.8)"],
    // thumb turned out to the side of the fist — straight up when the
    // forearm is level (RIGHT_THUMB)
    thumb: ["rotate(0deg) scaleY(0.45)", "rotate(0deg) scaleY(0.45)", "rotate(0deg) scaleY(0.45)", "translate(-9px, 2px) rotate(-126deg) scale(1.2)"],
    // finger 1 (next to the thumb) stays out, the rest curl in
    point: ["rotate(4deg) scaleY(1.12)", "rotate(0deg) scaleY(0.45)", "rotate(0deg) scaleY(0.45)", "rotate(30deg) scale(0.75)"],
  };
  const mirrorPose = (t) => t.replace(/rotate\((-?[\d.]+)deg\)/, (m, a) => `rotate(${-Number(a)}deg)`);

  // Leg segment lengths in robot.svg (hip 388 -> knee 545 -> ankle 673).
  const THIGH_LEN = 157;
  const SHIN_LEN = 128;
  // How far a leg pose { t: thigh scaleY, s: shin scaleY } lifts the foot
  // toward the hip — the body drops by this much to keep a planted foot
  // on the ground.
  const legRise = (f) => THIGH_LEN * (1 - (f.t ?? 1)) + SHIN_LEN * (1 - (f.s ?? 1));

  // Expressions robot.svg can show (#expr-<name>); neutral is the rest face.
  const EXPRESSIONS = ["neutral", "happy", "joy", "think", "wow"];
  const REDUCED_MOTION = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

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
      this._initFace();
      this._initVisibility();
      this._initPointerLook();
    }

    // ============ PAUSE WHEN NOT SEEN ============
    // Everything (idle, gestures, face) pauses while the robot is
    // scrolled out of view or the app is in the background, and carries
    // on from the same frame when it's back — no battery spent on a
    // robot nobody can see. A gesture chain waiting on a paused
    // animation simply waits too.
    _initVisibility() {
      this._offscreen = false;
      const update = () => {
        const hidden = this._offscreen || document.hidden;
        if (hidden === this._paused) return;
        this._paused = hidden;
        const anims = this.svg.getAnimations ? this.svg.getAnimations({ subtree: true }) : [];
        for (const a of anims) hidden ? a.pause() : a.play();
      };
      this._paused = false;
      document.addEventListener("visibilitychange", update);
      if (global.IntersectionObserver) {
        new IntersectionObserver((entries) => {
          this._offscreen = !entries[entries.length - 1].isIntersecting;
          update();
        }).observe(this.svg);
      }
    }

    // An animation started while the robot is paused (a gesture's next
    // phase, idle restarting after it) starts paused too.
    _held(anim) {
      if (this._paused) anim.pause();
      return anim;
    }

    // ============ EYES FOLLOW THE FINGER ============
    // A tap or drag anywhere on the page: the eyes turn toward it for a
    // couple of seconds (and the random glances wait), then drift back.
    _initPointerLook() {
      const onPointer = (e) => {
        if (this._paused || !this.face || !this.face.look) return;
        const r = this.svg.getBoundingClientRect();
        if (!r.width) return;
        // The eyes sit about 10% down the robot's box.
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height * 0.1);
        const len = Math.hypot(dx, dy) || 1;
        this._pointerAt = Date.now();
        this._lookTo({ x: (dx / len) * 4.5, y: (dy / len) * 2.5 }, 180);
        this._later("lookBack", () => this._lookTo({ x: 0, y: 0 }, 400), 2500);
      };
      document.addEventListener("pointerdown", onPointer, { passive: true });
      document.addEventListener("pointermove", (e) => { if (e.pointerType !== "mouse" || e.buttons) onPointer(e); }, { passive: true });
    }

    _lookTo(to, duration) {
      const eyes = this.face && this.face.look;
      if (!eyes) return;
      this._held(eyes.animate(
        [
          { transform: `translate(${this._lookAt.x}px, ${this._lookAt.y}px)` },
          { transform: `translate(${to.x}px, ${to.y}px)` },
        ],
        { duration, easing: GESTURE_EASE, fill: "forwards" }
      ));
      this._lookAt = to;
    }

    // ============ FACE & LIGHTS ============
    // The life layer on top of the body idle: real blinks, the eyes
    // glancing around, a glint sweeping the visor, the cyan lights
    // pulsing out of step, and an expression per gesture (setExpression).
    // Every part is optional — an older robot.svg without them just
    // skips that part.
    _initFace() {
      const q = (id) => this.svg.querySelector("#" + id);
      this.face = { expr: {}, look: q("eyes-look"), blink: q("eyes-blink"), glint: q("visor-glint") };
      for (const name of EXPRESSIONS) {
        const g = q("expr-" + name);
        if (!g) continue;
        g.style.transition = "opacity 180ms ease";
        this.face.expr[name] = g;
      }
      if (this.face.blink) this.face.blink.style.transformOrigin = "240px 80px";
      this._expression = "neutral";
      this._exprToken = 0;
      this._lookAt = { x: 0, y: 0 };
      this._faceTimers = Object.create(null);

      // Lights breathe at different rates so they never pulse in unison.
      this._lightAnims = [];
      const pulse = (id, low, duration, delay) => {
        const el = q(id);
        if (!el) return;
        this._lightAnims.push(el.animate(
          [{ opacity: 1 }, { opacity: low, offset: 0.5 }, { opacity: 1 }],
          { duration, delay, iterations: Infinity, easing: "ease-in-out" }
        ));
      };
      pulse("chest-light", 0.45, 2600, 0);
      pulse("waist-light", 0.45, 2600, -1300);
      pulse("head-light", 0.5, 3200, -400);
      pulse("ear-ring-left", 0.55, 3000, 0);
      pulse("ear-ring-right", 0.55, 3000, -1500);

      this._scheduleBlink();
      if (!REDUCED_MOTION) {
        this._scheduleLook();
        this._scheduleGlint();
      }
    }

    _later(kind, fn, ms) {
      clearTimeout(this._faceTimers[kind]);
      this._faceTimers[kind] = setTimeout(() => {
        if (this._paused) return this._later(kind, fn, 1000); // wait until seen again
        fn();
      }, ms);
    }

    // Cross-fades to one of EXPRESSIONS. A pending timed revert from
    // _expressFor() is dropped by any newer call.
    setExpression(name) {
      this._exprToken++;
      if (!this.face || !this.face.expr[name] || name === this._expression) return;
      this._expression = name;
      for (const key in this.face.expr) this.face.expr[key].style.opacity = key === name ? "1" : "0";
    }

    // Shows an expression for a while, then back to neutral.
    _expressFor(name, ms) {
      this.setExpression(name);
      const token = this._exprToken;
      this._later("expr", () => {
        if (token === this._exprToken) this.setExpression("neutral");
      }, ms);
    }

    _scheduleBlink() {
      this._later("blink", () => {
        this.blink(Math.random() < 0.2);
        this._scheduleBlink();
      }, 2400 + Math.random() * 3200);
    }

    // A quick squash of the open eyes (only the neutral face has them).
    blink(double) {
      const eyes = this.face && this.face.blink;
      if (!eyes || this._expression !== "neutral") return;
      const keyframes = [
        { transform: "scaleY(1)" },
        { transform: "scaleY(0.1)", offset: 0.45 },
        { transform: "scaleY(1)" },
      ];
      const first = eyes.animate(keyframes, { duration: 170, easing: "ease-in-out" });
      if (double) {
        first.finished.then(() => {
          this._later("blink2", () => eyes.animate(keyframes, { duration: 170, easing: "ease-in-out" }), 90);
        }).catch(() => {});
      }
    }

    _scheduleLook() {
      this._later("look", () => {
        this._glance();
        this._scheduleLook();
      }, 3000 + Math.random() * 3500);
    }

    // The eyes glance somewhere new, or back to the middle — unless
    // they're following the user's finger.
    _glance() {
      if (Date.now() - (this._pointerAt || 0) < 3000) return;
      const centre = Math.random() < 0.4;
      this._lookTo(centre ? { x: 0, y: 0 } : { x: jitter(0, 4), y: jitter(-0.5, 2) }, 240);
    }

    _scheduleGlint() {
      this._later("glint", () => {
        if (this.face && this.face.glint) {
          this.face.glint.animate(
            [{ transform: "translateX(0px)" }, { transform: "translateX(200px)" }],
            { duration: 750, easing: "ease-in-out" }
          );
        }
        this._scheduleGlint();
      }, 6000 + Math.random() * 5000);
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
        this._idleAnims[name] = this._held(el.animate(keyframes, {
          duration,
          delay: delay || 0,
          iterations: Infinity,
          easing: "ease-in-out",
        }));
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
        // rotation above). Real blinks are blink() — see FACE & LIGHTS.
        loop(
          "face",
          [
            { transform: "translateX(0px)", opacity: 1, offset: 0 },
            { transform: "translateX(1.5px)", opacity: 1, offset: 0.28 },
            { transform: "translateX(1.5px)", opacity: 1, offset: 0.5 },
            { transform: "translateX(-1.5px)", opacity: 1, offset: 0.72 },
            { transform: "translateX(0px)", opacity: 1, offset: 0.9 },
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
        .map((spec) => this._held(this.el[spec.key].animate(spec.keyframes, spec.options)));
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
      const gen = this._gestureGen;
      this._pauseIdle(idleKeysToRestart);
      await this._run(animSpecs);
      if (gen !== this._gestureGen) {
        // A newer gesture took over: leave its animations alone, but give
        // idle back the parts it isn't moving, so nothing is left frozen.
        const busy = new Set(this._gestureAnims.map((a) => a.effect && a.effect.target));
        this.idle(idleKeysToRestart.filter((k) => this.el[k] && !busy.has(this.el[k]) && !this._idleAnims[k]));
        return false;
      }
      this._finishGesture(idleKeysToRestart);
      return true;
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
    // Every phase below starts exactly where the previous one in the
    // chain ends, for every key it touches — that's what keeps the
    // whole sequence snap-free. See the file header for the phase
    // order and the shoulder/elbow safety rule.

    // ONE-TIME intro, played once by startWelcomeLoop() before the
    // repeating cycle starts: the robot "notices" the user (head
    // center -> slight turn -> back to center) and both hands settle
    // more deliberately into the waist — left hand starts first, right
    // hand ~110ms later, so the two read as independent limbs arriving
    // rather than a mirrored pair moving in lockstep.
    _noticeAndSettle() {
      return this._playGesture(["head", "leftArm", "leftElbow", "rightArm", "rightElbow"], [
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(5deg)", offset: 0.55 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration: 700, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "leftArm",
          keyframes: [
            { transform: `rotate(${LEFT_HIP_BASE.shoulder + 3}deg)`, offset: 0 },
            { transform: `rotate(${LEFT_HIP_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration: 600, delay: 180, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "leftElbow",
          keyframes: [
            { transform: `rotate(${LEFT_HIP_BASE.elbow - 4}deg)`, offset: 0 },
            { transform: `rotate(${LEFT_HIP_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration: 600, delay: 180, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder - 3}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration: 600, delay: 290, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow + 4}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration: 600, delay: 290, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
    }

    // The "waiting at the waist" hold at the start of every cycle
    // (including the first) — replaces what used to be a dead sleep()
    // with real, small, returning-to-baseline motion, so the robot
    // never reads as frozen even during the pause.
    //
    // IMPORTANT: this phase must explicitly hold rightArm/rightElbow at
    // RIGHT_HIP_BASE, even though nothing about them visually changes
    // here. welcome() pauses their idle loop (_pauseIdle) right before
    // this phase runs, and RIGHT_HIP_BASE isn't the identity transform
    // — without a replacement animation, cancelling idle's would leave
    // them un-driven for this phase's whole duration, and an un-driven
    // SVG element renders at its base (unrotated) pose, i.e. the arm
    // would visibly drop to hanging straight down for the length of the
    // hold, then jump back to the hip pose when _anticipate() starts.
    // (rightWrist/rightHand/body/face don't need this: their resting
    // idle value already IS the identity transform, so no snap risk.)
    _relaxHold(duration) {
      const tilt = jitter(2, 1);
      return this._run([
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: `rotate(${tilt}deg)`, offset: 0.5 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder - 1}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow + 1.5}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-2deg)", offset: 0.5 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "body",
          keyframes: [
            { transform: "translate(0px, 0px)", offset: 0 },
            { transform: "translate(0px, -1.5px)", offset: 0.5 },
            { transform: "translate(0px, 0px)", offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
      ]);
    }

    // ANTICIPATION: before the arm commits to rising, the body
    // prepares — a tiny weight-shift starts, the shoulder/elbow coil
    // slightly deeper into the hip rest, the head turns a touch
    // further right. welcome() follows this with a brief sleep() (the
    // "pause ~100-200ms" the brief asks for) before the rise begins.
    _anticipate(duration, variation) {
      return this._run([
        {
          key: "body",
          keyframes: [
            { transform: "translate(0px, 0px)", offset: 0 },
            { transform: "translate(-1px, -0.5px)", offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_ANTICIPATION.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_ANTICIPATION.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "head",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: `rotate(${variation.headStart}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
    }

    // THE RISE. Shoulder rises across the FULL duration (offset 0->1);
    // the elbow's bend is compressed into offset 0->0.78 then holds —
    // it LEADS the shoulder, finishing its bend before the shoulder
    // finishes rising (see the file header for why this is the safe
    // direction and what breaks the "one rigid object" look). Wrist
    // starts later still (0.22), trails, briefly overshoots past its
    // resting tilt, and settles by the end; the hand settles LAST,
    // turning toward the user right at the tail. Head/face/body
    // continue straight on from wherever _anticipate() left them.
    _riseToWelcome(duration, includeHeadBody, variation) {
      const specs = [
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_ANTICIPATION.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_ANTICIPATION.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0.78 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.22 },
            { transform: "rotate(-7deg)", offset: 0.7 },
            { transform: "rotate(-11deg)", offset: 0.84 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(0deg) scale(1)", offset: 0 },
            { transform: "rotate(0deg) scale(1)", offset: 0.35 },
            { transform: "rotate(5deg) scale(1.04)", offset: 0.82 },
            { transform: "rotate(3deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
      ];
      if (includeHeadBody) {
        specs.push(
          {
            key: "head",
            keyframes: [
              { transform: `rotate(${variation.headStart}deg)`, offset: 0 },
              { transform: `rotate(${variation.headTarget}deg)`, offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            key: "face",
            keyframes: [
              { transform: "translateX(1px)", opacity: 1, offset: 0 },
              { transform: "translateX(3px)", opacity: 1, offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          },
          {
            key: "body",
            keyframes: [
              { transform: "translate(-1px, -0.5px)", offset: 0 },
              { transform: "translate(-2.5px, -2.5px)", offset: 1 },
            ],
            options: { duration, easing: GESTURE_EASE, fill: "forwards" },
          }
        );
      }
      return this._run(specs);
    }

    // Lighter rise for the quick standalone wave() — starts directly
    // from the hip rest (no anticipation lead-in) but keeps the same
    // elbow-leads-shoulder cascade, just compressed. Arm-only, no
    // head/torso choreography.
    _riseToWelcomeQuick(duration) {
      return this._run([
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_HIP_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0.7 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(0deg)", offset: 0.25 },
            { transform: "rotate(-9deg)", offset: 0.75 },
            { transform: "rotate(-3deg)", offset: 0.92 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(0deg) scale(1)", offset: 0 },
            { transform: "rotate(0deg) scale(1)", offset: 0.3 },
            { transform: "rotate(4deg) scale(1.04)", offset: 0.85 },
            { transform: "rotate(3deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
      ]);
    }

    // A brief "arrival" beat right after the rise finishes and before
    // the wave starts — a small net-zero blip (bump and return) on the
    // hand/wrist, distinguishing "just arrived" from "now waving"
    // without changing the values _waveCycles2() starts from.
    _settleAtWelcome(duration) {
      return this._run([
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(3deg) scale(1.02)", offset: 0 },
            { transform: "rotate(3deg) scale(1.05)", offset: 0.5 },
            { transform: "rotate(3deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-2deg)", offset: 0.5 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-in-out", fill: "forwards" },
        },
      ]);
    }

    // THE WAVE. Shoulder/elbow barely move (well under 1deg — "mostly
    // stable" per the brief); the wrist carries the wave itself, two
    // small left-center-right-center cycles at 5-10deg (jittered per
    // cycle via `variation.waveAmp`, and the two cycles use slightly
    // different amplitude from each other so they don't read as an
    // exact repeat), with the hand/fingers doing a small synchronized
    // open/close flex. Includes a tiny head tilt if includeHeadBody.
    _waveCycles2(duration, includeHeadBody, variation) {
      const amp = variation.waveAmp;
      const amp2 = Math.max(5, amp - 2);
      const specs = [
        {
          key: "rightArm",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder - 0.8}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.shoulder}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow + 1}deg)`, offset: 0.5 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: `rotate(${-amp}deg)`, offset: 0.14 },
            { transform: "rotate(0deg)", offset: 0.3 },
            { transform: `rotate(${amp}deg)`, offset: 0.42 },
            { transform: "rotate(0deg)", offset: 0.58 },
            { transform: `rotate(${-amp2}deg)`, offset: 0.72 },
            { transform: "rotate(0deg)", offset: 0.86 },
            { transform: `rotate(${amp2}deg)`, offset: 0.95 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(3deg) scale(1.02)", offset: 0 },
            { transform: "rotate(1deg) scale(1.05)", offset: 0.14 },
            { transform: "rotate(3deg) scale(1.02)", offset: 0.3 },
            { transform: "rotate(5deg) scale(1.05)", offset: 0.42 },
            { transform: "rotate(3deg) scale(1.02)", offset: 0.58 },
            { transform: "rotate(1deg) scale(1.05)", offset: 0.72 },
            { transform: "rotate(3deg) scale(1.02)", offset: 0.86 },
            { transform: "rotate(4deg) scale(1.04)", offset: 0.95 },
            { transform: "rotate(3deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        },
      ];
      if (includeHeadBody) {
        specs.push({
          key: "head",
          keyframes: [
            { transform: `rotate(${variation.headTarget}deg)`, offset: 0 },
            { transform: `rotate(${variation.headTarget + 1.5}deg)`, offset: 0.5 },
            { transform: `rotate(${variation.headTarget}deg)`, offset: 1 },
          ],
          options: { duration, easing: WAVE_EASE, fill: "forwards" },
        });
      }
      return this._run(specs);
    }

    // FOLLOW-THROUGH: the hand doesn't stop dead the instant the wave
    // ends — it continues a couple degrees, the wrist and elbow settle
    // a beat behind it, then everything eases back to exactly the
    // wave's own resting values (a net-zero blip, like
    // _settleAtWelcome) — mechanical inertia, not a value change
    // _lowerToHip() needs to know about.
    _followThrough(duration) {
      return this._run([
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(3deg) scale(1.02)", offset: 0 },
            { transform: "rotate(1deg) scale(1.06)", offset: 0.4 },
            { transform: "rotate(3deg) scale(1.02)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightWrist",
          keyframes: [
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(-3deg)", offset: 0.4 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 0 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow - 1.5}deg)`, offset: 0.4 },
            { transform: `rotate(${RIGHT_WELCOME_BASE.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: "ease-out", fill: "forwards" },
        },
      ]);
    }

    // THE RETURN. Reverse cascade: wrist/hand snap back to neutral
    // within roughly the first third of this phase's own duration,
    // while the shoulder/elbow — on IDENTICAL offsets, see the file
    // header for why this direction stays lockstep — take the FULL
    // duration to ease back down to the hip rest. The hand visibly
    // settles well before the shoulder finishes lowering. Head/face/
    // body un-tilt back to neutral in step with the arm lowering.
    _lowerToHip(duration, includeHeadBody, variation) {
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
            { transform: "rotate(0deg)", offset: 0 },
            { transform: "rotate(3deg)", offset: 0.18 },
            { transform: "rotate(0deg)", offset: 0.35 },
            { transform: "rotate(0deg)", offset: 1 },
          ],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightHand",
          keyframes: [
            { transform: "rotate(3deg) scale(1.02)", offset: 0 },
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
              { transform: `rotate(${variation.headTarget}deg)`, offset: 0 },
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
              { transform: "translate(-2.5px, -2.5px)", offset: 0 },
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

    // One repeating cycle of the welcome ceremony: relax-hold ->
    // anticipation -> (pause) -> rise -> settle -> 2 waves ->
    // follow-through -> return to the waist. See the PHASES section
    // above for what each step does. A handful of small values
    // (head-turn amplitude, wave amplitude) are re-rolled within a
    // narrow, pre-verified-safe range each call so consecutive cycles
    // aren't identical. Resolves `true` if it played all the way
    // through, `false` if a newer gesture call interrupted it partway —
    // startWelcomeLoop() below uses that to know whether it's still
    // safe to keep looping.
    async welcome() {
      const keys = ["head", "face", "body", "rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);

      const variation = {
        headStart: jitter(4, 1),
        headTarget: jitter(7, 1.5),
        waveAmp: jitter(8, 2),
      };

      await this._relaxHold(this._welcomeRelaxMs || 850);
      if (gen !== this._gestureGen) return false;

      this.setExpression("happy");
      await this._anticipate(260, variation);
      if (gen !== this._gestureGen) return false;

      await sleep(150); // hold at the coiled position — see ANTICIPATION in the file header
      if (gen !== this._gestureGen) return false;

      await Promise.all([this._riseToWelcome(950, true, variation), this._run(this._handSpecs("right", "rest", "open", 450))]);
      if (gen !== this._gestureGen) return false;

      await this._settleAtWelcome(260);
      if (gen !== this._gestureGen) return false;

      await this._waveCycles2(1000, true, variation);
      if (gen !== this._gestureGen) return false;

      await this._followThrough(260);
      if (gen !== this._gestureGen) return false;

      await Promise.all([this._lowerToHip(950, true, variation), this._run(this._handSpecs("right", "open", "rest", 400))]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // Backward-compatible alias — existing call sites (e.g. index.html's
    // page-load trigger) call robot.greet(). Plays ONE cycle; use
    // startWelcomeLoop() (below) for the continuously-repeating version.
    greet() {
      return this.welcome();
    }

    // Runs welcome() on a loop, forever, until stopWelcomeLoop() is
    // called. Plays the one-time _noticeAndSettle() intro first (the
    // robot "noticing" the user and settling its hands at the waist),
    // then repeats welcome()'s own relax-hold -> anticipate -> rise ->
    // wave -> return cycle — welcome()'s leading _relaxHold() phase IS
    // the "pause at the waist" between greetings, so no extra dead
    // sleep() is layered on top of it. Every cycle starts from wherever
    // the arm actually is (idle's hip rest — welcome() always ends
    // there), so looping never resets/teleports anything; it's "greet
    // again", not "restart the whole animation from frame 0". If some
    // OTHER gesture (think()/success()/attention()/a manual wave())
    // interrupts a cycle mid-flight, welcome() reports that back and
    // the loop stops itself rather than fighting for control — call
    // startWelcomeLoop() again afterward to resume it.
    async startWelcomeLoop(relaxHoldMs) {
      // Each call starts a fresh loop and an older one exits at its next
      // checkpoint — so calling this right after another gesture (which
      // already interrupted the old loop, possibly mid-pause) can never
      // leave the robot with no loop at all.
      const id = (this._loopId = (this._loopId || 0) + 1);
      const current = () => this._welcomeLoopActive && id === this._loopId;
      this._welcomeLoopActive = true;
      this._welcomeRelaxMs = typeof relaxHoldMs === "number" ? relaxHoldMs : 850;

      if (!this._walkedIn && !REDUCED_MOTION) {
        this._walkedIn = true;
        await this.walkIn();
        if (!current()) return;
      }

      this._expressFor("wow", 600); // "oh, hello!" as it notices the user
      await this._noticeAndSettle();
      if (!current()) return;

      while (current()) {
        const completed = await this.welcome();
        if (!completed || !current()) break;
        const rested = await this._interlude(current);
        if (!rested || !current()) break;
      }
      if (id === this._loopId) this._welcomeLoopActive = false;
    }

    // Between greetings: rest a few seconds (blinking, glancing), and
    // now and then do something else — point at the chat button, a
    // thumbs-up, a shrug, a weight shift, a foot tap, or (rarely) a
    // little celebration — so the
    // loop never feels like the same clip on repeat. Resolves false if
    // another gesture or loop took over meanwhile.
    async _interlude(current) {
      const gen = this._gestureGen;
      await sleep(jitter(4500, 1500));
      if (gen !== this._gestureGen || !current()) return false;
      const roll = Math.random();
      const pick =
        roll < 0.2 ? "pointAtChat" :
        roll < 0.35 ? "thumbsUp" :
        roll < 0.47 ? "shrug" :
        roll < 0.6 ? "shiftWeight" :
        roll < 0.7 ? "tapFoot" :
        roll < 0.77 ? "celebrate" : null;
      if (!pick) return true;
      const done = await this[pick]();
      if (!done || !current()) return false;
      const gen2 = this._gestureGen;
      await sleep(jitter(3500, 1000));
      return gen2 === this._gestureGen && current();
    }

    // Stops startWelcomeLoop() after the in-flight welcome() finishes
    // its current cycle (it does not abort mid-gesture) — the loop
    // checks this flag at each of its own checkpoints, never mid-limb.
    stopWelcomeLoop() {
      this._welcomeLoopActive = false;
    }

    // A quicker, lighter acknowledgment wave — the same elbow-leads
    // rise and reverse-cascade return as welcome(), just faster and
    // arm-only (no head/torso choreography, no anticipation lead-in),
    // so it reads as a quick "hi" rather than the full welcome
    // ceremony. Reusable standalone (e.g. "user opens a feature").
    // Resolves `true`/`false` the same way welcome() does.
    async wave() {
      const keys = ["rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);
      this.setExpression("happy");

      await Promise.all([this._riseToWelcomeQuick(750), this._run(this._handSpecs("right", "rest", "open", 350))]);
      if (gen !== this._gestureGen) return false;

      await this._waveCycles2(650, false, { waveAmp: 8 });
      if (gen !== this._gestureGen) return false;

      await sleep(120);
      if (gen !== this._gestureGen) return false;

      await Promise.all([this._lowerToHip(700, false, {}), this._run(this._handSpecs("right", "open", "rest", 300))]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // ============ LEGS ============
    // Keyframes for one leg through a list of poses
    // { offset, t, s, a, easing }: t / s foreshorten the thigh / shin
    // (a knee coming toward the viewer), a tilts the boot. The part below
    // each foreshortened segment moves up by exactly what it lost, so the
    // leg never comes apart.
    _legSpecs(side, frames, duration) {
      const parts = {
        Thigh: (f) => `scaleY(${f.t ?? 1})`,
        Lower: (f) => `translateY(${-THIGH_LEN * (1 - (f.t ?? 1))}px)`,
        Shin: (f) => `scaleY(${f.s ?? 1})`,
        Ankle: (f) => `translateY(${-SHIN_LEN * (1 - (f.s ?? 1))}px) rotate(${f.a ?? 0}deg)`,
      };
      return Object.keys(parts).map((part) => ({
        key: side + part,
        keyframes: frames.map((f) => ({ transform: parts[part](f), offset: f.offset, easing: f.easing || "ease-in-out" })),
        options: { duration, easing: "linear", fill: "forwards" },
      }));
    }

    // Shift the weight onto the right leg: the left knee softens and the
    // body leans over, a few seconds, then back.
    shiftWeight() {
      const dur = 3200;
      const bent = { t: 0.97, s: 0.95 };
      const drop = legRise(bent) / 2;
      return this._playGesture(["body"], [
        ...this._legSpecs("left", [
          { offset: 0 },
          { offset: 0.2, ...bent },
          { offset: 0.8, ...bent },
          { offset: 1 },
        ], dur),
        {
          key: "body",
          keyframes: [
            { transform: "translate(0px, 0px) rotate(0deg)", offset: 0 },
            { transform: `translate(5px, ${drop}px) rotate(-1.5deg)`, offset: 0.2 },
            { transform: `translate(5px, ${drop}px) rotate(-1.5deg)`, offset: 0.8 },
            { transform: "translate(0px, 0px) rotate(0deg)", offset: 1 },
          ],
          options: { duration: dur, easing: GESTURE_EASE, fill: "forwards" },
        },
      ]);
    }

    // Three quick taps of the right foot — impatient / waiting.
    _footTapSpecs(duration) {
      const up = { s: 0.86, a: -8 };
      return this._legSpecs("right", [
        { offset: 0 },
        { offset: 0.12, ...up }, { offset: 0.25 },
        { offset: 0.37, ...up }, { offset: 0.5 },
        { offset: 0.62, ...up }, { offset: 0.75 },
        { offset: 1 },
      ], duration);
    }

    tapFoot() {
      this._expressFor("think", 1600);
      return this._playGesture([], this._footTapSpecs(1500));
    }

    // Entrance, once per page: the robot walks in from the right, fading
    // in, four alternating steps with a little bob on each.
    walkIn() {
      const dur = 1800;
      const offsets = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
      const xAt = (o) => 110 * Math.pow(1 - o, 1.2);
      const lift = { t: 0.95, s: 0.8 };
      const legFrames = (liftAt) => offsets.map((o) => (liftAt.indexOf(o) !== -1 ? { offset: o, ...lift } : { offset: o }));
      return this._playGesture(["body", "shadowEllipse"], [
        ...this._legSpecs("left", legFrames([0.125, 0.625]), dur),
        ...this._legSpecs("right", legFrames([0.375, 0.875]), dur),
        {
          key: "body",
          keyframes: offsets.map((o, i) => ({
            transform: `translate(${xAt(o)}px, ${i % 2 ? -4 : 0}px)`,
            opacity: Math.min(1, o * 4),
            offset: o,
          })),
          options: { duration: dur, easing: "linear", fill: "forwards" },
        },
        {
          key: "shadowEllipse",
          keyframes: offsets.map((o) => ({ transform: `translateX(${xAt(o)}px)`, opacity: 0.3 * Math.min(1, o * 4), offset: o })),
          options: { duration: dur, easing: "linear", fill: "forwards" },
        },
      ]);
    }

    // ============ HANDS ============
    // Finger animation specs taking one hand from one HAND_POSES pose to
    // another (fingers have no idle loop, so a gesture simply ends them
    // on "rest").
    _handSpecs(side, from, to, duration) {
      const keys = side === "right"
        ? ["rightFinger1", "rightFinger2", "rightFinger3", "rightThumb"]
        : ["leftFinger1", "leftFinger2", "leftFinger3", "leftThumb"];
      const pose = (name, i) => (side === "right" ? HAND_POSES[name][i] : mirrorPose(HAND_POSES[name][i]));
      return keys.map((key, i) => ({
        key,
        keyframes: [{ transform: pose(from, i), offset: 0 }, { transform: pose(to, i), offset: 1 }],
        // a little stagger, so the fingers don't move as one block
        options: { duration, delay: i * 25, easing: GESTURE_EASE, fill: "forwards" },
      }));
    }

    // Left arm hip rest <-> LEFT_CHEER, for celebrate().
    _leftArmSpecs(raise, duration) {
      const a = raise ? LEFT_HIP_BASE : LEFT_CHEER;
      const b = raise ? LEFT_CHEER : LEFT_HIP_BASE;
      return [
        {
          key: "leftArm",
          keyframes: [{ transform: `rotate(${a.shoulder}deg)` }, { transform: `rotate(${b.shoulder}deg)` }],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "leftElbow",
          keyframes: [
            { transform: `rotate(${a.elbow}deg)`, offset: 0 },
            { transform: `rotate(${b.elbow}deg)`, offset: raise ? 0.7 : 0.85 },
            { transform: `rotate(${b.elbow}deg)`, offset: 1 },
          ],
          options: { duration, easing: raise ? "ease-out" : GESTURE_EASE, fill: "forwards" },
        },
      ];
    }

    // Right shoulder + elbow from one { shoulder, elbow } pose to another.
    _rightArmSpecs(from, to, duration) {
      return [
        {
          key: "rightArm",
          keyframes: [{ transform: `rotate(${from.shoulder}deg)` }, { transform: `rotate(${to.shoulder}deg)` }],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
        {
          key: "rightElbow",
          keyframes: [{ transform: `rotate(${from.elbow}deg)` }, { transform: `rotate(${to.elbow}deg)` }],
          options: { duration, easing: GESTURE_EASE, fill: "forwards" },
        },
      ];
    }

    // 👍 — forearm comes up level, the hand closes with the thumb
    // pointing up, two small pumps from the elbow, then back to the hip.
    async thumbsUp() {
      const keys = ["rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);
      this.setExpression("happy");

      await this._run([...this._rightArmSpecs(RIGHT_HIP_BASE, RIGHT_THUMB, 600), ...this._handSpecs("right", "rest", "thumb", 300)]);
      if (gen !== this._gestureGen) return false;
      this.setExpression("joy");

      await this._run([{
        key: "rightElbow",
        keyframes: [
          { transform: `rotate(${RIGHT_THUMB.elbow}deg)` },
          { transform: `rotate(${RIGHT_THUMB.elbow - 10}deg)`, offset: 0.3 },
          { transform: `rotate(${RIGHT_THUMB.elbow}deg)`, offset: 0.55 },
          { transform: `rotate(${RIGHT_THUMB.elbow - 7}deg)`, offset: 0.8 },
          { transform: `rotate(${RIGHT_THUMB.elbow}deg)` },
        ],
        options: { duration: 700, easing: "ease-in-out", fill: "forwards" },
      }]);
      if (gen !== this._gestureGen) return false;

      await sleep(350);
      if (gen !== this._gestureGen) return false;

      await this._run([...this._rightArmSpecs(RIGHT_THUMB, RIGHT_HIP_BASE, 650), ...this._handSpecs("right", "thumb", "rest", 300)]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // 🙌 — right hand up high with fingers spread, left fist pumped up
    // beside the shoulder, a little jump, back down.
    async celebrate() {
      const keys = ["body", "shadowEllipse", "rightArm", "rightElbow", "rightWrist", "rightHand", "leftArm", "leftElbow", "leftWrist", "leftHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);
      this.setExpression("joy");

      await Promise.all([
        this._riseToWelcomeQuick(600),
        this._run([...this._leftArmSpecs(true, 600), ...this._handSpecs("right", "rest", "open", 300), ...this._handSpecs("left", "rest", "fist", 300)]),
      ]);
      if (gen !== this._gestureGen) return false;

      // crouch, spring up (legs tucked a little in the air), land with a
      // squash, settle. Body height keeps the feet on the ground except
      // in the air.
      const jump = 1100;
      const crouch = { t: 0.88, s: 0.92 };
      const land = { t: 0.9, s: 0.93 };
      const tuck = { t: 0.97, s: 0.95, a: 4 };
      const legs = [
        { offset: 0 },
        { offset: 0.18, ...crouch, easing: "ease-out" },
        { offset: 0.38, easing: "ease-out" },
        { offset: 0.5, ...tuck },
        { offset: 0.66, easing: "ease-in" },
        { offset: 0.76, ...land, easing: "ease-out" },
        { offset: 0.9 },
        { offset: 1 },
      ];
      await this._run([
        ...this._legSpecs("left", legs, jump),
        ...this._legSpecs("right", legs.map((f) => (f.a ? { ...f, a: -f.a } : f)), jump),
        {
          key: "body",
          keyframes: [
            { transform: "translateY(0px)", offset: 0 },
            { transform: `translateY(${legRise(crouch)}px)`, offset: 0.18, easing: "ease-out" },
            { transform: "translateY(-10px)", offset: 0.38, easing: "ease-out" },
            { transform: "translateY(-24px)", offset: 0.5, easing: "ease-in" },
            { transform: "translateY(-6px)", offset: 0.66, easing: "ease-in" },
            { transform: `translateY(${legRise(land)}px)`, offset: 0.76, easing: "ease-out" },
            { transform: "translateY(-3px)", offset: 0.9 },
            { transform: "translateY(0px)", offset: 1 },
          ],
          options: { duration: jump, easing: "linear", fill: "forwards" },
        },
        {
          key: "shadowEllipse",
          keyframes: [
            { transform: "scale(1)", opacity: 0.3, offset: 0 },
            { transform: "scale(1.05)", opacity: 0.34, offset: 0.18 },
            { transform: "scale(0.72)", opacity: 0.14, offset: 0.5 },
            { transform: "scale(1.06)", opacity: 0.34, offset: 0.76 },
            { transform: "scale(1)", opacity: 0.3, offset: 1 },
          ],
          options: { duration: jump, easing: "ease-in-out", fill: "forwards" },
        },
        ...["rightWrist", "leftWrist"].map((key, i) => ({
          key,
          keyframes: [
            { transform: "rotate(0deg)" },
            { transform: `rotate(${i ? 9 : -9}deg)`, offset: 0.45 },
            { transform: `rotate(${i ? -6 : 6}deg)`, offset: 0.75 },
            { transform: "rotate(0deg)" },
          ],
          options: { duration: jump, easing: "ease-in-out", fill: "forwards" },
        })),
      ]);
      if (gen !== this._gestureGen) return false;

      await Promise.all([
        this._lowerToHip(750, false, {}),
        this._run([...this._leftArmSpecs(false, 750), ...this._handSpecs("right", "open", "rest", 300), ...this._handSpecs("left", "fist", "rest", 300)]),
      ]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // 👉 — the right arm points straight out to the side (where the chat
    // button sits on Home) with the eyes looking the same way, two small
    // pokes, then back to the hip.
    async pointAtChat() {
      const keys = ["rightArm", "rightElbow", "rightWrist", "rightHand"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);
      this.setExpression("happy");
      this._lookTo({ x: 4.5, y: 0 }, 300);

      const out = (from, to, duration) => this._rightArmSpecs(from, to, duration);

      await this._run([...out(RIGHT_HIP_BASE, RIGHT_POINT, 650), ...this._handSpecs("right", "rest", "point", 300)]);
      if (gen !== this._gestureGen) return false;

      await this._run([{
        key: "rightWrist",
        keyframes: [
          { transform: "rotate(0deg)" },
          { transform: "rotate(-7deg)", offset: 0.25 },
          { transform: "rotate(0deg)", offset: 0.5 },
          { transform: "rotate(-7deg)", offset: 0.75 },
          { transform: "rotate(0deg)" },
        ],
        options: { duration: 800, easing: "ease-in-out", fill: "forwards" },
      }]);
      if (gen !== this._gestureGen) return false;

      await sleep(500);
      if (gen !== this._gestureGen) return false;

      this._lookTo({ x: 0, y: 0 }, 300);
      await this._run([...out(RIGHT_POINT, RIGHT_HIP_BASE, 700), ...this._handSpecs("right", "point", "rest", 300)]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // 🤷 — forearms out to the sides, palms open, head tilted, a
    // puzzled face, then back.
    async shrug() {
      const keys = ["head", "body", "rightArm", "rightElbow", "leftArm", "leftElbow"];
      this._cancelGesture();
      const gen = this._gestureGen;
      this._pauseIdle(keys);
      this.setExpression("think");

      const arms = (r0, r1, l0, l1, duration) => [
        ["rightArm", r0.shoulder, r1.shoulder], ["rightElbow", r0.elbow, r1.elbow],
        ["leftArm", l0.shoulder, l1.shoulder], ["leftElbow", l0.elbow, l1.elbow],
      ].map(([key, a, b]) => ({
        key,
        keyframes: [{ transform: `rotate(${a}deg)` }, { transform: `rotate(${b}deg)` }],
        options: { duration, easing: GESTURE_EASE, fill: "forwards" },
      }));
      const tilt = (a, b, duration) => [
        { key: "head", keyframes: [{ transform: `rotate(${a}deg)` }, { transform: `rotate(${b}deg)` }], options: { duration, easing: GESTURE_EASE, fill: "forwards" } },
        { key: "body", keyframes: [{ transform: `translateY(${a ? -4 : 0}px)` }, { transform: `translateY(${b ? -4 : 0}px)` }], options: { duration, easing: GESTURE_EASE, fill: "forwards" } },
      ];

      await this._run([
        ...arms(RIGHT_HIP_BASE, RIGHT_SHRUG, LEFT_HIP_BASE, LEFT_SHRUG, 500),
        ...tilt(0, 8, 500),
        ...this._handSpecs("right", "rest", "open", 300),
        ...this._handSpecs("left", "rest", "open", 300),
      ]);
      if (gen !== this._gestureGen) return false;

      await sleep(800);
      if (gen !== this._gestureGen) return false;

      await this._run([
        ...arms(RIGHT_SHRUG, RIGHT_HIP_BASE, LEFT_SHRUG, LEFT_HIP_BASE, 550),
        ...tilt(8, 0, 550),
        ...this._handSpecs("right", "open", "rest", 300),
        ...this._handSpecs("left", "open", "rest", 300),
      ]);
      if (gen !== this._gestureGen) return false;

      this.setExpression("neutral");
      this._finishGesture(keys);
      return true;
    }

    // A small head-tilt "considering" gesture with a subtle hand
    // fidget on the resting (left) arm — deliberately doesn't raise a
    // hand to the chin, which would need new geometry/clipping
    // verification; the tilt alone reads clearly as "thinking".
    think() {
      const dur = 2000;
      this._expressFor("think", dur);
      return this._playGesture(["head", "leftArm", "leftHand"], [
        ...this._footTapSpecs(dur),
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
      this._expressFor("joy", 1400);
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
      this._expressFor("wow", 1000);
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
      for (const k in this._faceTimers) clearTimeout(this._faceTimers[k]);
      for (const a of this._lightAnims || []) a.cancel();
      this._lightAnims = [];
      this.setExpression("neutral");
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
  global.robotThumbsUp = function () {
    return global.cmProRobot && global.cmProRobot.thumbsUp();
  };
  global.robotShiftWeight = function () {
    return global.cmProRobot && global.cmProRobot.shiftWeight();
  };
  global.robotTapFoot = function () {
    return global.cmProRobot && global.cmProRobot.tapFoot();
  };
  global.robotCelebrate = function () {
    return global.cmProRobot && global.cmProRobot.celebrate();
  };
  global.robotAttention = function () {
    return global.cmProRobot && global.cmProRobot.attention();
  };
})(window);
