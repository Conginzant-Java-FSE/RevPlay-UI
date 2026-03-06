import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { AdminService } from '../../core/services/admin.service';

@Component({
  selector: 'app-ads-upload',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './ads-upload.component.html',
  styleUrls: ['./ads-upload.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AdsUploadComponent implements OnInit {
  title = '';
  durationSeconds: number | null = null;
  selectedFile: File | null = null;
  selectedFileName = '';

  isLoading = true;
  isUploading = false;
  uploadProgress = 0;
  successMessage: string | null = null;
  errorMessage: string | null = null;
  currentAd: any = null;

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadCurrentAd();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }

    if (!String(file.type ?? '').startsWith('audio/')) {
      this.errorMessage = 'Please choose a valid audio file.';
      this.successMessage = null;
      this.selectedFile = null;
      this.selectedFileName = '';
      this.cdr.markForCheck();
      return;
    }

    this.errorMessage = null;
    this.successMessage = null;
    this.selectedFile = file;
    this.selectedFileName = file.name;
    this.cdr.markForCheck();
  }

  uploadAd(): void {
    if (!this.selectedFile) {
      this.errorMessage = 'Please select an audio file.';
      this.successMessage = null;
      this.cdr.markForCheck();
      return;
    }

    this.errorMessage = null;
    this.successMessage = null;
    this.isUploading = true;
    this.uploadProgress = 0;
    this.cdr.markForCheck();

    this.adminService.uploadAudioAd(this.selectedFile, this.title, Number(this.durationSeconds ?? 0)).subscribe({
      next: (event: any) => {
        if (event?.type === HttpEventType.UploadProgress && event?.total) {
          this.uploadProgress = Math.round((event.loaded / event.total) * 100);
          this.cdr.markForCheck();
          return;
        }

        if (event?.type === HttpEventType.Response || !event?.type) {
          this.isUploading = false;
          this.uploadProgress = 100;
          this.successMessage = 'Ad uploaded successfully.';
          this.errorMessage = null;
          this.selectedFile = null;
          this.selectedFileName = '';
          this.title = '';
          this.durationSeconds = null;
          this.loadCurrentAd(false);
          this.cdr.markForCheck();
        }
      },
      error: () => {
        this.isUploading = false;
        this.errorMessage = 'Unable to upload ad. Please try again.';
        this.successMessage = null;
        this.cdr.markForCheck();
      }
    });
  }

  private loadCurrentAd(toggleLoader = true): void {
    if (toggleLoader) {
      this.isLoading = true;
    }
    this.adminService.getCurrentAudioAd().pipe(
      catchError(() => of(null))
    ).subscribe((response) => {
      this.currentAd = response;
      this.isLoading = false;
      this.cdr.markForCheck();
    });
  }
}
