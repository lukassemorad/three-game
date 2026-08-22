import * as THREE from 'three';
import type * as RapierNS from '@dimforge/rapier3d-compat';
import { PlanetPhysicsService } from './planet-physics.service';
import { PlanetTerrain } from './planet-terrain';
import {
  PLANET_CENTER,
  SPAWN_DIRECTION,
  TEST_BODY_COUNT,
  TEST_BODY_DROP_HEIGHT,
  TEST_BODY_HALF_EXTENT
} from './planet-config';

// Dev-only lešení: kostky spadlé po celé planetě (včetně antipodu ke spawnu). Když všechny
// dosednou a zůstanou ležet, je radiální gravitace ověřená i pro ne-hráčská tělesa - to je
// vlastní důkaz, že fyzika planety unese budoucí obsah.
//
// Žije mimo PlanetSceneService, aby se prototypové lešení nemíchalo do produkčního kódu
// scény; zapíná se jen v isDevMode() (viz PlanetPrototypeComponent).

interface TestBody {
  readonly body: RapierNS.RigidBody;
  readonly mesh: THREE.Mesh;
}

export class PlanetDebugBodies {
  private readonly bodies: TestBody[] = [];
  // Geometrii sdílí všechny kostky, takže se uvolňuje jednou - materiál má každá vlastní.
  private readonly geometry: THREE.BoxGeometry;

  constructor(
    private readonly physics: PlanetPhysicsService,
    terrain: PlanetTerrain,
    scene: THREE.Scene
  ) {
    this.geometry = new THREE.BoxGeometry(
      TEST_BODY_HALF_EXTENT * 2,
      TEST_BODY_HALF_EXTENT * 2,
      TEST_BODY_HALF_EXTENT * 2
    );
    const spawnDir = SPAWN_DIRECTION.clone().normalize();

    for (let i = 0; i < TEST_BODY_COUNT; i++) {
      // Zlatý úhel dá rovnoměrné rozprostření po celé kouli bez shluků.
      const t = (i + 0.5) / TEST_BODY_COUNT;
      const z = 1 - 2 * t;
      const azimuth = i * Math.PI * (3 - Math.sqrt(5));
      const planarRadius = Math.sqrt(Math.max(0, 1 - z * z));
      const dir = new THREE.Vector3(
        planarRadius * Math.cos(azimuth),
        planarRadius * Math.sin(azimuth),
        z
      ).normalize();

      const position = dir
        .clone()
        .multiplyScalar(terrain.getSurfaceRadius(dir) + TEST_BODY_DROP_HEIGHT)
        .add(PLANET_CENTER);

      const body = this.physics.createDynamicBox(position, TEST_BODY_HALF_EXTENT);
      // Kostka blízko spawnu ať je jinak barevná, aby byla hned poznat.
      const isNearSpawn = dir.dot(spawnDir) > 0.7;
      const mesh = new THREE.Mesh(
        this.geometry,
        new THREE.MeshStandardMaterial({ color: isNearSpawn ? 0xffb347 : 0x9ad0ff })
      );
      mesh.position.copy(position);
      scene.add(mesh);
      this.bodies.push({ body, mesh });
    }
  }

  syncMeshes(): void {
    for (const { body, mesh } of this.bodies) {
      const { translation, rotation } = this.physics.readBodyTransform(body);
      mesh.position.set(translation.x, translation.y, translation.z);
      mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const { mesh } of this.bodies) {
      mesh.removeFromParent();
      (mesh.material as THREE.Material).dispose();
    }
    this.bodies.length = 0;
  }
}
