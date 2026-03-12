import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { BrowseService } from '../services/browse.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { ArtistService } from '../../core/services/artist.service';

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
  private artistNameCache = new Map<number, string>();

  constructor(
    private browseService: BrowseService,
    private authService: AuthService,
    private playerService: PlayerService,
    private artistService: ArtistService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const userId = Number(
      this.authService.getCurrentUserId?.()
        ? this.authService.getCurrentUserId()
        : (this.authService.getCurrentUserSnapshot()?.userId ?? 0)
    );
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
      trending: this.browseService.getTrending('SONG', 'WEEKLY', 12).pipe(
        catchError(() => of([]))
      ),
      releases: this.browseService.getNewReleases().pipe(
        catchError(() => of({ content: [] }))
      ),
      songs: this.browseService.getBrowseSongs().pipe(
        catchError(() => of({ content: [] }))
      ),
      mixPlaylists: this.browseService.getSystemPlaylists().pipe(
        catchError(() => of([]))
      )
    }).subscribe({
      next: ({ forYou, weekly, feed, trending, releases, songs, mixPlaylists }) => {
        const baseTrending = this.mapSongCards(this.extractContentArray(trending));
        const baseBrowseSongs = this.mapSongCards(this.extractContentArray(songs));
        const baseNewReleases = this.mapSongCards(this.extractContentArray(releases));
        const directForYou = this.mapSongCards(this.buildForYouList(forYou));
        const directWeekly = this.mapSongCards(this.extractArray(weekly, ['items', 'discoverWeekly']));
        const feedWeekly = this.mapSongCards(
          this.buildDiscoveryFeedList(feed, directWeekly, directForYou)
        );

        const fallbackPlaylists = this.selectMixPlaylists(mixPlaylists);
        const playlistRequests = fallbackPlaylists.map((playlist) =>
          this.browseService.getSystemPlaylistSongDetails(playlist.slug).pipe(catchError(() => of([])))
        );

        forkJoin(playlistRequests.length > 0 ? playlistRequests : [of([])]).subscribe({
          next: (playlistGroups) => {
            const mixPool = this.mapSongCards(playlistGroups.flat());
            const homeFallbackRecommended = this.buildHomeSongFallback(
              baseTrending,
              baseBrowseSongs,
              baseNewReleases
            );
            const homeFallbackWeekly = this.buildHomeSongFallback(
              baseNewReleases,
              baseBrowseSongs,
              baseTrending,
              homeFallbackRecommended
            );
            const fallbackRecommended = this.limitSongs(
              this.mergeSongCards(directForYou, mixPool, homeFallbackRecommended),
              8
            );
            const fallbackWeekly = this.limitSongs(
              this.mergeSongCards(directWeekly, feedWeekly, mixPool, homeFallbackWeekly),
              8
            );

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

  private extractContentArray(payload: any): any[] {
    if (!payload) {
      return [];
    }

    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.content)) {
      return payload.content;
    }

    if (Array.isArray(payload?.items)) {
      return payload.items;
    }

    if (Array.isArray(payload?.data)) {
      return payload.data;
    }

    if (Array.isArray(payload?.data?.content)) {
      return payload.data.content;
    }

    if (Array.isArray(payload?.data?.items)) {
      return payload.data.items;
    }

    return [];
  }

  private extractArray(payload: any, keys: string[]): any[] {
    const sources: any[] = [payload];
    if (payload?.data && typeof payload.data === 'object') {
      sources.push(payload.data);
    }
    if (payload?.data?.data && typeof payload.data.data === 'object') {
      sources.push(payload.data.data);
    }

    for (const source of sources) {
      if (!source) {
        continue;
      }

      if (Array.isArray(source)) {
        return source;
      }

      for (const key of keys) {
        const candidate = (source as any)?.[key];
        if (Array.isArray(candidate)) {
          return candidate;
        }
        if (Array.isArray(candidate?.content)) {
          return candidate.content;
        }
        if (Array.isArray(candidate?.items)) {
          return candidate.items;
        }
        if (Array.isArray(candidate?.data)) {
          return candidate.data;
        }
      }
    }

    return [];
  }

  private buildForYouList(response: any): any[] {
    const youMightLike = this.extractArray(response, ['youMightLike']);
    const popularWithSimilarUsers = this.extractArray(response, ['popularWithSimilarUsers']);
    const dedupe = new Map<number, any>();

    [...youMightLike, ...popularWithSimilarUsers].forEach((item) => {
      const id = Number(item?.songId ?? item?.contentId ?? item?.id ?? 0);
      if (id && !dedupe.has(id)) {
        dedupe.set(id, item);
      }
    });

    return Array.from(dedupe.values());
  }

  private buildDiscoveryFeedList(response: any, ...fallbackGroups: any[][]): any[] {
    const weekly = this.extractArray(response, ['discoverWeekly']);
    const releases = this.extractArray(response, ['newReleases']);
    const combined = [...weekly, ...releases];
    if (combined.length > 0) {
      return combined;
    }

    const fallback = this.mergeSongCards(...fallbackGroups);
    return fallback.slice(0, 12);
  }

  private buildHomeSongFallback(...groups: any[][]): any[] {
    return this.mergeSongCards(...groups).slice(0, 12);
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

      const albumId = Number(item?.albumId ?? item?.album?.albumId ?? item?.album?.id ?? 0);
      const image = this.resolveMediaImage(item, songId, albumId);
      const normalized = {
        id: songId,
        songId,
        albumId,
        title: String(item?.title ?? item?.name ?? item?.contentName ?? `Song #${songId}`).trim(),
        artistName: this.resolveArtistName(item),
        coverUrl: image || this.artistService.getCachedSongImage(songId) || this.artistService.getCachedAlbumImage(albumId),
        imageUrl: image || this.artistService.getCachedSongImage(songId) || this.artistService.getCachedAlbumImage(albumId),
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
          switchMap((response) => {
            const detail = this.unwrapPayload(response);
            const merged = {
              ...item,
              ...detail
            };
            const resolvedArtistName = this.resolveArtistName(merged);
            const artistId = Number(merged?.artistId ?? item?.artistId ?? 0);
            const baseSong = {
              ...item,
              ...detail,
              id: Number(merged?.songId ?? merged?.id ?? item.songId ?? item.id ?? 0),
              songId: Number(merged?.songId ?? merged?.id ?? item.songId ?? item.id ?? 0),
              title: String(merged?.title ?? item.title ?? 'Untitled').trim(),
              coverUrl: this.resolveMediaImage(merged, Number(merged?.songId ?? merged?.id ?? 0), Number(merged?.albumId ?? merged?.album?.albumId ?? 0))
                || item.coverUrl || 'assets/images/placeholder-album.png',
              imageUrl: this.resolveMediaImage(merged, Number(merged?.songId ?? merged?.id ?? 0), Number(merged?.albumId ?? merged?.album?.albumId ?? 0))
                || item.imageUrl || 'assets/images/placeholder-album.png',
              fileUrl: String(merged?.fileUrl ?? merged?.audioUrl ?? merged?.streamUrl ?? item.fileUrl ?? '').trim(),
              audioUrl: String(merged?.audioUrl ?? merged?.fileUrl ?? merged?.streamUrl ?? item.audioUrl ?? '').trim(),
              streamUrl: String(merged?.streamUrl ?? merged?.audioUrl ?? merged?.fileUrl ?? item.streamUrl ?? '').trim(),
              fileName: String(merged?.fileName ?? merged?.audioFileName ?? item.fileName ?? '').trim(),
              type: 'SONG'
            };

            if (resolvedArtistName !== 'Unknown Artist') {
              if (artistId > 0) {
                this.artistNameCache.set(artistId, resolvedArtistName);
              }
              return of({
                ...baseSong,
                artistId: artistId > 0 ? artistId : undefined,
                artistName: resolvedArtistName
              });
            }

            const fallbackArtistName = String(item?.artistName ?? '').trim();
            if (fallbackArtistName && fallbackArtistName !== 'Unknown Artist') {
              if (artistId > 0) {
                this.artistNameCache.set(artistId, fallbackArtistName);
              }
              return of({
                ...baseSong,
                artistId: artistId > 0 ? artistId : undefined,
                artistName: fallbackArtistName
              });
            }

            if (!artistId) {
              return of({
                ...baseSong,
                artistName: 'Unknown Artist'
              });
            }

            const cachedArtistName = this.artistNameCache.get(artistId);
            if (cachedArtistName) {
              return of({
                ...baseSong,
                artistId,
                artistName: cachedArtistName
              });
            }

            return this.browseService.getArtistById(artistId).pipe(
              map((artistResponse) => {
                const artistDetail = this.unwrapPayload(artistResponse);
                const artistName = this.resolveArtistName(artistDetail);
                const finalArtistName = artistName !== 'Unknown Artist' ? artistName : 'Unknown Artist';
                if (finalArtistName !== 'Unknown Artist') {
                  this.artistNameCache.set(artistId, finalArtistName);
                }
                return {
                  ...baseSong,
                  artistId,
                  artistName: finalArtistName
                };
              }),
              catchError(() => of({
                ...baseSong,
                artistId,
                artistName: 'Unknown Artist'
              }))
            );
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
    const arrayCandidates: Array<string | undefined> = [];
    const artistArray = Array.isArray(item?.artists) ? item.artists : [];
    if (artistArray.length > 0) {
      const first = artistArray[0];
      if (typeof first === 'string') {
        arrayCandidates.push(first);
      } else if (first && typeof first === 'object') {
        arrayCandidates.push(first?.displayName, first?.name, first?.username);
      }
    }
    const albumArtistArray = Array.isArray(item?.album?.artists) ? item.album.artists : [];
    if (albumArtistArray.length > 0) {
      const first = albumArtistArray[0];
      if (typeof first === 'string') {
        arrayCandidates.push(first);
      } else if (first && typeof first === 'object') {
        arrayCandidates.push(first?.displayName, first?.name, first?.username);
      }
    }
    if (Array.isArray(item?.artistNames) && item.artistNames.length > 0) {
      arrayCandidates.push(item.artistNames.join(', '));
    }
    if (Array.isArray(item?.artistsNames) && item.artistsNames.length > 0) {
      arrayCandidates.push(item.artistsNames.join(', '));
    }

    const candidates = [
      item?.artistName,
      item?.artistDisplayName,
      item?.artist,
      item?.artistTitle,
      item?.artistNames,
      item?.artistsNames,
      ...arrayCandidates,
      item?.artist?.displayName,
      item?.artist?.name,
      item?.artistDetails?.displayName,
      item?.artistDetails?.name,
      item?.uploaderName,
      item?.createdByName,
      item?.createdBy?.fullName,
      item?.createdBy?.name,
      item?.createdBy?.displayName,
      item?.createdBy?.username,
      item?.createdByUserName,
      item?.creatorName,
      item?.creatorDisplayName,
      item?.uploadedByName,
      item?.uploadedBy,
      item?.uploader,
      item?.ownerName,
      item?.displayName,
      item?.user?.fullName,
      item?.user?.name,
      item?.user?.displayName,
      item?.user?.username,
      item?.username
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) {
        return value;
      }
    }

    return 'Unknown Artist';
  }

  private resolveMediaImage(item: any, songId = 0, albumId = 0): string {
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
      item?.album?.imageFileName,
      item?.album?.imageName
    ];

    for (const candidate of candidates) {
      const raw = String(candidate ?? '').trim();
      if (!raw) {
        continue;
      }
      const resolved = this.artistService.resolveImageUrl(raw) || raw;
      if (resolved) {
        if (songId > 0) {
          this.artistService.cacheSongImage(songId, resolved);
        }
        if (albumId > 0) {
          this.artistService.cacheAlbumImage(albumId, resolved);
        }
        return resolved;
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
