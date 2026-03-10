import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpEventType } from '@angular/common/http';
import { RouterModule } from '@angular/router';
import { AdminService } from '../../core/services/admin.service';
import { AdAnalyticsService, AdAnalyticsSummary } from '../../core/services/ad-analytics.service';

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

  isUploading = false;
  isMutating = false;
  uploadProgress = 0;
  successMessage: string | null = null;
  errorMessage: string | null = null;
  currentAd: any = null;
  analyticsSummary: AdAnalyticsSummary = {
    impressions: 0,
    starts: 0,
    completions: 0,
    skippedAfterAd: 0,
    latestEvents: []
  };

  constructor(
    private adminService: AdminService,
    private adAnalyticsService: AdAnalyticsService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.refreshAnalyticsSummary();
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
          const responseBody = event?.body ?? event;
          this.isUploading = false;
          this.uploadProgress = 100;
          this.successMessage = 'Ad uploaded successfully.';
          this.errorMessage = null;
          this.currentAd = this.resolveAdRecord(responseBody);
          this.selectedFile = null;
          this.selectedFileName = '';
          this.title = '';
          this.durationSeconds = null;
          this.refreshAnalyticsSummary();
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

  toggleCurrentAdStatus(): void {
    const adId = Number(this.currentAd?.adId ?? this.currentAd?.id ?? 0);
    if (!adId) {
      this.errorMessage = 'No editable ad was returned by the backend.';
      this.successMessage = null;
      this.cdr.markForCheck();
      return;
    }

    this.isMutating = true;
    this.errorMessage = null;
    this.successMessage = null;
    const nextActive = !(this.currentAd?.active ?? this.currentAd?.enabled ?? false);

    const request$ = nextActive
      ? this.adminService.activateAudioAd(adId)
      : this.adminService.deactivateAudioAd(adId);

    request$.subscribe({
      next: (response) => {
        this.isMutating = false;
        const resolvedAd = this.resolveAdRecord(response);
        this.currentAd = {
          ...this.currentAd,
          ...(resolvedAd ?? {}),
          active: nextActive,
          enabled: nextActive,
          isActive: nextActive
        };
        this.successMessage = nextActive ? 'Ad enabled successfully.' : 'Ad disabled successfully.';
        this.refreshAnalyticsSummary();
        this.cdr.markForCheck();
      },
      error: () => {
        this.isMutating = false;
        this.errorMessage = 'Unable to update ad status with the current backend endpoints.';
        this.cdr.markForCheck();
      }
    });
  }

  get currentAdStatusLabel(): string {
    return (this.currentAd?.active ?? this.currentAd?.enabled ?? this.currentAd?.isActive ?? false) ? 'Active' : 'Inactive';
  }

  private refreshAnalyticsSummary(): void {
    this.analyticsSummary = this.adAnalyticsService.getSummary();
    this.cdr.markForCheck();
  }

  private resolveAdRecord(payload: any): any {
    if (!payload || typeof payload !== 'object') {
      return payload ?? null;
    }

    if (payload?.data && typeof payload.data === 'object') {
      return payload.data;
    }

    if (payload?.ad && typeof payload.ad === 'object') {
      return payload.ad;
    }

    return payload;
  }
}
