import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * useState that mirrors into localStorage.
 * Survives tab changes (component unmount) and full page reloads.
 *
 * @param {string} key  unique storage key, e.g. "pmvforge:generate"
 * @param {*} initial   default value when nothing stored
 * @param {object} [opts]
 * @param {number} [opts.debounceMs=200]  write delay
 * @param {function} [opts.serialize]     custom JSON stringify
 * @param {function} [opts.deserialize]   custom JSON parse + migration
 */
export function usePersistentState(key, initial, opts = {}) {
  const { debounceMs = 200, serialize, deserialize } = opts
  const initRef = useRef(initial)

  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null || raw === '') return initRef.current
      const parsed = deserialize ? deserialize(raw) : JSON.parse(raw)
      if (parsed == null) return initRef.current
      // merge with defaults so new fields appear after app updates
      if (
        typeof initRef.current === 'object' &&
        initRef.current !== null &&
        !Array.isArray(initRef.current) &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        return { ...initRef.current, ...parsed }
      }
      return parsed
    } catch {
      return initRef.current
    }
  })

  const timer = useRef(null)

  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try {
        const raw = serialize ? serialize(state) : JSON.stringify(state)
        localStorage.setItem(key, raw)
      } catch (e) {
        // quota / private mode — ignore
        console.warn('[persist]', key, e)
      }
    }, debounceMs)
    return () => clearTimeout(timer.current)
  }, [key, state, debounceMs, serialize])

  const reset = useCallback(() => {
    setState(initRef.current)
    try {
      localStorage.removeItem(key)
    } catch {}
  }, [key])

  return [state, setState, reset]
}

/** Clear one or many PMVForge keys (e.g. from Settings). */
export function clearPersistentKeys(prefixes = ['pmvforge:']) {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && prefixes.some((p) => k.startsWith(p))) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
  return keys.length
}
