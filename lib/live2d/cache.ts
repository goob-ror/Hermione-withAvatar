/**
 * Live2D Model Cache - IndexedDB-based caching for faster loads
 */

const DB_NAME = 'hermione-live2d'
const STORE_NAME = 'models'
const DB_VERSION = 1

interface CachedModel {
  key: string
  modelJson: any
  textures: Record<string, Blob>
  timestamp: number
  version: string
}

let db: IDBDatabase | null = null

async function initDB(): Promise<IDBDatabase> {
  if (db) return db

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      db = req.result
      resolve(db)
    }

    req.onupgradeneeded = (e) => {
      const idb = (e.target as IDBOpenDBRequest).result
      if (!idb.objectStoreNames.contains(STORE_NAME)) {
        idb.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })
}

export async function getCachedModel(modelPath: string): Promise<CachedModel | null> {
  try {
    const idb = await initDB()
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.get(modelPath)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve(req.result || null)
    })
  } catch (err) {
    console.warn('Live2D cache read failed:', err)
    return null
  }
}

export async function cacheModel(
  modelPath: string,
  modelJson: any,
  textures: Record<string, Blob>,
  version: string = '1.0'
): Promise<void> {
  try {
    const idb = await initDB()
    const cached: CachedModel = {
      key: modelPath,
      modelJson,
      textures,
      timestamp: Date.now(),
      version,
    }

    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.put(cached)

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch (err) {
    console.warn('Live2D cache write failed:', err)
  }
}

export async function clearModelCache(): Promise<void> {
  try {
    const idb = await initDB()
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const req = store.clear()

      req.onerror = () => reject(req.error)
      req.onsuccess = () => resolve()
    })
  } catch (err) {
    console.warn('Live2D cache clear failed:', err)
  }
}

export async function getModelSize(): Promise<number> {
  try {
    const idb = await initDB()
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()

      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const models = req.result as CachedModel[]
        const size = models.reduce((sum, m) => {
          const textureSize = Object.values(m.textures).reduce((s, b) => s + b.size, 0)
          const jsonSize = JSON.stringify(m.modelJson).length
          return sum + textureSize + jsonSize
        }, 0)
        resolve(size)
      }
    })
  } catch (err) {
    console.warn('Live2D cache size check failed:', err)
    return 0
  }
}

/**
 * Preload Live2D model and assets into cache
 */
export async function preloadModel(modelPath: string): Promise<void> {
  try {
    // Check if already cached
    const cached = await getCachedModel(modelPath)
    if (cached) {
      console.log(`Live2D model ${modelPath} already cached`)
      return
    }

    console.log(`Preloading Live2D model: ${modelPath}`)

    // Fetch model JSON
    const modelRes = await fetch(modelPath)
    if (!modelRes.ok) throw new Error(`Failed to fetch model: ${modelRes.statusText}`)
    const modelJson = await modelRes.json()

    // Fetch textures referenced in the model
    const textures: Record<string, Blob> = {}
    const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'))

    if (modelJson.FileReferences?.Textures) {
      for (const texturePath of modelJson.FileReferences.Textures) {
        const fullPath = `${modelDir}/${texturePath}`
        try {
          const texRes = await fetch(fullPath)
          if (texRes.ok) {
            textures[texturePath] = await texRes.blob()
          }
        } catch (err) {
          console.warn(`Failed to preload texture: ${texturePath}`, err)
        }
      }
    }

    // Cache everything
    await cacheModel(modelPath, modelJson, textures)
    console.log(`Live2D model cached: ${modelPath} (${Object.keys(textures).length} textures)`)
  } catch (err) {
    console.warn('Failed to preload Live2D model:', err)
  }
}

/**
 * Load model from cache or network
 */
export async function loadModelWithCache(modelPath: string): Promise<any> {
  // Try cache first
  const cached = await getCachedModel(modelPath)
  if (cached) {
    console.log(`Loading Live2D from cache: ${modelPath}`)
    return cached.modelJson
  }

  // Fall back to network
  console.log(`Loading Live2D from network: ${modelPath}`)
  const res = await fetch(modelPath)
  if (!res.ok) throw new Error(`Failed to fetch model: ${res.statusText}`)
  
  const modelJson = await res.json()

  // Cache for next time (don't await to avoid blocking)
  const modelDir = modelPath.substring(0, modelPath.lastIndexOf('/'))
  const textures: Record<string, Blob> = {}

  if (modelJson.FileReferences?.Textures) {
    for (const texturePath of modelJson.FileReferences.Textures) {
      const fullPath = `${modelDir}/${texturePath}`
      try {
        const texRes = await fetch(fullPath)
        if (texRes.ok) {
          textures[texturePath] = await texRes.blob()
        }
      } catch (err) {
        // Silently skip failed textures
      }
    }
  }

  cacheModel(modelPath, modelJson, textures).catch(err =>
    console.warn('Failed to cache Live2D model:', err)
  )

  return modelJson
}
