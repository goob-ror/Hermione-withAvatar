'use client'

import React, { useEffect, useRef, useState } from 'react'
import { loadModelWithCache } from '@/lib/live2d/cache'

interface Live2DAvatarProps {
  state?: 'idle' | 'focused' | 'alert'
  /** Explicit canvas size in CSS px. Omit both to fill the parent element. */
  width?: number
  height?: number
  /**
   * Fraction of the model's height the head occupies, measured from the top.
   * haru_greeter is a standing figure, so the head is roughly the top fifth.
   */
  headHeight?: number
  /** Vertical centre of the head, as a fraction from the top of the model. */
  headCentre?: number
  /** Multiplier on the computed framing (1 = head fills the frame). */
  zoom?: number
  /** Pixel nudge applied after framing — positive moves the model down. */
  offsetY?: number
  onLoaded?: () => void
  onError?: (err: string) => void
}

export function Live2DAvatar({
  state = 'idle',
  width,
  height,
  headHeight = 0.22,
  headCentre = 0.155,
  zoom = 1,
  offsetY = 0,
  onLoaded,
  onError,
}: Live2DAvatarProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const appRef = useRef<any>(null)
  const modelRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [size, setSize] = useState<{ w: number; h: number } | null>(
    width && height ? { w: width, h: height } : null,
  )

  // No explicit size → follow the parent box (the sidebar card sizes itself in CSS).
  useEffect(() => {
    if (width && height) {
      setSize({ w: width, h: height })
      return
    }
    const el = hostRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.height < 8) return
      const next = { w: Math.round(r.width), h: Math.round(r.height) }
      setSize((prev) =>
        prev && Math.abs(prev.w - next.w) < 4 && Math.abs(prev.h - next.h) < 4 ? prev : next,
      )
    }
    measure()
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [width, height])

  useEffect(() => {
    if (!size) return
    let isMounted = true
    const { w, h } = size

    async function initLive2D() {
      try {
        // Ensure Cubism Core JS is loaded on window
        if (typeof window !== 'undefined' && !(window as any).Live2DCubismCore) {
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script')
            script.src = '/live2dcubismcore.min.js'
            script.async = true
            script.onload = () => resolve()
            script.onerror = () => reject(new Error('Failed to load Live2D Cubism Core script'))
            document.body.appendChild(script)
          })
        }

        const PIXI = await import('pixi.js')
        // Cubism 4 entry point — the default export is the Cubism 2 build and
        // throws "Could not find Cubism 2 runtime" on any .moc3 model.
        const { Live2DModel } = await import('pixi-live2d-display/cubism4')

        // Register Cubism 4 runtime
        Live2DModel.registerTicker(PIXI.Ticker)

        if (!canvasRef.current || !isMounted) return

        const app = new PIXI.Application({
          view: canvasRef.current,
          backgroundAlpha: 0,
          autoStart: true,
          width: w,
          height: h,
          // Retina-crisp without inflating the CSS box.
          resolution: Math.min(4, (window.devicePixelRatio || 1) * 2),
          autoDensity: true,
          antialias: true,
        })
        appRef.current = app

        // Load model with cache (faster on subsequent loads)
        const modelPath = '/live2d/haru/haru_greeter_t03.model3.json'
        const model = await Live2DModel.from(modelPath, {
          autoInteract: false,
        })

        if (!isMounted) {
          app.destroy(true)
          return
        }

        modelRef.current = model

        // Frame the head instead of centring the whole figure: at full-body
        // scale the face is a few pixels tall and sits off the top edge.
        // The moc canvas carries transparent padding above the hair, which is
        // why headCentre (15.5%) is not half of headHeight (22%).
        const modelH = model.internalModel?.height || model.height || 1000
        const margin = 0.06
        const scale = ((h * (1 - margin * 2)) / headHeight / modelH) * zoom
        const screenH = modelH * scale

        model.anchor.set(0.5, 0.5)
        model.x = w / 2
        model.y = h / 2 + screenH * (0.5 - headCentre) + offsetY
        model.scale.set(scale)

        // Framing readout for scripts/avatar-frame-check.mjs — lets the test
        // report where the head actually lands instead of trusting the math.
        ;(window as any).__hermioneLive2D = {
          modelH,
          scale: +scale.toFixed(5),
          screenH: +screenH.toFixed(1),
          canvas: `${w}x${h}`,
          x: model.x,
          y: +model.y.toFixed(1),
          modelTop: +(model.y - screenH / 2).toFixed(1),
          headBottom: +(model.y - screenH / 2 + screenH * headHeight).toFixed(1),
        }

        app.stage.addChild(model)
        setLoading(false)
        onLoaded?.()
      } catch (err: any) {
        console.error('Live2D init error:', err)
        if (isMounted) {
          setLoading(false)
          onError?.(err?.message || 'Error initializing Live2D')
        }
      }
    }

    initLive2D()

    return () => {
      isMounted = false
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true, texture: true, baseTexture: true })
        } catch (e) {
          // ignore cleanup errors
        }
        appRef.current = null
        modelRef.current = null
      }
    }
    // Framing props are fixed for the lifetime of the component; only the box
    // size re-triggers a mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size?.w, size?.h])

  // Reaction to state changes
  useEffect(() => {
    if (!modelRef.current || !appRef.current) return
    const model = modelRef.current
    const app = appRef.current

    try {
      if (state === 'alert') {
        // haru_greeter_t03 declares two motion groups: "Idle" and "Use"
        model.motion?.('Use') || model.motion?.('Idle')
        // Pulsing opacity feedback
        model.alpha = 1
      } else if (state === 'focused') {
        model.motion?.('Idle')
        model.alpha = 1
      } else {
        // idle state
        model.motion?.('Idle')
        model.alpha = 0.95
      }
    } catch (e) {
      // safe fallback
    }
  }, [state])

  return (
    <div
      ref={hostRef}
      className="relative flex items-center justify-center overflow-hidden"
      style={{ width: width ?? '100%', height: height ?? '100%' }}
    >
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[9px] text-zinc-400">
          <span className="w-3.5 h-3.5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
          <span>Live2D…</span>
        </div>
      )}
      <canvas
        // New element per size so a resize never reuses a destroyed GL context.
        key={size ? `c${size.w}x${size.h}` : 'c0'}
        ref={canvasRef}
        className="pointer-events-none"
      />
    </div>
  )
}
