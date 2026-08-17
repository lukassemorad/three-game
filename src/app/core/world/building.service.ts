import { Injectable } from '@angular/core';
import * as THREE from 'three';
import { CollisionService } from '../engine/collision.service';
import { ThreeSceneService } from '../engine/three-scene.service';
import { PhysicsService } from '../engine/physics.service';
import { TreeService } from './tree.service';
import { BuildingConfig, BuildingEntity } from './building.entity';

@Injectable({ providedIn: 'root' })
export class BuildingService {
  private readonly buildings = new Map<string, BuildingEntity>();
  private tickableRegistered = false;

  constructor(
    private readonly scene: ThreeSceneService,
    private readonly collision: CollisionService,
    private readonly physics: PhysicsService,
    private readonly treeService: TreeService
  ) {}

  spawnBuilding(config: BuildingConfig): void {
    if (!this.tickableRegistered) {
      this.tickableRegistered = true;
      // Registrováno až tady (po TreeService.spawnTrees, viz GameCanvasComponent) - tickables
      // je Set iterovaný v pořadí registrace, takže fyzika/sync padlých kmenů v TreeService
      // proběhne dřív než tahle kontrola zóny ve stejném snímku.
      this.scene.registerTickable(() => {
        for (const building of this.buildings.values()) {
          this.treeService.collectLogsInZone({
            x: building.group.position.x,
            z: building.group.position.z,
            radius: building.collectionRadius
          });
        }
      });
    }

    const building = new BuildingEntity(config);
    this.buildings.set(building.id, building);
    this.scene.addToScene(building.group);

    for (const wall of building.wallBoxColliders) {
      this.physics.createStaticBoxCollider(
        building.group.position.x + wall.center.x,
        building.group.position.y + wall.center.y,
        building.group.position.z + wall.center.z,
        wall.halfExtents
      );
    }

    // World-space kopie stejných boxů pro CollisionService - používá je TreeService.tickGrab,
    // aby nesený kmen nemohl projít zdí (Rapier kinematické tělo samo kolize netestuje).
    this.collision.registerBoxes(
      building.id,
      building.wallBoxColliders.map((wall) => ({
        center: {
          x: building.group.position.x + wall.center.x,
          y: building.group.position.y + wall.center.y,
          z: building.group.position.z + wall.center.z
        },
        halfExtents: wall.halfExtents
      }))
    );

    for (let i = 0; i < building.groundWallSegments.length; i++) {
      const segment = building.groundWallSegments[i];
      this.registerGroundSegmentColliders(building, segment, i);
    }
  }

  dispose(): void {
    this.buildings.clear();
    this.tickableRegistered = false;
  }

  // Rovná zeď aproximovaná řetězcem kruhových koliderů podél délky - stejná technika jako
  // TreeService.registerFallenCollisionSegments pro ležící kmen (CollisionService umí jen kruhy).
  private registerGroundSegmentColliders(
    building: BuildingEntity,
    segment: { start: THREE.Vector2; end: THREE.Vector2; radius: number },
    segmentIndex: number
  ): void {
    const length = segment.start.distanceTo(segment.end);
    const count = Math.max(2, Math.ceil(length / segment.radius));
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const point = segment.start.clone().lerp(segment.end, t);
      this.collision.register(`${building.id}-wall-${segmentIndex}-${i}`, {
        x: building.group.position.x + point.x,
        z: building.group.position.z + point.y,
        radius: segment.radius
      });
    }
  }
}
