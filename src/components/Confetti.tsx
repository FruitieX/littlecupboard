import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'

export type Burst = { x: number; y: number; key: number; amount?: number }

const colors = [
  '#234d3b',
  '#9fc46f',
  '#f2c14e',
  '#f39b7f',
  '#e9dfcf',
  '#7fb8a4',
]

type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  spin: number
  color: string
  shape: number
  life: number
}

// A small canvas celebration. It runs entirely in requestAnimationFrame on
// one compositor layer and removes itself when the last particle fades.
export function Confetti({ burst }: { burst: Burst | null }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const particles = useRef<Particle[]>([])
  const frame = useRef(0)
  const reduced = useReducedMotion()
  useEffect(() => {
    const element = canvas.current
    if (!burst || reduced || !element) return
    const context = element.getContext('2d')
    if (!context) return
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    element.width = window.innerWidth * ratio
    element.height = window.innerHeight * ratio
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    const amount = burst.amount ?? 90
    for (let i = 0; i < amount; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
      const speed = 6 + Math.random() * 9
      particles.current.push({
        x: burst.x,
        y: burst.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        color: colors[i % colors.length],
        shape: i % 3,
        life: 1,
      })
    }
    let last = performance.now()
    cancelAnimationFrame(frame.current)
    const tick = (now: number) => {
      // Normalise to 60 fps steps so 120 Hz screens animate at the same speed.
      const step = Math.min((now - last) / 16.67, 3)
      last = now
      context.clearRect(0, 0, window.innerWidth, window.innerHeight)
      particles.current = particles.current.filter((p) => p.life > 0)
      for (const p of particles.current) {
        p.vy += 0.32 * step
        p.vx *= Math.pow(0.985, step)
        p.vy *= Math.pow(0.985, step)
        p.x += p.vx * step
        p.y += p.vy * step
        p.rotation += p.spin * step
        if (p.vy > 0) p.life -= 0.011 * step
        context.save()
        context.globalAlpha = Math.max(p.life, 0)
        context.translate(p.x, p.y)
        context.rotate(p.rotation)
        context.fillStyle = p.color
        if (p.shape === 0)
          context.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        else if (p.shape === 1) {
          context.beginPath()
          context.arc(0, 0, p.size / 2.6, 0, Math.PI * 2)
          context.fill()
        } else {
          context.beginPath()
          context.moveTo(0, -p.size / 2)
          context.lineTo(p.size / 2, p.size / 2)
          context.lineTo(-p.size / 2, p.size / 2)
          context.fill()
        }
        context.restore()
      }
      if (particles.current.length) frame.current = requestAnimationFrame(tick)
      else context.clearRect(0, 0, window.innerWidth, window.innerHeight)
    }
    frame.current = requestAnimationFrame(tick)
  }, [burst, reduced])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return <canvas ref={canvas} className="confetti-canvas" aria-hidden="true" />
}
