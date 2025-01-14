import * as THREE from '../extras/three'

import { Entity } from './Entity'
import { glbToNodes } from '../extras/glbToNodes'
import { createNode } from '../extras/createNode'
import { NetworkedVector3 } from '../extras/NetworkedVector3'
import { NetworkedQuaternion } from '../extras/NetworkedQuaternion'
import { ControlPriorities } from '../extras/ControlPriorities'

export class App extends Entity {
  constructor(world, data, local) {
    super(world, data, local)
    this.isApp = true
    this.build()
  }

  async build() {
    // cleanup any previous build
    this.unbuild()
    // fetch app config
    this.config = this.world.apps.get(this.data.app)
    // set up our base
    this.base = createNode({ name: 'group' })
    this.base.position.fromArray(this.data.position)
    this.base.quaternion.fromArray(this.data.quaternion)
    // activate, but if moving dont run physics
    this.base.activate({ world: this.world, entity: this, physics: !this.data.mover })
    // if moving we need updates
    if (this.data.mover) this.world.setHot(this, true)
    // if we're the mover lets bind controls
    if (this.data.mover === this.world.network.id) {
      this.lastMoveSendTime = 0
      this.control = this.world.controls.bind({
        priority: ControlPriorities.APP,
        onScroll: () => {
          return true
        },
      })
    }
    // if remote is moving, set up to receive network updates
    this.networkPosition = new NetworkedVector3(this.base.position, this.world.networkRate)
    this.networkQuaternion = new NetworkedQuaternion(this.base.quaternion, this.world.networkRate)
    // if (this.data.mover && this.data.mover !== this.world.network.id) {
    // }
    // if remote is uploading, display a loading indicator
    if (this.data.uploader && this.data.uploader !== this.world.network.id) {
      const box = createNode({ name: 'mesh' })
      box.type = 'box'
      box.width = 1
      box.height = 1
      box.depth = 1
      this.base.add(box)
    }
    // otherwise we can load our glb
    else {
      let glb = this.world.loader.get('glb', this.config.model)
      if (!glb) glb = await this.world.loader.load('glb', this.config.model)
      this.base.add(glb.toNodes())
    }
  }

  unbuild() {
    if (this.base) {
      this.base.deactivate()
      this.base = null
    }
    if (this.control) {
      this.control?.release()
      this.control = null
    }
    this.world.setHot(this, false)
  }

  update(delta) {
    // if we're moving the app, handle that
    if (this.data.mover === this.world.network.id) {
      if (this.control.buttons.ShiftLeft) {
        // if shift is down we're raising and lowering the app
        this.base.position.y -= this.world.controls.pointer.delta.y * delta * 0.5
      } else {
        // otherwise move with the cursor
        const position = this.world.controls.pointer.position
        const hits = this.world.stage.raycastPointer(position)
        let hit
        for (const _hit of hits) {
          const entity = _hit.getEntity?.()
          // ignore self and players
          if (entity === this || entity?.isPlayer) continue
          hit = _hit
          break
        }
        if (hit) {
          this.base.position.copy(hit.point)
        }
        // and rotate with the mouse wheel
        this.base.rotation.y += this.control.scroll.delta * 0.1 * delta
      }

      // periodically send updates
      this.lastMoveSendTime += delta
      if (this.lastMoveSendTime > this.world.networkRate) {
        this.world.network.send('entityModified', {
          id: this.data.id,
          position: this.base.position.toArray(),
          quaternion: this.base.quaternion.toArray(),
        })
        this.lastMoveSendTime = 0
      }
      // if we left clicked, we can place the app
      if (this.control.pressed.MouseLeft) {
        this.data.mover = null
        this.data.position = this.base.position.toArray()
        this.data.quaternion = this.base.quaternion.toArray()
        this.world.network.send('entityModified', {
          id: this.data.id,
          mover: null,
          position: this.data.position,
          quaternion: this.data.quaternion,
        })
        this.build()
      }
    }
    // if someone else is moving the app, interpolate updates
    if (this.data.mover && this.data.mover !== this.world.network.id) {
      this.networkPosition.update(delta)
      this.networkQuaternion.update(delta)
    }
  }

  onUploaded() {
    this.data.uploader = null
    this.world.network.send('entityModified', { id: this.data.id, uploader: null })
  }

  modify(data) {
    let rebuild
    if (data.hasOwnProperty('app')) {
      this.data.app = data.app
      rebuild = true
    }
    if (data.hasOwnProperty('uploader')) {
      this.data.uploader = data.uploader
      rebuild = true
    }
    if (data.hasOwnProperty('mover')) {
      this.data.mover = data.mover
      rebuild = true
    }
    if (data.hasOwnProperty('position')) {
      this.data.position = data.position
      this.networkPosition.pushArray(data.position)
    }
    if (data.hasOwnProperty('quaternion')) {
      this.data.quaternion = data.quaternion
      this.networkQuaternion.pushArray(data.quaternion)
    }
    if (rebuild) {
      this.build()
    }
  }

  move() {
    this.data.mover = this.world.network.id
    this.build()
    this.world.network.send('entityModified', { id: this.data.id, mover: this.data.mover })
  }

  destroy(local) {
    this.unbuild()
    super.destroy(local)
  }
}
