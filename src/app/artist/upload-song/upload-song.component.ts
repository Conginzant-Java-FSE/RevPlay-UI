import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpEventType } from '@angular/common/http';
import { take } from 'rxjs/operators';
import { ArtistService } from '../../core/services/artist.service';
import { GenreService } from '../../core/services/genre.service';
import { StateService } from '../../core/services/state.service';
import { AuthService } from '../../core/services/auth';

type Visibility = 'PUBLIC' | 'UNLISTED';

@Component({
  selector: 'app-upload-song',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './upload-song.component.html',
  styleUrls: ['./upload-song.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UploadSongComponent implements OnInit {
  private readonly recentUploadsCacheKey = 'revplay_artist_recent_uploads_cache';
  private readonly maxCoverImageSizeBytes = 10 * 1024 * 1024;
  artistId: number | null = null;
  artistDisplayName = '';

  songForm = {
    title: '',
    artist: '',
    albumId: '',
    genreId: '',
    visibility: 'PUBLIC' as Visibility,
    description: ''
  };

  genres: any[] = [];
  albums: any[] = [];

  coverImageFile: File | null = null;
  audioFile: File | null = null;
  replaceAudioFile: File | null = null;

  coverImagePreview: string | null = null;
  audioFileName = '';
  replaceAudioFileName = '';
  audioDurationSeconds = 180;

  isDraggingCover = false;
  isDraggingAudio = false;

  isUploading = false;
  uploadProgress = 0;
  isReplacingAudio = false;
  replaceAudioProgress = 0;

  uploadedSongId: number | null = null;
  replaceTargetSongId = '';
  replaceSongOptions: any[] = [];
  private uploadedCoverImageUrl = '';

  successMessage: string | null = null;
  error: string | null = null;

  constructor(
    private artistService: ArtistService,
    private genreService: GenreService,
    private stateService: StateService,
    private authService: AuthService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadGenres();
    this.bootstrapArtistContext();
  }

  get canReplaceAudio(): boolean {
    const songId = Number(this.replaceTargetSongId || this.uploadedSongId || 0);
    return !this.isReplacingAudio && songId > 0 && !!this.getReplacementAudioFile();
  }

  onCoverDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingCover = true;
  }

  onCoverDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingCover = false;
  }

  onCoverDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingCover = false;
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      this.setCoverImageFile(file);
    }
  }

  onAudioDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingAudio = true;
  }

  onAudioDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingAudio = false;
  }

  onAudioDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDraggingAudio = false;
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      this.setAudioFile(file);
    }
  }

  onCoverFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (file) {
      this.setCoverImageFile(file);
    }
  }

  onAudioFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (file) {
      this.setAudioFile(file);
    }
  }

  onReplaceAudioFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    if (!file) {
      return;
    }

    const isAudio = file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.mp3');
    if (!isAudio) {
      this.error = 'Please select a valid replacement audio file.';
      this.cdr.markForCheck();
      return;
    }

    this.replaceAudioFile = file;
    this.replaceAudioFileName = file.name;
    this.clearMessages();
    this.cdr.markForCheck();
  }

  uploadSong(): void {
    if (!this.songForm.title.trim()) {
      this.error = 'Song title is required.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.coverImageFile) {
      this.error = 'Cover image is required.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.audioFile) {
      this.error = 'Audio file is required.';
      this.cdr.markForCheck();
      return;
    }
    if (!this.artistId) {
      this.error = 'Artist profile is still syncing. Please wait a moment and retry.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isUploading = true;
    this.uploadProgress = 0;
    this.uploadedCoverImageUrl = '';
    this.cdr.markForCheck();

        this.artistService.uploadImage(this.coverImageFile).subscribe({
            next: (event: any) => {
                if (event.type === HttpEventType.UploadProgress && event.total) {
                    this.uploadProgress = Math.max(this.uploadProgress, Math.round((event.loaded / event.total) * 25));
                    this.cdr.markForCheck();
                    return;
                }

                if (event.type === HttpEventType.Response) {
                    const imageUrl = this.artistService.resolveUploadedImageUrl(event);
                    if (!imageUrl) {
                        this.isUploading = false;
                        this.error = 'Image uploaded but no image URL returned.';
                        this.cdr.markForCheck();
                        return;
          }
          this.uploadedCoverImageUrl = imageUrl;
          this.prepareAlbumThenCreateSong();
        }
      },
      error: (err) => {
        this.isUploading = false;
        this.error = this.extractUploadErrorMessage(err, 'Cover image upload failed. Use JPG/JPEG/PNG image.');
        this.cdr.markForCheck();
      }
    });
  }

  replaceAudio(): void {
    const songId = Number(this.replaceTargetSongId || this.uploadedSongId || 0);
    const replacementFile = this.getReplacementAudioFile();
    if (!songId) {
      this.error = 'Please select a song.';
      this.cdr.markForCheck();
      return;
    }
    if (!replacementFile) {
      this.error = 'Select a replacement audio file first.';
      this.cdr.markForCheck();
      return;
    }

    this.clearMessages();
    this.isReplacingAudio = true;
    this.replaceAudioProgress = 0;

    this.artistService.replaceSongAudio(songId, replacementFile).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          this.replaceAudioProgress = Math.round((event.loaded / event.total) * 100);
          this.cdr.markForCheck();
          return;
        }

        if (event.type === HttpEventType.Response) {
          const uploadedSong = this.artistService.resolveUploadedSongPayload(event);
          this.isReplacingAudio = false;
          this.replaceAudioProgress = 100;
          this.successMessage = 'Song audio replaced successfully.';
          this.cacheRecentUpload(songId, uploadedSong);
          this.replaceAudioFile = null;
          this.replaceAudioFileName = '';
          this.audioFile = null;
          this.audioFileName = '';
          this.loadSongsForReplace();
          this.cdr.markForCheck();
        }
      },
      error: (err) => {
        this.isReplacingAudio = false;
        this.error = this.extractUploadErrorMessage(err, 'Failed to replace song audio.');
        this.cdr.markForCheck();
      }
    });
  }

  private prepareAlbumThenCreateSong(): void {
    const selectedAlbumId = Number(this.songForm.albumId || 0);
    this.createSong(selectedAlbumId > 0 ? selectedAlbumId : null);
  }

  private createSong(albumId: number | null): void {
    const metadata: any = {
      title: this.songForm.title.trim(),
      albumId: albumId ?? null,
      durationSeconds: Math.max(1, Math.round(this.audioDurationSeconds || 180)),
      visibility: this.songForm.visibility,
      releaseDate: new Date().toISOString().slice(0, 10),
      artistId: Number(this.artistId ?? 0) || undefined,
      artistName: this.artistDisplayName || this.songForm.artist || undefined,
      description: this.songForm.description?.trim() || undefined
    };

    const resolvedCoverImage = String(this.uploadedCoverImageUrl ?? '').trim();
    if (resolvedCoverImage) {
      metadata.coverArtUrl = resolvedCoverImage;
      metadata.coverImageUrl = resolvedCoverImage;
      metadata.imageUrl = resolvedCoverImage;
    }

    const payload = new FormData();
    payload.append('metadata', JSON.stringify(metadata));
    payload.append('file', this.audioFile as File);

    this.artistService.uploadSong(payload).subscribe({
      next: (event: any) => {
        if (event.type === HttpEventType.UploadProgress && event.total) {
          const progress = Math.round((event.loaded / event.total) * 75);
          this.uploadProgress = Math.max(25, 25 + progress);
          this.cdr.markForCheck();
          return;
        }

        if (event.type === HttpEventType.Response) {
          const uploadedSong = this.artistService.resolveUploadedSongPayload(event);
          const songId = Number(uploadedSong?.songId ?? uploadedSong?.id ?? event?.body?.data?.songId ?? event?.body?.songId ?? 0);
          if (!songId) {
            this.isUploading = false;
            this.error = 'Song upload response is missing song id.';
            this.cdr.markForCheck();
            return;
          }

          this.artistService.cacheSongImage(songId, resolvedCoverImage || this.coverImagePreview || '');
          this.cacheRecentUpload(songId, uploadedSong);
          this.uploadedSongId = songId;
          this.replaceTargetSongId = String(songId);
          this.uploadProgress = 100;
          this.loadSongsForReplace();
          this.assignSelectedGenre(songId);
        }
      },
      error: () => {
        this.isUploading = false;
        this.error = 'Song upload failed.';
        this.cdr.markForCheck();
      }
    });
  }

  private assignSelectedGenre(songId: number): void {
    const genreId = Number(this.songForm.genreId || 0);
    if (!genreId) {
      this.isUploading = false;
      this.successMessage = 'Song uploaded successfully.';
      this.resetUploadFormAfterSuccess();
      this.cdr.markForCheck();
      return;
    }

    this.artistService.addSongGenres(songId, [genreId]).subscribe({
      next: () => {
        this.isUploading = false;
        this.successMessage = 'Song uploaded and genre assigned successfully.';
        this.resetUploadFormAfterSuccess();
        this.cdr.markForCheck();
      },
      error: () => {
        this.isUploading = false;
        this.successMessage = 'Song uploaded, but assigning genre failed.';
        this.resetUploadFormAfterSuccess();
        this.cdr.markForCheck();
      }
    });
  }

  private setCoverImageFile(file: File): void {
    const mime = String(file?.type ?? '').toLowerCase();
    const name = String(file?.name ?? '').toLowerCase();
    const isSupportedMime = mime === 'image/jpeg' || mime === 'image/png';
    const isSupportedExtension = name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
    if (!isSupportedMime && !isSupportedExtension) {
      this.error = 'Only JPG, JPEG, or PNG images are supported.';
      this.cdr.markForCheck();
      return;
    }

    if (Number(file?.size ?? 0) > this.maxCoverImageSizeBytes) {
      this.error = 'Cover image is too large. Please use an image under 10 MB.';
      this.cdr.markForCheck();
      return;
    }

    this.coverImageFile = file;
    this.readImagePreview(file);
    this.clearMessages();
    this.cdr.markForCheck();
  }

  private setAudioFile(file: File): void {
    const isAudio = file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.mp3');
    if (!isAudio) {
      this.error = 'Please select a valid audio file (.mp3 recommended).';
      this.cdr.markForCheck();
      return;
    }

    this.audioFile = file;
    this.audioFileName = file.name;
    this.estimateAudioDuration(file);
    this.clearMessages();
    this.cdr.markForCheck();
  }

  private estimateAudioDuration(file: File): void {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      this.audioDurationSeconds = Math.max(1, Math.round(audio.duration || 180));
      URL.revokeObjectURL(audio.src);
      this.cdr.markForCheck();
    };
  }

  private readImagePreview(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.coverImagePreview = reader.result as string;
      this.cdr.markForCheck();
    };
    reader.readAsDataURL(file);
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

  private bootstrapArtistContext(): void {
    const sessionUser = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const sessionUserId = Number(sessionUser?.userId ?? sessionUser?.id ?? 0);
    const mappedArtistId = this.stateService.getArtistIdForUser(sessionUserId);
    const directArtistId = this.getArtistIdFromUserLike(sessionUser);
    const preferredArtistId = Number(directArtistId ?? mappedArtistId ?? 0);

    this.artistDisplayName = this.resolveUserDisplayName(sessionUser);
    this.songForm.artist = this.artistDisplayName;
    this.cdr.markForCheck();

    if (preferredArtistId > 0) {
      this.artistId = preferredArtistId;
      this.stateService.setArtistId(preferredArtistId);
      this.stateService.setArtistIdForUser(sessionUserId, preferredArtistId);
      this.loadArtistProfileAndAlbums(preferredArtistId);
      return;
    }

    this.authService.currentUser$.pipe(take(1)).subscribe((user) => {
      this.artistDisplayName = this.resolveUserDisplayName(user);
      this.songForm.artist = this.artistDisplayName;
      this.cdr.markForCheck();
    });

    this.stateService.artistId$.subscribe((artistId) => {
      const numericArtistId = Number(artistId ?? 0);
      if (numericArtistId <= 0 || this.artistId === numericArtistId) {
        return;
      }
      this.artistId = numericArtistId;
      this.loadArtistProfileAndAlbums(numericArtistId);
    });
  }

  private loadArtistProfileAndAlbums(artistId: number): void {
    this.artistService.getArtistProfile(artistId).subscribe({
      next: (artist) => {
        this.artistDisplayName = artist?.displayName ?? this.artistDisplayName;
        this.songForm.artist = this.artistDisplayName;
        this.cdr.markForCheck();
      },
      error: () => {
        this.cdr.markForCheck();
      }
    });

    this.artistService.getArtistAlbums(artistId, 0, 100).subscribe({
      next: (response) => {
        this.albums = response?.content ?? [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.albums = [];
        this.cdr.markForCheck();
      }
    });

    this.loadSongsForReplace();
  }

  private resetUploadFormAfterSuccess(): void {
    this.songForm.title = '';
    this.songForm.description = '';
    this.songForm.genreId = '';
    this.songForm.albumId = '';
    this.songForm.visibility = 'PUBLIC';
    this.coverImageFile = null;
    this.audioFile = null;
    this.coverImagePreview = null;
    this.audioFileName = '';
    this.uploadedCoverImageUrl = '';
  }

  private clearMessages(): void {
    this.error = null;
    this.successMessage = null;
  }

  private getReplacementAudioFile(): File | null {
    return this.replaceAudioFile ?? this.audioFile;
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

  private cacheRecentUpload(songId: number, uploadedSong: any = null): void {
    const user = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const userId = Number(user?.userId ?? user?.id ?? 0);
    if (userId <= 0 || songId <= 0) {
      return;
    }

    const resolvedSong = uploadedSong && typeof uploadedSong === 'object' ? uploadedSong : null;
    const resolvedFileName = String(
      resolvedSong?.fileName ??
      resolvedSong?.audioFileName ??
      ''
    ).trim();
    const resolvedFileUrl = String(
      resolvedSong?.fileUrl ??
      resolvedSong?.audioUrl ??
      ''
    ).trim();
    const resolvedStreamUrl = String(resolvedSong?.streamUrl ?? '').trim();
    const resolvedImageUrl = String(
      resolvedSong?.imageUrl ??
      resolvedSong?.coverImageUrl ??
      resolvedSong?.coverArtUrl ??
      this.uploadedCoverImageUrl ??
      this.coverImagePreview ??
      ''
    ).trim();

    const nextUpload = {
      songId,
      id: songId,
      title: String(resolvedSong?.title ?? this.songForm.title ?? '').trim() || `Song #${songId}`,
      artistName: String(resolvedSong?.artistName ?? '').trim() || this.artistDisplayName || this.songForm.artist || this.resolveUserDisplayName(user) || 'Artist',
      fileName: resolvedFileName,
      audioFileName: resolvedFileName,
      fileUrl: resolvedFileUrl,
      audioUrl: resolvedFileUrl,
      streamUrl: resolvedStreamUrl,
      playCount: 0,
      imageUrl: resolvedImageUrl,
      createdAt: new Date().toISOString()
    };

    this.artistService.cacheSongImage(songId, String(nextUpload.imageUrl ?? ''));

    try {
      const raw = localStorage.getItem(this.recentUploadsCacheKey);
      const parsed = raw ? JSON.parse(raw) : {};
      const cache = parsed && typeof parsed === 'object' ? parsed : {};
      const existing = Array.isArray(cache[String(userId)]) ? cache[String(userId)] : [];
      const deduped = [nextUpload, ...existing]
        .filter((item: any, idx: number, arr: any[]) => {
          const id = Number(item?.songId ?? item?.id ?? 0);
          return id > 0 && arr.findIndex((entry) => Number(entry?.songId ?? entry?.id ?? 0) === id) === idx;
        })
        .slice(0, 20);
      cache[String(userId)] = deduped;
      localStorage.setItem(this.recentUploadsCacheKey, JSON.stringify(cache));
    } catch {
      return;
    }
  }

  private loadSongsForReplace(): void {
    if (!this.artistId) {
      this.replaceSongOptions = [];
      this.cdr.markForCheck();
      return;
    }

    this.artistService.getArtistSongs(this.artistId, 0, 100).subscribe({
      next: (response) => {
        this.replaceSongOptions = (response?.content ?? [])
          .map((song: any) => ({
            id: Number(song?.songId ?? song?.id ?? 0),
            title: String(song?.title ?? '').trim() || `Song #${Number(song?.songId ?? song?.id ?? 0)}`,
            visibility: String(song?.visibility ?? 'PUBLIC').toUpperCase()
          }))
          .filter((song: any) => Number(song?.id ?? 0) > 0);
        this.cdr.markForCheck();
      },
      error: () => {
        this.replaceSongOptions = this.getCachedRecentUploads()
          .map((song: any) => ({
            id: Number(song?.songId ?? song?.id ?? 0),
            title: String(song?.title ?? '').trim() || `Song #${Number(song?.songId ?? song?.id ?? 0)}`,
            visibility: String(song?.visibility ?? 'PUBLIC').toUpperCase()
          }))
          .filter((song: any) => Number(song?.id ?? 0) > 0);
        this.cdr.markForCheck();
      }
    });
  }

  private getCachedRecentUploads(): any[] {
    const user = this.authService.getCurrentUserSnapshot() ?? this.getStoredUser();
    const userId = Number(user?.userId ?? user?.id ?? 0);
    if (userId <= 0) {
      return [];
    }

    try {
      const raw = localStorage.getItem(this.recentUploadsCacheKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.[String(userId)]) ? parsed[String(userId)] : [];
    } catch {
      return [];
    }
  }

  private extractUploadErrorMessage(err: any, fallback: string): string {
    const backendMessage = String(
      err?.error?.userMessage ??
      err?.error?.message ??
      err?.message ??
      ''
    ).trim();

    if (backendMessage) {
      return backendMessage;
    }

    const status = Number(err?.status ?? 0);
    if (status === 400) {
      return 'Invalid image file. Please upload JPG/JPEG/PNG only.';
    }
    if (status === 413) {
      return 'Image size is too large. Please upload a smaller file.';
    }

    return fallback;
  }
}
