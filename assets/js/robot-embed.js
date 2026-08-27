/* =========================================================
   CM_Pro ROBOT EMBED
   =========================================================
   Fetches assets/images/robot.svg and injects its markup inline into
   a container element, then wires up a CMProRobotAnimator against it.

   WHY INLINE INSTEAD OF <img>: an <img src="robot.svg"> renders the
   SVG in a completely separate, script-inaccessible document — the
   parent page's JS cannot reach any element inside it, at all, ever.
   That made a JS-triggerable API (robot.greet(), robot.wave(), ...)
   impossible. Injecting the SVG's own markup directly into the page's
   DOM (this file) keeps robot.svg as the single source of truth for
   the rig's appearance while making its elements ordinary DOM nodes
   robot-animator.js can animate.

   USAGE
     <div id="assistantRobotSlot" class="assistant-icon"></div>
     <script src="assets/js/robot-animator.js"></script>
     <script src="assets/js/robot-embed.js"></script>
     <script>
       embedCMProRobot(document.getElementById('assistantRobotSlot'), {
         src: './assets/images/robot.svg' // relative to THIS page
       }).then((robot) => {
         robot.greet();       // e.g. on page load
         // robot.wave(); robot.think(); robot.success(); robot.attention();
       });
     </script>

   The resolved animator is also stashed on window.cmProRobot (the
   first one created wins) purely as a convenience for quick manual
   triggering from the console or other scripts that don't hold a
   direct reference — prefer the returned/awaited value when you have
   it. ========================================================= */

(function (global) {
  "use strict";

  /**
   * @param {HTMLElement} container - empty element the inline <svg> replaces the contents of.
   * @param {{src?: string}} [opts] - src: path to robot.svg, relative to the current page.
   * @returns {Promise<CMProRobotAnimator|null>} resolves to the animator, or null if the
   *   fetch/parse failed (fails soft — logs a warning, does not throw, matches the rest of
   *   this feature's fail-soft posture for unsupported/unavailable environments).
   */
  async function embedCMProRobot(container, opts) {
    if (!container) {
      console.warn("[robot-embed] no container element given");
      return null;
    }
    const src = (opts && opts.src) || "./assets/images/robot.svg";

    let markup;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error("HTTP " + res.status);
      markup = await res.text();
    } catch (err) {
      console.warn("[robot-embed] failed to fetch " + src + ":", err);
      return null;
    }

    let svgEl;
    try {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      svgEl = doc.documentElement;
      if (!svgEl || svgEl.nodeName.toLowerCase() !== "svg") {
        throw new Error("fetched file is not an <svg> document");
      }
    } catch (err) {
      console.warn("[robot-embed] failed to parse " + src + " as SVG:", err);
      return null;
    }

    const imported = document.importNode(svgEl, true);
    container.textContent = "";
    container.appendChild(imported);

    if (typeof global.CMProRobotAnimator !== "function") {
      console.warn("[robot-embed] CMProRobotAnimator is not loaded — include robot-animator.js first");
      return null;
    }

    const animator = new global.CMProRobotAnimator(imported);
    if (!global.cmProRobot) global.cmProRobot = animator;
    return animator;
  }

  global.embedCMProRobot = embedCMProRobot;
})(window);
