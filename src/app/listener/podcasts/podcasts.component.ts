import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BrowseService } from '../services/browse.service';
import { FollowingService } from '../../core/services/following.service';
import { ArtistService } from '../../core/services/artist.service';
import { AuthService } from '../../core/services/auth';
import { StateService } from '../../core/services/state.service';
import { ApiService } from '../../core/services/api';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

@Component({
  selector: 'app-podcasts',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './podcasts.component.html',
  styleUrl: './podcasts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PodcastsComponent implements OnInit {
  popular: any[] = [];
  recommended: any[] = [];
  isLoading = true;
  error: string | null = null;
  actionMessage: string | null = null;

  constructor(
    private browseService: BrowseService,
    private followingService: FollowingService,
    private artistService: ArtistService,
    private authService: AuthService,
    private stateService: StateService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.resolveArtistId().pipe(
      switchMap((artistId) => forkJoin({
        popular: this.browseService.getPopularPodcasts().pipe(catchError(() => of({ content: [] }))),
        recommended: this.browseService.getRecommendedPodcasts(0, 25).pipe(catchError(() => of({ content: [] }))),
        seeded: this.apiService.get<any>('/search?q=a&type=PODCAST&page=0&size=80').pipe(
          catchError(() => of({ content: [] }))
        ),
        creatorPodcasts: artistId > 0
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
      title: item?.title ?? 'Podcast',
      description: item?.description ?? '',
      playCount: item?.playCount ?? 0,
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
}
