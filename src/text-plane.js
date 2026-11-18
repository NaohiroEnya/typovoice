// Builds real 3D solid text (not a flat texture) by parsing actual glyph outlines from a
// selectable, bundled font file and extruding them with three.js. A vector outline gives crisp
// edges at any size and a single continuous volume, unlike a canvas-texture approach. Each
// bundled font is subset to the same character set as the original (ASCII, kana, and the ~3000
// Jouyou/Kyoiku-use kanji) to keep downloads small while covering ordinary Japanese input; a
// character outside that set won't render.
import * as THREE from 'three'
import opentype from 'opentype.js'

import {DEFAULT_FONT_ID, findFont} from './fonts'

export const TEXT_WORLD_HEIGHT = 0.4 // meters, per line
export const LINE_HEIGHT = 1.25 // ems between baselines, for messages broken over several lines

// Material/extrusion defaults; a style preset's `look` overrides any of these.
const DEFAULT_LOOK = {
  depthRatio: 0.12, // extrusion depth, as a fraction of the text height
  roughness: 0.5,
  metalness: 0.05,
  emissive: 0, // 0..1, how much the text's front face glows in its own color
}
// The sides (the extruded depth) are a darker shade of the face color and barely self-lit, so the
// letter's thickness reads as a distinct, shaded edge instead of merging into the face.
const SIDE_SHADE = 0.55
const DARK_LUMINANCE = 0.03
const luminance = ({r, g, b}) => 0.2126 * r + 0.7152 * g + 0.0722 * b // linear rgb
const SIDE_EMISSIVE = 0.15 // fraction of the face's emissive the sides keep
const BEVEL_SIZE = 0.006 // in ems: a hairline rounded edge that catches the light

// Cached per font file (the condensed face shares the regular gothic's file).
const fontPromises = new Map()
export const loadFont = (fontId = DEFAULT_FONT_ID) => {
  const {url} = findFont(fontId)
  if (!fontPromises.has(url)) {
    const promise = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buffer) => opentype.parse(buffer))
    fontPromises.set(url, promise)
  }
  return fontPromises.get(url)
}

// Splits an opentype.js path into its individual closed contours, converting each to a
// three.js Path so its point-based signed area can be measured. Which sign means "solid" depends
// on the font's outline format (CFF-based .otf and TrueType-based .ttf wind outer contours in
// opposite directions), so pathToShapes works that out per run of text rather than assuming it
// (same fix as Font AR's text-plane.js).
const contoursOf = (otPath) => {
  const contours = []
  let current = null
  otPath.commands.forEach((cmd) => {
    if (cmd.type === 'M') {
      current = new THREE.Path()
      contours.push(current)
    }
    if (!current) {
      return
    }
    if (cmd.type === 'M') current.moveTo(cmd.x, cmd.y)
    else if (cmd.type === 'L') current.lineTo(cmd.x, cmd.y)
    else if (cmd.type === 'C') current.bezierCurveTo(cmd.x1, cmd.y1, cmd.x2, cmd.y2, cmd.x, cmd.y)
    else if (cmd.type === 'Q') current.quadraticCurveTo(cmd.x1, cmd.y1, cmd.x, cmd.y)
  })
  return contours.map((path) => {
    const points = path.getPoints()
    let area = 0
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i]
      const b = points[(i + 1) % points.length]
      area += a.x * b.y - b.x * a.y
    }
    return {points, area: area / 2}
  })
}

const pointInPolygon = (point, polygon) => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]
    const b = polygon[j]
    const crosses = a.y > point.y !== b.y > point.y
    if (crosses && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

// Converts a run of text's glyph outlines into extrudable shapes, attaching each hole contour to
// whichever solid contour geometrically contains it (so e.g. 回's inner solid square sits inside
// its outer frame's hole as its own shape, rather than being merged into one).
const pathToShapes = (otPath) => {
  const contours = contoursOf(otPath)
  if (contours.length === 0) {
    return []
  }
  // The largest contour in any run of text is always an outer (solid) one -- a hole is by
  // definition inside something bigger -- so its winding direction is this font's "solid" sign.
  const largest = contours.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a))
  const solidSign = Math.sign(largest.area)
  const isSolid = (c) => c.area * solidSign > 0
  const solids = contours.filter(isSolid).map((c) => ({shape: new THREE.Shape(c.points), points: c.points}))
  contours
    .filter((c) => !isSolid(c))
    .forEach((hole) => {
      const owner = solids.find((s) => pointInPolygon(hole.points[0], s.points))
      if (owner) {
        owner.shape.holes.push(new THREE.Path(hole.points))
      }
    })
  return solids.map((s) => s.shape)
}

// One path for the whole message, each '\n'-separated line centered under the one before.
const messagePath = (font, text) => {
  const path = new opentype.Path()
  text.split('\n').forEach((line, i) => {
    path.extend(font.getPath(line, -font.getAdvanceWidth(line, 1) / 2, i * LINE_HEIGHT, 1))
  })
  return path
}

// Builds a group showing `text` as a solid, shadow-casting 3D object sized so each line's
// world-space height is about `worldHeight` meters, in the requested font, color, and look. The
// group is centered on X/Z with its bottom at local y=0, so placing it at a ground hit point sits
// it directly on the ground.
// With `baseline: true` (one line, used for the live per-character text) `worldHeight` is instead
// meters per em, and the mesh keeps the font's own origin: x centered on the advance width, y=0 on
// the baseline -- so characters laid out side by side line up like ordinary type.
export const createTextMesh = async (text, {fontId = DEFAULT_FONT_ID, worldHeight = TEXT_WORLD_HEIGHT, color = '#ff3b30', look = {}, baseline = false} = {}) => {
  const font = await loadFont(fontId)
  const {scaleX} = findFont(fontId)
  const {depthRatio, roughness, metalness, emissive} = {...DEFAULT_LOOK, ...look}
  const otPath = messagePath(font, text) // fontSize=1 -> coordinates are fractions of an em
  const shapes = pathToShapes(otPath)

  const group = new THREE.Group()
  if (shapes.length === 0) {
    return group // e.g. blank input, or a glyph outside the bundled font's coverage
  }

  const box = otPath.getBoundingBox()
  const lineCount = text.split('\n').length
  const emHeight = baseline ? 1 : (box.y2 - box.y1) / (1 + (lineCount - 1) * LINE_HEIGHT)
  const scale = worldHeight / emHeight

  const depth = emHeight * depthRatio
  const geometry = new THREE.ExtrudeGeometry(shapes, {
    depth,
    bevelEnabled: true,
    bevelSize: BEVEL_SIZE,
    bevelThickness: Math.min(BEVEL_SIZE * 1.5, depth * 0.25),
    bevelSegments: 2,
  })
  // opentype.js paths are Y-down (like a canvas); flipping Y here both corrects that and applies
  // the em-units-to-meters scale (and the font's horizontal squeeze) in one step.
  geometry.scale(scale * scaleX, -scale, scale)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  geometry.translate(
    baseline ? 0 : -(bounds.min.x + bounds.max.x) / 2,
    baseline ? 0 : -bounds.min.y,
    -(bounds.min.z + bounds.max.z) / 2
  )

  // ExtrudeGeometry puts the front/back faces in group 0 and the sides (and bevel) in group 1.
  const faceMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: color,
    emissiveIntensity: emissive,
  })
  // Near-black text has no darker shade to go to, so its sides go a touch lighter instead.
  const faceColor = new THREE.Color(color)
  const sideColor = luminance(faceColor) < DARK_LUMINANCE
    ? faceColor.clone().lerp(new THREE.Color(0xffffff), 0.1)
    : faceColor.clone().multiplyScalar(SIDE_SHADE)
  const sideMaterial = new THREE.MeshStandardMaterial({
    color: sideColor,
    roughness: Math.min(1, roughness + 0.15),
    metalness,
    emissive: sideColor,
    emissiveIntensity: emissive * SIDE_EMISSIVE,
  })

  const mesh = new THREE.Mesh(geometry, [faceMaterial, sideMaterial])
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)

  return group
}
