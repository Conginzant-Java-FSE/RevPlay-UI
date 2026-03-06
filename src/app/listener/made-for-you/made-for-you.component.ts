import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrowseService } from '../services/browse.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-made-for-you',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './made-for-you.component.html',
  styleUrl: './made-for-you.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MadeForYouComponent implements OnInit {
  picks: any[] = [];
  weekly: any[] = [];
  isLoading = true;
  error: string | null = null;

  constructor(
    private browseService: BrowseService,
    private authService: AuthService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const userId = Number(this.authService.getCurrentUserSnapshot()?.userId ?? 0);
    if (!userId) {
      this.isLoading = false;
      this.error = 'User session not found.';
      this.cdr.markForCheck();
      return;
    }

    forkJoin({
      forYou: this.browseService.getRecommendationsForYou(userId).pipe(
        catchError(() => of({ youMightLike: [], popularWithSimilarUsers: [] }))
      ),
      weekly: this.browseService.getDiscoverWeekly(userId).pipe(
        catchError(() => of({ items: [] }))
      )
    }).subscribe({
      next: ({ forYou, weekly }) => {
        const forYouItems = [...(forYou?.youMightLike ?? []), ...(forYou?.popularWithSimilarUsers ?? [])];
        this.picks = this.mapSongCards(forYouItems);
        this.weekly = this.mapSongCards(weekly?.items ?? []);
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.error = 'Failed to load personalized picks.';
        this.cdr.markForCheck();
      }
    });
  }

  playTrack(item: any): void {
    const songId = Number(item.songId ?? item.id ?? 0);
    if (!songId) {
      return;
    }
    this.browseService.getSongById(songId).subscribe({
      next: (song) => this.playerService.playTrack({ ...song, id: song.songId ?? song.id }, [song]),
      error: () => {}
    });
  }

  private mapSongCards(items: any[]): any[] {
    const dedupe = new Map<number, any>();
    (items ?? []).forEach((item: any) => {
      const songId = Number(item.songId ?? item.contentId ?? item.id ?? 0);
      if (!songId || dedupe.has(songId)) {
        return;
      }
      dedupe.set(songId, {
        id: songId,
        songId,
        title: item.title ?? 'Untitled',
        artistName: item.artistName ?? 'Unknown Artist'
      });
    });
    return Array.from(dedupe.values());
  }
}
