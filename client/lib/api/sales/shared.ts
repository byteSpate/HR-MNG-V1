/** Only the filters that are set, so an absent one never reaches the server as "undefined". */
export function searchOf(query: object): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || value === false) continue
    search.set(key, String(value))
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ""
}

/**
 * The name the server gave the file, so a download is called what the kept
 * copy is called. The header carries it twice: RFC 5987 first, because the
 * name has an en dash, then a plain fallback.
 */
export function fileNameFrom(headers: Headers, fallback: string): string {
  const disposition = headers.get("content-disposition") ?? ""
  const encoded = /filename*=UTF-8''([^;]+)/i.exec(disposition)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // A malformed header is not worth failing a download over.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(disposition)
  return plain ? plain[1] : fallback
}
