import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  effect
} from '@angular/core';
import { Router } from '@angular/router';
import * as THREE from 'three';
import { GameFlowService } from '../../core/state/game-flow.service';
import { PlayerStateService } from '../../core/state/player-state.service';
import { SaveGameService } from '../../core/state/save-game.service';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { BuildingService } from '../../core/world/building.service';
import { createCircleExclusionZone, createRoadExclusionZone } from '../../core/world/placement-exclusion';
import { RoadNetwork } from '../../core/world/road-network';
import { generateTreePositions } from '../../core/world/tree-placement';
import { TreeService } from '../../core/world/tree.service';
import { WORLD_BOUNDS } from '../../core/world/world-config';
import { RoadDefinition } from '../../shared/models/road.model';
import { HudComponent } from '../hud/hud.component';

const BUILDING_POSITION = { x: 12, z: -55 };
const BUILDING_EXCLUSION_RADIUS = 3;

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
  imports: [HudComponent],
  templateUrl: './game-canvas.component.html',
  styleUrl: './game-canvas.component.scss'
})
export class GameCanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  constructor(
    protected readonly threeScene: ThreeSceneService,
    protected readonly gameFlow: GameFlowService,
    private readonly treeService: TreeService,
    private readonly buildingService: BuildingService,
    private readonly playerState: PlayerStateService,
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
    await this.threeScene.init(this.canvasRef.nativeElement, roadNetwork);
    const groundedVec3 = (x: number, z: number) =>
      new THREE.Vector3(x, this.threeScene.getGroundHeight(x, z), z);

    const save = this.saveGame.load();
    if (save) {
      this.treeService.restoreTrees({ intact: save.intactTrees, detailed: save.trees });
      this.threeScene.setPlayerTransform(save.player.position, save.player.rotation);
      this.playerState.hydrate({ money: save.player.money, treesChoppedCount: save.player.treesChoppedCount });
    } else {
      this.playerState.reset();
      const exclusionZones = [
        createRoadExclusionZone(roadNetwork, ROAD_TREE_CLEARANCE),
        createCircleExclusionZone(BUILDING_POSITION, BUILDING_EXCLUSION_RADIUS)
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
  }

  ngOnDestroy(): void {
    this.buildingService.dispose();
    this.treeService.dispose();
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
