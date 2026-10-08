/**
 * Finds every `.findMany(` call in a source text and says whether its
 * argument block has a `take:` or a `cursor:`. It matches brackets, so a
 * call that spans many lines is read as a whole. It does not understand
 * strings, so a bracket inside a string could confuse it. It is an audit
 * aid, not a parser.
 */
export function auditFindMany(source, file) {
  const results = []
  const needle = ".findMany("
  let from = 0
  for (;;) {
    const at = source.indexOf(needle, from)
    if (at === -1) break

    const open = at + needle.length - 1
    let depth = 0
    let end = open
    for (let i = open; i < source.length; i++) {
      const ch = source[i]
      if (ch === "(") depth++
      else if (ch === ")") {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }

    const block = source.slice(open, end + 1)
    const model = /([A-Za-z0-9_]+)\s*$/.exec(source.slice(Math.max(0, at - 40), at))?.[1] ?? "?"
    results.push({
      file,
      line: source.slice(0, at).split("\n").length,
      model,
      hasTake: /\btake\s*:/.test(block),
      hasCursor: /\bcursor\s*:/.test(block),
    })
    from = at + needle.length
  }
  return results
}
