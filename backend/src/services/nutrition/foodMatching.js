/**
 * Match free-text food names to library entries.
 */

function normalizeToken(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/^\d+(?:\.\d+)?\s*(?:x|×)?\s*/, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singularize(word) {
  const w = String(word || '')
  if (w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2)
  if (w.endsWith('s') && w.length > 3) return w.slice(0, -1)
  return w
}

function findLibraryFoodByName(library, rawName) {
  const query = normalizeToken(rawName)
  if (!query) return null

  const queryWords = query.split(' ').filter(Boolean).map(singularize)
  let best = null
  let bestScore = 0

  for (const food of library || []) {
    const fname = normalizeToken(food.name)
    const baseName = singularize(fname.split(' ')[0] || fname)
    const queryBase = queryWords[0] || query

    if (fname === query) {
      return food
    }
    if (fname.includes(query) || query.includes(fname)) {
      const score = query.length / fname.length + 0.5
      if (score > bestScore) {
        bestScore = score
        best = food
      }
      continue
    }
    if (baseName && (baseName === queryBase || fname.includes(queryBase) || queryBase.includes(baseName))) {
      const score = 0.8 + queryBase.length / Math.max(fname.length, 1)
      if (score > bestScore) {
        bestScore = score
        best = food
      }
      continue
    }

    const hits = queryWords.filter((w) => w.length > 2 && fname.includes(w)).length
    if (hits > bestScore) {
      bestScore = hits
      best = food
    }
  }

  return bestScore > 0 ? best : null
}

module.exports = {
  normalizeToken,
  findLibraryFoodByName,
}
