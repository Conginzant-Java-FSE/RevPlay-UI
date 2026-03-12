import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrowseService } from '../services/browse.service';
import { FollowingService } from '../../core/services/following.service';
import { ArtistService } from '../../core/services/artist.service';
import { AuthService } from '../../core/services/auth';
import { StateService } from '../../core/services/state.service';
import { ApiService } from '../../core/services/api';
import { PlayerService } from '../../core/services/player.service';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { hasAnyRole, hasRole } from '../../core/utils/role.util';

@Component({
  selector: 'app-podcasts',
  standalone: true,
  imports: [CommonModule, ProtectedMediaPipe],
  templateUrl: './podcasts.component.html',
  styleUrl: './podcasts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PodcastsComponent implements OnInit {
  private readonly podcastPlayCountStorageKey = 'revplay_podcast_play_count_cache_v1';
  popular: any[] = [];
  recommended: any[] = [];
  selectedPodcast: any | null = null;
  selectedPodcastEpisodes: any[] = [];
  selectedEpisodeId: number | null = null;
  isLoading = true;
  isEpisodesLoading = false;
  error: string | null = null;
  episodeError: string | null = null;
  actionMessage: string | null = null;
  private hasListenerBackendAccess = false;

  constructor(
    private browseService: BrowseService,
    private followingService: FollowingService,
    private artistService: ArtistService,
    private authService: AuthService,
    private stateService: StateService,
    private apiService: ApiService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const includeCreatorCatalog = hasRole(currentUser, 'ARTIST');
    this.hasListenerBackendAccess = this.canUseListenerBackend(currentUser);
    (includeCreatorCatalog ? this.resolveArtistId() : of(0)).pipe(
      switchMap((artistId) => forkJoin({
        popular: this.hasListenerBackendAccess
          ? this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] })))
          : of({ content: [] }),
        recommended: this.hasListenerBackendAccess
          ? this.browseService.getRecommendedPodcasts(0, 25).pipe(catchError(() => of({ content: [] })))
          : of({ content: [] }),
        seeded: this.hasListenerBackendAccess
          ? this.apiService.get<any>('/search?q=a&type=PODCAST&page=0&size=80').pipe(
            catchError(() => of({ content: [] }))
          )
          : of({ content: [] }),
        creatorPodcasts: includeCreatorCatalog && artistId > 0
          ? this.artistService.getArtistPodcasts(artistId, 0, 120).pipe(catchError(() => of({ content: [] })))
          : of({ content: [] })
      }))
    ).subscribe({
      next: ({ popular, recommended, seeded, creatorPodcasts }) => {
        const popularMapped = this.mapPodcasts(this.extractContentArray(popular));
        const recommendedMapped = this.mapPodcasts(this.extractContentArray(recommended));
        const seededMapped = this.mapPodcasts(this.extractContentArray(seeded));
        const creatorMapped = this.mapPodcasts(this.extractContentArray(creatorPodcasts));

        this.popular = this.mergePodcastLists(creatorMapped, seededMapped, popularMapped);
        this.recommended = this.mergePodcastLists(creatorMapped, recommendedMapped, seededMapped).slice(0, 30);
        this.isLoading = false;
        this.cdr.markForCheck();
        this.enrichDisplayedPodcasts();
      },
      error: () => {
        this.error = 'Failed to load podcasts.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  togglePodcastFollow(podcast: any): void {
    const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
    if (!podcastId) {
      return;
    }

    const nextState = this.followingService.togglePodcast({
      id: podcastId,
      name: podcast?.title ?? `Podcast #${podcastId}`,
      subtitle: podcast?.description ?? ''
    });
    podcast.isFollowed = nextState;
    this.actionMessage = nextState
      ? `Now following ${podcast?.title ?? 'podcast'}.`
      : `Unfollowed ${podcast?.title ?? 'podcast'}.`;
    this.cdr.markForCheck();
  }

  openPodcastDetails(podcast: any): void {
    const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
    if (podcastId <= 0) {
      return;
    }

    this.error = null;
    this.episodeError = null;
    this.selectedPodcast = podcast;
    this.selectedPodcastEpisodes = [];
    this.selectedEpisodeId = null;
    this.isEpisodesLoading = true;
    this.cdr.markForCheck();

    this.artistService.getPodcastEpisodes(podcastId, 0, 100).pipe(
      map((response) => Array.isArray(response?.content) ? response.content : []),
      catchError(() => of([]))
    ).subscribe((episodes) => {
      this.selectedPodcastEpisodes = this.normalizeEpisodes(episodes);
      this.isEpisodesLoading = false;
      if (this.selectedPodcastEpisodes.length === 0) {
        this.episodeError = 'No episodes found for this podcast.';
      }
      this.cdr.markForCheck();
    });
  }

  closePodcastDetails(): void {
    this.selectedPodcast = null;
    this.selectedPodcastEpisodes = [];
    this.selectedEpisodeId = null;
    this.episodeError = null;
    this.isEpisodesLoading = false;
    this.cdr.markForCheck();
  }

  playPodcast(podcast: any): void {
    const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
    if (podcastId <= 0) {
      return;
    }

    this.error = null;
    this.episodeError = null;
    this.selectedPodcast = podcast;
    this.selectedPodcastEpisodes = [];
    this.selectedEpisodeId = null;
    this.isEpisodesLoading = true;
    this.cdr.markForCheck();

    this.artistService.getPodcastEpisodes(podcastId, 0, 100).pipe(
      map((response) => Array.isArray(response?.content) ? response.content : []),
      catchError(() => of([]))
    ).subscribe((episodes) => {
      this.selectedPodcastEpisodes = this.normalizeEpisodes(episodes);
      this.isEpisodesLoading = false;

      if (this.selectedPodcastEpisodes.length === 0) {
        this.episodeError = 'No episodes found for this podcast.';
        this.cdr.markForCheck();
        return;
      }

      const queue = this.selectedPodcastEpisodes
        .map((episode: any) => this.toPodcastPlayerTrack(episode, podcast))
        .filter((item: any) => this.hasPlayableEpisode(item));

      if (queue.length === 0) {
        this.episodeError = 'No playable episodes found for this podcast.';
        this.cdr.markForCheck();
        return;
      }

      this.selectedEpisodeId = Number(queue[0]?.episodeId ?? queue[0]?.id ?? 0) || null;
      this.playerService.playTrack(queue[0], queue);
      this.incrementPodcastPlayCount(podcastId);
      this.cdr.markForCheck();
    });
  }

  playEpisode(episode: any, podcast: any = this.selectedPodcast): void {
    if (!podcast) {
      return;
    }

    const selectedTrack = this.toPodcastPlayerTrack(episode, podcast);
    if (!this.hasPlayableEpisode(selectedTrack)) {
      this.episodeError = 'This episode is not playable yet.';
      this.cdr.markForCheck();
      return;
    }

    const queue = this.selectedPodcastEpisodes
      .map((item: any) => this.toPodcastPlayerTrack(item, podcast))
      .filter((item: any) => this.hasPlayableEpisode(item));

    if (queue.length === 0) {
      this.episodeError = 'No playable episodes found for this podcast.';
      this.cdr.markForCheck();
      return;
    }

    const selectedEpisodeId = Number(selectedTrack?.episodeId ?? selectedTrack?.id ?? 0);
    const queueIndex = queue.findIndex((item: any) => Number(item?.episodeId ?? item?.id ?? 0) === selectedEpisodeId);
    const current = queueIndex >= 0 ? queue[queueIndex] : selectedTrack;
    this.selectedEpisodeId = selectedEpisodeId || null;
    this.episodeError = null;
    this.playerService.playTrack(current, queue);
    const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
    if (podcastId > 0) {
      this.incrementPodcastPlayCount(podcastId);
    }
    this.cdr.markForCheck();
  }

  onPodcastCoverError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) {
      return;
    }
    image.src = 'assets/images/placeholder-album.png';
  }

  formatEpisodeMeta(episode: any): string {
    const duration = this.formatDuration(Number(episode?.durationSeconds ?? 0));
    const releaseDate = String(episode?.releaseDate ?? '').trim();
    if (duration && releaseDate) {
      return `${duration} • ${releaseDate}`;
    }
    return duration || releaseDate || 'Episode';
  }

  isSelectedEpisode(episode: any): boolean {
    const episodeId = Number(episode?.episodeId ?? episode?.id ?? 0);
    return episodeId > 0 && episodeId === Number(this.selectedEpisodeId ?? 0);
  }

  private canUseListenerBackend(user: any): boolean {
    return hasAnyRole(user, ['LISTENER', 'ARTIST', 'ADMIN']);
  }

  private extractContentArray(response: any): any[] {
    if (Array.isArray(response?.content)) {
      return response.content;
    }
    if (Array.isArray(response)) {
      return response;
    }
    return [];
  }

  private mapPodcasts(items: any[]): any[] {
    return (items ?? []).map((item) => ({
      podcastId: Number(item?.podcastId ?? item?.id ?? 0),
      id: Number(item?.podcastId ?? item?.id ?? 0),
      title: item?.title ?? 'Podcast',
      description: item?.description ?? '',
      playCount: this.resolveMergedPodcastPlayCount(item),
      coverArtUrl: this.resolvePodcastImage(item),
      isFollowed: this.followingService.isPodcastFollowed(Number(item?.podcastId ?? item?.id ?? 0))
    })).filter((item) => item.podcastId > 0);
  }

  private mergePodcastLists(...lists: any[][]): any[] {
    const merged: any[] = [];
    const seen = new Set<number>();
    for (const list of lists) {
      for (const podcast of list ?? []) {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
        if (podcastId <= 0 || seen.has(podcastId)) {
          continue;
        }
        seen.add(podcastId);
        merged.push(podcast);
      }
    }

    const nonTestPodcasts = merged.filter((podcast) => !this.isSmokePodcast(podcast));
    const source = nonTestPodcasts.length > 0 ? nonTestPodcasts : merged;
    return source.sort((a, b) => Number(b?.podcastId ?? 0) - Number(a?.podcastId ?? 0));
  }

  private isSmokePodcast(podcast: any): boolean {
    const title = String(podcast?.title ?? '').trim();
    if (!title) {
      return false;
    }
    return /(smoke|endpoint)/i.test(title);
  }

  private resolveArtistId() {
    const user = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const userId = Number(user?.userId ?? user?.id ?? 0);
    const directArtistId = Number(
      user?.artistId ??
      user?.artist?.artistId ??
      user?.artist?.id ??
      user?.artistProfileId ??
      0
    );
    if (directArtistId > 0) {
      this.stateService.setArtistIdForUser(userId, directArtistId);
      return of(directArtistId);
    }

    const mappedArtistId = this.stateService.getArtistIdForUser(userId) || this.stateService.artistId;
    if (Number(mappedArtistId ?? 0) > 0) {
      return of(Number(mappedArtistId));
    }

    const username = String(user?.username ?? '').trim();
    if (!username) {
      return of(0);
    }

    return this.artistService.findArtistByUsername(username).pipe(
      map((response: any) => {
        const items = this.extractContentArray(response);
        const normalizedUsername = username.toLowerCase();
        const artist = (items ?? []).find((item: any) => {
          const rawType = String(item?.type ?? '').trim().toUpperCase();
          if (['SONG', 'ALBUM', 'PODCAST', 'PLAYLIST', 'GENRE'].includes(rawType)) {
            return false;
          }
          const candidates = [item?.username, item?.title, item?.artistName, item?.displayName, item?.name];
          return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
        }) ?? (items ?? [])[0];
        const artistId = Number(artist?.artistId ?? artist?.contentId ?? artist?.id ?? 0);
        if (artistId > 0) {
          this.stateService.setArtistIdForUser(userId, artistId);
        }
        return artistId;
      }),
      catchError(() => of(0))
    );
  }

  private getStoredUser(): any | null {
    const rawUser = localStorage.getItem('revplay_user');
    if (!rawUser) {
      return null;
    }

    try {
      return JSON.parse(rawUser);
    } catch {
      return null;
    }
  }

  private enrichDisplayedPodcasts(): void {
    this.enrichPodcastList(this.popular).subscribe((items) => {
      this.popular = items;
      this.cdr.markForCheck();
    });
    this.enrichPodcastList(this.recommended).subscribe((items) => {
      this.recommended = items;
      this.cdr.markForCheck();
    });
  }

  private enrichPodcastList(items: any[]) {
    const source = Array.isArray(items) ? items : [];
    if (source.length === 0) {
      return of([]);
    }

    return forkJoin(
      source.map((podcast) => {
        const podcastId = Number(podcast?.podcastId ?? podcast?.id ?? 0);
        if (podcastId <= 0) {
          return of(podcast);
        }

        return forkJoin({
          detail: this.artistService.getPodcast(podcastId).pipe(catchError(() => of(null))),
          episodes: this.artistService.getPodcastEpisodes(podcastId, 0, 12).pipe(catchError(() => of({ content: [] })))
        }).pipe(
          map(({ detail, episodes }) => {
            const normalizedEpisodes = this.normalizeEpisodes(
              Array.isArray(episodes?.content) ? episodes.content : []
            );
            const previewTitles = normalizedEpisodes
              .slice(0, 2)
              .map((episode: any, index: number) => this.toEpisodePreviewLabel(episode, index));

            return {
              ...podcast,
              ...detail,
              id: podcastId,
              podcastId,
              title: detail?.title ?? podcast?.title ?? `Podcast #${podcastId}`,
              description: detail?.description ?? podcast?.description ?? '',
              coverArtUrl: this.resolvePodcastImage(detail) || String(podcast?.coverArtUrl ?? '').trim(),
              episodePreviewTitles: previewTitles,
              playCount: Math.max(
                this.resolvePodcastPlayCount(detail),
                Number(podcast?.playCount ?? 0),
                this.getPersistedPodcastPlayCount(podcastId)
              )
            };
          }),
          catchError(() => of(podcast))
        );
      })
    );
  }

  private incrementPodcastPlayCount(podcastId: number): void {
    this.persistPodcastPlayCountIncrement(podcastId);

    const bump = (items: any[]) =>
      (items ?? []).map((item: any) => {
        const id = Number(item?.podcastId ?? item?.id ?? 0);
        if (id !== podcastId) {
          return item;
        }
        return {
          ...item,
          playCount: Number(item?.playCount ?? 0) + 1
        };
      });

    this.popular = bump(this.popular);
    this.recommended = bump(this.recommended);

    if (this.selectedPodcast && Number(this.selectedPodcast?.podcastId ?? this.selectedPodcast?.id ?? 0) === podcastId) {
      this.selectedPodcast = {
        ...this.selectedPodcast,
        playCount: Number(this.selectedPodcast?.playCount ?? 0) + 1
      };
    }

    this.cdr.markForCheck();
  }

  private resolvePodcastPlayCount(item: any): number {
    return Number(
      item?.playCount ??
      item?.plays ??
      item?.totalPlays ??
      item?.podcastPlayCount ??
      item?.podcastStreams ??
      item?.streamCount ??
      item?.listenCount ??
      item?.listenerCount ??
      item?.play_count ??
      item?.total_plays ??
      item?.podcast_play_count ??
      item?.podcast_streams ??
      item?.stream_count ??
      item?.listen_count ??
      item?.count ??
      item?.analytics?.podcastPlayCount ??
      item?.analytics?.playCount ??
      item?.stats?.podcastPlayCount ??
      item?.stats?.playCount ??
      0
    );
  }

  private resolveMergedPodcastPlayCount(item: any): number {
    const podcastId = Number(item?.podcastId ?? item?.id ?? 0);
    return Math.max(
      this.resolvePodcastPlayCount(item),
      this.getPersistedPodcastPlayCount(podcastId)
    );
  }

  private persistPodcastPlayCountIncrement(podcastId: number): void {
    const userId = this.getCurrentUserId();
    if (userId <= 0 || podcastId <= 0) {
      return;
    }

    const cache = this.getPodcastPlayCountCache();
    const scoped = cache[String(userId)] ?? {};
    const current = Number(scoped[String(podcastId)] ?? 0);
    scoped[String(podcastId)] = current + 1;
    cache[String(userId)] = scoped;
    localStorage.setItem(this.podcastPlayCountStorageKey, JSON.stringify(cache));
  }

  private getPersistedPodcastPlayCount(podcastId: number): number {
    const userId = this.getCurrentUserId();
    if (userId <= 0 || podcastId <= 0) {
      return 0;
    }

    const cache = this.getPodcastPlayCountCache();
    return Number(cache[String(userId)]?.[String(podcastId)] ?? 0);
  }

  private getPodcastPlayCountCache(): Record<string, Record<string, number>> {
    try {
      const raw = localStorage.getItem(this.podcastPlayCountStorageKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private getCurrentUserId(): number {
    const user = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    return Number(user?.userId ?? user?.id ?? 0);
  }

  private toPodcastPlayerTrack(episode: any, podcast: any): any {
    return {
      id: Number(episode?.episodeId ?? episode?.id ?? 0),
      episodeId: Number(episode?.episodeId ?? episode?.id ?? 0),
      podcastId: Number(podcast?.podcastId ?? podcast?.id ?? episode?.podcastId ?? 0),
      title: String(episode?.title ?? podcast?.title ?? 'Podcast Episode').trim(),
      artistName: String(podcast?.title ?? 'Podcast').trim(),
      podcastName: String(podcast?.title ?? 'Podcast').trim(),
      fileUrl: String(episode?.fileUrl ?? episode?.audioUrl ?? episode?.streamUrl ?? '').trim(),
      audioUrl: String(episode?.audioUrl ?? episode?.fileUrl ?? episode?.streamUrl ?? '').trim(),
      streamUrl: String(episode?.streamUrl ?? episode?.audioUrl ?? episode?.fileUrl ?? '').trim(),
      fileName: String(episode?.fileName ?? episode?.audioFileName ?? '').trim(),
      durationSeconds: Number(episode?.durationSeconds ?? 0),
      imageUrl: this.resolvePodcastImage(podcast),
      type: 'PODCAST'
    };
  }

  private hasPlayableEpisode(item: any): boolean {
    return !!String(item?.fileUrl ?? item?.audioUrl ?? item?.streamUrl ?? item?.fileName ?? '').trim();
  }

  private normalizeEpisodes(items: any[]): any[] {
    return (items ?? [])
      .map((episode: any, index: number) => ({
        ...episode,
        id: Number(episode?.episodeId ?? episode?.id ?? 0),
        episodeId: Number(episode?.episodeId ?? episode?.id ?? 0),
        title: String(episode?.title ?? '').trim() || `Episode ${index + 1}`,
        durationSeconds: Number(episode?.durationSeconds ?? 0),
        releaseDate: String(episode?.releaseDate ?? '').trim()
      }))
      .filter((episode: any) => Number(episode?.episodeId ?? episode?.id ?? 0) > 0)
      .sort((a: any, b: any) => Number(b?.episodeId ?? 0) - Number(a?.episodeId ?? 0));
  }

  private toEpisodePreviewLabel(episode: any, index: number): string {
    const rawTitle = String(episode?.title ?? '').trim();
    if (rawTitle && !/^episode[_\s-]*\d+$/i.test(rawTitle)) {
      return rawTitle;
    }

    const episodeNumber = index + 1;
    const labels = ['Episode One', 'Episode Two', 'Episode Three', 'Episode Four'];
    return labels[index] ?? `Episode ${episodeNumber}`;
  }

  private formatDuration(totalSeconds: number): string {
    const value = Number(totalSeconds ?? 0);
    if (!Number.isFinite(value) || value <= 0) {
      return '';
    }

    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  private resolvePodcastImage(item: any): string {
    const candidates = [
      item?.coverArtUrl,
      item?.coverImageUrl,
      item?.coverUrl,
      item?.imageUrl,
      item?.image,
      item?.thumbnailUrl,
      item?.cover?.imageUrl,
      item?.cover?.fileName,
      item?.imageFileName,
      item?.coverFileName,
      item?.coverImageFileName
    ];

    for (const candidate of candidates) {
      const resolved = this.artistService.resolveImageUrl(String(candidate ?? '').trim());
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }
}
