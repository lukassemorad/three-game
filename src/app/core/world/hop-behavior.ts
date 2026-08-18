import * as THREE from 'three';

export interface AnimalBehavior {
  update(delta: number): void;
}

export interface HopBehaviorOptions {
  readonly minWaitSeconds: number;
  readonly maxWaitSeconds: number;
  readonly minHopDistance: number;
  readonly maxHopDistance: number;
  readonly hopDuration: number;
  readonly getGroundHeight: (x: number, z: number) => number;
  readonly onHopStart?: () => void;
  readonly onHopEnd?: () => void;
}

type HopState = 'idle' | 'jumping';

// Náhodný timer bez pathfindingu/kolizí - po většinu času idle, v náhodných intervalech
// otočka + přesun (hop) náhodným směrem. Y během hopu drží getGroundHeight.
export class HopBehavior implements AnimalBehavior {
  private state: HopState = 'idle';
  private waitTimer: number;
  private hopElapsed = 0;
  private readonly hopStart = new THREE.Vector3();
  private readonly hopTarget = new THREE.Vector3();

  constructor(
    private readonly group: THREE.Group,
    private readonly options: HopBehaviorOptions
  ) {
    this.waitTimer = THREE.MathUtils.randFloat(options.minWaitSeconds, options.maxWaitSeconds);
  }

  update(delta: number): void {
    if (this.state === 'idle') {
      this.waitTimer -= delta;
      if (this.waitTimer <= 0) this.startHop();
      return;
    }

    this.hopElapsed += delta;
    const t = Math.min(1, this.hopElapsed / this.options.hopDuration);
    this.group.position.lerpVectors(this.hopStart, this.hopTarget, t);
    this.group.position.y = this.options.getGroundHeight(this.group.position.x, this.group.position.z);

    if (t >= 1) this.finishHop();
  }

  private startHop(): void {
    this.state = 'jumping';
    this.hopElapsed = 0;

    const yaw = Math.random() * Math.PI * 2;
    this.group.rotation.y = yaw;
    const distance = THREE.MathUtils.randFloat(this.options.minHopDistance, this.options.maxHopDistance);
    const direction = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.hopStart.copy(this.group.position);
    this.hopTarget.copy(this.hopStart).addScaledVector(direction, distance);
    this.hopTarget.y = this.options.getGroundHeight(this.hopTarget.x, this.hopTarget.z);

    this.options.onHopStart?.();
  }

  private finishHop(): void {
    this.state = 'idle';
    this.waitTimer = THREE.MathUtils.randFloat(this.options.minWaitSeconds, this.options.maxWaitSeconds);
    this.options.onHopEnd?.();
  }
}
