/**
 * Live2D Model Preloader - runs on app startup to cache models
 */

import { preloadModel } from './cache'

export async function initLive2DPreloader(): Promise<void> {
  if (typeof window === 'undefined') return

  // Only run once
  if ((window as any).__live2dPreloadDone) return
  ;(window as any).__live2dPreloadDone = true

  // Preload the default avatar model
  const modelPath = '/live2d/haru/haru_greeter_t03.model3.json'

  // Use requestIdleCallback if available for non-blocking load
  if ('requestIdleCallback' in window) {
    ;(window as any).requestIdleCallback(
      () => {
        preloadModel(modelPath).catch(err =>
          console.warn('Live2D preload failed:', err)
        )
      },
      { timeout: 5000 }
    )
  } else {
    // Fallback: schedule after a short delay
    setTimeout(() => {
      preloadModel(modelPath).catch(err =>
        console.warn('Live2D preload failed:', err)
      )
    }, 1000)
  }
}
