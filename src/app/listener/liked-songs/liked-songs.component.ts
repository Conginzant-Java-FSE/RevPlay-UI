import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BrowseService } from '../services/browse.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';
import { LikesService } from '../../core/services/likes.service';
import { ArtistService } from '../../core/services/artist.service';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';
import { PlaylistService } from '../../core/services/playlist.service';
import { Router } from '@angular/router';
import { shareSongWithFallback } from '../../core/utils/song-share.util';

@Component({
  selector: 'app-liked-songs',
  standalone: true,
  imports: [CommonModule, FormsModule, ProtectedMediaPipe],
  templateUrl: './liked-songs.component.html',
  styleUrl: './liked-songs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LikedSongsComponent implements OnInit {
  likedSongs: any[] = [];
  isLoading = true;
  error: string | null = null;
  actionMessage: string | null = null;
  showAddToPlaylistPicker = false;
  songForPlaylistAdd: any | null = null;
  targetPlaylistIdForSongAdd = '';
  playlistTargets: any[] = [];
  isActionSaving = false;
  private artistNameCache = new Map<number, string>();
  private currentUserId: number | null = null;

  constructor(
    private browseService: BrowseService,
    private likesService: LikesService,
    private authService: AuthService,
    private playerService: PlayerService,
    private artistService: ArtistService,
    private playlistService: PlaylistService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    const currentUser = this.authService.getCurrentUserSnapshot();
    const userId = Number(currentUser?.userId ?? currentUser?.id ?? 0);
    this.currentUserId = userId || null;
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

  addToQueue(song: any): void {
    this.playerService.addToQueue(song);
  }

  async shareSong(song: any): Promise<void> {
    const result = await shareSongWithFallback({
      songId: Number(song?.songId ?? song?.contentId ?? song?.id ?? 0),
      title: String(song?.title ?? 'Song'),
      artistName: String(song?.artistName ?? '')
    });

    this.actionMessage = null;
    this.error = null;

    if (result.status === 'shared') {
      this.actionMessage = 'Song share dialog opened.';
      this.cdr.markForCheck();
      return;
    }

    if (result.status === 'copied') {
      this.actionMessage = 'Song link copied.';
      this.cdr.markForCheck();
      return;
    }

    if (result.status === 'cancelled') {
      this.cdr.markForCheck();
      return;
    }

    this.error = result.status === 'unsupported'
      ? 'Sharing is not supported in this browser.'
      : 'Failed to share this song.';
    this.cdr.markForCheck();
  }

  goToAlbum(song: any): void {
    const albumId = Number(song?.albumId ?? 0);
    if (albumId > 0) {
      this.router.navigate(['/search'], {
        queryParams: { type: 'ALBUM', albumId }
      });
      return;
    }
    this.error = 'Album details are not available for this song.';
    this.cdr.markForCheck();
  }

  goToArtist(song: any): void {
    const artistName = String(song?.artistName ?? '').trim();
    if (!artistName) {
      this.error = 'Artist details are not available for this song.';
      this.cdr.markForCheck();
      return;
    }
    this.router.navigate(['/search'], {
      queryParams: { q: artistName, type: 'ARTIST' }
    });
  }

  openAddToPlaylistPicker(song: any): void {
    const songId = Number(song?.songId ?? song?.id ?? 0);
    if (!songId) {
      return;
    }

    this.songForPlaylistAdd = song;
    this.targetPlaylistIdForSongAdd = '';
    this.showAddToPlaylistPicker = true;
    this.actionMessage = null;
    this.error = null;

    if (this.playlistTargets.length > 0) {
      this.cdr.markForCheck();
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
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Unable to load your playlists right now.';
        this.playlistTargets = [];
        this.cdr.markForCheck();
      }
    });
  }

  closeAddToPlaylistPicker(): void {
    this.showAddToPlaylistPicker = false;
    this.songForPlaylistAdd = null;
    this.targetPlaylistIdForSongAdd = '';
    this.cdr.markForCheck();
  }

  addCurrentSongToSelectedPlaylist(): void {
    const songId = Number(this.songForPlaylistAdd?.songId ?? this.songForPlaylistAdd?.id ?? 0);
    const playlistId = Number(this.targetPlaylistIdForSongAdd ?? 0);
    if (!songId || !playlistId) {
      this.error = 'Please select a playlist.';
      this.cdr.markForCheck();
      return;
    }

    this.isActionSaving = true;
    this.error = null;
    this.actionMessage = null;
    this.playlistService.addSongToPlaylist(playlistId, songId).subscribe({
      next: () => {
        this.isActionSaving = false;
        this.actionMessage = 'Song added to playlist.';
        this.closeAddToPlaylistPicker();
        this.cdr.markForCheck();
      },
      error: () => {
        this.isActionSaving = false;
        this.error = 'Failed to add song to selected playlist.';
        this.cdr.markForCheck();
      }
    });
  }

  removeFromLikedSongs(song: any): void {
    const songId = Number(song?.songId ?? song?.id ?? 0);
    if (!songId || !this.currentUserId) {
      this.error = 'User session not found.';
      this.cdr.markForCheck();
      return;
    }

    this.error = null;
    this.actionMessage = null;
    this.likesService.getSongLikeId(this.currentUserId, songId).subscribe({
      next: (likeId) => {
        if (!likeId) {
          this.likedSongs = this.likedSongs.filter((item) => Number(item?.songId ?? item?.id ?? 0) !== songId);
          this.actionMessage = 'Removed from liked songs.';
          this.cdr.markForCheck();
          return;
        }
        this.likesService.unlikeByLikeId(likeId).subscribe({
          next: () => {
            this.likedSongs = this.likedSongs.filter((item) => Number(item?.songId ?? item?.id ?? 0) !== songId);
            this.actionMessage = 'Removed from liked songs.';
            this.cdr.markForCheck();
          },
          error: () => {
            this.error = 'Failed to remove from liked songs.';
            this.cdr.markForCheck();
          }
        });
      },
      error: () => {
        this.error = 'Failed to remove from liked songs.';
        this.cdr.markForCheck();
      }
    });
  }

  private buildLikedSongRow(song: any): Observable<any> {
    const songId = Number(song?.songId ?? song?.id ?? 0);
    const albumId = Number(song?.albumId ?? 0);
    const artistId = Number(song?.artistId ?? 0);
    const directArtistName = this.resolveArtistName(song);
    const base = {
      id: songId,
      songId: songId,
      title: song?.title,
      artistName: directArtistName,
      artistId: artistId > 0 ? artistId : undefined,
      fileUrl: song?.fileUrl,
      fileName: song?.fileName,
      audioUrl: song?.audioUrl,
      albumId: albumId || undefined,
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
    const songId = Number(song?.songId ?? song?.id ?? 0);
    const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
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
      const resolved = this.artistService.resolveImageUrl(String(candidate ?? '').trim());
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

    const cachedSong = this.artistService.getCachedSongImage(songId);
    if (cachedSong) {
      return cachedSong;
    }
    const cachedAlbum = this.artistService.getCachedAlbumImage(albumId);
    if (cachedAlbum) {
      return cachedAlbum;
    }

    return '';
  }

  private resolveImagePath(value: any): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return '';
    }
    return this.artistService.resolveImageUrl(raw);
  }
}
