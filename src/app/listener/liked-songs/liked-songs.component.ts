import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrowseService } from '../services/browse.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';
import { LikesService } from '../../core/services/likes.service';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-liked-songs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './liked-songs.component.html',
  styleUrl: './liked-songs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LikedSongsComponent implements OnInit {
  likedSongs: any[] = [];
  isLoading = true;
  error: string | null = null;
  private artistNameCache = new Map<number, string>();

  constructor(
    private browseService: BrowseService,
    private likesService: LikesService,
    private authService: AuthService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUserSnapshot();
    const userId = Number(currentUser?.userId ?? currentUser?.id ?? 0);
    if (!userId) {
      this.isLoading = false;
      this.error = 'User session not found.';
      this.cdr.markForCheck();
      return;
    }

    this.likesService.getUserLikes(userId, 'SONG', 0, 200).subscribe({
      next: (likes) => {
        const safeLikes = Array.isArray(likes) ? likes : [];
        const likedSongIds = Array.from(
          new Set(
            safeLikes
              .map((like: any) => Number(like?.likeableId ?? 0))
              .filter((id: number) => id > 0)
          )
        );

        if (likedSongIds.length === 0) {
          this.likedSongs = [];
          this.isLoading = false;
          this.cdr.markForCheck();
          return;
        }

        const songRequests = likedSongIds.map((songId) =>
          this.browseService.getSongById(songId).pipe(
            switchMap((song) => this.buildLikedSongRow(song)),
            catchError(() => of(null))
          )
        );

        forkJoin(songRequests).subscribe({
          next: (songs) => {
            this.likedSongs = (songs ?? []).filter((song) => !!song);
            this.isLoading = false;
            this.cdr.markForCheck();
          },
          error: () => {
            this.error = 'Failed to load liked songs.';
            this.isLoading = false;
            this.cdr.markForCheck();
          }
        });
      },
      error: () => {
        this.error = 'Failed to load likes.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  playSong(song: any): void {
    this.playerService.playTrack(song, this.likedSongs);
  }

  private buildLikedSongRow(song: any): Observable<any> {
    const artistId = Number(song?.artistId ?? 0);
    const directArtistName = this.resolveArtistName(song);
    const base = {
      id: song?.songId ?? song?.id,
      songId: song?.songId ?? song?.id,
      title: song?.title,
      artistName: directArtistName,
      artistId: artistId > 0 ? artistId : undefined,
      fileUrl: song?.fileUrl,
      fileName: song?.fileName,
      audioUrl: song?.audioUrl,
      albumId: Number(song?.albumId ?? 0) || undefined,
      imageUrl: this.resolveSongImageUrl(song)
    };

    if (directArtistName) {
      return of(base);
    }
    if (!artistId) {
      return of({ ...base, artistName: 'Unknown Artist' });
    }

    const cachedName = this.artistNameCache.get(artistId);
    if (cachedName) {
      return of({ ...base, artistName: cachedName });
    }

    return this.browseService.getArtistById(artistId).pipe(
      map((artist) => {
        const resolved = this.resolveArtistName(artist) || 'Unknown Artist';
        this.artistNameCache.set(artistId, resolved);
        return { ...base, artistName: resolved };
      }),
      catchError(() => of({ ...base, artistName: 'Unknown Artist' }))
    );
  }

  private resolveArtistName(entity: any): string {
    const candidates = [
      entity?.artistName,
      entity?.displayName,
      entity?.name,
      entity?.username
    ];

    for (const value of candidates) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  private resolveSongImageUrl(song: any): string {
    const candidates = [
      song?.imageUrl,
      song?.coverArtUrl,
      song?.coverImageUrl,
      song?.image,
      song?.thumbnailUrl,
      song?.album?.coverArtUrl,
      song?.album?.coverImageUrl,
      song?.albumImageUrl
    ];

    for (const candidate of candidates) {
      const resolved = this.resolveImagePath(candidate);
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }

  private resolveImagePath(value: any): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return '';
    }

    const apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      return raw;
    }
    if (raw.startsWith('/api/v1/')) {
      return `${apiOrigin}${raw}`;
    }
    if (raw.startsWith('/files/images/')) {
      return `${environment.apiUrl}${raw}`;
    }
    if (raw.startsWith('files/images/')) {
      return `${environment.apiUrl}/${raw}`;
    }

    const fileName = raw.split('?')[0].split('#')[0].split(/[\\/]/).filter(Boolean).pop() ?? '';
    if (!raw.includes('/') && fileName) {
      return `${environment.apiUrl}/files/images/${encodeURIComponent(fileName)}`;
    }

    if (raw.startsWith('/')) {
      return `${apiOrigin}${raw}`;
    }

    return `${apiOrigin}/${raw}`;
  }
}
