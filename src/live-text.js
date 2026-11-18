// The words appearing in space *while* someone is still speaking. Each recognized character is
// its own small 3D glyph that pops in where the finished message will be, lines reflow smoothly
// as more words arrive, and the whole block breathes with the live voice level. Speech
// recognition revises itself as it goes (kana turning into kanji, words regrouping), so every
// update keeps the characters that stayed the same and rebuilds only from the first change on.
// When speaking ends the block dissolves, and scene.js puts the finished, voice-styled message
// (one solid mesh, like any other) in the same place.
import * as THREE from 'three'

import {createTextMesh, loadFont, LINE_HEIGHT} from './text-plane'
import {findFont} from './fonts'
import {wrapText} from './wrap'

const POP_SECONDS = 0.35
const DISSOLVE_SECONDS = 0.3
const DISSOLVE_STAGGER = 0.02 // per character, left to right
const CAP_HEIGHT = 0.88 // ems above the baseline the glyphs reach, roughly
const DESCENT = 0.12 // ems below it
const MAX_EM = 0.44 // meters per em at most: matches a finished message's TEXT_WORLD_HEIGHT

const easeOutBack = (x) => {
  const c1 = 2.2
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2
}
const clamp01 = (x) => Math.min(1, Math.max(0, x))
const follow = (dt, rate) => 1 - Math.exp(-dt * rate) // frame-rate independent smoothing

const disposeMesh = (mesh) => {
  mesh.geometry.dispose()
  ;[].concat(mesh.material).forEach((material) => material.dispose())
}

// `getLevel` returns the live voice level (0..1). `fit` is the box the finished message is fitted
// into ({maxWidth, maxHeight} in meters), so the live block lays out at about the same size.
export const createLiveText = ({style, fit, getLevel}) => {
  const root = new THREE.Group() // placed and turned by scene.js
  const floatNode = new THREE.Group()
  const block = new THREE.Group() // children are in ems; its scale is meters per em
  root.add(floatNode)
  floatNode.add(block)

  const {scaleX} = findFont(style.fontId)
  let font = null
  let pendingText = null
  let glyphs = [] // {char, node, mesh, born, level, target}
  let level = 0
  let dissolveStart = null
  let started = null
  let blockScale = null // meters per em, eased toward the fitted size

  const buildGlyph = (char, now) => {
    const node = new THREE.Group()
    node.scale.setScalar(0.001)
    block.add(node)
    const glyph = {char, node, mesh: null, born: now, level, target: new THREE.Vector3(), placed: false}
    createTextMesh(char, {...style, worldHeight: 1, baseline: true}).then((group) => {
      const [mesh] = group.children
      if (!mesh) {
        return // a space, or a character outside the bundled font
      }
      if (glyph.removed) {
        disposeMesh(mesh)
        return
      }
      glyph.mesh = mesh
      node.add(mesh)
    })
    return glyph
  }

  const removeGlyph = (glyph) => {
    glyph.removed = true
    block.remove(glyph.node)
    if (glyph.mesh) {
      disposeMesh(glyph.mesh)
    }
  }

  // Lays the (wrapped) lines out centered, with the block's middle at the origin.
  const layout = (lines) => {
    let index = 0
    let widest = 0
    const top = (CAP_HEIGHT - (lines.length - 1) * LINE_HEIGHT - DESCENT) / 2
    lines.forEach((line, row) => {
      const chars = Array.from(line)
      const advances = chars.map((char) => font.getAdvanceWidth(char, 1) * scaleX)
      const width = advances.reduce((a, b) => a + b, 0)
      widest = Math.max(widest, width)
      let x = -width / 2
      chars.forEach((char, i) => {
        const glyph = glyphs[index]
        index += 1
        glyph.target.set(x + advances[i] / 2, -row * LINE_HEIGHT - top, 0)
        if (!glyph.placed) {
          glyph.node.position.copy(glyph.target)
          glyph.placed = true
        }
        x += advances[i]
      })
    })
    const height = CAP_HEIGHT + (lines.length - 1) * LINE_HEIGHT + DESCENT
    return Math.min(MAX_EM, fit.maxWidth / Math.max(widest, 1e-3), fit.maxHeight / height)
  }

  let targetScale = MAX_EM

  const setText = (text) => {
    if (dissolveStart !== null) {
      return
    }
    if (!font) {
      pendingText = text
      return
    }
    const lines = wrapText(text).split('\n').filter(Boolean)
    const chars = lines.flatMap((line) => Array.from(line))
    let same = 0
    while (same < glyphs.length && same < chars.length && glyphs[same].char === chars[same]) {
      same += 1
    }
    glyphs.slice(same).forEach(removeGlyph)
    const now = performance.now() / 1000
    glyphs = glyphs.slice(0, same).concat(chars.slice(same).map((char) => buildGlyph(char, now)))
    if (glyphs.length) {
      targetScale = layout(lines)
    }
  }

  loadFont(style.fontId).then((loaded) => {
    font = loaded
    if (pendingText !== null) {
      setText(pendingText)
    }
  })

  // Called every frame by scene.js. Resolves nothing; returns false once fully dissolved.
  const update = (now, dt) => {
    started = started ?? now
    level += (getLevel() - level) * follow(dt, 12)
    blockScale = blockScale === null ? targetScale : blockScale + (targetScale - blockScale) * follow(dt, 6)
    block.scale.setScalar(blockScale * (1 + level * 0.12))
    floatNode.position.y = 0.025 * Math.sin((now - started) * 2.2)

    let alive = false
    glyphs.forEach((glyph, i) => {
      glyph.node.position.lerp(glyph.target, follow(dt, 14))
      // Pops in, overshooting more the louder the voice was when this character arrived.
      const t = clamp01((now - glyph.born) / POP_SECONDS)
      let scale = Math.max(0.001, easeOutBack(t) * (1 + glyph.level * 0.5 * (1 - t)))
      if (dissolveStart !== null) {
        const d = clamp01((now - dissolveStart - i * DISSOLVE_STAGGER) / DISSOLVE_SECONDS)
        scale *= 1 - d
        glyph.node.position.y += d * 0.02
        alive = alive || d < 1
      }
      glyph.node.scale.setScalar(scale)
      // A little sway of its own, so the line feels hand-set rather than typeset.
      glyph.node.rotation.z = 0.04 * Math.sin(now * 2.6 + i * 1.3) * (0.4 + level)
    })
    return dissolveStart === null || alive
  }

  const dissolve = () => {
    if (dissolveStart === null) {
      dissolveStart = performance.now() / 1000
    }
  }

  const dispose = () => {
    glyphs.forEach(removeGlyph)
    glyphs = []
  }

  return {object: root, setText, update, dissolve, dispose}
}
