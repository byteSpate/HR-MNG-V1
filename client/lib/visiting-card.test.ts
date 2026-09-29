import assert from "node:assert/strict"
import test from "node:test"

import { CARD_MAX_BYTES, checkCardFile, formatBytes } from "./visiting-card"

const MB = 1024 * 1024

test("takes JPG, JPEG, PNG and WebP, in any capitals", () => {
  for (const name of ["card.jpg", "card.jpeg", "card.png", "card.webp", "CARD.PNG", "Card.JpG"]) {
    assert.equal(checkCardFile({ name, size: 1000 }), null, name)
  }
})

test("refuses a file that is not one of those, and says which are allowed", () => {
  for (const name of ["card.pdf", "card.gif", "card.heic", "card", "card.png.exe"]) {
    assert.equal(
      checkCardFile({ name, size: 1000 }),
      "That file is not a picture we can use. Choose a JPG, PNG or WebP image.",
      name,
    )
  }
})

test("takes a picture of exactly 5 MB and refuses one byte more, saying both sizes", () => {
  assert.equal(CARD_MAX_BYTES, 5 * MB)
  assert.equal(checkCardFile({ name: "a.png", size: 5 * MB }), null)
  assert.equal(
    checkCardFile({ name: "a.png", size: Math.round(7.2 * MB) }),
    "That picture is 7.2 MB. The most we can take is 5 MB. Choose a smaller picture.",
  )
})

test("refuses an empty file", () => {
  assert.equal(checkCardFile({ name: "a.png", size: 0 }), "That file is empty. Choose another picture.")
})

test("reads a file size in plain words", () => {
  assert.equal(formatBytes(500), "500 B")
  assert.equal(formatBytes(2048), "2 KB")
  assert.equal(formatBytes(1.5 * MB), "1.5 MB")
  assert.equal(formatBytes(5 * MB), "5 MB")
})
