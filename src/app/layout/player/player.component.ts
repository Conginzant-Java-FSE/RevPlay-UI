import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { PlayerService, PlayerState } from '../../core/services/player.service';
import { Subscription, of } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { PlaylistService } from '../../core/services/playlist.service';
import { LikesService } from '../../core/services/likes.service';
import { BrowseService } from '../../listener/services/browse.service';
import { shareSongToPlatform, shareSongWithFallback } from '../../core/utils/song-share.util';
import { PremiumService } from '../../core/services/premium.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { AdIndicatorComponent } from '../../components/ad-indicator/ad-indicator.component';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-player',
  templateUrl: './player.component.html',
  styleUrls: ['./player.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, ProtectedMediaPipe, AdIndicatorComponent]
})
export class PlayerComponent implements OnInit, OnDestroy {
  queuePanelOpen = false;
  showNowPlayingOverlay = false;
  actionMessage: string | null = null;
  actionError: string | null = null;
  showAddToPlaylistPicker = false;
  targetPlaylistIdForSongAdd = '';
  playlistTargets: any[] = [];
  isActionSaving = false;
  showPremiumFeatureModal = false;
  isPremiumUser = false;
  isDownloading = false;
  showDownloadToast = false;
  playerState: PlayerState = {
    currentItem: null,
    queue: [],
    currentIndex: -1,
    isPlaying: false,
    repeatMode: 'OFF',
    isShuffle: false,
    volume: 50,
    duration: 0,
    currentTime: 0,
    bufferedPercent: 0,
    isLoading: false,
    isQueueSyncing: false,
    autoplayEnabled: true,
    autoplayMessage: null,
    songsPlayedCount: 0,
    isAdPlaying: false
  };
  songsPlayedCount = 0;
  private sub!: Subscription;
  private premiumSub!: Subscription;
  private nowPlayingRequestSub!: Subscription;
  private currentUserId: number | null = null;
  private shouldOpenNowPlayingOnNextTrack = false;
  private likedSongIds = new Set<number>();
  private likeIdBySongId = new Map<number, number>();

  constructor(
    public playerService: PlayerService,
    private playlistService: PlaylistService,
    private likesService: LikesService,
    private browseService: BrowseService,
    private premiumService: PremiumService,
    private http: HttpClient,
    private router: Router,
    private ngZone: NgZone,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.currentUserId = this.resolveCurrentUserId();
    this.isPremiumUser = this.premiumService.isPremiumUser;
    this.loadLikedSongs();
    this.premiumSub = this.premiumService.status$.subscribe((status) => {
      this.ngZone.run(() => {
        this.isPremiumUser = !!status?.isPremium;
        this.cdr.markForCheck();
      });
    });
    this.nowPlayingRequestSub = this.playerService.nowPlayingOpenRequest$.subscribe(() => {
      this.ngZone.run(() => {
        if (this.isCompactViewport()) {
          this.shouldOpenNowPlayingOnNextTrack = true;
        }
      });
    });
    this.sub = this.playerService.state$.subscribe(state => {
      this.ngZone.run(() => {
        this.playerState = state;
        this.songsPlayedCount = Number(state.songsPlayedCount ?? 0);
        if (this.shouldOpenNowPlayingOnNextTrack && !!state.currentItem && !state.isAdPlaying) {
          this.showNowPlayingOverlay = true;
          this.shouldOpenNowPlayingOnNextTrack = false;
        }
        this.cdr.markForCheck();
      });
    });
  }

  ngOnDestroy(): void {
    if (this.sub) this.sub.unsubscribe();
    if (this.premiumSub) this.premiumSub.unsubscribe();
    if (this.nowPlayingRequestSub) this.nowPlayingRequestSub.unsubscribe();
  }

  formatTime(seconds: number): string {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  currentTrackImage(): string {
    const current = this.playerState.currentItem;
    return String(
      current?.imageUrl ??
      current?.coverArtUrl ??
      current?.coverImageUrl ??
      current?.coverUrl ??
      current?.thumbnailUrl ??
      current?.album?.coverArtUrl ??
      current?.album?.coverImageUrl ??
      current?.song?.coverArtUrl ??
      current?.song?.coverImageUrl ??
      current?.song?.thumbnailUrl ??
      ''
    ).trim();
  }

  onSeek(event: any) {
    this.playerService.seek(Number(event.target.value));
  }

  onVolumeChange(event: any) {
    this.playerService.setVolume(Number(event.target.value));
  }

  toggleQueuePanel(): void {
    this.queuePanelOpen = !this.queuePanelOpen;
    if (this.queuePanelOpen) {
      this.playerService.refreshQueueFromServer();
    }
  }

  playFromQueue(item: any): void {
    this.playerService.playQueueItem(item);
  }

  addCurrentSongToQueue(): void {
    const current = this.playerState.currentItem;
    if (!current) {
      return;
    }
    this.playerService.addToQueue(current);
    this.actionError = null;
    this.actionMessage = 'Added to queue.';
  }

  downloadCurrentSong(): void {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId || !this.currentUserId) {
      this.actionError = 'Unable to download song. Please try again.';
      this.actionMessage = null;
      return;
    }

    if (!this.isPremiumUser) {
      this.showPremiumFeatureModal = true;
      return;
    }

    this.isDownloading = true;
    this.actionError = null;
    this.actionMessage = null;

    const endpoint = `${environment.apiUrl}/download/song/${songId}?userId=${this.currentUserId}`;
    this.http.get(endpoint, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.isDownloading = false;
        this.triggerSongDownload(blob, current);
        this.showDownloadStartedToast();
      },
      error: () => {
        this.isDownloading = false;
        this.actionError = 'Unable to download song. Please try again.';
      }
    });
  }

  async shareCurrentSong(): Promise<void> {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId) {
      this.actionError = 'No playable song selected.';
      this.actionMessage = null;
      return;
    }

    const result = await shareSongWithFallback({
      songId,
      title: String(current?.title ?? 'Song'),
      artistName: String(current?.artistName ?? '')
    });

    this.actionError = null;
    this.actionMessage = null;

    if (result.status === 'shared') {
      this.actionMessage = 'Song share dialog opened.';
      return;
    }

    if (result.status === 'copied') {
      this.actionMessage = 'Song link copied.';
      return;
    }

    if (result.status === 'cancelled') {
      return;
    }

    this.actionError = result.status === 'unsupported'
      ? 'Sharing is not supported in this browser.'
      : 'Failed to share this song.';
  }

  shareCurrentSongTo(platform: 'WHATSAPP' | 'TELEGRAM'): void {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId) {
      this.actionError = 'No playable song selected.';
      this.actionMessage = null;
      return;
    }

    const result = shareSongToPlatform({
      songId,
      title: String(current?.title ?? 'Song'),
      artistName: String(current?.artistName ?? '')
    }, platform);

    this.actionError = null;
    this.actionMessage = null;

    if (result.status === 'shared') {
      this.actionMessage = platform === 'WHATSAPP'
        ? 'Opening WhatsApp share.'
        : 'Opening Telegram share.';
      return;
    }

    this.actionError = 'Failed to open share option. Please allow popups and try again.';
  }

  openNowPlayingOverlay(): void {
    if (!this.playerState.currentItem) {
      return;
    }
    this.showNowPlayingOverlay = true;
  }

  closeNowPlayingOverlay(): void {
    this.showNowPlayingOverlay = false;
  }

  removeQueueItem(item: any): void {
    this.playerService.removeFromQueue(Number(item?.queueId ?? 0));
  }

  moveQueueItem(item: any, direction: 'UP' | 'DOWN'): void {
    this.playerService.reorderQueue(Number(item?.queueId ?? 0), direction);
  }

  isCurrentQueueItem(item: any): boolean {
    return Number(item?.queueId ?? 0) > 0 &&
      Number(item?.queueId ?? 0) === Number(this.playerState.currentItem?.queueId ?? -1);
  }

  addCurrentSongToLikedSongs(): void {
    this.toggleCurrentSongLike();
  }

  openAddToPlaylistPicker(): void {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId) {
      this.actionError = 'No playable song selected.';
      this.actionMessage = null;
      return;
    }

    this.showAddToPlaylistPicker = true;
    this.targetPlaylistIdForSongAdd = '';
    this.actionError = null;
    this.actionMessage = null;

    if (this.playlistTargets.length > 0) {
      return;
    }

    this.playlistService.getUserPlaylists(0, 100).subscribe({
      next: (response) => {
        this.playlistTargets = (response?.content ?? [])
          .map((playlist: any) => ({
            ...playlist,
            id: Number(playlist?.id ?? playlist?.playlistId ?? 0)
          }))
          .filter((playlist: any) => Number(playlist?.id ?? 0) > 0);
      },
      error: () => {
        this.playlistTargets = [];
        this.actionError = 'Unable to load your playlists right now.';
      }
    });
  }

  closeAddToPlaylistPicker(): void {
    this.showAddToPlaylistPicker = false;
    this.targetPlaylistIdForSongAdd = '';
  }

  addCurrentSongToSelectedPlaylist(): void {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    const playlistId = Number(this.targetPlaylistIdForSongAdd ?? 0);
    if (!songId || !playlistId) {
      this.actionError = 'Please select a playlist.';
      this.actionMessage = null;
      return;
    }

    this.isActionSaving = true;
    this.actionError = null;
    this.actionMessage = null;
    this.playlistService.addSongToPlaylist(playlistId, songId).subscribe({
      next: () => {
        this.isActionSaving = false;
        this.closeAddToPlaylistPicker();
        this.actionMessage = 'Song added to playlist.';
      },
      error: () => {
        this.isActionSaving = false;
        this.actionError = 'Failed to add song to selected playlist.';
      }
    });
  }


  isCurrentSongLiked(): boolean {
    const songId = Number(this.playerState.currentItem?.songId ?? this.playerState.currentItem?.id ?? 0);
    return songId > 0 && this.likedSongIds.has(songId);
  }

  toggleCurrentSongLike(): void {
    const current = this.playerState.currentItem;
    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId || !this.currentUserId) {
      this.actionError = 'User session not found.';
      this.actionMessage = null;
      return;
    }

    this.actionError = null;
    this.actionMessage = null;

    if (this.likedSongIds.has(songId)) {
      const cachedLikeId = this.likeIdBySongId.get(songId);
      if (cachedLikeId) {
        this.unlikeSong(songId, cachedLikeId);
        return;
      }

      this.likesService.getSongLikeId(this.currentUserId, songId).subscribe({
        next: (resolvedLikeId) => {
          if (!resolvedLikeId) {
            this.likedSongIds.delete(songId);
            this.likeIdBySongId.delete(songId);
            this.actionMessage = 'Removed from liked songs.';
            return;
          }
          this.unlikeSong(songId, resolvedLikeId);
        },
        error: () => {
          this.actionError = 'Failed to verify liked songs state.';
        }
      });
      return;
    }

    this.likesService.likeSong(songId).subscribe({
      next: (response) => {
        const likeId = Number(response?.id ?? response?.likeId ?? 0);
        this.likedSongIds.add(songId);
        if (likeId > 0) {
          this.likeIdBySongId.set(songId, likeId);
        }
        this.actionMessage = 'Added to liked songs.';
      },
      error: () => {
        this.actionError = 'Failed to add this song to liked songs.';
      }
    });
  }


  closePremiumFeatureModal(): void {
    this.showPremiumFeatureModal = false;
  }

  goToPremiumPage(): void {
    this.showPremiumFeatureModal = false;
    this.router.navigate(['/premium']);
  }

  goToAlbumFromCurrent(): void {
    const current = this.playerState.currentItem;
    const openByAlbumId = (albumId: number) => {
      if (albumId <= 0) {
        this.actionError = 'Album details are not available for this song.';
        this.actionMessage = null;
        return;
      }

      this.router.navigate(['/search'], {
        queryParams: { type: 'ALBUM', albumId }
      });
    };

    const albumId = Number(current?.albumId ?? 0);
    if (albumId > 0) {
      openByAlbumId(albumId);
      return;
    }

    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId) {
      this.actionError = 'Album details are not available for this song.';
      this.actionMessage = null;
      return;
    }

    this.browseService.getSongById(songId).pipe(
      catchError(() => of(null))
    ).subscribe((resolved) => openByAlbumId(Number(resolved?.albumId ?? 0)));
  }

  goToArtistFromCurrent(): void {
    const current = this.playerState.currentItem;
    const openByArtistName = (artistName: string) => {
      const value = String(artistName ?? '').trim();
      if (!value) {
        this.actionError = 'Artist details are not available for this song.';
        this.actionMessage = null;
        return;
      }

      this.router.navigate(['/search'], {
        queryParams: { q: value, type: 'ARTIST' }
      });
    };

    const artistName = String(current?.artistName ?? '').trim();
    if (artistName) {
      openByArtistName(artistName);
      return;
    }

    const songId = Number(current?.songId ?? current?.id ?? 0);
    if (!songId) {
      this.actionError = 'Artist details are not available for this song.';
      this.actionMessage = null;
      return;
    }

    this.browseService.getSongById(songId).pipe(
      catchError(() => of(null))
    ).subscribe((resolved) => openByArtistName(String(resolved?.artistName ?? '')));
  }

  get volumeIcon(): string {
    if (this.playerState.volume === 0) {
      return 'bi-volume-mute-fill';
    }
    if (this.playerState.volume < 50) {
      return 'bi-volume-down-fill';
    }
    return 'bi-volume-up-fill';
  }

  get repeatLabel(): string {
    if (this.playerState.repeatMode === 'ONE') {
      return 'Repeat one';
    }
    if (this.playerState.repeatMode === 'ALL') {
      return 'Repeat all';
    }
    return 'Repeat off';
  }

  get playbackPercent(): number {
    const duration = Number(this.playerState.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      return 0;
    }
    const current = Number(this.playerState.currentTime ?? 0);
    if (!Number.isFinite(current) || current <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, (current / duration) * 100));
  }

  get adCountdownSeconds(): number {
    if (!this.playerState.isAdPlaying) {
      return 0;
    }
    return Math.max(0, Math.ceil(Number(this.playerState.duration ?? 0) - Number(this.playerState.currentTime ?? 0)));
  }

  get progressStartLabel(): string {
    if (this.playerState.isAdPlaying) {
      return '0:00';
    }
    return this.formatTime(this.playerState.currentTime);
  }

  get progressEndLabel(): string {
    if (this.playerState.isAdPlaying) {
      return this.formatTime(this.adCountdownSeconds);
    }
    return this.formatTime(this.playerState.duration);
  }

  get upcomingQueueItems(): Array<{ item: any; queueIndex: number }> {
    const queue = Array.isArray(this.playerState.queue) ? this.playerState.queue : [];
    if (queue.length === 0) {
      return [];
    }
    const startIndex = Math.max(0, Number(this.playerState.currentIndex ?? -1) + 1);
    return queue.slice(startIndex).map((item: any, index: number) => ({
      item,
      queueIndex: startIndex + index
    }));
  }

  get manualUpNextItems(): Array<{ item: any; queueIndex: number }> {
    return this.upcomingQueueItems.filter((entry) => !this.isAutoplayQueueItem(entry.item));
  }

  get autoplayUpNextItems(): Array<{ item: any; queueIndex: number }> {
    return this.upcomingQueueItems.filter((entry) => this.isAutoplayQueueItem(entry.item));
  }

  isAutoplayQueueItem(item: any): boolean {
    return !!item?.isAutoplay || String(item?.queueSection ?? '').toUpperCase() === 'AUTOPLAY';
  }

  private resolveCurrentUserId(): number | null {
    const rawUser = localStorage.getItem('revplay_user');
    if (!rawUser) {
      return null;
    }

    try {
      const user = JSON.parse(rawUser);
      const id = Number(user?.userId ?? user?.id ?? 0);
      return id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  private triggerSongDownload(blob: Blob, currentItem: any): void {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const title = this.sanitizeFileName(String(currentItem?.title ?? 'song'));
    link.href = objectUrl;
    link.download = `${title}.mp3`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }

  private sanitizeFileName(rawValue: string): string {
    const cleaned = String(rawValue ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return cleaned || 'song';
  }

  private showDownloadStartedToast(): void {
    this.showDownloadToast = true;
    setTimeout(() => {
      this.showDownloadToast = false;
      this.cdr.markForCheck();
    }, 2200);
    this.cdr.markForCheck();
  }

  private isCompactViewport(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia('(max-width: 768px)').matches;
  }

  private loadLikedSongs(): void {
    if (!this.currentUserId) {
      return;
    }

    this.likesService.getUserLikes(this.currentUserId, 'SONG', 0, 400).subscribe({
      next: (likes) => {
        const nextLikedIds = new Set<number>();
        const nextLikeIds = new Map<number, number>();
        for (const like of likes ?? []) {
          const songId = Number(like?.likeableId ?? 0);
          if (songId <= 0) {
            continue;
          }
          nextLikedIds.add(songId);
          const likeId = Number(like?.id ?? 0);
          if (likeId > 0) {
            nextLikeIds.set(songId, likeId);
          }
        }
        this.likedSongIds = nextLikedIds;
        this.likeIdBySongId = nextLikeIds;
        this.cdr.markForCheck();
      },
      error: () => {
        // Ignore like preload failures.
      }
    });
  }

  private unlikeSong(songId: number, likeId: number): void {
    this.likesService.unlikeByLikeId(likeId).subscribe({
      next: () => {
        this.likedSongIds.delete(songId);
        this.likeIdBySongId.delete(songId);
        this.actionMessage = 'Removed from liked songs.';
      },
      error: () => {
        this.actionError = 'Failed to remove this song from liked songs.';
      }
    });
  }
}
