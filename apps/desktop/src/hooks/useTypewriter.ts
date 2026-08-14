import { useEffect, useRef, useState } from "react";

/**
 * Smooth character-drip typewriter hook.
 *
 * Architecture: a `requestAnimationFrame` loop drains up to `speed`
 * characters per frame from a pending queue.  This avoids the jittery
 * `setTimeout` approach and gives a buttery-smooth appearance even when
 * tokens arrive in large bursts (which Gemini tends to do).
 *
 * Production-build fix: when streaming ends, instead of flushing all text
 * instantly, we accelerate the drain (4x speed) so the typewriter effect
 * remains visible even for cached or very fast responses.
 */
export function useTypewriter(target: string, active: boolean, speed = 3): string {
  const [displayed, setDisplayed] = useState("");
  const pendingRef = useRef("");
  const prevTargetRef = useRef("");
  const activeRef = useRef(active);

  // Keep activeRef in sync so the rAF loop can read it without re-mounting
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

  // 2. Continuous rAF loop to drain the queue independently of renders
  //    When streaming ends (activeRef.current === false), drain at 4x speed
  //    to preserve the typewriter effect in production builds instead of
  //    flushing everything instantly.
  useEffect(() => {
    let rafId: number;

    const tick = () => {
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
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [speed]);

  // 3. When target resets entirely (new answer), sync displayed state.
  //    We no longer force-flush here — the rAF loop handles draining.
  useEffect(() => {
    if (!active && target === "" && pendingRef.current === "") {
      setDisplayed("");
    }
  }, [active, target]);

  return displayed;
}
