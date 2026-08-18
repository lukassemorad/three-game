import * as THREE from 'three';
import { AnimalBehavior } from './hop-behavior';

export type GrazeState = 'idle' | 'walking' | 'grazing' | 'galloping';

export interface GrazeBehaviorOptions {
  readonly anchor: THREE.Vector3;
  readonly minIdleSeconds: number;
  readonly maxIdleSeconds: number;
  readonly minGrazeSeconds: number;
  readonly maxGrazeSeconds: number;
  readonly walkMinDistance: number;
  readonly walkMaxDistance: number;
  readonly walkSpeed: number;
  readonly gallopMinDistance: number;
  readonly gallopMaxDistance: number;
  readonly gallopSpeed: number;
  readonly getGroundHeight: (x: number, z: number) => number;
  readonly onStateChange: (next: GrazeState) => void;
}

const ARRIVAL_EPSILON = 0.1;
const ACTION_WEIGHTS: Record<'walking' | 'grazing' | 'galloping', number> = {
  walking: 0.55,
  grazing: 0.3,
  galloping: 0.15
};
const POST_WALK_GRAZE_CHANCE = 0.5;

// Ambientní chování bez pathfindingu/kolizí (stejné zjednodušení jako HopBehavior) - jelen
// postává, občas přejde nebo zaběhne cvalem na náhodný bod v okolí a občas se zastaví
// a žere. Na rozdíl od HopBehavior se cíle počítají vždy od pevného `anchor` (spawn pozice),
// ne od aktuální pozice - jinak by se náhodné procházky mohly v čase kumulativně "rozjet"
// daleko od spawnu (u krátkého hopu žáby zanedbatelné, u delšího cvalu jelena už riziko
// vyjetí z biomu/do cesty).
export class GrazeBehavior implements AnimalBehavior {
  private state: GrazeState = 'idle';
  private waitTimer: number;
  private readonly moveTarget = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly options: GrazeBehaviorOptions
  ) {
    this.waitTimer = THREE.MathUtils.randFloat(options.minIdleSeconds, options.maxIdleSeconds);
  }

  update(delta: number): void {
    switch (this.state) {
      case 'idle':
        this.waitTimer -= delta;
        if (this.waitTimer <= 0) this.startNextAction();
        break;
      case 'grazing':
        this.waitTimer -= delta;
        if (this.waitTimer <= 0) this.enterIdle();
        break;
      case 'walking':
        this.stepToward(this.options.walkSpeed, delta, () => this.finishWalk());
        break;
      case 'galloping':
        this.stepToward(this.options.gallopSpeed, delta, () => this.enterIdle());
        break;
    }
  }

  private stepToward(speed: number, delta: number, onArrive: () => void): void {
    const position = this.group.position;
    const dx = this.moveTarget.x - position.x;
    const dz = this.moveTarget.z - position.z;
    const distance = Math.hypot(dx, dz);

    if (distance <= ARRIVAL_EPSILON) {
      onArrive();
      return;
    }

    const step = Math.min(distance, speed * delta);
    position.x += (dx / distance) * step;
    position.z += (dz / distance) * step;
    position.y = this.options.getGroundHeight(position.x, position.z);
    this.group.rotation.y = Math.atan2(dx, dz);
  }

  private startNextAction(): void {
    const roll = Math.random();
    if (roll < ACTION_WEIGHTS.walking) {
      this.startMoveTo('walking', this.options.walkMinDistance, this.options.walkMaxDistance);
    } else if (roll < ACTION_WEIGHTS.walking + ACTION_WEIGHTS.grazing) {
      this.enterGrazing();
    } else {
      this.startMoveTo('galloping', this.options.gallopMinDistance, this.options.gallopMaxDistance);
    }
  }

  private startMoveTo(state: 'walking' | 'galloping', minDistance: number, maxDistance: number): void {
    this.state = state;
    const angle = Math.random() * Math.PI * 2;
    const distance = THREE.MathUtils.randFloat(minDistance, maxDistance);
    this.moveTarget.set(
      this.options.anchor.x + Math.sin(angle) * distance,
      0,
      this.options.anchor.z + Math.cos(angle) * distance
    );
    this.options.onStateChange(state);
  }

  private finishWalk(): void {
    if (Math.random() < POST_WALK_GRAZE_CHANCE) this.enterGrazing();
    else this.enterIdle();
  }

  private enterGrazing(): void {
    this.state = 'grazing';
    this.waitTimer = THREE.MathUtils.randFloat(this.options.minGrazeSeconds, this.options.maxGrazeSeconds);
    this.options.onStateChange('grazing');
  }

  // Veřejné, aby po skončení aggro epizody (viz AggroBehavior.onGiveUp) mohla StagEntity
  // předat řízení zpátky bez duplikace resetovací logiky (waitTimer + crossfade na idle).
  enterIdle(): void {
    this.state = 'idle';
    this.waitTimer = THREE.MathUtils.randFloat(this.options.minIdleSeconds, this.options.maxIdleSeconds);
    this.options.onStateChange('idle');
  }
}
