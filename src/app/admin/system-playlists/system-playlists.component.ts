import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AdminService } from '../../core/services/admin.service';
import { ArtistService } from '../../core/services/artist.service';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';

@Component({
  selector: 'app-system-playlists',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ProtectedMediaPipe],
  templateUrl: './system-playlists.component.html',
  styleUrls: ['./system-playlists.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SystemPlaylistsComponent implements OnInit {
  playlists: any[] = [];
  availableSongs: any[] = [];
  playlistSongs: any[] = [];
  selectedPlaylistSlug = '';
  selectedSongIds = new Set<number>();
  isLoading = false;
  isSaving = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  constructor(
    private adminService: AdminService,
    private artistService: ArtistService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadInitialData();
  }

  loadInitialData(): void {
    this.isLoading = true;
    this.errorMessage = null;

    forkJoin({
      playlists: this.adminService.getSystemPlaylists().pipe(catchError(() => of([]))),
      songs: this.adminService.getAvailableSongs(0, 200).pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ playlists, songs }) => {
        this.playlists = this.normalizePlaylists(playlists);
        this.availableSongs = this.normalizeSongs(this.extractAvailableSongs(songs));
        this.selectedPlaylistSlug = this.playlists[0]?.slug ?? '';
        this.selectedSongIds.clear();
        this.playlistSongs = [];
        this.successMessage = null;
        this.isLoading = false;
        if (this.selectedPlaylistSlug) {
          this.loadPlaylistSongs();
          return;
        }
        this.cdr.markForCheck();
      },
      error: () => {
        this.playlists = [];
        this.availableSongs = [];
        this.playlistSongs = [];
        this.errorMessage = 'Failed to load system playlists.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  onPlaylistChange(): void {
    this.selectedSongIds.clear();
    this.playlistSongs = [];
    this.successMessage = null;
    this.loadPlaylistSongs();
  }

  toggleSongSelection(songId: number, checked: boolean): void {
    const normalizedSongId = Number(songId ?? 0);
    if (normalizedSongId <= 0) {
      return;
    }

    if (checked) {
      this.selectedSongIds.add(normalizedSongId);
    } else {
      this.selectedSongIds.delete(normalizedSongId);
    }
  }

  isSongSelected(songId: number): boolean {
    return this.selectedSongIds.has(Number(songId ?? 0));
  }

  addSelectedSongs(): void {
    const slug = String(this.selectedPlaylistSlug ?? '').trim();
    const songIds = Array.from(this.selectedSongIds.values()).filter((id) => id > 0);
    if (!slug || songIds.length === 0 || this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.errorMessage = null;
    this.successMessage = null;

    this.adminService.addSongsToSystemPlaylist(slug, songIds).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Songs added to system playlist.';
        this.selectedSongIds.clear();
        this.loadPlaylistSongs();
      },
      error: (err) => {
        this.isSaving = false;
        if (Number(err?.status ?? 0) === 409) {
          this.successMessage = 'This song is already in the playlist.';
          this.cdr.markForCheck();
          return;
        }
        this.errorMessage = 'Failed to add songs to system playlist.';
        this.cdr.markForCheck();
      }
    });
  }

  trackPlaylistBySlug(_: number, playlist: any): string {
    return String(playlist?.slug ?? '');
  }

  trackSongById(_: number, song: any): number {
    return Number(song?.songId ?? song?.id ?? 0);
  }

  private normalizePlaylists(items: any[]): any[] {
    return (items ?? [])
      .map((item: any) => ({
        id: Number(item?.id ?? item?.playlistId ?? 0),
        name: String(item?.name ?? '').trim(),
        slug: String(item?.slug ?? '').trim()
      }))
      .filter((item: any) => item.id > 0 && item.name && item.slug);
  }

  private normalizeSongs(items: any[]): any[] {
    return (items ?? [])
      .map((song: any) => {
        const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
        const albumId = Number(song?.albumId ?? song?.album?.albumId ?? song?.album?.id ?? 0);
        const artist = this.resolveSongArtist(song);
        const resolvedImage = this.resolveSongImage(song)
          || this.artistService.getCachedSongImage(songId)
          || this.artistService.getCachedAlbumImage(albumId);
        if (songId > 0 && resolvedImage) {
          this.artistService.cacheSongImage(songId, resolvedImage);
        }
        if (albumId > 0 && resolvedImage) {
          this.artistService.cacheAlbumImage(albumId, resolvedImage);
        }
        const image = resolvedImage || 'assets/images/placeholder-album.png';
        return {
          ...song,
          id: songId,
          songId,
          title: String(song?.title ?? song?.name ?? `Song #${songId}`),
          artist,
          artistName: artist,
          image,
          imageUrl: image
        };
      })
      .filter((song: any) => song.songId > 0);
  }

  private extractAvailableSongs(response: any): any[] {
    if (Array.isArray(response)) {
      return response;
    }

    if (Array.isArray(response?.content)) {
      return response.content;
    }

    if (Array.isArray(response?.songs)) {
      return response.songs;
    }

    if (Array.isArray(response?.items)) {
      return response.items;
    }

    if (Array.isArray(response?.results)) {
      return response.results;
    }

    if (Array.isArray(response?.data)) {
      return response.data;
    }

    if (Array.isArray(response?.data?.content)) {
      return response.data.content;
    }

    if (Array.isArray(response?.data?.songs)) {
      return response.data.songs;
    }

    if (Array.isArray(response?.data?.items)) {
      return response.data.items;
    }

    if (Array.isArray(response?.data?.results)) {
      return response.data.results;
    }

    return [];
  }

  private loadPlaylistSongs(): void {
    const slug = String(this.selectedPlaylistSlug ?? '').trim();
    if (!slug) {
      this.playlistSongs = [];
      this.cdr.markForCheck();
      return;
    }

    this.adminService.getSystemPlaylistSongs(slug).pipe(
      switchMap((response) => {
        const songIds = this.extractSongIds(response);
        if (songIds.length === 0) {
          return of([]);
        }

        return forkJoin(
          songIds.map((songId) =>
            this.adminService.getSongById(songId).pipe(
              catchError(() => of(null))
            )
          )
        );
      }),
      catchError(() => of([]))
    ).subscribe((songs: any[]) => {
      this.playlistSongs = this.normalizeSongs((songs ?? []).filter((song: any) => !!song));
      this.cdr.markForCheck();
    });
  }

  private extractSongIds(response: any): number[] {
    const source = Array.isArray(response)
      ? response
      : (Array.isArray(response?.content) ? response.content : []);

    return (source ?? [])
      .map((item: any) => Number(item?.songId ?? item?.id ?? item))
      .filter((songId: number) => songId > 0);
  }

  private resolveSongArtist(song: any): string {
    const candidates = [
      song?.artistName,
      song?.artistDisplayName,
      song?.artist,
      song?.artist?.name,
      song?.artist?.displayName,
      song?.artistDetails?.name,
      song?.artistDetails?.displayName,
      song?.uploaderName,
      song?.createdByName,
      song?.createdBy?.name,
      song?.createdBy?.displayName,
      song?.createdBy?.fullName,
      song?.user?.name,
      song?.user?.displayName,
      song?.user?.fullName
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (value) {
        return value;
      }
    }

    return 'Unknown Artist';
  }

  private resolveSongImage(song: any): string {
    const candidates = [
      song?.imageUrl,
      song?.image,
      song?.artwork,
      song?.artworkUrl,
      song?.coverImageUrl,
      song?.coverUrl,
      song?.cover,
      song?.cover?.imageUrl,
      song?.cover?.url,
      song?.cover?.fileName,
      song?.imageFileName,
      song?.coverImageFileName,
      song?.coverFileName,
      song?.imageName,
      song?.album?.coverImageUrl,
      song?.album?.coverArtUrl,
      song?.album?.cover?.imageUrl,
      song?.album?.cover?.url,
      song?.album?.cover?.fileName,
      song?.album?.coverImageFileName,
      song?.album?.coverFileName
    ];

    for (const candidate of candidates) {
      const resolved = this.resolveSongImageCandidate(candidate);
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }

  private resolveSongImageCandidate(candidate: any): string {
    const directValue = String(candidate ?? '').trim();
    if (directValue && directValue !== '[object Object]') {
      return this.artistService.resolveImageUrl(directValue);
    }

    if (!candidate || typeof candidate !== 'object') {
      return '';
    }

    const nestedCandidates = [
      candidate?.url,
      candidate?.fileName,
      candidate?.name,
      candidate?.path,
      candidate?.imageUrl,
      candidate?.downloadUrl,
      candidate?.downloadUri,
      candidate?.fileDownloadUri
    ];

    for (const nested of nestedCandidates) {
      const value = this.artistService.resolveImageUrl(String(nested ?? '').trim());
      if (value) {
        return value;
      }
    }

    return '';
  }
}
