import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, filter, take, timeout } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';
import { resolveHttpErrorMessage } from '../../core/utils/error-message.util';

interface DashboardSnapshot {
  stats: any | null;
  summary: any | null;
  trendPoints: any[];
  topSongs: any[];
  savedAt: number;
}

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly recentUploadsCacheKey = 'revplay_artist_recent_uploads_cache';
  private readonly dashboardCacheKey = 'revplay_artist_dashboard_cache';
  private readonly dashboardCacheTtlMs = 10 * 60 * 1000;
  private readonly recentUploadsPageSize = 20;

  stats: any = null;
  summary: any = null;
  topSongs: any[] = [];
  trendPoints: any[] = [];
  isLoading = true;
  notice: string | null = null;
  error: string | null = null;

  private username = '';
  private artistDisplayName = '';
  private userId: number | null = null;
  private readonly sectionIssues = new Set<string>();
  private loadWatchdog: ReturnType<typeof setTimeout> | null = null;
  private loadWatchdogStartedAt = 0;
  private artistBootstrapAttempts = 0;
  private activeLoadSequence = 0;
  private readonly albumCoverById = new Map<number, string>();
  private readonly pendingSongImageLoads = new Set<number>();

  constructor(
    private artistService: ArtistService,
    private stateService: StateService,
    private authService: AuthService
  ) { }

  ngOnInit(): void {
    const snapshotUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    if (snapshotUser) {
      this.initializeUserContext(snapshotUser);
      this.loadDashboardData();
      return;
    }

    this.authService.currentUser$
      .pipe(
        filter((user) => !!user),
        take(1),
        timeout(1500),
        catchError(() => of(this.getStoredUser()))
      )
      .subscribe((user) => {
        if (!user) {
          this.isLoading = false;
          this.error = 'Unable to identify artist account for this session. Please log in again.';
          return;
        }
        this.initializeUserContext(user);
        this.loadDashboardData();
      });
  }

  ngOnDestroy(): void {
    this.activeLoadSequence += 1;
    this.clearLoadWatchdog();
  }

  loadDashboardData(): void {
    const artistId = this.stateService.artistId;
    if (!artistId) {
      this.ensureArtistProfile();
      return;
    }

    this.activeLoadSequence += 1;
    const currentLoadSequence = this.activeLoadSequence;
    const cachedSnapshot = this.getCachedDashboardSnapshotForCurrentUser();
    const hasCachedSnapshot = !!cachedSnapshot && this.hasRenderableDashboardData(cachedSnapshot);

    this.notice = null;
    this.error = null;
    this.sectionIssues.clear();
    this.clearLoadWatchdog();

    if (hasCachedSnapshot && cachedSnapshot) {
      this.applyDashboardSnapshot(cachedSnapshot);
      this.isLoading = false;
      this.notice = null;
    } else {
      this.stats = null;
      this.summary = null;
      this.topSongs = [];
      this.trendPoints = [];
      this.isLoading = true;
      const cachedRecentSongs = this.getCachedRecentUploadsForCurrentUser();
      if (cachedRecentSongs.length > 0) {
        this.topSongs = cachedRecentSongs.slice(0, 10);
        this.summary = {
          ...(this.summary ?? {}),
          totalSongs: cachedRecentSongs.length
        };
        this.isLoading = false;
      }
      this.loadQuickRecentUploads(artistId, currentLoadSequence);
      this.startLoadWatchdog();
    }

    forkJoin({
      stats: this.artistService.getArtistDashboard(artistId).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'dashboard overview');
          return of(null);
        })
      ),
      summary: this.artistService.getArtistSummary(artistId).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'summary');
          return of(null);
        })
      ),
      trends: this.artistService.getArtistTrends(artistId).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'trends');
          return of([]);
        })
      ),
      topSongs: this.artistService.getArtistSongsPopularity(artistId).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'top songs');
          return of([]);
        })
      ),
      recentUploads: this.artistService.getArtistSongs(artistId, 0, this.recentUploadsPageSize).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'recent uploads');
          return of({ content: [] });
        })
      ),
      albums: this.artistService.getArtistAlbums(artistId, 0, 200).pipe(
        timeout(7000),
        take(1),
        catchError((err) => {
          this.captureSectionIssue(err, 'albums');
          return of({ content: [] });
        })
      )
    }).subscribe({
      next: ({ stats, summary, trends, topSongs, recentUploads, albums }) => {
        if (currentLoadSequence !== this.activeLoadSequence) {
          return;
        }

        this.clearLoadWatchdog();
        this.indexAlbumCovers(albums);

        try {
          const freshSnapshot = this.buildDashboardSnapshot(stats, summary, trends, topSongs, recentUploads);
          const hasFreshData = this.hasRenderableDashboardData(freshSnapshot);

          if (hasFreshData) {
            this.applyDashboardSnapshot(freshSnapshot);
            this.saveDashboardSnapshotForCurrentUser(freshSnapshot);
          }

          if (!hasFreshData) {
            if (hasCachedSnapshot) {
              this.notice = null;
            } else if (this.sectionIssues.size > 0) {
              this.error = 'Unable to load dashboard data right now. Please retry in a moment.';
            } else {
              this.notice = null;
            }
          } else {
            this.notice = null;
          }
        } catch (err) {
          if (hasCachedSnapshot) {
            this.notice = null;
          } else {
            this.error = resolveHttpErrorMessage(err, '/artist/dashboard');
          }
        } finally {
          this.isLoading = false;
        }
      },
      error: (err) => {
        if (currentLoadSequence !== this.activeLoadSequence) {
          return;
        }

        this.clearLoadWatchdog();
        this.isLoading = false;
        if (hasCachedSnapshot) {
          this.notice = null;
          this.error = null;
          return;
        }
        this.error = resolveHttpErrorMessage(err, '/artist/dashboard');
      }
    });
  }

  refreshDashboard(): void {
    this.loadDashboardData();
  }

  private ensureArtistProfile(): void {
    if (!this.username) {
      this.isLoading = false;
      this.error = 'Unable to identify artist account for this session. Please log in again.';
      return;
    }

    this.isLoading = false;
    this.notice = null;
    this.error = null;
    this.artistBootstrapAttempts = 0;
    this.startLoadWatchdog();

    const cachedArtistId = this.stateService.getArtistIdForUser(this.userId) || this.stateService.artistId;
    if (cachedArtistId) {
      this.stateService.setArtistId(cachedArtistId);
      this.clearLoadWatchdog();
      this.loadDashboardData();
      return;
    }

    this.retryResolveArtist(this.username, 1);
  }

  private retryResolveArtist(username: string, retries: number): void {
    this.artistService.findArtistByUsername(username).pipe(
      timeout(3500)
    ).subscribe({
      next: (pagedResult) => {
        const items = pagedResult?.content ?? [];
        const artist = this.findBestArtistSearchResult(items, username);
        const artistId = Number(artist?.artistId ?? artist?.contentId ?? artist?.id ?? 0);

        if (artistId > 0) {
          this.stateService.setArtistId(artistId);
          this.stateService.setArtistIdForUser(this.userId, artistId);
          this.clearLoadWatchdog();
          this.loadDashboardData();
          return;
        }

        if (retries > 0) {
          setTimeout(() => this.retryResolveArtist(username, retries - 1), 600);
          return;
        }

        this.tryResolveArtistByUserCatalog(username);
      },
      error: (err) => {
        const status = Number(err?.status ?? 0);
        if (status === 401 || status === 403) {
          this.clearLoadWatchdog();
          this.isLoading = false;
          this.error = 'Your account cannot access artist dashboard right now. Please check artist role permissions.';
          return;
        }
        if (retries > 0) {
          setTimeout(() => this.retryResolveArtist(username, retries - 1), 600);
          return;
        }
        this.tryResolveArtistByUserCatalog(username);
      }
    });
  }

  private initializeUserContext(user: any): void {
    this.username = user?.username ?? '';
    this.artistDisplayName = this.resolveUserDisplayName(user);
    const resolvedUserId = Number(user?.userId ?? user?.id ?? 0);
    this.userId = resolvedUserId > 0 ? resolvedUserId : null;
    const directArtistId = this.getArtistIdFromUserLike(user);
    const mappedArtistId = this.stateService.getArtistIdForUser(this.userId);

    if (directArtistId) {
      this.stateService.setArtistId(directArtistId);
      this.stateService.setArtistIdForUser(this.userId, directArtistId);
      return;
    }

    if (mappedArtistId) {
      this.stateService.setArtistId(mappedArtistId);
      return;
    }

    if (this.userId) {
      this.stateService.setArtistId(null);
      return;
    }

    const fallbackArtistId = this.stateService.artistId;
    if (fallbackArtistId) {
      this.stateService.setArtistId(fallbackArtistId);
    }
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

  private buildDashboardSnapshot(
    stats: any,
    summary: any,
    trends: any,
    topSongs: any,
    recentUploads: any
  ): DashboardSnapshot {
    const normalizedStats = stats && typeof stats === 'object' ? { ...stats } : null;
    const normalizedSummary = summary && typeof summary === 'object' ? { ...summary } : null;
    const points = Array.isArray(trends) ? trends : (trends?.points ?? trends?.content ?? []);
    const trendPoints = Array.isArray(points) ? points : [];
    const rankedSongs = this.normalizeTopSongs(topSongs);
    const recentSongs = this.normalizeTopSongs(recentUploads);
    const cachedSongs = this.getCachedRecentUploadsForCurrentUser();
    let resolvedTopSongs = rankedSongs.length > 0 ? rankedSongs : recentSongs;
    if (resolvedTopSongs.length === 0 && cachedSongs.length > 0) {
      resolvedTopSongs = cachedSongs;
    }
    resolvedTopSongs = resolvedTopSongs.slice(0, 10);

    let resolvedSummary = normalizedSummary;
    const summaryTotalSongs = Number(resolvedSummary?.totalSongs ?? 0);
    if (summaryTotalSongs <= 0 && resolvedTopSongs.length > 0) {
      resolvedSummary = {
        ...(resolvedSummary ?? {}),
        totalSongs: resolvedTopSongs.length
      };
    }

    return {
      stats: normalizedStats,
      summary: resolvedSummary,
      trendPoints,
      topSongs: resolvedTopSongs,
      savedAt: Date.now()
    };
  }

  private applyDashboardSnapshot(snapshot: DashboardSnapshot): void {
    this.stats = snapshot?.stats ?? null;
    this.summary = snapshot?.summary ?? null;
    this.trendPoints = Array.isArray(snapshot?.trendPoints) ? snapshot.trendPoints : [];
    this.topSongs = Array.isArray(snapshot?.topSongs) ? snapshot.topSongs.slice(0, 10) : [];
    this.hydrateTopSongImages();
  }

  private hasObjectData(value: any): boolean {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
  }

  private hasRenderableDashboardData(snapshot: DashboardSnapshot | null): boolean {
    if (!snapshot) {
      return false;
    }
    return this.hasObjectData(snapshot.stats) ||
      this.hasObjectData(snapshot.summary) ||
      (Array.isArray(snapshot.trendPoints) && snapshot.trendPoints.length > 0) ||
      (Array.isArray(snapshot.topSongs) && snapshot.topSongs.length > 0);
  }

  private getCachedDashboardSnapshotForCurrentUser(): DashboardSnapshot | null {
    const uid = Number(this.userId ?? 0);
    if (uid <= 0) {
      return null;
    }

    try {
      const raw = localStorage.getItem(this.dashboardCacheKey);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      const scoped = parsed?.[String(uid)];
      if (!scoped || typeof scoped !== 'object') {
        return null;
      }

      const savedAt = Number(scoped?.savedAt ?? 0);
      if (savedAt <= 0 || (Date.now() - savedAt) > this.dashboardCacheTtlMs) {
        delete parsed[String(uid)];
        localStorage.setItem(this.dashboardCacheKey, JSON.stringify(parsed));
        return null;
      }

      const snapshot: DashboardSnapshot = {
        stats: scoped?.stats && typeof scoped.stats === 'object' ? scoped.stats : null,
        summary: scoped?.summary && typeof scoped.summary === 'object' ? scoped.summary : null,
        trendPoints: Array.isArray(scoped?.trendPoints) ? scoped.trendPoints : [],
        topSongs: this.normalizeTopSongs(scoped?.topSongs),
        savedAt
      };

      return this.hasRenderableDashboardData(snapshot) ? snapshot : null;
    } catch {
      return null;
    }
  }

  private saveDashboardSnapshotForCurrentUser(snapshot: DashboardSnapshot): void {
    const uid = Number(this.userId ?? 0);
    if (uid <= 0 || !this.hasRenderableDashboardData(snapshot)) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.dashboardCacheKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const safeMap = parsed && typeof parsed === 'object' ? parsed : {};
      safeMap[String(uid)] = {
        stats: snapshot.stats ?? null,
        summary: snapshot.summary ?? null,
        trendPoints: Array.isArray(snapshot.trendPoints) ? snapshot.trendPoints : [],
        topSongs: Array.isArray(snapshot.topSongs) ? snapshot.topSongs.slice(0, 10) : [],
        savedAt: Date.now()
      };
      localStorage.setItem(this.dashboardCacheKey, JSON.stringify(safeMap));
    } catch {
      // cache write is best-effort.
    }
  }

  private startLoadWatchdog(): void {
    const now = Date.now();
    if (!this.loadWatchdogStartedAt) {
      this.loadWatchdogStartedAt = now;
    }
    const elapsedMs = now - this.loadWatchdogStartedAt;
    const maxWindowMs = 10000;
    const remainingMs = Math.max(800, maxWindowMs - elapsedMs);

    if (this.loadWatchdog) {
      clearTimeout(this.loadWatchdog);
      this.loadWatchdog = null;
    }
    this.loadWatchdog = setTimeout(() => {
      if (!this.isLoading) {
        return;
      }
      this.isLoading = false;
      this.error = 'Dashboard load timed out. Please retry once.';
      this.loadWatchdogStartedAt = 0;
    }, remainingMs);
  }

  private clearLoadWatchdog(): void {
    if (!this.loadWatchdog) {
      return;
    }
    clearTimeout(this.loadWatchdog);
    this.loadWatchdog = null;
    this.loadWatchdogStartedAt = 0;
  }

  private normalizeTopSongs(items: any): any[] {
    const list = Array.isArray(items) ? items : (items?.content ?? []);
    return (list ?? []).map((track: any, index: number) => {
      if (!track || typeof track !== 'object') {
        return null;
      }
      const songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
      return {
        ...track,
        songId: songId > 0 ? songId : null,
        title: track?.title ?? track?.name ?? `Track #${songId > 0 ? songId : index + 1}`,
        artistName: this.resolveArtistName(track),
        playCount: Number(track?.playCount ?? track?.totalPlays ?? track?.streams ?? track?.count ?? 0),
        imageUrl: this.resolveSongImageUrl(track)
      };
    }).filter((track: any) => !!track);
  }

  private resolveArtistName(track: any): string {
    const values = [
      track?.artistName,
      track?.artistDisplayName,
      track?.artist?.displayName,
      track?.artist?.name,
      track?.uploaderName,
      track?.createdByName,
      track?.username,
      track?.displayName
    ];

    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }
    return this.artistDisplayName || this.username || 'Unknown Artist';
  }

  private resolveSongImageUrl(track: any): string {
    const candidates = [
      track?.imageUrl,
      track?.coverUrl,
      track?.coverArtUrl,
      track?.coverImageUrl,
      track?.cover?.imageUrl,
      track?.cover?.url,
      track?.cover?.fileName,
      track?.artworkUrl,
      track?.image,
      track?.thumbnailUrl,
      track?.imageFileName,
      track?.coverFileName,
      track?.coverImageFileName,
      track?.imageName,
      track?.album?.coverArtUrl,
      track?.album?.coverImageUrl,
      track?.album?.cover?.imageUrl,
      track?.album?.cover?.fileName,
      track?.album?.coverFileName,
      track?.albumImageUrl
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (!value) {
        continue;
      }
      const resolved = this.artistService.resolveImageUrl(value);
      if (resolved) {
        return resolved;
      }
    }

    const albumId = Number(track?.albumId ?? track?.album?.albumId ?? track?.album?.id ?? 0);
    if (albumId > 0) {
      const albumCover = this.albumCoverById.get(albumId);
      if (albumCover) {
        return albumCover;
      }
    }

    const songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
    if (songId > 0) {
      const cached = this.artistService.getCachedSongImage(songId);
      if (cached) {
        return cached;
      }
    }

    return '';
  }

  onTrackImageError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) {
      return;
    }
    img.src = '/assets/images/placeholder-album.png';
  }

  private captureSectionIssue(err: any, section: string): void {
    const status = Number(err?.status ?? 0);
    if (status === 401) {
      this.sectionIssues.add(`${section}: session`);
      return;
    }
    if (status === 403) {
      this.sectionIssues.add(`${section}: access`);
      return;
    }
    this.sectionIssues.add(section);
  }

  private getArtistIdFromUserLike(user: any): number | null {
    const candidates = [
      user?.artistId,
      user?.artist?.artistId,
      user?.artist?.id,
      user?.artistProfileId,
      user?.profile?.artistId
    ];

    for (const value of candidates) {
      const artistId = Number(value ?? 0);
      if (artistId > 0) {
        return artistId;
      }
    }

    return null;
  }

  private resolveUserDisplayName(user: any): string {
    const candidates = [
      user?.displayName,
      user?.fullName,
      user?.name,
      user?.username
    ];

    for (const value of candidates) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  private getCachedRecentUploadsForCurrentUser(): any[] {
    const uid = Number(this.userId ?? 0);
    if (uid <= 0) {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.recentUploadsCacheKey);
      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);
      const scoped = Array.isArray(parsed?.[String(uid)]) ? parsed[String(uid)] : [];
      return scoped
        .map((item: any, index: number) => {
          const songId = Number(item?.songId ?? item?.id ?? 0);
          return {
            ...item,
            songId: songId > 0 ? songId : null,
            title: String(item?.title ?? '').trim() || `Track #${index + 1}`,
            artistName: String(item?.artistName ?? '').trim() || this.artistDisplayName || this.username || 'Unknown Artist',
            playCount: Number(item?.playCount ?? 0),
            imageUrl: this.resolveSongImageUrl(item)
          };
        })
        .filter((song: any) => Number(song?.songId ?? 0) > 0);
    } catch {
      return [];
    }
  }

  private indexAlbumCovers(albumsResponse: any): void {
    this.albumCoverById.clear();
    const list = Array.isArray(albumsResponse) ? albumsResponse : (albumsResponse?.content ?? []);
    for (const album of list ?? []) {
      const albumId = Number(album?.albumId ?? album?.id ?? 0);
      if (albumId <= 0) {
        continue;
      }
      const resolved = this.artistService.resolveImageUrl(
        album?.coverArtUrl ??
        album?.coverImageUrl ??
        album?.imageUrl ??
        album?.image ??
        album?.cover?.imageUrl ??
        album?.cover?.fileName ??
        ''
      );
      if (resolved) {
        this.albumCoverById.set(albumId, resolved);
      }
    }
  }

  private hydrateTopSongImages(): void {
    for (const track of this.topSongs ?? []) {
      if (!track) {
        continue;
      }

      if (!track.imageUrl) {
        const fromCurrent = this.resolveSongImageUrl(track);
        if (fromCurrent) {
          track.imageUrl = fromCurrent;
        }
      }

      const songId = Number(track?.songId ?? track?.id ?? track?.contentId ?? 0);
      if (!songId || track?.imageUrl || this.pendingSongImageLoads.has(songId)) {
        continue;
      }

      this.pendingSongImageLoads.add(songId);
      this.artistService.getSong(songId).pipe(
        take(1),
        catchError(() => of(null))
      ).subscribe((song) => {
        this.pendingSongImageLoads.delete(songId);
        if (!song) {
          return;
        }
        const resolved = this.resolveSongImageUrl(song);
        if (!resolved) {
          return;
        }
        this.artistService.cacheSongImage(songId, resolved);
        const target = this.topSongs.find((item) => Number(item?.songId ?? item?.id ?? 0) === songId);
        if (target) {
          target.imageUrl = resolved;
        }
      });
    }
  }

  private createArtistProfileFallback(username: string): void {
    this.artistBootstrapAttempts += 1;
    if (this.artistBootstrapAttempts > 2) {
      this.clearLoadWatchdog();
      this.isLoading = false;
      this.error = 'Artist profile not found for this account.';
      return;
    }

    this.artistService.createArtist({
      displayName: username,
      bio: '',
      artistType: 'BOTH'
    }).pipe(
      timeout(7000)
    ).subscribe({
      next: (created) => {
        const artistId = Number(created?.artistId ?? created?.id ?? 0);
        if (artistId > 0) {
          this.stateService.setArtistId(artistId);
          this.stateService.setArtistIdForUser(this.userId, artistId);
          this.clearLoadWatchdog();
          this.loadDashboardData();
          return;
        }

        this.clearLoadWatchdog();
        this.isLoading = false;
        this.error = 'Artist profile not found for this account.';
      },
      error: (err) => {
        if (Number(err?.status ?? 0) === 409) {
          this.tryResolveArtistByUserCatalog(username);
          return;
        }
        this.clearLoadWatchdog();
        this.isLoading = false;
        this.error = 'Unable to load creator dashboard right now. Please retry.';
      }
    });
  }

  private tryResolveArtistByUserCatalog(username: string): void {
    this.artistService.findArtistByUsername(username).pipe(
      timeout(3500),
      catchError(() => of({ content: [] }))
    ).subscribe((searchResponse) => {
      const items = Array.isArray(searchResponse?.content) ? searchResponse.content : [];
      const artist = this.findBestArtistSearchResult(items, username);
      const artistId = Number(artist?.artistId ?? artist?.contentId ?? artist?.id ?? 0);

      if (artistId > 0) {
        this.stateService.setArtistId(artistId);
        this.stateService.setArtistIdForUser(this.userId, artistId);
        this.clearLoadWatchdog();
        this.loadDashboardData();
        return;
      }

      if (this.artistBootstrapAttempts < 2) {
        this.createArtistProfileFallback(username);
        return;
      }

      this.clearLoadWatchdog();
      this.isLoading = false;
      this.error = 'Artist profile not found for this account.';
    });
  }

  private findBestArtistSearchResult(items: any[], username: string): any {
    const artistItems = (items ?? []).filter((item: any) => this.isArtistLikeSearchItem(item));
    if (artistItems.length === 0) {
      return null;
    }

    const expectedUserId = Number(this.userId ?? 0);
    if (expectedUserId > 0) {
      const byUserId = artistItems.find((item: any) => {
        const candidates = [
          item?.userId,
          item?.ownerUserId,
          item?.createdBy,
          item?.accountId,
          item?.artist?.userId
        ];
        return candidates.some((value) => Number(value ?? 0) === expectedUserId);
      });
      if (byUserId) {
        return byUserId;
      }
    }

    const normalizedUsername = String(username ?? '').trim().toLowerCase();
    return artistItems.find((item: any) => {
      const candidates = [item?.username, item?.title, item?.artistName, item?.displayName, item?.name];
      return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
    }) ?? artistItems[0] ?? null;
  }

  private isArtistLikeSearchItem(item: any): boolean {
    const rawType = String(item?.type ?? '').trim().toUpperCase();
    const artistId = Number(item?.artistId ?? 0);
    const contentId = Number(item?.contentId ?? 0);
    const id = Number(item?.id ?? 0);

    if (['SONG', 'ALBUM', 'PODCAST', 'PLAYLIST', 'GENRE'].includes(rawType)) {
      return false;
    }

    if (['ARTIST', 'BOTH', 'MUSIC', 'MUSICIAN', 'CREATOR'].includes(rawType)) {
      return artistId > 0 || contentId > 0 || id > 0;
    }

    return artistId > 0 || contentId > 0 || id > 0;
  }

  private loadQuickRecentUploads(artistId: number, loadSequence: number): void {
    this.artistService.getArtistSongs(artistId, 0, this.recentUploadsPageSize).pipe(
      timeout(3000),
      take(1),
      catchError(() => of({ content: [] }))
    ).subscribe((recentUploads) => {
      if (loadSequence !== this.activeLoadSequence) {
        return;
      }
      if ((this.topSongs ?? []).length > 0) {
        return;
      }
      const normalized = this.normalizeTopSongs(recentUploads);
      if (normalized.length === 0) {
        return;
      }
      this.topSongs = normalized.slice(0, 10);
      this.summary = {
        ...(this.summary ?? {}),
        totalSongs: Number(this.summary?.totalSongs ?? 0) || normalized.length
      };
      this.isLoading = false;
    });
  }
}
