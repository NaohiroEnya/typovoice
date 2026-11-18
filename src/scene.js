// 8th Wall XR Camera Pipeline Module, from TYPO CAM. TYPO VOICE adds startLive (words appear in
// space as they're spoken, see live-text.js), spawnInFront (the finished message floats where
// they were) and clearAll; the rest is unchanged.
// Original description: lets the user tap to fix text in real space -- standing on
// the ground or floating in the air (PLACE) -- drag a placed text to move it, pinch to resize it,
// twist to rotate it, animates each text's MOTION, and grabs a still frame (or a per-frame hook,
// for video) of the composited camera + AR scene.
// XR8.XrController provides real 6DoF SLAM tracking, so text placed here stays anchored to the
// physical location it was tapped on, including depth (distance from the camera) — unlike a
// DeviceOrientation-only approach, which can only react to tilt, not real-world position.
import * as THREE from 'three'
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js'

import {createTextMesh} from './text-plane'
import {prepareMotionMesh, restartMotion, applyMotion} from './motion'
import {createPoseFilter} from './pose-filter'
import {createLiveText} from './live-text'

const SELECTION_RING_COLOR = 0xffffff
const MIN_SCALE = 0.2
const MAX_SCALE = 6
// AIR placement: the text goes along the tapped direction, this far away (or at the ground hit
// if that's nearer), with its bottom no lower than AIR_MIN_HEIGHT above the ground.
const AIR_DISTANCE = 1.6 // meters
const AIR_MIN_HEIGHT = 0.3
const AIR_LIFT = 0.9 // height a GROUND text is raised to when switched to AIR
const TEXT_HALF_HEIGHT = 0.2 // half of text-plane's TEXT_WORLD_HEIGHT, at scale 1
// Voice messages: how far in front of the camera they appear, and the box they're fitted into
// (at size 1) so a long message still fits the view at that distance.
const SPAWN_DISTANCE = 1.3 // meters
const SPAWN_MAX_WIDTH = 0.5 // a portrait phone sees ~0.7m across at SPAWN_DISTANCE
const SPAWN_MAX_HEIGHT = 0.45
const SPAWN_VIEW_WIDTH = 0.65

const nowSeconds = () => performance.now() / 1000
const UP = new THREE.Vector3(0, 1, 0)

// A thin flat ring, sized to the selected text's footprint, added as a child of its group so it
// automatically follows that group's position, rotation, and (importantly, for pinch resizing)
// scale without any extra transform math.
const createSelectionRing = (group) => {
  const mesh = group.userData.textMesh
  if (!mesh) {
    return null // e.g. a glyph outside the bundled font, which produced an empty group
  }
  const bounds = mesh.geometry.boundingBox
  const outerRadius = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 0.65 + 0.04
  const geometry = new THREE.RingGeometry(outerRadius * 0.9, outerRadius, 48)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: SELECTION_RING_COLOR,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.position.y = 0.003 // just above the ground text sits on, to avoid z-fighting
  ring.renderOrder = 1
  return ring
}

const disposeMesh = (mesh) => {
  mesh.geometry.dispose()
  ;[].concat(mesh.material).forEach((material) => material.dispose())
}

// Soft dark ellipse on the ground under each text (ambient occlusion where it meets the floor),
// which the sharp cast shadow alone doesn't give. One radial-gradient texture is shared by all.
const CONTACT_OPACITY = 0.55
const CONTACT_FADE_HEIGHT = 1.4 // meters above the ground at which it has fully faded out
let contactTexture = null
const getContactTexture = () => {
  if (!contactTexture) {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    gradient.addColorStop(0, 'rgba(0,0,0,1)')
    gradient.addColorStop(0.45, 'rgba(0,0,0,0.6)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 128, 128)
    contactTexture = new THREE.CanvasTexture(canvas)
  }
  return contactTexture
}

const createContactShadow = (mesh) => {
  const bounds = mesh.geometry.boundingBox
  const width = (bounds.max.x - bounds.min.x) * 1.15 + 0.08
  const depth = (bounds.max.z - bounds.min.z) + 0.16
  const geometry = new THREE.PlaneGeometry(width, depth)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    alphaMap: getContactTexture(),
    transparent: true,
    opacity: CONTACT_OPACITY,
    depthWrite: false,
    // Shares the text's DRAW clipping plane, so it's only under the part that's written out.
    clippingPlanes: mesh.userData.clipPlanes,
  })
  const contact = new THREE.Mesh(geometry, material)
  contact.renderOrder = 1
  contact.raycast = () => {} // not tappable: taps on the ground below shouldn't select the text
  return contact
}

// Keeps a group's contact shadow on the ground (world y=0) however high the text is, growing
// and fading as it rises -- including during FLOAT / POP's bounce.
const updateContactShadow = (group) => {
  const contact = group.userData.contactShadow
  if (!contact) {
    return
  }
  const scale = group.scale.x
  const height = Math.max(0, group.position.y + group.userData.motionNode.position.y * scale)
  const k = Math.min(1, height / CONTACT_FADE_HEIGHT)
  contact.position.y = (-group.position.y + 0.002) / scale
  contact.scale.setScalar(1 + k * 0.8)
  contact.material.opacity = CONTACT_OPACITY * (1 - k) ** 2
  contact.visible = k < 1
}

// `getPlacementOptions` is called at the moment of each tap so the current text settings always
// apply to the next placed object, without this module needing to know about the UI that manages
// them; it returns null when there's no text yet, in which case `onNeedText` is called instead of
// placing. `onSelectionChange` is called with the selected group's options (or null) whenever
// selection changes, `onPlaced` after a new text lands, and `onScaleChange` with the selected
// text's scale after a pinch. `onFrameRendered` is called once per frame right after the AR scene
// has been drawn (used to feed the video recorder).
export const createScenePipeline = ({
  getPlacementOptions,
  onNeedText,
  onPlaced,
  onSelectionChange,
  onScaleChange,
  onFrameRendered,
}) => {
  // Shadow-catcher at ground level (y=0): it's invisible except where a placed text object blocks
  // the light, so GROUND text reads as sitting on the ground and AIR text as hovering above it.
  // (Taps and drags are resolved against mathematical planes instead; see dragPlaneFor.)
  const groundGeometry = new THREE.PlaneGeometry(2000, 2000)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundMaterial = new THREE.ShadowMaterial()
  groundMaterial.opacity = 0.35
  const ground = new THREE.Mesh(groundGeometry, groundMaterial)
  ground.receiveShadow = true

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const heightPlane = new THREE.Plane()
  const placedTexts = [] // groups currently placed in the scene, for tap-to-select

  let liveScene = null
  let liveCamera = null
  const poseFilter = createPoseFilter()
  let selectedGroup = null
  let helpersVisible = true
  let drag = null // {touchId, plane, offset} while one finger drags selectedGroup
  let pinch = null // {distance, angle, scale, rotationY} at the start of a two-finger gesture

  // Each placed text is a group (the user's transform) holding a motion node (the animation, see
  // motion.js) that holds the text mesh, plus, while selected, the ring. The mesh can be swapped
  // out when the text/font/color/preset change.
  const buildTextMesh = async (options) => {
    const built = await createTextMesh(options.text, {
      fontId: options.fontId,
      color: options.color,
      look: options.look,
    })
    const [mesh] = built.children
    if (mesh) {
      prepareMotionMesh(mesh)
    }
    return mesh || null
  }

  const setTextMesh = (group, mesh) => {
    const node = group.userData.motionNode
    const previous = group.userData.textMesh
    if (previous) {
      node.remove(previous)
      disposeMesh(previous)
    }
    const previousContact = group.userData.contactShadow
    if (previousContact) {
      group.remove(previousContact)
      disposeMesh(previousContact)
      delete group.userData.contactShadow
    }
    group.userData.textMesh = mesh
    if (mesh) {
      node.add(mesh)
      group.userData.contactShadow = createContactShadow(mesh)
      group.add(group.userData.contactShadow)
      updateContactShadow(group)
    }
  }

  const removeRing = (group) => {
    const ring = group.userData.selectionRing
    if (ring) {
      group.remove(ring)
      disposeMesh(ring)
      delete group.userData.selectionRing
    }
  }

  const addRing = (group) => {
    const ring = createSelectionRing(group)
    if (ring) {
      ring.visible = helpersVisible
      group.add(ring)
      group.userData.selectionRing = ring
    }
  }

  const placeTextAt = async ({scene, camera}, ray) => {
    const options = getPlacementOptions()
    if (!options) {
      onNeedText()
      return
    }
    const point = placementPoint(ray, options)
    if (!point) {
      return // GROUND, tapped above the horizon
    }
    const group = new THREE.Group()
    group.userData.motionNode = new THREE.Group()
    group.add(group.userData.motionNode)
    setTextMesh(group, await buildTextMesh(options))
    group.userData.options = options
    restartMotion(group, nowSeconds())
    group.position.copy(point)
    group.scale.setScalar(options.size)
    // Stand upright facing the viewer: only the camera's heading is used, so text never tilts
    // into the ground when the phone is pointed down at the spot it's placed on.
    const forward = new THREE.Vector3()
    camera.getWorldDirection(forward)
    group.rotation.set(0, Math.atan2(-forward.x, -forward.z), 0)
    scene.add(group)
    placedTexts.push(group)
    select(group)
    onPlaced()
  }

  // Where a tap along `ray` puts a new text: on the ground where the ray meets it (GROUND), or in
  // the air along the ray (AIR), centered on the tapped point.
  const placementPoint = (ray, {place, size}) => {
    const groundPoint = ray.intersectPlane(heightPlane.set(UP, 0), new THREE.Vector3())
    if (place !== 'air') {
      return groundPoint
    }
    const distance = groundPoint ? Math.min(ray.origin.distanceTo(groundPoint), AIR_DISTANCE) : AIR_DISTANCE
    const point = ray.at(distance, new THREE.Vector3())
    point.y = Math.max(point.y - TEXT_HALF_HEIGHT * size, AIR_MIN_HEIGHT)
    return point
  }

  // Straight ahead of the camera at eye level, facing the viewer: where a message appears.
  const spawnPose = () => {
    const forward = new THREE.Vector3()
    liveCamera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) {
      forward.set(0, 0, -1)
    }
    forward.normalize()
    const position = liveCamera.getWorldPosition(new THREE.Vector3()).addScaledVector(forward, SPAWN_DISTANCE)
    return {position, rotationY: Math.atan2(-forward.x, -forward.z)}
  }

  const liveTexts = [] // live-text.js blocks being spoken or dissolving
  let lastUpdate = null

  // Starts showing words as they're spoken; returns {pose, setText, finish} (null if the camera
  // isn't running yet). `finish()` dissolves them; pass `pose` to spawnInFront to put the
  // finished message in the same place.
  const startLive = (style, getLevel) => {
    if (!liveScene || !liveCamera) {
      return null
    }
    const pose = spawnPose()
    const live = createLiveText({style, getLevel, fit: {maxWidth: SPAWN_MAX_WIDTH, maxHeight: SPAWN_MAX_HEIGHT}})
    live.object.position.copy(pose.position)
    live.object.rotation.set(0, pose.rotationY, 0)
    liveScene.add(live.object)
    liveTexts.push(live)
    return {pose, setText: live.setText, finish: live.dissolve}
  }

  const updateLiveTexts = (now, dt) => {
    for (let i = liveTexts.length - 1; i >= 0; i -= 1) {
      const live = liveTexts[i]
      if (!live.update(now, dt)) {
        liveScene.remove(live.object)
        live.dispose()
        liveTexts.splice(i, 1)
      }
    }
  }

  // Places a message centered on `pose` (default: straight ahead of the camera, at eye level),
  // facing the viewer, scaled to fit SPAWN_MAX_WIDTH x SPAWN_MAX_HEIGHT and then by
  // `options.size`. SLAM keeps it where it appeared as the viewer moves. Resolves with false if
  // the camera isn't running yet.
  const spawnInFront = async (options, pose = null) => {
    if (!liveScene || !liveCamera) {
      return false
    }
    const {position, rotationY} = pose || spawnPose()
    const group = new THREE.Group()
    group.userData.motionNode = new THREE.Group()
    group.add(group.userData.motionNode)
    const mesh = await buildTextMesh(options)
    setTextMesh(group, mesh)
    if (!mesh) {
      return false // nothing the bundled font can draw
    }
    const {min, max} = mesh.geometry.boundingBox
    const fit = Math.min(1, SPAWN_MAX_WIDTH / (max.x - min.x), SPAWN_MAX_HEIGHT / (max.y - min.y))
    // A loud voice enlarges the message, but never past the edges of a portrait view.
    const scale = Math.min(fit * options.size, SPAWN_VIEW_WIDTH / (max.x - min.x), MAX_SCALE)
    group.userData.options = {...options, place: 'air', size: scale}
    restartMotion(group, nowSeconds())

    group.position.copy(position)
    group.position.y = Math.max(position.y - ((max.y - min.y) * scale) / 2, AIR_MIN_HEIGHT)
    group.scale.setScalar(scale)
    group.rotation.set(0, rotationY, 0)
    liveScene.add(group)
    placedTexts.push(group)
    onPlaced()
    return true
  }

  const clearAll = () => {
    deselect()
    placedTexts.splice(0).forEach((group) => {
      liveScene.remove(group)
      setTextMesh(group, null)
    })
  }

  const deselect = () => {
    if (!selectedGroup) {
      return
    }
    removeRing(selectedGroup)
    selectedGroup = null
    drag = null
    pinch = null
    onSelectionChange(null)
  }

  const select = (group) => {
    if (group === selectedGroup) {
      return
    }
    deselect()
    selectedGroup = group
    addRing(group)
    onSelectionChange({...group.userData.options, size: group.scale.x})
  }

  // Rebuilds the selected text with new settings (text/font/color/look), keeping where it is,
  // how it's turned, and how big it was pinched to.
  const updateSelected = async (options) => {
    const group = selectedGroup
    if (!group) {
      return
    }
    const previous = group.userData.options
    group.userData.options = options
    if (options.place !== previous.place) {
      group.position.y = options.place === 'air' ? Math.max(group.position.y, AIR_LIFT) : 0
    }
    if (options.motion !== previous.motion) {
      restartMotion(group, nowSeconds())
    }
    const token = Symbol('rebuild')
    group.userData.rebuildToken = token
    const mesh = await buildTextMesh(options)
    if (group.userData.rebuildToken !== token) {
      if (mesh) disposeMesh(mesh) // a newer change already superseded this one
      return
    }
    removeRing(group)
    setTextMesh(group, mesh)
    if (group === selectedGroup) {
      addRing(group)
    }
  }

  const deleteSelected = () => {
    if (!selectedGroup || !liveScene) {
      return
    }
    const group = selectedGroup
    deselect()
    liveScene.remove(group)
    placedTexts.splice(placedTexts.indexOf(group), 1)
    setTextMesh(group, null)
  }

  // Hides scene-side UI (the selection ring) so photos and videos show only the camera and text.
  const setHelpersVisible = (visible) => {
    helpersVisible = visible
    const ring = selectedGroup && selectedGroup.userData.selectionRing
    if (ring) {
      ring.visible = visible
    }
  }

  const initXrScene = ({scene, camera, renderer}) => {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.localClippingEnabled = true // for MOTION: DRAW
    // Only affects three.js's own drawing; the camera feed is drawn by GlTextureRenderer.
    renderer.toneMapping = THREE.NeutralToneMapping
    scene.add(ground)

    // Image-based lighting from a generic indoor room: gives the text soft, direction-dependent
    // shading on every face and something for glossy/metallic presets to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    pmrem.dispose()

    // Key light, fixed in the world so shadows stay put as the viewer walks around.
    const directionalLight = new THREE.DirectionalLight(0xfff4e6, 1.6)
    directionalLight.position.set(3, 6, 4)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.set(2048, 2048)
    directionalLight.shadow.bias = -0.0005
    directionalLight.shadow.normalBias = 0.01
    directionalLight.shadow.radius = 3
    const shadowCam = directionalLight.shadow.camera
    shadowCam.left = -10
    shadowCam.right = 10
    shadowCam.top = 10
    shadowCam.bottom = -10
    shadowCam.far = 30
    shadowCam.updateProjectionMatrix()
    scene.add(directionalLight)
    // Sky/ground bounce: tops of letters a touch brighter than their undersides.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.35))
    // Weak fill from the viewer's side (follows the camera, casts no shadow), so a text seen from
    // the far side of the key light still has a readable face.
    const fill = new THREE.DirectionalLight(0xffffff, 0.35)
    fill.position.set(-0.5, 0.5, 1)
    camera.add(fill)
    camera.add(fill.target)
    fill.target.position.set(0, 0, -1)
    if (!camera.parent) {
      scene.add(camera)
    }

    camera.position.set(0, 1.6, 2)
  }

  // Photo capture: resolved from onRender (see below), which -- because this module is added to
  // the camera pipeline after XR8.Threejs's own module -- always runs right after that frame's
  // camera + AR scene have already been drawn into the canvas. Reading the canvas synchronously
  // at that point captures exactly what was just drawn, without needing a costly
  // `preserveDrawingBuffer: true` context (the backbuffer isn't swapped/cleared until control
  // returns to the browser after this synchronous call finishes).
  let pendingCaptures = []
  const requestCapture = () => new Promise((resolve) => {
    pendingCaptures.push(resolve)
  })

  return {
    requestCapture,
    startLive,
    spawnInFront,
    clearAll,
    updateSelected,
    deleteSelected,
    deselect,
    setHelpersVisible,
    pipelineModule: {
      name: 'typovoice',

      onStart: ({canvas}) => {
        const {scene, camera, renderer} = XR8.Threejs.xrScene()
        liveScene = scene
        liveCamera = camera

        initXrScene({scene, camera, renderer})

        XR8.XrController.updateCameraProjectionMatrix(
          {origin: camera.position, facing: camera.quaternion}
        )

        const setRayFromTouch = (touch) => {
          pointer.x = (touch.clientX / window.innerWidth) * 2 - 1
          pointer.y = -(touch.clientY / window.innerHeight) * 2 + 1
          raycaster.setFromCamera(pointer, camera)
        }

        // The surface a text slides along while dragged: the ground for a GROUND text; for an AIR
        // text, an upright plane through it facing the camera, so it follows the finger up/down/
        // left/right at its current distance (a horizontal plane near eye level would barely be
        // hit by the touch ray).
        const dragPlaneFor = (group) => {
          if (group.userData.options.place !== 'air') {
            return new THREE.Plane(UP.clone(), 0)
          }
          const facing = new THREE.Vector3()
          camera.getWorldDirection(facing)
          facing.y = 0
          if (facing.lengthSq() < 1e-6) {
            facing.set(0, 0, -1) // looking straight up/down: any upright plane will do
          }
          return new THREE.Plane().setFromNormalAndCoplanarPoint(facing.normalize().negate(), group.position)
        }

        const pointFromTouch = (touch, plane) => {
          setRayFromTouch(touch)
          return raycaster.ray.intersectPlane(plane, new THREE.Vector3())
        }

        const twoFingerMetrics = (touches) => {
          const dx = touches[1].clientX - touches[0].clientX
          const dy = touches[1].clientY - touches[0].clientY
          return {distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx)}
        }

        const startPinch = (touches) => {
          drag = null
          pinch = {
            ...twoFingerMetrics(touches),
            scale: selectedGroup.scale.x,
            rotationY: selectedGroup.rotation.y,
          }
        }

        canvas.addEventListener('touchstart', async (event) => {
          if (event.touches.length === 2 && selectedGroup) {
            startPinch(event.touches)
            return
          }
          if (event.touches.length !== 1) {
            return
          }

          const touch = event.touches[0]
          setRayFromTouch(touch)

          // Touching a placed text selects it and starts dragging it straight away; touching
          // empty space either deselects, or -- if nothing is selected -- places a new text with
          // the current settings.
          const [textHit] = raycaster.intersectObjects(placedTexts, true)
          if (textHit) {
            let hitGroup = textHit.object
            while (hitGroup.parent && !placedTexts.includes(hitGroup)) {
              hitGroup = hitGroup.parent
            }
            select(hitGroup)
            const plane = dragPlaneFor(hitGroup)
            const point = pointFromTouch(touch, plane)
            drag = {
              touchId: touch.identifier,
              plane,
              offset: point ? hitGroup.position.clone().sub(point) : new THREE.Vector3(),
            }
            return
          }

          if (selectedGroup) {
            deselect()
            return
          }

          await placeTextAt({scene, camera}, raycaster.ray.clone())
        }, true)

        canvas.addEventListener('touchmove', (event) => {
          event.preventDefault()

          if (!selectedGroup) {
            return
          }
          if (event.touches.length >= 2) {
            if (!pinch) {
              startPinch(event.touches) // second finger landed mid-drag
            }
            const {distance, angle} = twoFingerMetrics(event.touches)
            const scale = THREE.MathUtils.clamp(pinch.scale * (distance / pinch.distance), MIN_SCALE, MAX_SCALE)
            selectedGroup.scale.setScalar(scale)
            // Twisting the fingers clockwise on screen turns the text clockwise seen from above.
            selectedGroup.rotation.y = pinch.rotationY - (angle - pinch.angle)
            return
          }
          if (!drag) {
            return
          }
          const touch = Array.from(event.touches).find((t) => t.identifier === drag.touchId)
          if (!touch) {
            return
          }
          const point = pointFromTouch(touch, drag.plane)
          if (point) {
            selectedGroup.position.copy(point.add(drag.offset))
            if (selectedGroup.userData.options.place === 'air') {
              selectedGroup.position.y = Math.max(selectedGroup.position.y, AIR_MIN_HEIGHT)
            }
          }
        }, true)

        const endGesture = (event) => {
          if (pinch && event.touches.length < 2) {
            pinch = null
            if (selectedGroup) {
              selectedGroup.userData.options.size = selectedGroup.scale.x
              onScaleChange(selectedGroup.scale.x)
            }
          }
          // Lifting one finger of a pinch shouldn't turn the other into a drag (it would jump).
          if (event.touches.length === 0 || (drag && !Array.from(event.touches).some((t) => t.identifier === drag.touchId))) {
            drag = null
          }
        }
        canvas.addEventListener('touchend', endGesture, true)
        canvas.addEventListener('touchcancel', endGesture, true)
      },

      // Runs after XR8.Threejs's onUpdate has set this frame's camera pose (this module is added
      // last), and before anything is rendered or hit-tested with it.
      onUpdate: () => {
        const now = nowSeconds()
        poseFilter.apply(liveCamera, now)
        updateLiveTexts(now, Math.min(0.1, now - (lastUpdate ?? now)))
        lastUpdate = now
        placedTexts.forEach((group) => {
          applyMotion(group, now)
          updateContactShadow(group)
        })
      },

      onRender: () => {
        onFrameRendered()
        if (pendingCaptures.length === 0) {
          return
        }
        const canvas = document.getElementById('camerafeed')
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        const resolvers = pendingCaptures
        pendingCaptures = []
        resolvers.forEach((resolve) => resolve(dataUrl))
      },
    },
  }
}
