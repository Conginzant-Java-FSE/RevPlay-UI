import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PlayerService } from '../../core/services/player.service';
import { RecentlyPlayedItem, RecentlyPlayedService } from '../../services/recently-played.service';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';

@Component({
  selector: 'app-recently-played',
  standalone: true,
  imports: [CommonModule, ProtectedMediaPipe],
  templateUrl: './recently-played.component.html',
  styleUrl: './recently-played.component.scss'
})
export class RecentlyPlayedComponent {
  readonly items$;

  constructor(
    private recentlyPlayedService: RecentlyPlayedService,
    private playerService: PlayerService
  ) {
    this.items$ = this.recentlyPlayedService.items$;
  }

  replay(item: RecentlyPlayedItem): void {
    const songId = Number(item?.songId ?? 0);
    if (songId <= 0) {
      return;
    }

    const track = {
      id: songId,
      songId,
      contentId: songId,
      title: item.title,
      artistName: item.artist,
      imageUrl: item.imageUrl,
      coverUrl: item.imageUrl,
      isActive: item.isActive,
      type: 'SONG'
    };

    this.playerService.playTrack(track, [track]);
  }
}
