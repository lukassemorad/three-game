import { Injectable, signal } from '@angular/core';

export type GamePhase = 'not-started' | 'playing' | 'paused';

@Injectable({ providedIn: 'root' })
export class GameFlowService {
  private readonly phaseSignal = signal<GamePhase>('not-started');
  readonly phase = this.phaseSignal.asReadonly();

  reset(): void {
    this.phaseSignal.set('not-started');
  }

  setPlaying(): void {
    this.phaseSignal.set('playing');
  }

  setPaused(): void {
    this.phaseSignal.set('paused');
  }
}
