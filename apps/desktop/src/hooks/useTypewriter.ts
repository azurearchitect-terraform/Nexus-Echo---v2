import { useEffect, useRef, useState } from "react";

/**
 * Smooth character-drip typewriter hook.
 *
 * Architecture: a `setInterval` loop drains up to `speed` characters per
 * tick from a pending queue. We use setInterval instead of
 * requestAnimationFrame because rAF is throttled/paused by WebView2
 * (Chromium) when the window does not have focus. Since the Nexus overlay
 * is always-on-top but almost never focused (the user is clicked into
 * Teams/Zoom), rAF would freeze and the typewriter would stop entirely
 * in production builds.
 *
 * The interval runs at ~16ms (~60fps equivalent) for smooth animation.
 * When streaming ends, the drain rate is accelerated 4x so any remaining
 * buffer flushes quickly but still visibly.
 */
export function useTypewriter(target: string, active: boolean, speed = 3): string {
  const [displayed, setDisplayed] = useState("");
  const pendingRef = useRef("");
  const prevTargetRef = useRef("");
  const activeRef = useRef(active);

  // Keep activeRef in sync so the interval loop can read it without re-mounting
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // 1. Enqueue diffs as target grows
  useEffect(() => {
    if (target === "") {
      setDisplayed("");
      pendingRef.current = "";
      prevTargetRef.current = "";
      return;
    }

    const diff = target.slice(prevTargetRef.current.length);
    prevTargetRef.current = target;
    if (diff) {
      pendingRef.current += diff;
    }
  }, [target]);

  // 2. Continuous setInterval loop to drain the queue independently of renders.
  //    setInterval keeps ticking even when the Tauri overlay window is not
  //    focused, unlike requestAnimationFrame which WebView2 throttles/pauses.
  //    When streaming ends (activeRef.current === false), drain at 4x speed.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (pendingRef.current) {
        // If streaming is over and very few chars remain, flush instantly
        // to avoid a lingering animation on tiny remnants.
        if (!activeRef.current && pendingRef.current.length <= 20) {
          const rest = pendingRef.current;
          pendingRef.current = "";
          setDisplayed((d) => d + rest);
        } else {
          // Accelerate 4x when streaming is done to drain fast but visibly
          const rate = activeRef.current ? speed : speed * 4;
          const take = pendingRef.current.slice(0, rate);
          pendingRef.current = pendingRef.current.slice(rate);
          setDisplayed((d) => d + take);
        }
      }
    }, 16); // ~60fps

    return () => clearInterval(intervalId);
  }, [speed]);

  // 3. When target resets entirely (new answer), sync displayed state.
  useEffect(() => {
    if (!active && target === "" && pendingRef.current === "") {
      setDisplayed("");
    }
  }, [active, target]);

  return displayed;
}
