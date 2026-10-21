import { useEffect, useRef, useState } from 'react'

export const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Eases a number from its previous value to `target`. Jumps straight there for reduced motion. */
export function useCountUp(target: number, duration = 850): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0))
  const current = useRef(value)
  useEffect(() => {
    const from = current.current
    const length = prefersReducedMotion() ? 0 : duration
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = length === 0 ? 1 : Math.min(1, (now - started) / length)
      const eased = 1 - Math.pow(1 - t, 3)
      current.current = from + (target - from) * eased
      setValue(current.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return value
}
