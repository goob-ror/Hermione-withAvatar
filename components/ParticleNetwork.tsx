'use client'

import { useEffect, useRef } from 'react'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

export function ParticleNetwork({
  className = '',
  particleColor = '#80a9c1',
  lineColor = '#80a9c1',
  particleCount = 80,
  maxDistance = 150,
  speed = 0.3,
}: {
  className?: string
  particleColor?: string
  lineColor?: string
  particleCount?: number
  maxDistance?: number
  speed?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationIdRef = useRef<number | null>(null)
  const mouseRef = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resize = () => {
      const parent = canvas.parentElement
      if (!parent) return
      canvas.width = parent.clientWidth
      canvas.height = parent.clientHeight
    }

    resize()
    window.addEventListener('resize', resize)

    // Initialize particles
    const initParticles = () => {
      particlesRef.current = []
      for (let i = 0; i < particleCount; i++) {
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * speed * 2,
          vy: (Math.random() - 0.5) * speed * 2,
        })
      }
    }

    initParticles()

    // Mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const handleMouseLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 }
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    // Animation loop
    const animate = () => {
      // Clear canvas
      ctx.fillStyle = 'transparent'
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Update particle positions
      for (const p of particlesRef.current) {
        p.x += p.vx
        p.y += p.vy

        // Bounce off edges
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1

        // Keep in bounds
        p.x = Math.max(0, Math.min(canvas.width, p.x))
        p.y = Math.max(0, Math.min(canvas.height, p.y))
      }

      // Draw connections between particles
      for (let i = 0; i < particlesRef.current.length; i++) {
        for (let j = i + 1; j < particlesRef.current.length; j++) {
          const p1 = particlesRef.current[i]
          const p2 = particlesRef.current[j]
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)

          if (dist < maxDistance) {
            const alpha = ((maxDistance - dist) / maxDistance) * 0.4
            ctx.strokeStyle = lineColor.replace(')', `, ${alpha})`)
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }

        // Connect to cursor
        const p = particlesRef.current[i]
        const cursorDist = Math.hypot(p.x - mouseRef.current.x, p.y - mouseRef.current.y)
        if (cursorDist < maxDistance * 1.5 && mouseRef.current.x > -9999) {
          const alpha = ((maxDistance * 1.5 - cursorDist) / (maxDistance * 1.5)) * 0.5
          ctx.strokeStyle = lineColor.replace(')', `, ${alpha})`)
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(mouseRef.current.x, mouseRef.current.y)
          ctx.stroke()
        }
      }

      // Draw particles
      ctx.fillStyle = particleColor
      for (const p of particlesRef.current) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }

      animationIdRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current)
      }
    }
  }, [particleColor, lineColor, particleCount, maxDistance, speed])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full h-full absolute top-0 left-0 pointer-events-auto ${className}`}
      style={{ background: 'transparent' }}
    />
  )
}
