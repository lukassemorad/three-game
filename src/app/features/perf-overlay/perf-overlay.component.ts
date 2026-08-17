import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { ThreeSceneService } from '../../core/engine/three-scene.service';

const UPDATE_INTERVAL_MS = 300;

// Dev-only perf HUD (FPS/draw calls/trojúhelníky z renderer.info) - viz GameCanvasComponent,
// kde se připojuje jen když isDevMode(). Vlastní requestAnimationFrame smyčka spuštěná mimo
// Angular zone a zápis přímo do DOM (ne přes signály/binding) - stejný vzor jako render loop
// v ThreeSceneService - aby overlay nikdy nevyvolal change detection.
@Component({
  selector: 'app-perf-overlay',
  templateUrl: './perf-overlay.component.html',
  styleUrl: './perf-overlay.component.scss'
})
export class PerfOverlayComponent implements AfterViewInit, OnDestroy {
  @ViewChild('text', { static: true })
  private textRef!: ElementRef<HTMLPreElement>;

  private frameId: number | null = null;
  private lastUpdate = 0;

  constructor(
    private readonly zone: NgZone,
    private readonly threeScene: ThreeSceneService
  ) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.frameId = requestAnimationFrame(this.loop);
    });
  }

  ngOnDestroy(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
  }

  private readonly loop = (timestamp: number): void => {
    this.frameId = requestAnimationFrame(this.loop);
    if (timestamp - this.lastUpdate < UPDATE_INTERVAL_MS) return;
    this.lastUpdate = timestamp;

    const info = this.threeScene.getRendererInfo();
    this.textRef.nativeElement.textContent =
      `FPS: ${this.threeScene.getFps()}\n` +
      `Draw calls: ${info?.calls ?? '-'}\n` +
      `Triangles: ${info?.triangles ?? '-'}`;
  };
}
