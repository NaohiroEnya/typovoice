// MOTION: how a placed text behaves. Each placed text group holds a "motion node" between the
// group (which carries the user's position / pinch scale / twist) and the text mesh; the
// animation only ever touches the motion node, so it never fights with dragging or pinching.
// DRAW is done with a clipping plane on the text's material that sweeps across the text, so it
// looks written out left to right without needing per-character meshes.
import * as THREE from 'three'

const INTRO_SECONDS = 0.4 // every placement / motion change pops the text in
// Defaults; TYPO VOICE passes per-message `motionParams` derived from the voice (voice-style.js).
const DEFAULT_PARAMS = {speed: 2, lift: 0.05, sway: 0.08, bounce: 0.15}
const POP_PERIOD = 1.2 // at speed 2
const DRAW = {reveal: 1.6, hold: 2.4, erase: 0.6}
const NO_CLIP = 1e6
const LEFT = new THREE.Vector3(-1, 0, 0)

const easeOutBack = (x) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2
}
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2)
const clamp01 = (x) => Math.min(1, Math.max(0, x))

// Squash-and-stretch bounce: crouch, jump, land.
const applyPop = (node, t, {speed, bounce}) => {
  const period = (POP_PERIOD * 2) / speed
  const p = (t % period) / period
  if (p < 0.12) {
    const k = Math.sin((p / 0.12) * Math.PI)
    node.scale.set(1 + 0.08 * k, 1 - 0.12 * k, 1)
  } else if (p < 0.5) {
    const k = Math.sin(((p - 0.12) / 0.38) * Math.PI)
    node.position.y = bounce * k
    node.scale.set(1 - 0.03 * k, 1 + 0.06 * k, 1)
  } else if (p < 0.62) {
    const k = Math.sin(((p - 0.5) / 0.12) * Math.PI)
    node.scale.set(1 + 0.06 * k, 1 - 0.1 * k, 1)
  }
}

const applyFloat = (node, t, {speed, lift, sway}) => {
  const k = speed / 2
  node.position.y = lift * (1 + Math.sin(t * speed))
  node.rotation.z = sway * 0.375 * Math.sin(t * 1.3 * k)
  node.rotation.y = sway * Math.sin(t * 0.8 * k)
}

// 0..1, how much of the text is currently written out.
const drawProgress = (t) => {
  const cycle = DRAW.reveal + DRAW.hold + DRAW.erase
  const c = t % cycle
  if (c < DRAW.reveal) {
    return easeInOut(c / DRAW.reveal)
  }
  if (c < DRAW.reveal + DRAW.hold) {
    return 1
  }
  return 1 - easeInOut((c - DRAW.reveal - DRAW.hold) / DRAW.erase)
}

// Gives a freshly built text mesh the clipping plane DRAW uses. Every text gets one (parked far
// away when not drawing) so switching motions never changes the material's shader.
export const prepareMotionMesh = (mesh) => {
  const plane = new THREE.Plane(LEFT.clone(), NO_CLIP)
  mesh.userData.clipPlanes = [plane]
  mesh.userData.clipPlane = plane
  ;[].concat(mesh.material).forEach((material) => {
    material.clippingPlanes = mesh.userData.clipPlanes
    material.clipShadows = true
  })
}

// (Re)starts the group's motion from the beginning, e.g. right after it's placed.
export const restartMotion = (group, now) => {
  group.userData.motionStart = now
}

const localClip = new THREE.Plane()

// Sets the group's motion node (and DRAW's clipping plane) for time `now` (seconds).
export const applyMotion = (group, now) => {
  const node = group.userData.motionNode
  const mesh = group.userData.textMesh
  const {motion, motionParams} = group.userData.options
  const params = {...DEFAULT_PARAMS, ...motionParams}
  const t = now - group.userData.motionStart

  node.position.set(0, 0, 0)
  node.rotation.set(0, 0, 0)
  node.scale.set(1, 1, 1)

  if (motion === 'float') {
    applyFloat(node, t, params)
  } else if (motion === 'pop') {
    applyPop(node, t, params)
  }
  if (motion !== 'draw') {
    node.scale.multiplyScalar(Math.max(0.001, easeOutBack(clamp01(t / INTRO_SECONDS))))
  }

  if (!mesh) {
    return
  }
  const plane = mesh.userData.clipPlane
  if (motion === 'draw') {
    // Keep everything left of the cut: signed distance (-x + cut) >= 0.
    const {min, max} = mesh.geometry.boundingBox
    const cut = min.x - 0.01 + drawProgress(t) * (max.x - min.x + 0.02)
    group.updateMatrixWorld(true)
    plane.copy(localClip.set(LEFT, cut)).applyMatrix4(mesh.matrixWorld)
  } else {
    plane.set(LEFT, NO_CLIP)
  }
}
