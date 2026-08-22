import {
  AfterViewInit,
  Component,
  ElementRef,
  HostListener,
  NgZone,
  OnDestroy,
  ViewChild,
  isDevMode
} from '@angular/core';
import { Router } from '@angular/router';
import { PlanetSceneService } from '../../core/planet/planet-scene.service';

const DEBUG_UPDATE_INTERVAL_MS = 300;

@Component({
  selector: 'app-planet-prototype',
  templateUrl: './planet-prototype.component.html',
  styleUrl: './planet-prototype.component.scss'
})
export class PlanetPrototypeComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', { static: true })
  private canvasRef!: ElementRef<HTMLCanvasElement>;

  @ViewChild('debugText')
  private debugTextRef?: ElementRef<HTMLPreElement>;

  @ViewChild('hudText', { static: true })
  private hudTextRef!: ElementRef<HTMLDivElement>;

  protected readonly showDebug = isDevMode();

  private debugFrameId: number | null = null;
  private lastDebugUpdate = 0;

  constructor(
    protected readonly planetScene: PlanetSceneService,
    private readonly zone: NgZone,
    private readonly router: Router
  ) {}

  async ngAfterViewInit(): Promise<void> {
    // V dev módu se 12 pětiúhelníků obarví červeně - jinak se na 10 242 dlaždicích nedají
    // najít a nešlo by ověřit chování kontroléru právě na nich. Testovací kostky ověřují
    // radiální gravitaci pro ne-hráčská tělesa.
    await this.planetScene.init(this.canvasRef.nativeElement, {
      highlightPentagons: isDevMode(),
      debugBodies: isDevMode()
    });

    // Vlastní smyčka mimo Angular zone se zápisem přímo do DOMu - stejný vzor jako
    // PerfOverlayComponent, aby HUD ani debug čísla nikdy nespustily change detection.
    // HUD (prompt/rychlost) běží vždy, debug panel jen v dev módu.
    this.zone.runOutsideAngular(() => {
      this.debugFrameId = requestAnimationFrame(this.debugLoop);
    });
  }

  ngOnDestroy(): void {
    if (this.debugFrameId !== null) cancelAnimationFrame(this.debugFrameId);
    this.planetScene.dispose();
  }

  @HostListener('window:resize')
  onResize(): void {
    const canvas = this.canvasRef.nativeElement;
    this.planetScene.resize(canvas.clientWidth, canvas.clientHeight);
  }

  protected onStartClick(): void {
    this.planetScene.lock();
  }

  protected onBackClick(): void {
    this.router.navigate(['/']);
  }

  private readonly debugLoop = (timestamp: number): void => {
    this.debugFrameId = requestAnimationFrame(this.debugLoop);

    // HUD se aktualizuje každý frame - rychlost jízdy by při 300ms throttlingu poskakovala.
    const hud = this.planetScene.getHudState();
    const hudText =
      hud.speedKmh !== null ? `${hud.speedKmh.toFixed(1)} km/h · ${hud.prompt ?? ''}` : hud.prompt;
    const hudElement = this.hudTextRef.nativeElement;
    if (hudElement.textContent !== (hudText ?? '')) {
      hudElement.textContent = hudText ?? '';
    }

    if (timestamp - this.lastDebugUpdate < DEBUG_UPDATE_INTERVAL_MS) return;
    this.lastDebugUpdate = timestamp;

    const element = this.debugTextRef?.nativeElement;
    if (!element) return;

    const stats = this.planetScene.getStats();
    const biomes = Object.entries(stats.biomeCounts)
      .map(([biome, count]) => `${biome} ${Math.round((count / stats.tiles) * 100)}%`)
      .join(' · ');
    element.textContent =
      `FPS: ${stats.fps}\n` +
      `Dlaždice: ${stats.tiles} (${stats.pentagons} pětiúhelníků)\n` +
      `Trojúhelníky: ${stats.triangles}\n` +
      `Chunky: ${stats.chunks}\n` +
      `Biomy: ${biomes}\n` +
      `Tráva: ${stats.vegetationInstances} instancí, ${stats.vegetationVisibleChunks} chunků vidět\n` +
      `Stromy: ${stats.trees}, ${stats.treeVisibleChunks} chunků vidět\n` +
      `Draw calls: ${stats.drawCalls}\n` +
      `Hráč: dlaždice ${stats.playerTile}, biom ${stats.playerBiome}\n` +
      `Zem: ${stats.usingRapier ? 'Rapier controller' : 'analytické přisazení'}`;
  };
}
