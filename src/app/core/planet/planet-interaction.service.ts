import { Injectable } from '@angular/core';
import * as THREE from 'three';

// Na co se hráč kouká a co s tím může udělat.
//
// Planeta tohle dosud neměla vůbec - v plochém světě je celý registr interaktivních objektů,
// raycast i look-target uvnitř ThreeSceneService (jedna ze osmi odpovědností, které z něj
// dělají 797řádkový god object). Tady je to samostatná služba od začátku.
//
// Záměrně minimální: prompt + akce. Grab/carry, sekání a autofire z plochého světa tu nejsou,
// protože je nic nepotřebuje - přidají se, až je bude mít kdo použít.
const INTERACTION_DISTANCE = 3.5;

export interface PlanetInteractable {
  readonly label: string;
  readonly prompt: string;
  readonly onUse: () => void;
}

@Injectable({ providedIn: 'root' })
export class PlanetInteractionService {
  private readonly registry = new Map<THREE.Object3D, PlanetInteractable>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly cameraDirection = new THREE.Vector3();

  private currentTarget: PlanetInteractable | null = null;

  constructor() {
    this.raycaster.far = INTERACTION_DISTANCE;
  }

  register(object: THREE.Object3D, interactable: PlanetInteractable): void {
    this.registry.set(object, interactable);
  }

  unregister(object: THREE.Object3D): void {
    this.registry.delete(object);
    // Kdyby se odregistroval právě zacílený objekt, prompt by jinak zůstal svítit.
    this.currentTarget = null;
  }

  clear(): void {
    this.registry.clear();
    this.currentTarget = null;
  }

  // Vrací prompt k zobrazení, nebo null když hráč na nic nemíří.
  getPrompt(): string | null {
    return this.currentTarget?.prompt ?? null;
  }

  // Zavolá akci zacíleného objektu. Vrací true, když se něco stalo - scéna z toho pozná,
  // jestli stisk E něco udělal.
  use(): boolean {
    if (!this.currentTarget) return false;
    this.currentTarget.onUse();
    return true;
  }

  update(camera: THREE.Camera): void {
    if (this.registry.size === 0) {
      this.currentTarget = null;
      return;
    }

    // matrixWorld se jinak přepočítá až v render() - o frame pozadu za pohybem hráče.
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.cameraDirection);
    this.raycaster.set(camera.position, this.cameraDirection);

    let closest: PlanetInteractable | null = null;
    let closestDistance = Infinity;

    for (const [object, interactable] of this.registry) {
      if (!object.visible) continue;
      const hits = this.raycaster.intersectObject(object, true);
      if (hits.length > 0 && hits[0].distance < closestDistance) {
        closestDistance = hits[0].distance;
        closest = interactable;
      }
    }

    this.currentTarget = closest;
  }
}
