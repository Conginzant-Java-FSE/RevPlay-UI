import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GenreService } from '../../core/services/genre.service';
import { PlayerService } from '../../core/services/player.service';

@Component({
  selector: 'app-genres',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './genres.component.html',
  styleUrl: './genres.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GenresComponent implements OnInit {
  genres: any[] = [];
  songs: any[] = [];
  selectedGenre: any = null;

  isGenresLoading = true;
  isSongsLoading = false;
  error: string | null = null;
  songsError: string | null = null;

  page = 0;
  readonly pageSize = 20;
  totalPages = 0;

  constructor(
    private genreService: GenreService,
    private playerService: PlayerService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.genreService.getAllGenres().subscribe({
      next: (genres) => {
        this.genres = genres ?? [];
        this.isGenresLoading = false;

        const firstGenre = this.genres[0] ?? null;
        if (firstGenre) {
          this.selectGenre(firstGenre);
        } else {
          this.songs = [];
          this.totalPages = 0;
        }

        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load genres.';
        this.isGenresLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  selectGenre(genre: any): void {
    const genreId = Number(genre?.id ?? genre?.genreId ?? 0);
    if (!genreId) {
      return;
    }

    this.selectedGenre = genre;
    this.page = 0;
    this.loadGenreSongs(genreId);
  }

  previousPage(): void {
    if (!this.selectedGenre || this.page <= 0) {
      return;
    }
    this.page -= 1;
    this.loadGenreSongs(Number(this.selectedGenre?.id ?? this.selectedGenre?.genreId ?? 0));
  }

  nextPage(): void {
    if (!this.selectedGenre || this.page >= this.totalPages - 1) {
      return;
    }
    this.page += 1;
    this.loadGenreSongs(Number(this.selectedGenre?.id ?? this.selectedGenre?.genreId ?? 0));
  }

  playSong(song: any): void {
    const queue = this.songs.length > 0 ? this.songs : [song];
    this.playerService.playTrack(song, queue);
  }

  addToQueue(song: any): void {
    this.playerService.addToQueue(song);
  }

  formatDuration(seconds?: number): string {
    if (!seconds || seconds < 1) {
      return '0:00';
    }

    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  private loadGenreSongs(genreId: number): void {
    this.isSongsLoading = true;
    this.songsError = null;
    this.cdr.markForCheck();

    this.genreService.getGenreSongs(genreId, this.page, this.pageSize).subscribe({
      next: (response) => {
        this.songs = response?.content ?? [];
        this.totalPages = Number(response?.totalPages ?? 0);
        this.page = Number(response?.page ?? this.page);
        this.isSongsLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.songs = [];
        this.totalPages = 0;
        this.isSongsLoading = false;
        this.songsError = 'Failed to load songs for this genre.';
        this.cdr.markForCheck();
      }
    });
  }
}
