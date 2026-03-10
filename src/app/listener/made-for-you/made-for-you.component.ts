import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { BrowseService } from '../services/browse.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';

@Component({
  selector: 'app-made-for-you',
  standalone: true,
  imports: [CommonModule, ProtectedMediaPipe],
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
        catchError(() => of({ data: { youMightLike: [], popularWithSimilarUsers: [] } }))
      ),
      weekly: this.browseService.getDiscoverWeekly(userId).pipe(
        catchError(() => of({ data: { items: [] } }))
      ),
      feed: this.browseService.getDiscoveryFeed(userId).pipe(
        catchError(() => of({ data: { discoverWeekly: [], newReleases: [] } }))
      ),
      mixPlaylists: this.browseService.getSystemPlaylists().pipe(
        catchError(() => of([]))
      )
    }).subscribe({
      next: ({ forYou, weekly, feed, mixPlaylists }) => {
        const forYouPayload = this.unwrapPayload(forYou);
        const weeklyPayload = this.unwrapPayload(weekly);
        const feedPayload = this.unwrapPayload(feed);
        const directForYou = this.mapSongCards([
          ...(forYouPayload?.youMightLike ?? []),
          ...(forYouPayload?.popularWithSimilarUsers ?? [])
        ]);
        const directWeekly = this.mapSongCards(weeklyPayload?.items ?? []);
        const feedWeekly = this.mapSongCards(feedPayload?.discoverWeekly ?? []);

        const fallbackPlaylists = this.selectMixPlaylists(mixPlaylists);
        const playlistRequests = fallbackPlaylists.map((playlist) =>
          this.browseService.getSystemPlaylistSongDetails(playlist.slug).pipe(catchError(() => of([])))
        );

        forkJoin(playlistRequests.length > 0 ? playlistRequests : [of([])]).subscribe({
          next: (playlistGroups) => {
            const mixPool = this.mapSongCards(playlistGroups.flat());
            const fallbackRecommended = this.limitSongs(this.mergeSongCards(directForYou, mixPool), 8);
            const fallbackWeekly = this.limitSongs(this.mergeSongCards(directWeekly, feedWeekly, mixPool), 8);

            const basePicks = directForYou.length > 0 ? directForYou : fallbackRecommended;
            const baseWeekly = directWeekly.length > 0 ? directWeekly : fallbackWeekly;

            forkJoin({
              picks: this.enrichSongCardsWithDetails(basePicks),
              weekly: this.enrichSongCardsWithDetails(baseWeekly)
            }).subscribe({
              next: ({ picks, weekly }) => {
                this.picks = picks;
                this.weekly = weekly;
                this.isLoading = false;
                this.cdr.markForCheck();
              },
              error: () => {
                this.picks = basePicks;
                this.weekly = baseWeekly;
                this.isLoading = false;
                this.cdr.markForCheck();
              }
            });
          },
          error: () => {
            this.picks = this.limitSongs(directForYou, 8);
            this.weekly = this.limitSongs(this.mergeSongCards(directWeekly, feedWeekly), 8);
            this.isLoading = false;
            this.cdr.markForCheck();
          }
        });
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
      next: (song) => {
        const payload = this.unwrapPayload(song);
        const playbackTrack = {
          ...item,
          ...payload,
          id: payload?.songId ?? payload?.id ?? item.songId ?? item.id,
          songId: payload?.songId ?? payload?.id ?? item.songId ?? item.id
        };
        const queue = this.buildPlaybackQueue(item, playbackTrack);
        this.playerService.playTrack(playbackTrack, queue.length > 0 ? queue : [playbackTrack]);
      },
      error: () => {}
    });
  }

  private unwrapPayload(payload: any): any {
    if (payload?.data && typeof payload.data === 'object') {
      return payload.data;
    }

    return payload ?? {};
  }

  private selectMixPlaylists(playlists: any[]): Array<{ id: number; name: string; slug: string }> {
    return (Array.isArray(playlists) ? playlists : [])
      .map((item: any) => ({
        id: Number(item?.id ?? 0),
        name: String(item?.name ?? '').trim(),
        slug: String(item?.slug ?? '').trim()
      }))
      .filter((item) => item.id > 0 && !!item.slug && /mix/i.test(item.name))
      .slice(0, 3);
  }

  private limitSongs(items: any[], size: number): any[] {
    return this.mergeSongCards(items).slice(0, size);
  }

  private mergeSongCards(...groups: any[][]): any[] {
    const merged: any[] = [];
    const seen = new Set<number>();

    for (const group of groups) {
      for (const item of group ?? []) {
        const songId = Number(item?.songId ?? item?.id ?? 0);
        if (!songId || seen.has(songId)) {
          continue;
        }
        seen.add(songId);
        merged.push(item);
      }
    }

    return merged;
  }

  private mapSongCards(items: any[]): any[] {
    const dedupe = new Map<number, any>();
    (items ?? []).forEach((item: any) => {
      const songId = Number(item?.songId ?? item?.trackId ?? item?.contentId ?? item?.id ?? 0);
      if (!songId || dedupe.has(songId)) {
        return;
      }

      const normalized = {
        id: songId,
        songId,
        title: String(item?.title ?? item?.name ?? item?.contentName ?? `Song #${songId}`).trim(),
        artistName: this.resolveArtistName(item),
        coverUrl: this.resolveImage(item),
        imageUrl: this.resolveImage(item),
        fileUrl: String(item?.fileUrl ?? item?.audioUrl ?? item?.streamUrl ?? '').trim(),
        audioUrl: String(item?.audioUrl ?? item?.fileUrl ?? item?.streamUrl ?? '').trim(),
        streamUrl: String(item?.streamUrl ?? item?.audioUrl ?? item?.fileUrl ?? '').trim(),
        fileName: String(item?.fileName ?? item?.audioFileName ?? '').trim(),
        type: 'SONG'
      };

      dedupe.set(songId, normalized);
    });

    return Array.from(dedupe.values());
  }

  private enrichSongCardsWithDetails(items: any[]): Observable<any[]> {
    const source = this.limitSongs(items, 8);
    if (source.length === 0) {
      return of([]);
    }

    return forkJoin(
      source.map((item) =>
        this.browseService.getSongById(Number(item.songId ?? item.id ?? 0)).pipe(
          map((response) => {
            const detail = this.unwrapPayload(response);
            const merged = {
              ...item,
              ...detail
            };

            return {
              ...item,
              ...detail,
              id: Number(merged?.songId ?? merged?.id ?? item.songId ?? item.id ?? 0),
              songId: Number(merged?.songId ?? merged?.id ?? item.songId ?? item.id ?? 0),
              title: String(merged?.title ?? item.title ?? 'Untitled').trim(),
              artistName: this.resolveArtistName(merged) || item.artistName,
              coverUrl: this.resolveImage(merged) || item.coverUrl || 'assets/images/placeholder-album.png',
              imageUrl: this.resolveImage(merged) || item.imageUrl || 'assets/images/placeholder-album.png',
              fileUrl: String(merged?.fileUrl ?? merged?.audioUrl ?? merged?.streamUrl ?? item.fileUrl ?? '').trim(),
              audioUrl: String(merged?.audioUrl ?? merged?.fileUrl ?? merged?.streamUrl ?? item.audioUrl ?? '').trim(),
              streamUrl: String(merged?.streamUrl ?? merged?.audioUrl ?? merged?.fileUrl ?? item.streamUrl ?? '').trim(),
              fileName: String(merged?.fileName ?? merged?.audioFileName ?? item.fileName ?? '').trim(),
              type: 'SONG'
            };
          }),
          catchError(() => of({
            ...item,
            coverUrl: item.coverUrl || 'assets/images/placeholder-album.png',
            imageUrl: item.imageUrl || 'assets/images/placeholder-album.png'
          }))
        )
      )
    );
  }

  private resolveArtistName(item: any): string {
    const candidates = [
      item?.artistName,
      item?.artistDisplayName,
      item?.artist?.displayName,
      item?.artist?.name,
      item?.artistDetails?.displayName,
      item?.artistDetails?.name,
      item?.uploaderName,
      item?.createdByName,
      item?.createdBy?.fullName,
      item?.createdBy?.name,
      item?.createdBy?.displayName,
      item?.creatorName,
      item?.user?.fullName,
      item?.user?.name,
      item?.user?.displayName
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) {
        return value;
      }
    }

    return 'Unknown Artist';
  }

  private resolveImage(item: any): string {
    const candidates = [
      item?.coverUrl,
      item?.coverArtUrl,
      item?.coverImageUrl,
      item?.imageUrl,
      item?.image,
      item?.thumbnailUrl,
      item?.artworkUrl,
      item?.cover?.imageUrl,
      item?.cover?.url,
      item?.cover?.fileName,
      item?.imageFileName,
      item?.imageName,
      item?.coverFileName,
      item?.coverImageFileName,
      item?.album?.coverArtUrl,
      item?.album?.coverImageUrl,
      item?.album?.cover?.imageUrl,
      item?.album?.cover?.fileName,
      item?.album?.coverFileName,
      item?.album?.coverImageFileName,
      item?.album?.imageFileName
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) {
        return value;
      }
    }

    return '';
  }

  private buildPlaybackQueue(sourceItem: any, resolvedTrack: any): any[] {
    const targetSongId = Number(sourceItem?.songId ?? sourceItem?.id ?? resolvedTrack?.songId ?? resolvedTrack?.id ?? 0);
    const sourceGroup = [this.picks, this.weekly].find((group) =>
      (group ?? []).some((item: any) => Number(item?.songId ?? item?.id ?? 0) === targetSongId)
    ) ?? [];

    return (sourceGroup ?? [])
      .map((item: any) => {
        const songId = Number(item?.songId ?? item?.id ?? 0);
        return songId === targetSongId
          ? resolvedTrack
          : {
              ...item,
              id: songId,
              songId,
              title: item?.title ?? `Song #${songId}`,
              artistName: item?.artistName ?? 'Unknown Artist',
              type: 'SONG'
            };
      })
      .filter((item: any) => Number(item?.songId ?? item?.id ?? 0) > 0);
  }
}
