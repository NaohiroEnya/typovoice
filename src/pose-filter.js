// Steadies the AR camera pose. 8th Wall's SLAM pose has a little frame-to-frame noise, which the
// XR8.Threejs module copies straight onto the three.js camera; with the phone held still that
// noise makes placed text visibly tremble. This applies a One Euro filter (Casiez et al. 2012):
// strong smoothing while the camera is (nearly) still, little to none while it's really moving,
// so the text stays put without lagging behind the camera feed during actual motion.
// It runs in this app's own pipeline module, after XR8.Threejs has set the camera for the frame
// and before it renders, so the XR layer itself is untouched.
import * as THREE from 'three'

// Position (meters): SLAM translation is the noisy part, so it's smoothed the most.
const POSITION = {minCutoff: 0.4, beta: 10, dCutoff: 1}
// Rotation (radians): mostly from the gyro and already steady, so only a light touch -- smoothing
// real hand rotation would make the text slide against the camera feed.
const ROTATION = {minCutoff: 2.5, beta: 1.5, dCutoff: 1}
// A jump this large is a tracking reset/recenter, not noise: snap to it.
const SNAP_DISTANCE = 0.3
const SNAP_ANGLE = 0.5

const alpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff)
  return 1 / (1 + tau / dt)
}

export const createPoseFilter = () => {
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  let positionSpeed = 0 // filtered speed, m/s
  let rotationSpeed = 0 // filtered angular speed, rad/s
  let lastTime = null

  const reset = (camera, now) => {
    position.copy(camera.position)
    rotation.copy(camera.quaternion)
    positionSpeed = 0
    rotationSpeed = 0
    lastTime = now
  }

  // Replaces the camera's raw pose for this frame with the filtered one. `now` is in seconds.
  const apply = (camera, now) => {
    const dt = lastTime === null ? 0 : now - lastTime
    if (dt <= 0 || dt > 0.5) {
      reset(camera, now) // first frame, or resuming after the tab was hidden
      return
    }
    const distance = position.distanceTo(camera.position)
    const angle = rotation.angleTo(camera.quaternion)
    if (distance > SNAP_DISTANCE || angle > SNAP_ANGLE) {
      reset(camera, now)
      return
    }
    lastTime = now

    positionSpeed += alpha(POSITION.dCutoff, dt) * (distance / dt - positionSpeed)
    position.lerp(camera.position, alpha(POSITION.minCutoff + POSITION.beta * positionSpeed, dt))

    rotationSpeed += alpha(ROTATION.dCutoff, dt) * (angle / dt - rotationSpeed)
    rotation.slerp(camera.quaternion, alpha(ROTATION.minCutoff + ROTATION.beta * rotationSpeed, dt))

    camera.position.copy(position)
    camera.quaternion.copy(rotation)
    camera.updateMatrixWorld(true)
  }

  return {apply}
}
