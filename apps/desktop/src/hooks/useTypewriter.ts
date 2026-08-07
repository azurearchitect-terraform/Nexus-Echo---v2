import { useEffect, useRef, useState } from "react";

export function useTypewriter(target: string, active: boolean, speed = 3): string {
  const [displayed, setDisplayed] = useState("");
  const pendingRef = useRef("");
  const prevTargetRef = useRef("");

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
  useEffect(() => {
    let rafId: number;

    const tick = () => {
      if (pendingRef.current) {
        const take = pendingRef.current.slice(0, speed);
        pendingRef.current = pendingRef.current.slice(speed);
        setDisplayed((d) => d + take);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [speed]);

  // 3. Force flush when streaming stops
  useEffect(() => {
    if (!active && pendingRef.current) {
      setDisplayed(target);
      pendingRef.current = "";
      prevTargetRef.current = target;
    }
  }, [active, target]);

  return displayed;
}
