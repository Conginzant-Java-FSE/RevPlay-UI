import { Injectable } from '@angular/core';
import { map } from 'rxjs/operators';
import { PlayerService } from '../core/services/player.service';

@Injectable({
  providedIn: 'root'
})
export class AutoplayService {
  readonly enabled$;

  constructor(private readonly playerService: PlayerService) {
    this.enabled$ = this.playerService.state$.pipe(
      map((state) => !!state.autoplayEnabled)
    );
  }

  toggle(): void {
    this.playerService.toggleAutoplay();
  }
}
