export async function nativePick(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString()
  const url = qs ? `/api${endpoint}?${qs}` : `/api${endpoint}`
  const res = await fetch(url, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}
