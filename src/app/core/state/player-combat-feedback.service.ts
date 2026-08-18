import { Injectable, computed, signal } from '@angular/core';
import { ThreeSceneService } from '../engine/three-scene.service';

const FLASH_HOLD_SECONDS = 0.35; // naplno červené
const FLASH_FADE_SECONDS = 0.25; // pak dojede na 0
// Součet musí být citelně KRATŠÍ než AGGRO_ATTACK_COOLDOWN_SECONDS (1s, viz stag.entity.ts) -
// jinak při souboji zblízka (kdy jelen útočí přesně jednou za sekundu) další rána
// "dobije" vinětu ještě předtím, než by stihla doběhnout na 0, a efekt vypadá jako
// nepřetržitě svítící navzdory správně fungujícímu doznívání.
const FLASH_TOTAL_SECONDS = FLASH_HOLD_SECONDS + FLASH_FADE_SECONDS;

// Čistě vizuální "byl jsi zasažen" signál pro HUD (červená viněta) - žádné reálné HP
// hráče. `remaining` je čas do úplného zhasnutí od POSLEDNÍHO zásahu (další zásah ho
// jen nastaví zpátky na FLASH_TOTAL_SECONDS) - opacita se z něj odvozuje čistě jako
// funkce zbývajícího času, ne jako nezávisle dekrementovaná hodnota, takže je
// zaručeno, že bez dalšího zásahu viněta do FLASH_TOTAL_SECONDS vždy zhasne úplně.
@Injectable({ providedIn: 'root' })
export class PlayerCombatFeedbackService {
  private readonly remainingSignal = signal(0);
  readonly flashOpacity = computed(() => {
    const remaining = this.remainingSignal();
    if (remaining <= 0) return 0;
    if (remaining > FLASH_FADE_SECONDS) return 1;
    return remaining / FLASH_FADE_SECONDS;
  });

  private tickRegistered = false;

  constructor(private readonly scene: ThreeSceneService) {}

  notifyHit(): void {
    this.ensureTickRegistered();
    this.remainingSignal.set(FLASH_TOTAL_SECONDS);
  }

  // Líné - NE v konstruktoru. Tahle služba (přes StagService) se konstruuje v
  // konstruktoru GameCanvasComponent, tedy DŘÍV, než vůbec proběhne
  // ThreeSceneService.init() (ten běží až v ngAfterViewInit). init() si na začátku
  // dělá `this.tickables.clear()` kvůli čistému restartu hry - kdyby se tickable
  // registroval už v konstruktoru, init() by ho hned smazal a decay by se nikdy
  // nespustil (přesně tenhle bug jsme takhle chytili - notifyHit fungoval, protože je
  // to přímé volání metody, ale tick() se nikdy nezavolal). Zásah může přijít jedině
  // po startu hry (po init()), takže registrace tady je bezpečně "po".
  private ensureTickRegistered(): void {
    if (this.tickRegistered) return;
    this.tickRegistered = true;
    this.scene.registerTickable((delta) => this.tick(delta));
  }

  private tick(delta: number): void {
    if (this.remainingSignal() <= 0) return;
    this.remainingSignal.update((v) => Math.max(0, v - delta));
  }
}
