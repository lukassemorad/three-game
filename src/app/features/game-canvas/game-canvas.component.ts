import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild
} from '@angular/core';
import * as THREE from 'three';
import { ThreeSceneService } from '../../core/engine/three-scene.service';
import { BuildingService } from '../../core/world/building.service';
import { createCircleExclusionZone, createRoadExclusionZone } from '../../core/world/placement-exclusion';
import { RoadNetwork } from '../../core/world/road-network';
import { generateTreePositions } from '../../core/world/tree-placement';
import { TreeService } from '../../core/world/tree.service';
import { RoadDefinition } from '../../shared/models/road.model';
import { HudComponent } from '../hud/hud.component';

const WORLD_BOUNDS = { minX: -50, maxX: 50, minZ: -100, maxZ: 100 };
const BUILDING_POSITION = { x: 12, z: -20 };
const BUILDING_EXCLUSION_RADIUS = 3;

const MAIN_ROAD: RoadDefinition = {
  points: [
    { x: 0, z: -100 },
    { x: -6, z: -45 },
    { x: 0, z: 0 },
    { x: 8, z: 55 },
    { x: 2, z: 100 }
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
    private readonly treeService: TreeService,
    private readonly buildingService: BuildingService
  ) {}

  async ngAfterViewInit(): Promise<void> {
    const roadNetwork = new RoadNetwork(MAIN_ROAD);
    await this.threeScene.init(this.canvasRef.nativeElement, roadNetwork);
    const groundedVec3 = (x: number, z: number) =>
      new THREE.Vector3(x, this.threeScene.getGroundHeight(x, z), z);

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

  @HostListener('window:resize')
  onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    this.threeScene.resize(canvas.clientWidth, canvas.clientHeight);
  }
}
