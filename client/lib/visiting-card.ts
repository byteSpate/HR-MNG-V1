/**
 * The visiting card picture: what may be chosen, checked in the browser before
 * anything is sent. The server checks the same two things again and is the one
 * that decides; this only saves a wasted upload and gives the answer at once.
 * Keep the formats and the size in step with AVATAR_LIMITS on the server.
 */

export const CARD_MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = ["jpg", "jpeg", "png", "webp"]

/** For the file picker's `accept`, so the dialog already hides other files. */
export const CARD_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"

/** "2 KB", "1.5 MB": whole numbers stay whole. */
export function formatBytes(bytes: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${trim(bytes / 1024)} KB`
  return `${trim(bytes / (1024 * 1024))} MB`
}

/** A sentence saying why the file cannot be used, or null when it can. */
export function checkCardFile(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf(".")
  const extension = dot === -1 ? "" : file.name.slice(dot + 1).toLowerCase()
  if (!ALLOWED.includes(extension)) {
    return "That file is not a picture we can use. Choose a JPG, PNG or WebP image."
  }
  if (file.size === 0) return "That file is empty. Choose another picture."
  if (file.size > CARD_MAX_BYTES) {
    return `That picture is ${formatBytes(file.size)}. The most we can take is ${formatBytes(CARD_MAX_BYTES)}. Choose a smaller picture.`
  }
  return null
}
