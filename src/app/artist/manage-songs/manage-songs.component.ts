import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError, take } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';
import { GenreService } from '../../core/services/genre.service';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';

@Component({
  selector: 'app-manage-songs',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ProtectedMediaPipe],
  templateUrl: './manage-songs.component.html',
  styleUrls: ['./manage-songs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManageSongsComponent implements OnInit {
  artistId: number | null = null;
  songs: any[] = [];
  genres: any[] = [];
  albums: any[] = [];

  selectedSong: any = null;
  selectedGenreIds: number[] = [];
  replacementAudioFile: File | null = null;

  form = {
    title: '',
    durationSeconds: 180,
    albumId: '',
    releaseDate: '',
    visibility: 'PUBLIC' as 'PUBLIC' | 'UNLISTED',
    isActive: true
  };

  isLoading = false;
  isSaving = false;
  audioReplaceProgress = 0;
  error: string | null = null;
  successMessage: string | null = null;
  private readonly pendingSongImageLoads = new Set<number>();

  constructor(
    private artistService: ArtistService,
    private stateService: StateService,
    private authService: AuthService,
    private genreService: GenreService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.bootstrapArtistContext();
    this.loadGenres();
  }

  selectSong(song: any): void {
    const songId = Number(song?.songId ?? song?.id ?? 0);
    if (!songId) {
      return;
    }

    this.isLoading = true;
    this.clearMessages();
    this.artistService.getSong(songId).subscribe({
      next: (fullSong) => {
        this.selectedSong = fullSong;
        this.form = {
          title: fullSong?.title ?? '',
          durationSeconds: Number(fullSong?.durationSeconds ?? 180),
          albumId: String(fullSong?.albumId ?? ''),
          releaseDate: fullSong?.releaseDate ?? '',
          visibility: (fullSong?.visibility ?? 'PUBLIC') as 'PUBLIC' | 'UNLISTED',
          isActive: fullSong?.isActive !== false
        };
        this.selectedGenreIds = (fullSong?.genres ?? [])
          .map((g: any) => Number(g?.genreId ?? g?.id ?? 0))
          .filter((id: number) => id > 0);
        this.replacementAudioFile = null;
        this.audioReplaceProgress = 0;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isLoading = false;
        this.error = 'Failed to load song details.';
        this.cdr.markForCheck();
      }
    });
  }

  saveSongBasics(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId || !this.form.title.trim()) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.updateSong(songId, {
      title: this.form.title.trim(),
      durationSeconds: Number(this.form.durationSeconds || 180),
      albumId: this.form.albumId ? Number(this.form.albumId) : undefined,
      releaseDate: this.form.releaseDate || undefined
    }).subscribe({
      next: (updatedSong) => {
        this.selectedSong = { ...this.selectedSong, ...updatedSong };
        this.isSaving = false;
        this.successMessage = 'Song metadata updated.';
        this.reloadSongs();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to update song.';
        this.cdr.markForCheck();
      }
    });
  }

  saveVisibility(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.updateSongVisibility(songId, this.form.visibility, this.form.isActive).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Visibility updated.';
        this.reloadSongs();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to update visibility.';
        this.cdr.markForCheck();
      }
    });
  }

  replaceGenres(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId || this.selectedGenreIds.length === 0) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.replaceSongGenres(songId, this.selectedGenreIds).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Song genres replaced.';
        this.selectSong(this.selectedSong);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to replace genres.';
        this.cdr.markForCheck();
      }
    });
  }

  addGenres(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId || this.selectedGenreIds.length === 0) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.addSongGenres(songId, this.selectedGenreIds).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Genres added to song.';
        this.selectSong(this.selectedSong);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to add genres.';
        this.cdr.markForCheck();
      }
    });
  }

  onGenresSelectionChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const values = Array.from(target.selectedOptions).map((opt) => Number(opt.value)).filter((id) => id > 0);
    this.selectedGenreIds = values;
  }

  onReplaceAudioFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    this.replacementAudioFile = file;
  }

  replaceAudio(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId || !this.replacementAudioFile) {
      return;
    }

    this.isSaving = true;
    this.audioReplaceProgress = 0;
    this.clearMessages();

    this.artistService.replaceSongAudio(songId, this.replacementAudioFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.audioReplaceProgress = Math.round((event.loaded / event.total) * 100);
          this.cdr.markForCheck();
          return;
        }

        if (event.type === HttpEventType.Response) {
          this.isSaving = false;
          this.audioReplaceProgress = 100;
          this.successMessage = 'Song audio replaced successfully.';
          this.selectSong(this.selectedSong);
        }
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to replace audio.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteSong(): void {
    const songId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
    if (!songId) {
      return;
    }

    const confirmed = window.confirm('Are you sure you want to delete this song?');
    if (!confirmed) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.deleteSong(songId).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Song deleted.';
        this.pendingSongImageLoads.delete(songId);
        this.reloadSongs();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to delete song.';
        this.cdr.markForCheck();
      }
    });
  }

  private bootstrapArtistContext(): void {
    const sessionUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const sessionUserId = Number(sessionUser?.userId ?? sessionUser?.id ?? 0);
    const mappedArtistId = this.stateService.getArtistIdForUser(sessionUserId);
    const directArtistId = this.getArtistIdFromUserLike(sessionUser);
    const preferredArtistId = Number(directArtistId ?? mappedArtistId ?? 0);

    if (preferredArtistId > 0) {
      this.artistId = preferredArtistId;
      this.stateService.setArtistId(preferredArtistId);
      this.stateService.setArtistIdForUser(sessionUserId, preferredArtistId);
      this.reloadSongs();
      this.loadAlbums();
      return;
    }

    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      const username = user?.username ?? '';
      const userId = Number(user?.userId ?? user?.id ?? 0);
      if (!username) {
        this.error = 'Artist identity not found.';
        this.cdr.markForCheck();
        return;
      }

      const cachedArtistId = this.stateService.getArtistIdForUser(userId);
      if (cachedArtistId) {
        this.artistId = cachedArtistId;
        this.stateService.setArtistId(cachedArtistId);
        this.reloadSongs();
        this.loadAlbums();
        return;
      }

      this.artistService.findArtistByUsername(username).subscribe({
        next: (searchResponse) => {
          const items = searchResponse?.content ?? [];
          const found = this.findBestArtistSearchResult(items, username, userId);
          const foundId = Number(found?.artistId ?? found?.contentId ?? found?.id ?? 0);

          if (!foundId) {
            this.error = 'Artist profile not found.';
            this.cdr.markForCheck();
            return;
          }

          this.artistId = foundId;
          this.stateService.setArtistId(foundId);
          this.stateService.setArtistIdForUser(userId, foundId);
          this.reloadSongs();
          this.loadAlbums();
        },
        error: () => {
          this.error = 'Failed to load artist identity.';
          this.cdr.markForCheck();
        }
      });
    });
  }

  private reloadSongs(): void {
    if (!this.artistId) {
      return;
    }

    this.isLoading = true;
    this.artistService.getArtistSongs(this.artistId, 0, 100).subscribe({
      next: (response) => {
        this.songs = (response?.content ?? []).map((song: any) => this.enrichSong(song));
        this.hydrateSongImages(this.songs);
        this.isLoading = false;

        const selectedId = Number(this.selectedSong?.songId ?? this.selectedSong?.id ?? 0);
        if (selectedId) {
          const refreshedSelection = this.songs.find((song) => Number(song?.songId ?? song?.id ?? 0) === selectedId);
          if (refreshedSelection) {
            this.selectedSong = refreshedSelection;
          } else {
            this.selectedSong = null;
          }
        }

        this.cdr.markForCheck();
      },
      error: () => {
        this.songs = [];
        this.isLoading = false;
        this.error = 'Failed to load songs.';
        this.cdr.markForCheck();
      }
    });
  }

  private loadAlbums(): void {
    if (!this.artistId) {
      return;
    }

    this.artistService.getArtistAlbums(this.artistId, 0, 100).subscribe({
      next: (response) => {
        this.albums = response?.content ?? [];
        this.applyAlbumCoverFallbacks();
        this.cdr.markForCheck();
      },
      error: () => {
        this.albums = [];
        this.cdr.markForCheck();
      }
    });
  }

  private loadGenres(): void {
    this.genreService.getAllGenres().subscribe({
      next: (genres) => {
        this.genres = genres ?? [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.genres = [];
        this.cdr.markForCheck();
      }
    });
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }

  private enrichSong(song: any): any {
    return {
      ...song,
      imageUrl: this.resolveSongImageUrl(song)
    };
  }

  private resolveSongImageUrl(song: any): string {
    const candidates = [
      song?.imageUrl,
      song?.coverUrl,
      song?.coverArtUrl,
      song?.coverImageUrl,
      song?.cover?.imageUrl,
      song?.cover?.url,
      song?.cover?.fileName,
      song?.artworkUrl,
      song?.image,
      song?.thumbnailUrl,
      song?.imageFileName,
      song?.coverFileName,
      song?.coverImageFileName,
      song?.imageName,
      song?.album?.coverArtUrl,
      song?.album?.coverImageUrl,
      song?.album?.cover?.imageUrl,
      song?.album?.cover?.fileName,
      song?.album?.coverFileName,
      song?.albumImageUrl
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

    const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
    if (albumId > 0) {
      const albumCover = this.resolveAlbumCoverById(albumId);
      if (albumCover) {
        return albumCover;
      }
    }

    const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
    if (songId > 0) {
      const cached = this.artistService.getCachedSongImage(songId);
      if (cached) {
        return cached;
      }
    }

    return '';
  }

  private resolveAlbumCoverById(albumId: number): string {
    const targetAlbumId = Number(albumId ?? 0);
    if (targetAlbumId <= 0) {
      return '';
    }

    const album = this.albums.find((item) => Number(item?.albumId ?? item?.id ?? 0) === targetAlbumId);
    if (!album) {
      return '';
    }

    return this.artistService.resolveImageUrl(
      album?.coverArtUrl ??
      album?.coverImageUrl ??
      album?.imageUrl ??
      album?.image ??
      album?.cover?.imageUrl ??
      album?.cover?.fileName ??
      ''
    );
  }

  private applyAlbumCoverFallbacks(): void {
    let changed = false;
    this.songs = (this.songs ?? []).map((song) => {
      if (song?.imageUrl) {
        return song;
      }
      const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
      if (albumId <= 0) {
        return song;
      }
      const albumCover = this.resolveAlbumCoverById(albumId);
      if (!albumCover) {
        return song;
      }
      changed = true;
      return {
        ...song,
        imageUrl: albumCover
      };
    });

    if (changed) {
      this.cdr.markForCheck();
    }
  }

  private hydrateSongImages(songs: any[]): void {
    for (const song of songs ?? []) {
      if (!song) {
        continue;
      }

      const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
      if (!songId || song?.imageUrl || this.pendingSongImageLoads.has(songId)) {
        continue;
      }

      this.pendingSongImageLoads.add(songId);
      this.artistService.getSong(songId).pipe(
        take(1),
        catchError(() => of(null))
      ).subscribe((fullSong) => {
        this.pendingSongImageLoads.delete(songId);
        if (!fullSong) {
          return;
        }

        const resolved = this.resolveSongImageUrl(fullSong);
        if (!resolved) {
          return;
        }

        this.artistService.cacheSongImage(songId, resolved);
        this.songs = (this.songs ?? []).map((item) => {
          const itemSongId = Number(item?.songId ?? item?.id ?? item?.contentId ?? 0);
          return itemSongId === songId ? { ...item, imageUrl: resolved } : item;
        });
        this.cdr.markForCheck();
      });
    }
  }

  onSongImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) {
      return;
    }
    image.src = '/assets/images/placeholder-album.png';
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

  private findBestArtistSearchResult(items: any[], username: string, userId: number | null): any {
    const artistItems = (items ?? []).filter((item: any) => this.isArtistLikeSearchItem(item));
    if (artistItems.length === 0) {
      return null;
    }

    const expectedUserId = Number(userId ?? 0);
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
    }) ?? null;
  }

  private isArtistLikeSearchItem(item: any): boolean {
    const type = String(item?.type ?? '').trim().toUpperCase();
    if (['SONG', 'ALBUM', 'PODCAST', 'PLAYLIST', 'GENRE'].includes(type)) {
      return false;
    }
    if (['ARTIST', 'BOTH', 'MUSIC', 'CREATOR', 'MUSICIAN'].includes(type)) {
      return true;
    }
    return Number(item?.artistId ?? 0) > 0;
  }
}
