import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { take } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';
import { PlayerService } from '../../core/services/player.service';

@Component({
  selector: 'app-manage-albums',
  templateUrl: './manage-albums.component.html',
  styleUrls: ['./manage-albums.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ManageAlbumsComponent implements OnInit {
  private readonly albumSongMapKey = 'revplay_album_song_map';
  artistId: number | null = null;
  private userId: number | null = null;
  private artistLabel = '';
  albums: any[] = [];
  songs: any[] = [];
  selectedAlbum: any = null;
  selectedAlbumId: number | null = null;
  albumSongs: any[] = [];

  isLoading = false;
  isSaving = false;
  error: string | null = null;
  successMessage: string | null = null;

  newAlbum = {
    title: '',
    releaseDate: new Date().toISOString().split('T')[0],
    description: ''
  };
  createCoverFile: File | null = null;
  createCoverPreview: string | null = null;

  editAlbum = {
    title: '',
    releaseDate: '',
    description: '',
    coverArtUrl: ''
  };
  editCoverFile: File | null = null;
  editCoverPreview: string | null = null;
  selectedSongIdForAlbum = '';

  constructor(
    private artistService: ArtistService,
    private stateService: StateService,
    private authService: AuthService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.bootstrapArtistContext();
    this.stateService.artistId$.subscribe((artistId) => {
      if (artistId === this.artistId) {
        return;
      }
      this.artistId = artistId;
      if (!artistId) {
        return;
      }
      this.loadAlbumsAndSongs();
    });
  }

  selectAlbum(album: any, fetchDetails = true): void {
    const albumId = this.getAlbumId(album);
    if (!albumId) {
      return;
    }

    this.selectedAlbumId = albumId;
    this.selectedAlbum = album;
    this.editAlbum = {
      title: album?.title ?? '',
      releaseDate: album?.releaseDate ?? new Date().toISOString().split('T')[0],
      description: album?.description ?? '',
      coverArtUrl: album?.coverArtUrl ?? ''
    };
    this.editCoverPreview = this.resolveAlbumImage(album);
    this.albumSongs = this.mapAlbumSongs(this.mergeAlbumSongs(
      this.getFallbackAlbumSongs(album, albumId),
      this.getLocalMappedSongs(albumId)
    ));

    if (!fetchDetails) {
      this.isLoading = false;
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isLoading = true;
    this.cdr.markForCheck();
    this.artistService.getAlbum(albumId).subscribe({
      next: (albumDetail) => {
        if (this.selectedAlbumId !== albumId) {
          return;
        }
        this.selectedAlbum = albumDetail;
        this.editAlbum = {
          title: albumDetail?.title ?? '',
          releaseDate: albumDetail?.releaseDate ?? new Date().toISOString().split('T')[0],
          description: albumDetail?.description ?? '',
          coverArtUrl: albumDetail?.coverArtUrl ?? ''
        };
        this.editCoverPreview = this.resolveAlbumImage(albumDetail);
        this.editCoverFile = null;
        this.albumSongs = this.mapAlbumSongs(albumDetail?.songs ?? this.getFallbackAlbumSongs(albumDetail, albumId));
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        if (this.selectedAlbumId !== albumId) {
          return;
        }
        this.editAlbum = {
          title: album?.title ?? '',
          releaseDate: album?.releaseDate ?? new Date().toISOString().split('T')[0],
          description: album?.description ?? '',
          coverArtUrl: album?.coverArtUrl ?? ''
        };
        this.editCoverPreview = this.resolveAlbumImage(album);
        const fallbackSongs = this.mapAlbumSongs(this.mergeAlbumSongs(
          this.getFallbackAlbumSongs(album, albumId),
          this.getLocalMappedSongs(albumId)
        ));
        this.albumSongs = this.mergeAlbumSongs(this.albumSongs, fallbackSongs);
        this.isLoading = false;
        this.error = null;
        this.cdr.markForCheck();
      }
    });
  }

  isAlbumSelected(album: any): boolean {
    return this.getAlbumId(album) === Number(this.selectedAlbumId ?? 0);
  }

  playAlbumSong(song: any): void {
    const track = this.toPlayerTrack(song);
    if (!track || !track.songId) {
      return;
    }

    const queue = (this.albumSongs ?? [])
      .map((albumSong) => this.toPlayerTrack(albumSong))
      .filter((item) => Number(item?.songId ?? 0) > 0);

    this.playerService.playTrack(track, queue.length > 0 ? queue : [track]);
  }

  playAlbum(): void {
    const queue = (this.albumSongs ?? [])
      .map((albumSong) => this.toPlayerTrack(albumSong))
      .filter((item) => Number(item?.songId ?? 0) > 0);

    if (queue.length === 0) {
      this.error = 'No playable songs found in this album.';
      this.cdr.markForCheck();
      return;
    }

    this.playerService.playTrack(queue[0], queue);
  }

  onCreateCoverSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.createCoverFile = file;
    this.clearMessages();
    const reader = new FileReader();
    reader.onload = () => {
      this.createCoverPreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  onEditCoverSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.error = 'Please select a valid image file.';
      this.cdr.markForCheck();
      return;
    }

    this.editCoverFile = file;
    this.clearMessages();
    const reader = new FileReader();
    reader.onload = () => {
      this.editCoverPreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
  }

  createAlbum(): void {
    if (!this.newAlbum.title.trim() || !this.createCoverFile) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();

    this.artistService.uploadImage(this.createCoverFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.Response) {
          const imageUrl = this.artistService.resolveUploadedImageUrl(event);
          if (!imageUrl) {
            this.isSaving = false;
            this.error = 'Cover upload succeeded but URL is missing.';
            this.cdr.markForCheck();
            return;
          }

          this.artistService.createAlbum({
            title: this.newAlbum.title.trim(),
            description: this.newAlbum.description?.trim() ?? '',
            coverArtUrl: imageUrl,
            releaseDate: this.newAlbum.releaseDate
          }).subscribe({
            next: () => {
              this.isSaving = false;
              this.successMessage = 'Album created successfully.';
              this.newAlbum = {
                title: '',
                releaseDate: new Date().toISOString().split('T')[0],
                description: ''
              };
              this.createCoverFile = null;
              this.createCoverPreview = null;
              this.loadAlbumsAndSongs();
            },
            error: () => {
              this.isSaving = false;
              this.error = 'Failed to create album.';
              this.cdr.markForCheck();
            }
          });
        }
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to upload album cover.';
        this.cdr.markForCheck();
      }
    });
  }

  saveAlbumUpdates(): void {
    const albumId = this.getAlbumId(this.selectedAlbum);
    if (!albumId || !this.editAlbum.title.trim()) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();

    if (this.editCoverFile) {
      this.artistService.uploadImage(this.editCoverFile).subscribe({
        next: (event: any) => {
          if (event.type === HttpEventType.Response) {
            const imageUrl = this.artistService.resolveUploadedImageUrl(event);
            this.executeAlbumUpdate(albumId, imageUrl || this.editAlbum.coverArtUrl);
          }
        },
        error: () => {
          this.isSaving = false;
          this.error = 'Failed to upload new album cover.';
          this.cdr.markForCheck();
        }
      });
      return;
    }

    this.executeAlbumUpdate(albumId, this.editAlbum.coverArtUrl);
  }

  addSongToAlbum(): void {
    const albumId = this.getAlbumId(this.selectedAlbum);
    const songId = Number(this.selectedSongIdForAlbum || 0);
    if (!albumId || !songId) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();

    this.artistService.addSongToAlbum(albumId, songId).subscribe({
      next: () => {
        this.ensureSongMappedToAlbum(songId, albumId, () => {
          this.updateLocalAlbumSongMap(albumId, songId, true);
          this.refreshSelectedAlbumSongs(albumId, songId);
        });
      },
      error: (err: any) => {
        this.isSaving = false;
        const message = String(
          err?.error?.message ??
          err?.error?.data?.message ??
          err?.message ??
          ''
        ).trim();
        this.error = message || 'Failed to add song to album.';
        this.cdr.markForCheck();
      }
    });
  }

  removeSongFromAlbum(song: any): void {
    const albumId = this.getAlbumId(this.selectedAlbum);
    const songId = Number(song?.songId ?? song?.id ?? 0);
    if (!albumId || !songId) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();

    this.artistService.removeSongFromAlbum(albumId, songId).subscribe({
      next: () => {
        this.updateLocalAlbumSongMap(albumId, songId, false);
        this.isSaving = false;
        this.successMessage = 'Song removed from album.';
        this.albumSongs = (this.albumSongs ?? []).filter((albumSong: any) => this.getSongId(albumSong) !== songId);
        this.reloadSelectedAlbum(false);
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to remove song from album.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteSelectedAlbum(): void {
    const albumId = this.getAlbumId(this.selectedAlbum);
    if (!albumId) {
      return;
    }

    this.isSaving = true;
    this.clearMessages();
    this.artistService.deleteAlbum(albumId).subscribe({
      next: () => {
        this.removeLocalAlbumSongMap(albumId);
        this.isSaving = false;
        this.successMessage = 'Album deleted successfully.';
        this.selectedAlbum = null;
        this.selectedAlbumId = null;
        this.albumSongs = [];
        this.loadAlbumsAndSongs();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to delete album.';
        this.cdr.markForCheck();
      }
    });
  }

  get availableSongsForSelectedAlbum(): any[] {
    const mappedSongIds = new Set(
      (this.albumSongs ?? [])
        .map((song: any) => this.getSongId(song))
        .filter((id: number) => id > 0)
    );

    return (this.songs ?? []).filter((song: any) => {
      const songId = this.getSongId(song);
      return songId > 0 && !mappedSongIds.has(songId);
    });
  }

  private executeAlbumUpdate(albumId: number, coverArtUrl: string): void {
    this.artistService.updateAlbum(albumId, {
      title: this.editAlbum.title.trim(),
      description: this.editAlbum.description?.trim() ?? '',
      releaseDate: this.editAlbum.releaseDate,
      coverArtUrl: coverArtUrl ?? ''
    }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Album updated successfully.';
        this.loadAlbumsAndSongs();
        this.reloadSelectedAlbum();
      },
      error: () => {
        this.isSaving = false;
        this.error = 'Failed to update album.';
        this.cdr.markForCheck();
      }
    });
  }

  private loadAlbumsAndSongs(): void {
    if (!this.artistId) {
      return;
    }

    this.isLoading = true;
    this.artistService.getArtistAlbums(this.artistId, 0, 100).subscribe({
      next: (albumsResponse) => {
        this.albums = albumsResponse?.content ?? [];
        const selectedId = Number(this.selectedAlbumId ?? 0);
        if (selectedId > 0) {
          const refreshedSelection = this.albums.find((album: any) => this.getAlbumId(album) === selectedId) ?? null;
          if (refreshedSelection) {
            this.selectedAlbum = refreshedSelection;
          }
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.albums = [];
        this.cdr.markForCheck();
      }
    });

    this.artistService.getArtistSongs(this.artistId, 0, 200).subscribe({
      next: (songsResponse) => {
        this.songs = songsResponse?.content ?? [];
        const selectedId = Number(this.selectedAlbumId ?? 0);
        if (selectedId > 0) {
          const selectedFromList = (this.albums ?? []).find((album: any) => this.getAlbumId(album) === selectedId) ?? this.selectedAlbum;
          const fallbackSongs = this.mapAlbumSongs(this.mergeAlbumSongs(
            this.getFallbackAlbumSongs(selectedFromList, selectedId),
            this.getLocalMappedSongs(selectedId)
          ));
          if (fallbackSongs.length > 0) {
            this.albumSongs = this.mergeAlbumSongs(this.albumSongs, fallbackSongs);
          }
        }
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.songs = [];
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private reloadSelectedAlbum(fetchDetails = true): void {
    if (!this.selectedAlbum) {
      this.cdr.markForCheck();
      return;
    }
    this.selectAlbum(this.selectedAlbum, fetchDetails);
    this.loadAlbumsAndSongs();
  }

  private refreshSelectedAlbumSongs(albumId: number, songId: number): void {
    this.artistService.getAlbum(albumId).subscribe({
      next: (albumDetail) => {
        if (this.selectedAlbumId !== albumId) {
          return;
        }

        this.selectedAlbum = albumDetail;
        this.albumSongs = this.mapAlbumSongs(
          albumDetail?.songs ?? this.getFallbackAlbumSongs(albumDetail, albumId)
        );
        this.isSaving = false;
        this.successMessage = 'Song added to album.';
        this.selectedSongIdForAlbum = '';
        this.loadAlbumsAndSongs();
        this.cdr.markForCheck();
      },
      error: () => {
        const added = (this.songs ?? []).find((song: any) => this.getSongId(song) === songId);
        if (added && !(this.albumSongs ?? []).some((song: any) => this.getSongId(song) === songId)) {
          this.albumSongs = this.mapAlbumSongs([...(this.albumSongs ?? []), { ...added, albumId }]);
        }
        this.isSaving = false;
        this.successMessage = 'Song added to album.';
        this.selectedSongIdForAlbum = '';
        this.reloadSelectedAlbum();
        this.cdr.markForCheck();
      }
    });
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }

  private bootstrapArtistContext(): void {
    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      const userId = Number(user?.userId ?? user?.id ?? 0);
      this.userId = userId > 0 ? userId : null;
      this.artistLabel = this.resolveArtistLabel(user);
      const username = String(user?.username ?? '').trim();
      const directArtistId = this.resolveArtistIdFromUser(user);
      if (directArtistId) {
        this.artistId = directArtistId;
        this.stateService.setArtistId(directArtistId);
        this.stateService.setArtistIdForUser(userId, directArtistId);
        this.loadAlbumsAndSongs();
        return;
      }

      const cachedArtistId = this.stateService.getArtistIdForUser(userId);
      if (cachedArtistId) {
        this.artistId = cachedArtistId;
        this.stateService.setArtistId(cachedArtistId);
        this.loadAlbumsAndSongs();
        return;
      }

      const existingArtistId = this.stateService.artistId;
      if (existingArtistId) {
        this.artistId = existingArtistId;
        this.loadAlbumsAndSongs();
        return;
      }

      if (!username) {
        this.error = 'Artist identity not found. Please login again.';
        this.cdr.markForCheck();
        return;
      }

      this.artistService.findArtistByUsername(username).subscribe({
        next: (searchResponse) => {
          const items = searchResponse?.content ?? [];
          const normalizedUsername = username.toLowerCase();
          const artistItems = items.filter((item: any) => String(item?.type ?? '').toUpperCase() === 'ARTIST');
          const found = artistItems.find((item: any) => {
            const candidates = [item?.username, item?.title, item?.artistName, item?.displayName, item?.name];
            return candidates.some((value) => String(value ?? '').trim().toLowerCase() === normalizedUsername);
          }) ?? artistItems[0];
          const foundId = Number(found?.artistId ?? found?.contentId ?? found?.id ?? 0);

          if (!foundId) {
            this.error = 'Artist profile not found.';
            this.cdr.markForCheck();
            return;
          }

          this.artistId = foundId;
          this.stateService.setArtistId(foundId);
          this.stateService.setArtistIdForUser(userId, foundId);
          this.loadAlbumsAndSongs();
        },
        error: () => {
          this.error = 'Failed to resolve artist identity.';
          this.cdr.markForCheck();
        }
      });
    });
  }

  private resolveArtistIdFromUser(user: any): number | null {
    const candidates = [
      user?.artistId,
      user?.artist?.artistId,
      user?.artist?.id,
      user?.artistProfileId
    ];
    for (const value of candidates) {
      const artistId = Number(value ?? 0);
      if (artistId > 0) {
        return artistId;
      }
    }
    return null;
  }

  resolveImage(rawUrl: any): string {
    return this.artistService.resolveImageUrl(rawUrl);
  }

  resolveAlbumImage(album: any): string {
    const resolved = this.resolveImage(
      album?.coverArtUrl ??
      album?.coverImageUrl ??
      album?.imageUrl ??
      album?.image ??
      album?.cover?.imageUrl ??
      album?.cover?.fileName ??
      ''
    );
    const albumId = this.getAlbumId(album);
    if (!resolved && albumId > 0) {
      return this.artistService.getCachedAlbumImage(albumId);
    }
    return resolved;
  }

  private getAlbumId(album: any): number {
    return Number(album?.albumId ?? album?.id ?? album?.contentId ?? 0);
  }

  private getSongId(song: any): number {
    return Number(song?.songId ?? song?.id ?? 0);
  }

  private getSongAlbumId(song: any): number {
    return Number(song?.albumId ?? song?.album?.id ?? song?.album?.albumId ?? 0);
  }

  private getFallbackAlbumSongs(album: any, albumId: number): any[] {
    const embeddedSongs = Array.isArray(album?.songs) ? album.songs : [];
    if (embeddedSongs.length > 0) {
      return embeddedSongs;
    }

    return (this.songs ?? []).filter((song: any) => this.getSongAlbumId(song) === albumId);
  }

  private mapAlbumSongs(items: any[]): any[] {
    return (items ?? [])
      .map((song: any) => {
        const songId = this.getSongId(song);
        const albumId = this.getSongAlbumId(song);
        return {
          ...song,
          id: songId,
          songId,
          title: song?.title ?? `Song #${songId}`,
          artistName: String(
            song?.artistName ??
            song?.artistDisplayName ??
            song?.artist?.displayName ??
            song?.artist?.name ??
            song?.uploaderName ??
            song?.createdByName ??
            this.artistLabel ??
            ''
          ).trim(),
          albumId,
          fileUrl: song?.fileUrl ?? song?.audioUrl ?? '',
          fileName: song?.fileName ?? '',
          imageUrl: this.artistService.resolveImageUrl(
            song?.imageUrl ??
            song?.coverUrl ??
            song?.coverArtUrl ??
            song?.coverImageUrl ??
            song?.cover?.imageUrl ??
            song?.cover?.fileName ??
            song?.album?.coverArtUrl ??
            song?.album?.coverImageUrl ??
            ''
          ) || this.artistService.getCachedSongImage(songId) || this.artistService.getCachedAlbumImage(albumId)
        };
      })
      .filter((song: any) => Number(song?.songId ?? 0) > 0);
  }

  private mergeAlbumSongs(primary: any[], secondary: any[]): any[] {
    const merged = [...(primary ?? []), ...(secondary ?? [])];
    const seen = new Set<number>();
    const unique: any[] = [];
    for (const song of merged) {
      const songId = this.getSongId(song);
      if (songId <= 0 || seen.has(songId)) {
        continue;
      }
      seen.add(songId);
      unique.push(song);
    }
    return unique;
  }

  private toPlayerTrack(song: any): any {
    const songId = this.getSongId(song);
    return {
      id: songId,
      songId,
      title: song?.title ?? `Song #${songId}`,
      artistName: song?.artistName ?? this.artistLabel ?? 'Unknown Artist',
      fileUrl: song?.fileUrl ?? song?.audioUrl ?? '',
      fileName: song?.fileName ?? '',
      type: 'SONG',
      imageUrl: this.resolveAlbumImage(this.selectedAlbum)
    };
  }

  private resolveArtistLabel(user: any): string {
    const values = [
      user?.displayName,
      user?.fullName,
      user?.name,
      user?.username
    ];
    for (const value of values) {
      const text = String(value ?? '').trim();
      if (text) {
        return text;
      }
    }
    return '';
  }

  private getLocalMappedSongs(albumId: number): any[] {
    const songIds = this.getLocalAlbumSongIds(albumId);
    if (songIds.length === 0) {
      return [];
    }

    return songIds
      .map((songId) => (this.songs ?? []).find((song: any) => this.getSongId(song) === songId))
      .filter((song: any) => !!song)
      .map((song: any) => ({ ...song, albumId }));
  }

  private getLocalAlbumSongIds(albumId: number): number[] {
    const uid = Number(this.userId ?? 0);
    const targetAlbumId = Number(albumId ?? 0);
    if (uid <= 0 || targetAlbumId <= 0) {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.albumSongMapKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const byUser = parsed?.[String(uid)] ?? {};
      const ids = Array.isArray(byUser?.[String(targetAlbumId)]) ? byUser[String(targetAlbumId)] : [];
      return ids.map((id: any) => Number(id ?? 0)).filter((id: number) => id > 0);
    } catch {
      return [];
    }
  }

  private updateLocalAlbumSongMap(albumId: number, songId: number, isAdd: boolean): void {
    const uid = Number(this.userId ?? 0);
    const targetAlbumId = Number(albumId ?? 0);
    const targetSongId = Number(songId ?? 0);
    if (uid <= 0 || targetAlbumId <= 0 || targetSongId <= 0) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.albumSongMapKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const safe = parsed && typeof parsed === 'object' ? parsed : {};
      const byUser = safe[String(uid)] && typeof safe[String(uid)] === 'object' ? safe[String(uid)] : {};
      const current = Array.isArray(byUser[String(targetAlbumId)]) ? byUser[String(targetAlbumId)] : [];
      const unique = new Set(current.map((id: any) => Number(id ?? 0)).filter((id: number) => id > 0));

      if (isAdd) {
        unique.add(targetSongId);
      } else {
        unique.delete(targetSongId);
      }

      const next = Array.from(unique);
      if (next.length > 0) {
        byUser[String(targetAlbumId)] = next;
      } else {
        delete byUser[String(targetAlbumId)];
      }

      safe[String(uid)] = byUser;
      localStorage.setItem(this.albumSongMapKey, JSON.stringify(safe));
    } catch {
      return;
    }
  }

  private removeLocalAlbumSongMap(albumId: number): void {
    const uid = Number(this.userId ?? 0);
    const targetAlbumId = Number(albumId ?? 0);
    if (uid <= 0 || targetAlbumId <= 0) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.albumSongMapKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const byUser = parsed?.[String(uid)];
      if (!byUser || typeof byUser !== 'object') {
        return;
      }
      delete byUser[String(targetAlbumId)];
      parsed[String(uid)] = byUser;
      localStorage.setItem(this.albumSongMapKey, JSON.stringify(parsed));
    } catch {
      return;
    }
  }

  private ensureSongMappedToAlbum(songId: number, albumId: number, onDone: () => void): void {
    const applySongUpdate = (song: any): void => {
      const title = String(song?.title ?? '').trim();
      const durationSeconds = Number(song?.durationSeconds ?? 0);
      if (!title || durationSeconds <= 0) {
        this.songs = (this.songs ?? []).map((item: any) => {
          const itemId = this.getSongId(item);
          return itemId === songId ? { ...item, albumId } : item;
        });
        onDone();
        return;
      }

      const releaseDate = String(song?.releaseDate ?? '').trim() || undefined;
      this.artistService.updateSong(songId, {
        title,
        durationSeconds,
        albumId,
        releaseDate
      }).subscribe({
        next: () => {
          this.songs = (this.songs ?? []).map((item: any) => {
            const itemId = this.getSongId(item);
            return itemId === songId ? { ...item, albumId } : item;
          });
          onDone();
        },
        error: () => {
          this.songs = (this.songs ?? []).map((item: any) => {
            const itemId = this.getSongId(item);
            return itemId === songId ? { ...item, albumId } : item;
          });
          onDone();
        }
      });
    };

    const localSong = (this.songs ?? []).find((song: any) => this.getSongId(song) === songId);
    if (localSong) {
      applySongUpdate(localSong);
      return;
    }

    this.artistService.getSong(songId).subscribe({
      next: (song) => applySongUpdate(song),
      error: () => onDone()
    });
  }
}
