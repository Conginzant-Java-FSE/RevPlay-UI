import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AdminService } from '../../core/services/admin.service';

declare global {
  interface Window {
    Chart: any;
  }
}

@Component({
  selector: 'app-admin-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.scss']
})
export class AdminAnalyticsComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('revenueChartCanvas') revenueChartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('mixesChartCanvas') mixesChartCanvas?: ElementRef<HTMLCanvasElement>;

  isLoading = false;
  error: string | null = null;

  overview = {
    totalUsers: 0,
    activePremiumUsers: 0,
    totalAdImpressions: 0,
    totalDownloads: 0,
    totalSongPlays: 0
  };

  revenue = {
    monthlyRevenue: 0,
    yearlyRevenue: 0,
    totalRevenue: 0
  };

  topDownloads: Array<{ songId: number; downloadCount: number }> = [];

  topMixes: Array<{ label: string; value: number }> = [
    { label: 'Telugu Mix', value: 0 },
    { label: 'Tamil Mix', value: 0 },
    { label: 'Hindi Mix', value: 0 },
    { label: 'English Mix', value: 0 },
    { label: 'DJ Mix', value: 0 }
  ];

  conversionRate = 0;
  conversionRateLoading = false;
  conversionRateError: string | null = null;

  private revenueChart: any = null;
  private mixesChart: any = null;
  private viewReady = false;
  private static chartScriptPromise: Promise<void> | null = null;

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.refreshAnalytics();
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderCharts();
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  refreshAnalytics(): void {
    this.loadAnalytics();
    this.loadConversionRate();
  }

  loadAnalytics(): void {
    if (this.isLoading) {
      return;
    }
    this.isLoading = true;
    this.error = null;

    forkJoin({
      overview: this.adminService.getBusinessOverview().pipe(catchError(() => of(null))),
      revenue: this.adminService.getRevenueAnalytics().pipe(catchError(() => of(null))),
      topDownloads: this.adminService.getTopDownloadedSongs().pipe(catchError(() => of([]))),
      topMixes: this.adminService.getTopMixes().pipe(catchError(() => of(null)))
    }).subscribe({
      next: ({ overview, revenue, topDownloads, topMixes }) => {
        const hasAnyData = !!overview || !!revenue || (topDownloads?.length ?? 0) > 0 || !!topMixes;

        this.overview = this.normalizeOverview(overview);
        this.revenue = this.normalizeRevenue(revenue);
        this.topDownloads = this.normalizeTopDownloads(topDownloads);
        this.topMixes = this.normalizeTopMixes(topMixes);

        this.error = hasAnyData ? null : 'Analytics data is unavailable right now.';
        this.isLoading = false;
        this.cdr.markForCheck();
        this.renderCharts().catch(() => {
          this.error = this.error || 'Charts could not be loaded.';
          this.cdr.markForCheck();
        });
      },
      error: () => {
        this.isLoading = false;
        this.error = 'Failed to load analytics dashboard.';
        this.cdr.markForCheck();
      }
    });
  }

  loadConversionRate(): void {
    if (this.conversionRateLoading) {
      return;
    }

    this.conversionRateLoading = true;
    this.conversionRateError = null;

    this.adminService.getPremiumConversionRate().subscribe({
      next: (data) => {
        this.conversionRate = this.normalizeConversionRate(data);
        this.conversionRateLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        console.error('Failed to load premium conversion rate', error);
        this.conversionRateError = 'Unable to load conversion data';
        this.conversionRateLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  get conversionRatePercent(): number {
    const normalized = Number(this.conversionRate ?? 0);
    if (!Number.isFinite(normalized)) {
      return 0;
    }
    return Math.max(0, Math.min(100, normalized));
  }

  private normalizeOverview(value: any) {
    return {
      totalUsers: Number(value?.totalUsers ?? 0),
      activePremiumUsers: Number(value?.activePremiumUsers ?? 0),
      totalAdImpressions: Number(value?.totalAdImpressions ?? 0),
      totalDownloads: Number(value?.totalDownloads ?? 0),
      totalSongPlays: Number(value?.totalSongPlays ?? 0)
    };
  }

  private normalizeRevenue(value: any) {
    return {
      monthlyRevenue: Number(value?.monthlyRevenue ?? 0),
      yearlyRevenue: Number(value?.yearlyRevenue ?? 0),
      totalRevenue: Number(value?.totalRevenue ?? 0)
    };
  }

  private normalizeTopDownloads(value: any[]): Array<{ songId: number; downloadCount: number }> {
    const list = Array.isArray(value) ? value : [];
    return list
      .map((item: any) => ({
        songId: Number(item?.songId ?? item?.id ?? item?.contentId ?? 0),
        downloadCount: Number(item?.downloadCount ?? item?.downloads ?? item?.count ?? 0)
      }))
      .filter((item) => item.songId > 0);
  }

  private normalizeTopMixes(value: any): Array<{ label: string; value: number }> {
    const list = Array.isArray(value)
      ? value
      : Array.isArray(value?.data)
        ? value.data
        : [];

    const normalized = list
      .map((item: any) => ({
        label: String(item?.label ?? item?.mixName ?? item?.playlistName ?? item?.name ?? '').trim(),
        value: Number(item?.count ?? item?.playCount ?? item?.totalPlayCount ?? item?.value ?? 0)
      }))
      .filter((item: { label: string; value: number }) => item.label.length > 0 && Number.isFinite(item.value) && item.value > 0);

    if (normalized.length > 0) {
      return normalized;
    }

    return [
      { label: 'Telugu Mix', value: 0 },
      { label: 'Tamil Mix', value: 0 },
      { label: 'Hindi Mix', value: 0 },
      { label: 'English Mix', value: 0 },
      { label: 'DJ Mix', value: 0 }
    ];
  }

  private normalizeConversionRate(value: any): number {
    if (value === null || value === undefined) {
      return 0;
    }

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    const candidate =
      value?.conversionRate ??
      value?.premiumConversionRate ??
      value?.rate ??
      value?.percentage ??
      value?.value ??
      value?.data?.conversionRate ??
      value?.data?.premiumConversionRate ??
      value?.data?.rate ??
      value?.data?.percentage ??
      value?.data?.value;

    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private async renderCharts(): Promise<void> {
    if (!this.viewReady) {
      return;
    }

    await this.ensureChartJs();
    this.renderRevenueChart();
    this.renderTopMixesChart();
    this.cdr.markForCheck();
  }

  private renderRevenueChart(): void {
    const canvas = this.revenueChartCanvas?.nativeElement;
    if (!canvas || !window.Chart) {
      return;
    }

    this.revenueChart?.destroy();
    this.revenueChart = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels: ['Monthly', 'Yearly', 'Total'],
        datasets: [{
          label: 'Revenue',
          data: [
            this.revenue.monthlyRevenue,
            this.revenue.yearlyRevenue,
            this.revenue.totalRevenue
          ],
          backgroundColor: ['#6f8cff', '#f5b54d', '#34c759'],
          borderRadius: 8,
          maxBarThickness: 56
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { color: '#aab2cf' },
            grid: { display: false }
          },
          y: {
            ticks: { color: '#aab2cf' },
            grid: { color: 'rgba(255,255,255,0.08)' }
          }
        }
      }
    });
  }

  private renderTopMixesChart(): void {
    const canvas = this.mixesChartCanvas?.nativeElement;
    if (!canvas || !window.Chart) {
      return;
    }

    this.mixesChart?.destroy();
    this.mixesChart = new window.Chart(canvas, {
      type: 'pie',
      data: {
        labels: this.topMixes.map((mix) => mix.label),
        datasets: [{
          data: this.topMixes.map((mix) => mix.value),
          backgroundColor: ['#6f8cff', '#f5b54d', '#34c759', '#a855f7', '#737373']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#d5dcf6' }
          }
        }
      }
    });
  }

  private destroyCharts(): void {
    this.revenueChart?.destroy();
    this.mixesChart?.destroy();
    this.revenueChart = null;
    this.mixesChart = null;
  }

  private ensureChartJs(): Promise<void> {
    if (window.Chart) {
      return Promise.resolve();
    }

    if (AdminAnalyticsComponent.chartScriptPromise) {
      return AdminAnalyticsComponent.chartScriptPromise;
    }

    AdminAnalyticsComponent.chartScriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Chart.js'));
      document.head.appendChild(script);
    });

    return AdminAnalyticsComponent.chartScriptPromise;
  }
}
