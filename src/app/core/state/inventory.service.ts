import { Injectable, computed, signal } from '@angular/core';
import { HAND_ITEM, ITEM_DEFS, ItemDef } from '../../shared/models/item.model';

@Injectable({ providedIn: 'root' })
export class InventoryService {
  private readonly ownedIdsSignal = signal<string[]>([]);
  readonly ownedIds = this.ownedIdsSignal.asReadonly();

  // null = ruka (výchozí, vždy dostupná, nikdy není součástí ownedIds).
  private readonly equippedIdSignal = signal<string | null>(null);

  // Sloty do hotbaru - ruka vždy první, dál v pořadí, jak byly věci koupené.
  readonly slots = computed<readonly ItemDef[]>(() => [
    HAND_ITEM,
    ...this.ownedIdsSignal().map((id) => ITEM_DEFS[id])
  ]);

  readonly activeItem = computed<ItemDef>(() => {
    const id = this.equippedIdSignal();
    return id ? ITEM_DEFS[id] : HAND_ITEM;
  });

  readonly activeIndex = computed(() => this.slots().findIndex((item) => item.id === this.activeItem().id));

  owns(id: string): boolean {
    return this.ownedIdsSignal().includes(id);
  }

  // Přidá nástroj do inventáře a rovnou ho vybaví - reálný odraz toho, že hráč si ho
  // právě koupil a přirozeně by ho chtěl hned vyzkoušet.
  acquire(id: string): void {
    if (this.owns(id)) return;
    this.ownedIdsSignal.update((ids) => [...ids, id]);
    this.equippedIdSignal.set(id);
  }

  cycle(direction: 1 | -1): void {
    const slots = this.slots();
    if (slots.length <= 1) return;
    const nextIndex = (this.activeIndex() + direction + slots.length) % slots.length;
    const chosen = slots[nextIndex];
    this.equippedIdSignal.set(chosen.id === HAND_ITEM.id ? null : chosen.id);
  }

  hydrate(state: { ownedItemIds: readonly string[]; equippedItemId: string | null }): void {
    this.ownedIdsSignal.set([...state.ownedItemIds]);
    this.equippedIdSignal.set(state.equippedItemId);
  }

  reset(): void {
    this.ownedIdsSignal.set([]);
    this.equippedIdSignal.set(null);
  }
}
