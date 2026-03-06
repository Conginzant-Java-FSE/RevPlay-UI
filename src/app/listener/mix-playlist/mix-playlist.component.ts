import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BrowseService } from '../services/browse.service';
import { PlayerService } from '../../core/services/player.service';
import { ArtistService } from '../../core/services/artist.service';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-mix-playlist',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './mix-playlist.component.html',
  styleUrls: ['./mix-playlist.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MixPlaylistComponent implements OnInit {
  isLoading = true;
  error: string | null = null;
  playlistName = 'Mix Playlist';
  slug = '';
  songs: any[] = [];

  constructor(
    private route: ActivatedRoute,
    private browseService: BrowseService,
    private playerService: PlayerService,
    private artistService: ArtistService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.slug = String(params.get('slug') ?? '').trim();
      this.playlistName = this.toTitleCase(this.slug.replace(/-/g, ' ')) || 'Mix Playlist';
      this.loadSongs();
    });
  }

  playSong(song: any): void {
    const songId = Number(song?.songId ?? song?.id ?? 0);
    if (songId <= 0) {
      return;
    }

    const queue = this.songs.map((item) => this.toPlayerTrack(item)).filter((item) => Number(item?.songId ?? 0) > 0);
    const current = queue.find((item) => Number(item?.songId ?? 0) === songId) ?? queue[0];
    if (!current) {
      return;
    }

    this.playerService.playTrack(current, queue);
  }

  onCoverError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    if (!image) {
      return;
    }
    image.src = 'assets/images/placeholder-album.png';
  }

  private loadSongs(): void {
    if (!this.slug) {
      this.error = 'Mix playlist not found.';
      this.isLoading = false;
      this.songs = [];
      this.cdr.markForCheck();
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.songs = [];

    this.browseService.getSystemPlaylistSongs(this.slug).pipe(
      catchError(() => of([]))
    ).subscribe((response: any) => {
      const source = Array.isArray(response) ? response : (Array.isArray(response?.content) ? response.content : []);
      this.songs = (source ?? []).map((song: any) => this.normalizeSong(song));
      this.isLoading = false;
      if (this.songs.length === 0) {
        this.error = null;
      }
      this.cdr.markForCheck();
    });
  }

  private normalizeSong(song: any): any {
    const songId = Number(song?.songId ?? song?.id ?? song?.contentId ?? 0);
    const cover = this.resolveSongImage(song);

    return {
      ...song,
      id: songId,
      songId,
      title: String(song?.title ?? `Song #${songId}`),
      artistName: String(
        song?.artistName ??
        song?.artistDisplayName ??
        song?.artist?.displayName ??
        song?.artist?.name ??
        'Unknown Artist'
      ),
      fileUrl: String(song?.fileUrl ?? song?.audioUrl ?? ''),
      imageUrl: cover
    };
  }

  private toPlayerTrack(song: any): any {
    return {
      id: Number(song?.songId ?? song?.id ?? 0),
      songId: Number(song?.songId ?? song?.id ?? 0),
      title: String(song?.title ?? 'Song'),
      artistName: String(song?.artistName ?? 'Unknown Artist'),
      fileUrl: String(song?.fileUrl ?? song?.audioUrl ?? ''),
      imageUrl: String(song?.imageUrl ?? ''),
      type: 'SONG'
    };
  }

  private resolveSongImage(song: any): string {
    const candidates = [
      song?.imageUrl,
      song?.coverUrl,
      song?.coverArtUrl,
      song?.coverImageUrl,
      song?.album?.coverArtUrl,
      song?.album?.coverImageUrl,
      song?.thumbnailUrl
    ];

    for (const candidate of candidates) {
      const raw = String(candidate ?? '').trim();
      if (!raw) {
        continue;
      }
      const resolved = this.artistService.resolveImageUrl(raw);
      if (resolved) {
        return resolved;
      }
    }

    return '';
  }

  private toTitleCase(input: string): string {
    return String(input ?? '')
      .split(' ')
      .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '')
      .join(' ')
      .trim();
  }
}
