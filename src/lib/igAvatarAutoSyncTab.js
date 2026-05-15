/** One automatic Instagram avatar sync per full page load (no browser storage). */
let igAvatarAutoSyncCompleted = false

export function markIgAvatarAutoSyncCompleted() {
  igAvatarAutoSyncCompleted = true
}

export function hasIgAvatarAutoSyncCompleted() {
  return igAvatarAutoSyncCompleted
}
