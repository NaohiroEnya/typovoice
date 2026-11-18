// Shared by the live text (as words arrive) and the finished message, so both break the same way.
const MAX_CHARS = 40
const CHARS_PER_LINE = 8
const BREAK_AFTER = /[\s、。，．,.!?！？…ー〜]/

// Breaks a message into short lines so it reads as a block rather than one long strip,
// preferring to break right after punctuation or a space near the end of each line.
export const wrapText = (text) => {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, MAX_CHARS)
  const lines = []
  while (chars.length > CHARS_PER_LINE) {
    let cut = CHARS_PER_LINE
    for (let i = CHARS_PER_LINE; i > CHARS_PER_LINE - 3; i -= 1) {
      if (BREAK_AFTER.test(chars[i - 1])) {
        cut = i
        break
      }
    }
    lines.push(chars.splice(0, cut).join('').trim())
  }
  lines.push(chars.join('').trim())
  return lines.filter(Boolean).join('\n')
}
