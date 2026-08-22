import { Injectable, NgZone } from '@angular/core';
import * as THREE from 'three';
import { createIcosphere } from './icosphere';
import { buildGoldbergTiles, PlanetTile } from './goldberg-mesh';
import { buildPlanetSurface, PlanetSurface } from './planet-mesh-builder';
import { PlanetTerrain } from './planet-terrain';
import { buildTileData, TileData } from './planet-biome';
import { PlanetTileIndex } from './planet-tile-index';
import { PlanetPhysicsService, PlayerBodyHandle } from './planet-physics.service';
import { PlanetPlayerController } from './planet-player-controller';
import { PlanetInputService } from './planet-input.service';
import { PlanetVegetationService } from './planet-vegetation.service';
import { PlanetTreeService } from './planet-tree.service';
import { PlanetInteractionService } from './planet-interaction.service';
import {
  DISMOUNT_PROMPT,
  MOUNT_PROMPT,
  PlanetBicycleService
} from './planet-bicycle.service';
import { PlanetDebugBodies } from './planet-debug';
import {
  CAMERA_FAR,
  EYE_OFFSET,
  FEET_OFFSET,
  PLANET_CENTER,
  PLANET_RADIUS,
  PLANET_SUBDIVISION_LEVEL,
  SPAWN_CLEARANCE,
  SPAWN_DIRECTION,
  STAR_COUNT,
  STAR_FIELD_RADIUS
} from './planet-config';

const FPS_SAMPLE_INTERVAL = 0.5;

export interface PlanetSceneStats {
  readonly tiles: number;
  readonly pentagons: number;
  readonly triangles: number;
  readonly chunks: number;
  readonly fps: number;
  readonly usingRapier: boolean;
  readonly playerTile: number;
  readonly playerBiome: string;
  readonly biomeCounts: Readonly<Record<string, number>>;
  readonly vegetationInstances: number;
  readonly vegetationVisibleChunks: number;
  readonly trees: number;
  readonly treeVisibleChunks: number;
  readonly drawCalls: number;
}

export interface PlanetSceneOptions {
  readonly highlightPentagons?: boolean;
  readonly debugBodies?: boolean;
  readonly vegetation?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PlanetSceneService {
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock!: THREE.Clock;

  private terrain!: PlanetTerrain;
  private surface!: PlanetSurface;
  private tiles: readonly PlanetTile[] = [];
  private tileData: readonly TileData[] = [];
  private tileIndex!: PlanetTileIndex;
  private planetMesh: THREE.Mesh | null = null;
  private starField: THREE.Points | null = null;
  private playerHandle!: PlayerBodyHandle;
  private controller!: PlanetPlayerController;
  private debugBodies: PlanetDebugBodies | null = null;

  private frameId: number | null = null;
  private fpsFrameCount = 0;
  private fpsElapsed = 0;
  private fps = 0;
  private pentagonCount = 0;
  private playerTile = 0;
  private biomeCounts: Record<string, number> = {};

  private readonly lookDelta = { x: 0, y: 0 };
  private readonly playerDirScratch = new THREE.Vector3();

  constructor(
    private readonly zone: NgZone,
    private readonly physics: PlanetPhysicsService,
    private readonly input: PlanetInputService,
    private readonly vegetation: PlanetVegetationService,
    private readonly trees: PlanetTreeService,
    private readonly interaction: PlanetInteractionService,
    private readonly bicycle: PlanetBicycleService
  ) {}

  // Getter, ne field initializer - ten by běžel před přiřazením `this.input` z konstruktoru.
  get locked() {
    return this.input.locked;
  }

  async init(canvas: HTMLCanvasElement, options: PlanetSceneOptions = {}): Promise<void> {
    this.terrain = new PlanetTerrain();

    // Geodesická koule -> Goldberg duál -> mesh. Tenhle řetěz je jednorázový; planetka je
    // statická, takže se nic z toho neopakuje za běhu.
    const sphere = createIcosphere(PLANET_SUBDIVISION_LEVEL);
    this.tiles = buildGoldbergTiles(sphere);
    this.tileIndex = new PlanetTileIndex(this.tiles);
    this.tileData = buildTileData(this.tiles, this.terrain);
    this.surface = buildPlanetSurface(this.tiles, this.tileData, this.terrain, {
      highlightPentagons: options.highlightPentagons
    });

    this.pentagonCount = 0;
    for (const tile of this.tiles) if (tile.isPentagon) this.pentagonCount++;

    // Rozložení biomů se spočítá jednou - dev overlay z něj hned pozná, jestli je mapování
    // rozumné (např. že hory nezabírají půl planety nebo naopak nejsou jen pár dlaždic).
    this.biomeCounts = {};
    for (const data of this.tileData) {
      this.biomeCounts[data.biome] = (this.biomeCounts[data.biome] ?? 0) + 1;
    }

    await this.physics.init(this.surface);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060d);

    this.camera = new THREE.PerspectiveCamera(
      75,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      CAMERA_FAR
    );
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.planetMesh = new THREE.Mesh(
      this.surface.geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true })
    );
    this.scene.add(this.planetMesh);

    this.buildStarField();
    this.buildLights();

    const spawn = this.computeSpawnPosition();
    this.playerHandle = this.physics.createPlayer(spawn);
    this.controller = new PlanetPlayerController(
      this.physics,
      this.terrain,
      this.playerHandle,
      spawn
    );
    this.camera.position.copy(spawn).addScaledVector(SPAWN_DIRECTION.clone().normalize(), EYE_OFFSET);

    if (options.debugBodies) {
      this.debugBodies = new PlanetDebugBodies(this.physics, this.terrain, this.scene);
    }

    this.input.attach(canvas);
    // Za jízdy je mezerník sesednutí, jinak skok - jinak by hráč z kola vyskakoval.
    this.input.onPress('Space', () => {
      if (this.bicycle.isRiding()) this.dismountBicycle();
      else this.controller.jump();
    });
    this.input.onPress('KeyR', () => this.controller.teleportTo(this.computeSpawnPosition()));
    this.input.onPress('KeyE', () => {
      if (this.bicycle.isRiding()) this.dismountBicycle();
      else this.interaction.use();
    });
    // Přepínač záchytky: Rapier character controller <-> analytické přisazení k povrchu.
    this.input.onPress('KeyG', () =>
      this.controller.setUseRapierController(!this.controller.isUsingRapierController())
    );

    this.clock = new THREE.Clock();
    this.zone.runOutsideAngular(() => this.animate());

    // Kolo o kousek vedle spawnu hráče, ať je hned po startu na dohled.
    const bicycleDir = SPAWN_DIRECTION.clone()
      .normalize()
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.045)
      .normalize();
    this.bicycle
      .spawn(this.scene, this.terrain, bicycleDir)
      .then(() => this.registerBicycleInteractable())
      .catch((err) => console.error(err));

    if (options.vegetation !== false) {
      // Obsah se dosype až po rozběhnutí smyčky - modely se stahují asynchronně a planeta
      // má být pochozí okamžitě, ne až po dokončení loadu. Stromy jdou první, protože jich
      // je řádově méně a jsou nápadnější.
      this.trees
        .spawn(this.scene, this.tiles, this.tileData, this.tileIndex, this.terrain)
        .then(() =>
          this.vegetation.spawn(this.scene, this.tiles, this.tileData, this.tileIndex, this.terrain)
        )
        .catch((err) => console.error(err));
    }
  }

  lock(): void {
    this.input.requestLock();
  }

  resize(width: number, height: number): void {
    if (!this.renderer || !this.camera) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // Plain getter, ne signál: čte se z requestAnimationFrame smyčky dev overlaye a zapisuje
  // se přímo do DOMu. Signál by znamenal change detection několikrát za sekundu jen kvůli
  // debug čísly - stejný důvod, proč PerfOverlayComponent obchází Angular zone.
  getStats(): PlanetSceneStats {
    const vegetationStats = this.vegetation.getStats();
    const treeStats = this.trees.getStats();
    return {
      tiles: this.tiles.length,
      pentagons: this.pentagonCount,
      triangles: this.surface?.triangleCount ?? 0,
      chunks: this.tileIndex?.chunkCount ?? 0,
      fps: this.fps,
      usingRapier: this.controller?.isUsingRapierController() ?? true,
      playerTile: this.playerTile,
      playerBiome: this.tileData[this.playerTile]?.biome ?? '-',
      biomeCounts: this.biomeCounts,
      vegetationInstances: vegetationStats.instances,
      vegetationVisibleChunks: vegetationStats.visibleChunks,
      trees: treeStats.trees,
      treeVisibleChunks: treeStats.visibleChunks,
      drawCalls: this.renderer?.info.render.calls ?? 0
    };
  }

  dispose(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    this.input.detach();

    this.vegetation.dispose();
    this.trees.dispose();
    this.bicycle.dispose();
    this.interaction.clear();
    this.debugBodies?.dispose();
    this.debugBodies = null;

    if (this.planetMesh) {
      this.planetMesh.geometry.dispose();
      (this.planetMesh.material as THREE.Material).dispose();
      this.planetMesh = null;
    }
    if (this.starField) {
      this.starField.geometry.dispose();
      (this.starField.material as THREE.Material).dispose();
      this.starField = null;
    }

    this.physics.dispose();
    this.renderer?.dispose();
  }

  private registerBicycleInteractable(): void {
    const group = this.bicycle.getGroup();
    if (!group) return;
    this.interaction.register(group, {
      label: 'Kolo',
      prompt: MOUNT_PROMPT,
      onUse: () => this.mountBicycle()
    });
  }

  private mountBicycle(): void {
    if (!this.bicycle.mount(this.controller.getForward())) return;
    // Kolo teď stojí přímo pod hráčem - bez odregistrování by na něj mířil vlastní raycast
    // a svítil prompt "nasedni" na stroj, na kterém už jede.
    const group = this.bicycle.getGroup();
    if (group) this.interaction.unregister(group);
  }

  private dismountBicycle(): void {
    const dismountPosition = this.bicycle.dismount();
    if (!dismountPosition) return;
    this.controller.teleportTo(dismountPosition);
    this.registerBicycleInteractable();
  }

  private computeSpawnPosition(): THREE.Vector3 {
    const dir = SPAWN_DIRECTION.clone().normalize();
    const radius = this.terrain.getSurfaceRadius(dir) + FEET_OFFSET + SPAWN_CLEARANCE;
    return dir.multiplyScalar(radius).add(PLANET_CENTER);
  }

  // Hvězdy jako body na velké kouli okolo scény - planetka pod běžnou modrou oblohou by
  // vypadala jako kopec, ne jako těleso ve vesmíru.
  private buildStarField(): void {
    const positions = new Float32Array(STAR_COUNT * 3);
    const direction = new THREE.Vector3();
    for (let i = 0; i < STAR_COUNT; i++) {
      // Rovnoměrné rozdělení na sféře: z uniformně v -1..1, azimut uniformně - jinak by se
      // hvězdy hromadily u pólů.
      const z = Math.random() * 2 - 1;
      const azimuth = Math.random() * Math.PI * 2;
      const planarRadius = Math.sqrt(1 - z * z);
      direction
        .set(planarRadius * Math.cos(azimuth), planarRadius * Math.sin(azimuth), z)
        .multiplyScalar(STAR_FIELD_RADIUS);
      positions[i * 3] = direction.x;
      positions[i * 3 + 1] = direction.y;
      positions[i * 3 + 2] = direction.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starField = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false })
    );
    this.scene.add(this.starField);
  }

  private buildLights(): void {
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(1, 0.6, 0.4).normalize().multiplyScalar(PLANET_RADIUS * 4);
    this.scene.add(sun);
    // Ambient je záměrně silné: na kouli je vždycky polovina odvrácená od slunce a na
    // úplně černé straně by se nedalo ověřit chování na antipodu.
    this.scene.add(new THREE.AmbientLight(0x6070a0, 1.1));
  }

  // Syrové osy plynu/řízení z W/S/A/D - vozidlo si z nich odvodí zrychlení i yaw-rate samo.
  //
  // POZOR na znaménko řízení: kladné = doleva (A), ne doprava. Vychází to z toho, že kladný
  // yawRate rotuje `forward` okolo `up` k `-right`, tedy doleva. Stejnou konvenci má
  // ThreeSceneService.getRideInputAxes v plochém světě. Obrácené znaménko se navíc projeví
  // dvakrát - kolo zatáčí na opačnou stranu A klopí se do vnějšku zatáčky, protože
  // leanAngle se počítá z `-steerAngle`.
  private readRideInput(): { throttle: number; steer: number } {
    const keys = this.input.pressedKeys;
    let throttle = 0;
    let steer = 0;
    if (keys.has('KeyW')) throttle += 1;
    if (keys.has('KeyS')) throttle -= 1;
    if (keys.has('KeyA')) steer += 1;
    if (keys.has('KeyD')) steer -= 1;
    return { throttle, steer };
  }

  // Prompt interakce a rychlost jízdy pro HUD. Plain getter ze stejného důvodu jako getStats.
  getHudState(): { prompt: string | null; speedKmh: number | null } {
    const riding = this.bicycle.isRiding();
    return {
      prompt: riding ? DISMOUNT_PROMPT : this.interaction.getPrompt(),
      speedKmh: riding ? this.bicycle.getSpeedKmh() : null
    };
  }

  private animate(): void {
    this.frameId = requestAnimationFrame(() => this.animate());
    const delta = this.clock.getDelta();

    this.fpsFrameCount++;
    this.fpsElapsed += delta;
    if (this.fpsElapsed >= FPS_SAMPLE_INTERVAL) {
      this.fps = Math.round(this.fpsFrameCount / this.fpsElapsed);
      this.fpsFrameCount = 0;
      this.fpsElapsed = 0;
    }

    // Při uvolněném pointer locku svět stojí - stejná konvence jako v plochém světě.
    if (this.input.locked()) {
      this.input.consumeLookDelta(this.lookDelta);
      this.controller.addLookDelta(this.lookDelta.x, this.lookDelta.y);

      if (this.bicycle.isRiding()) {
        // Za jízdy jsou W/S/A/D syrové osy plynu a řízení, ne pohyb relativní ke kameře -
        // rozhlížení myší tím vůbec neprochází, takže hráč má za jízdy volný rozhled.
        const seat = this.bicycle.tickRide(delta, this.readRideInput());
        if (seat) {
          this.camera.position.copy(seat);
          this.controller.tickWhileRiding(seat, this.camera);
        }
        this.physics.step(delta);
      } else {
        // Pohyb hráče se počítá proti aktuálnímu stavu colliderů a zapisuje se jako cíl
        // kinematického těla; world.step() ho pak skutečně provede.
        this.controller.tick(delta, this.input.pressedKeys, this.camera);
        this.physics.step(delta);
        this.bicycle.tick();
        this.interaction.update(this.camera);
      }

      this.playerDirScratch.copy(this.camera.position).sub(PLANET_CENTER);
      this.playerTile = this.tileIndex.findTile(this.playerDirScratch);

      this.vegetation.tick(delta, this.camera.position);
      this.trees.tick(delta, this.camera.position);
      this.debugBodies?.syncMeshes();
    }

    this.renderer.render(this.scene, this.camera);
  }
}
