import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PlayerStateService {
  private readonly moneySignal = signal(0);
  readonly money = this.moneySignal.asReadonly();

  addMoney(amount: number): void {
    this.moneySignal.update((m) => m + amount);
  }
}
