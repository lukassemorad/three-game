import { Injectable, NgZone, signal } from '@angular/core';
import { SettingsService } from '../state/settings.service';

// Vstupy planetární scény: klávesnice, myš, pointer lock.
//
// Odštěpené ze scény záměrně - `ThreeSceneService` plochého světa má 797 řádků a 8
// odpovědností v jedné třídě (scéna, smyčka, vstupy, pohyb, terén, interakce, grab, ride)
// a je to na něm vidět. Než na planetární scénu začne viset obsah, má vstup žít vedle.
//
// Pointer lock se řídí přímo přes browser API (`requestPointerLock`, `pointerlockchange`),
// ne přes `PointerLockControls` - ten předpokládá pevnou world-Y osu, viz komentář
// v planet-player-controller.ts.
@Injectable({ providedIn: 'root' })
export class PlanetInputService {
  private readonly lockedSignal = signal(false);
  readonly locked = this.lockedSignal.asReadonly();

  private readonly keys = new Set<string>();
  private canvas: HTMLCanvasElement | null = null;

  // Nasbíraná výchylka myši za frame. Scéna si ji vyzvedne v ticku, aby se yaw otáčel
  // okolo `up` platného pro tenhle frame, ne okolo toho z doby doručení eventu.
  private lookDeltaX = 0;
  private lookDeltaY = 0;

  // Akce, které se dějí jednorázově na stisk (ne držením) - scéna si na ně navěsí handler,
  // aby si služba nemusela tahat referenci na kontrolér.
  private readonly pressListeners = new Map<string, () => void>();

  private readonly onKeyDown = (event: KeyboardEvent) => {
    // Repeat by u jednorázových akcí (skok, respawn) při držení klávesy spouštěl akci
    // opakovaně každý frame.
    if (!event.repeat) {
      const listener = this.pressListeners.get(event.code);
      if (listener) {
        event.preventDefault();
        listener();
      }
    }
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.lockedSignal()) return;
    this.lookDeltaX += event.movementX;
    this.lookDeltaY += event.movementY;
  };

  private readonly onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    // Smyčka i listenery běží mimo Angular zone (viz PlanetSceneService.init), takže zápis
    // do signálu musí projít zone.run(), jinak se change detection nespustí.
    this.zone.run(() => this.lockedSignal.set(locked));
    if (!locked) {
      this.keys.clear();
      this.lookDeltaX = 0;
      this.lookDeltaY = 0;
    }
  };

  constructor(
    private readonly zone: NgZone,
    private readonly settings: SettingsService
  ) {}

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.keys.clear();
    this.pressListeners.clear();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.onKeyDown);
      document.addEventListener('keyup', this.onKeyUp);
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('pointerlockchange', this.onPointerLockChange);
    });
  }

  detach(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    if (this.canvas && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.keys.clear();
    this.pressListeners.clear();
    this.canvas = null;
  }

  onPress(code: string, listener: () => void): void {
    this.pressListeners.set(code, listener);
  }

  requestLock(): void {
    this.canvas?.requestPointerLock();
  }

  get pressedKeys(): ReadonlySet<string> {
    return this.keys;
  }

  // Vyzvedne a vynuluje nasbíranou výchylku myši, přepočtenou citlivostí z nastavení.
  consumeLookDelta(target: { x: number; y: number }): { x: number; y: number } {
    const sensitivity = this.settings.lookSensitivity();
    target.x = this.lookDeltaX * sensitivity;
    target.y = this.lookDeltaY * sensitivity;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return target;
  }
}
