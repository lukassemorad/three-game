import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect,
  isDevMode
} from '@angular/core';
import { Router } from '@angular/router';
import * as THREE from 'three';
import { GameFlowService } from '../../core/state/game-flow.service';
import { InventoryService } from '../../core/state/inventory.service';
import { PlayerStateService } from '../../core/state/player-state.service';
import { SaveGameService } from '../../core/state/save-game.service';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { BuildingService } from '../../core/world/building.service';
import { ShopService } from '../../core/world/shop.service';
import { createCircleExclusionZone, createRoadExclusionZone } from '../../core/world/placement-exclusion';
import { RoadNetwork } from '../../core/world/road-network';
import { generateTreePositions } from '../../core/world/tree-placement';
import { PlayerHandService } from '../../core/world/player-hand.service';
import { TreeService } from '../../core/world/tree.service';
import { WORLD_BOUNDS } from '../../core/world/world-config';
import { RoadDefinition } from '../../shared/models/road.model';
import { HotbarComponent } from '../hotbar/hotbar.component';
import { HudComponent } from '../hud/hud.component';
import { PerfOverlayComponent } from '../perf-overlay/perf-overlay.component';

const BUILDING_POSITION = { x: 12, z: -55 };
const BUILDING_EXCLUSION_RADIUS = 4;

const SHOP_POSITION = { x: 12, z: -70 };
const SHOP_EXCLUSION_RADIUS = 6;
// Terén pod obchodem dorovnaný na plocho (viz FlatZone), jinak by nerovný terén podlahou
// prosvítal nebo naopak podlaha visela nad zemí. Radius pokrývá půdorys i s přesahem střechy
// (5.8 m do rohu), feather ho pak dalších 4 m hladce vrací k přirozenému terénu. `raise`
// navíc celou plochu nadzvedne o 18 cm - s rezervou nad mikro-reliéfní jitter vizuálního
// terénu (5 cm) a zároveň dá obchodu malý přirozený náběh/podstavec (viz schůdek u vchodu
// v shop.entity.ts).
const SHOP_FLAT_ZONE = { x: SHOP_POSITION.x, z: SHOP_POSITION.z, radius: 6, feather: 4, raise: 0.18 };

const MAIN_ROAD: RoadDefinition = {
  points: [
    { x: 0, z: -150 },
    { x: -13, z: -68 },
    { x: 0, z: 0 },
    { x: 18, z: 83 },
    { x: 4, z: 150 }
  ],
  width: 4,
  surfaceColor: 0x8a7a5c
};
const ROAD_TREE_CLEARANCE = 1.5;

@Component({
  selector: 'app-game-canvas',
  imports: [HudComponent, PerfOverlayComponent, HotbarComponent],
  templateUrl: './game-canvas.component.html',
  styleUrl: './game-canvas.component.scss'
})
export class GameCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly showPerfOverlay = isDevMode();

  constructor(
    protected readonly threeScene: ThreeSceneService,
    protected readonly gameFlow: GameFlowService,
    private readonly treeService: TreeService,
    private readonly buildingService: BuildingService,
    private readonly shopService: ShopService,
    private readonly playerHandService: PlayerHandService,
    private readonly playerState: PlayerStateService,
    private readonly inventory: InventoryService,
    private readonly saveGame: SaveGameService,
    private readonly router: Router
  ) {
    // `unlock` ruší jen z 'playing' - hned po init() je `locked` taky false, ale fáze
    // je pořád 'not-started', takže se tím omylem neskočí do 'paused'.
    effect(() => {
      if (this.threeScene.locked()) {
        this.gameFlow.setPlaying();
      } else if (this.gameFlow.phase() === 'playing') {
        this.gameFlow.setPaused();
      }
    });
  }

  async ngAfterViewInit(): Promise<void> {
    this.gameFlow.reset();
    const roadNetwork = new RoadNetwork(MAIN_ROAD);
    await this.threeScene.init(this.canvasRef.nativeElement, roadNetwork, [SHOP_FLAT_ZONE]);
    const groundedVec3 = (x: number, z: number) =>
      new THREE.Vector3(x, this.threeScene.getGroundHeight(x, z), z);

    const save = this.saveGame.load();
    if (save) {
      this.treeService.restoreTrees({ intact: save.intactTrees, detailed: save.trees });
      this.threeScene.setPlayerTransform(save.player.position, save.player.rotation);
      this.playerState.hydrate({ money: save.player.money, treesChoppedCount: save.player.treesChoppedCount });
      this.inventory.hydrate({
        ownedItemIds: save.player.ownedItemIds,
        equippedItemId: save.player.equippedItemId
      });
    } else {
      this.playerState.reset();
      this.inventory.reset();
      const exclusionZones = [
        createRoadExclusionZone(roadNetwork, ROAD_TREE_CLEARANCE),
        createCircleExclusionZone(BUILDING_POSITION, BUILDING_EXCLUSION_RADIUS),
        createCircleExclusionZone(SHOP_POSITION, SHOP_EXCLUSION_RADIUS)
      ];
      this.treeService.spawnTrees(
        generateTreePositions(WORLD_BOUNDS, exclusionZones).map(({ x, z, variant }) => ({
          position: groundedVec3(x, z),
          variant
        }))
      );
    }

    this.buildingService.spawnBuilding({
      position: groundedVec3(BUILDING_POSITION.x, BUILDING_POSITION.z)
    });
    this.shopService.spawnShop({
      position: groundedVec3(SHOP_POSITION.x, SHOP_POSITION.z)
    });
    this.playerHandService.spawn();
  }

  ngOnDestroy(): void {
    this.buildingService.dispose();
    this.shopService.dispose();
    this.treeService.dispose();
    this.playerHandService.dispose();
    this.threeScene.dispose();
  }

  onStartClick(): void {
    this.threeScene.lock();
  }

  onSaveAndExitClick(): void {
    this.saveGame.save();
    this.router.navigate(['/']);
  }

  @HostListener('window:resize')
  onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    this.threeScene.resize(canvas.clientWidth, canvas.clientHeight);
  }
}
