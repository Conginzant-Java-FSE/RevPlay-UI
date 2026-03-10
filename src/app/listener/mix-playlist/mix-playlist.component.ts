import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { BrowseService } from '../services/browse.service';
import { PlayerService } from '../../core/services/player.service';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ProtectedMediaPipe } from '../../core/pipes/protected-media.pipe';

@Component({
  selector: 'app-mix-playlist',
  standalone: true,
  imports: [CommonModule, RouterModule, ProtectedMediaPipe],
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
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.slug = String(params.get('slug') ?? '').trim();
      this.playlistName = this.toTitleCase(this.slug.replace(/-/g, ' ')) || 'Mix Playlist';
      this.loadSongs();
      this.loadPlaylistMeta();
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

    this.browseService.getSystemPlaylistSongDetails(this.slug).pipe(
      catchError(() => of([]))
    ).subscribe((songs: any[]) => {
      this.songs = (songs ?? []).filter((song: any) => !!song);
      this.isLoading = false;
      if (this.songs.length === 0) {
        this.error = null;
      }
      this.cdr.markForCheck();
    });
  }

  private loadPlaylistMeta(): void {
    if (!this.slug) {
      return;
    }

    this.browseService.getSystemPlaylists().pipe(
      catchError(() => of([]))
    ).subscribe((playlists: any[]) => {
      const matched = (playlists ?? []).find((playlist: any) => String(playlist?.slug ?? '').trim() === this.slug);
      const matchedName = String(matched?.name ?? '').trim();
      if (matchedName) {
        this.playlistName = matchedName;
        this.cdr.markForCheck();
      }
    });
  }

  private toPlayerTrack(song: any): any {
    return {
      id: Number(song?.songId ?? song?.id ?? 0),
      songId: Number(song?.songId ?? song?.id ?? 0),
      title: String(song?.title ?? 'Song'),
      artist: String(song?.artist ?? song?.artistName ?? 'Unknown Artist'),
      artistName: String(song?.artist ?? song?.artistName ?? 'Unknown Artist'),
      fileUrl: String(song?.fileUrl ?? song?.audioUrl ?? song?.streamUrl ?? ''),
      audioUrl: String(song?.audioUrl ?? song?.fileUrl ?? song?.streamUrl ?? ''),
      streamUrl: String(song?.streamUrl ?? song?.audioUrl ?? song?.fileUrl ?? ''),
      image: String(song?.image ?? song?.imageUrl ?? 'assets/images/placeholder-album.png'),
      coverUrl: String(song?.image ?? song?.coverUrl ?? song?.imageUrl ?? 'assets/images/placeholder-album.png'),
      coverImageUrl: String(song?.image ?? song?.coverImageUrl ?? song?.imageUrl ?? 'assets/images/placeholder-album.png'),
      imageUrl: String(song?.image ?? song?.imageUrl ?? 'assets/images/placeholder-album.png'),
      type: 'SONG'
    };
  }

  private toTitleCase(input: string): string {
    return String(input ?? '')
      .split(' ')
      .map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '')
      .join(' ')
      .trim();
  }
}
