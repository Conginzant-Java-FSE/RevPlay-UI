import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';
import { GenreService } from '../../core/services/genre.service';

@Component({
  selector: 'app-manage-genres',
  templateUrl: './manage-genres.component.html',
  styleUrls: ['./manage-genres.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule]
})
export class ManageGenresComponent implements OnInit {
  genres: any[] = [];
  isLoading = false;
  newGenreName = '';
  isCreating = false;
  isSaving = false;
  editingGenreId: number | null = null;
  editGenreName = '';
  successMessage: string | null = null;
  errorMessage: string | null = null;

  constructor(
    private adminService: AdminService,
    private genreService: GenreService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadGenres();
  }

  loadGenres(): void {
    this.isLoading = true;
    this.genreService.getAllGenres().subscribe({
      next: (data) => {
        this.genres = data;
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load genres', err);
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  addGenre(): void {
    if (!this.newGenreName.trim()) return;
    this.isCreating = true;
    this.clearMessages();
    this.adminService.createGenre({ name: this.newGenreName }).subscribe({
      next: () => {
        this.newGenreName = '';
        this.isCreating = false;
        this.successMessage = 'Genre created successfully.';
        this.genreService.clearCache();
        this.cdr.markForCheck();
        this.loadGenres();
      },
      error: () => {
        this.errorMessage = 'Failed to create genre.';
        this.isCreating = false;
        this.cdr.markForCheck();
      }
    });
  }

  startEditGenre(genre: any): void {
    this.clearMessages();
    this.editingGenreId = Number(genre?.id ?? genre?.genreId ?? 0);
    this.editGenreName = genre?.name ?? '';
  }

  cancelEditGenre(): void {
    this.editingGenreId = null;
    this.editGenreName = '';
  }

  saveGenreUpdate(): void {
    if (!this.editingGenreId || !this.editGenreName.trim()) {
      return;
    }

    this.clearMessages();
    this.isSaving = true;

    this.adminService.updateGenre(this.editingGenreId, { name: this.editGenreName.trim() }).subscribe({
      next: () => {
        this.isSaving = false;
        this.successMessage = 'Genre updated successfully.';
        this.genreService.clearCache();
        this.cancelEditGenre();
        this.loadGenres();
        this.cdr.markForCheck();
      },
      error: () => {
        this.isSaving = false;
        this.errorMessage = 'Failed to update genre.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteGenre(id: number): void {
    if (confirm('Are you sure you want to delete this genre?')) {
      this.clearMessages();
      this.adminService.deleteGenre(id).subscribe({
        next: () => {
          this.successMessage = 'Genre deleted successfully.';
          this.genreService.clearCache();
          this.cdr.markForCheck();
          this.loadGenres();
        },
        error: () => {
          this.errorMessage = 'Failed to delete genre.';
          this.cdr.markForCheck();
        }
      });
    }
  }

  private clearMessages(): void {
    this.successMessage = null;
    this.errorMessage = null;
  }
}
