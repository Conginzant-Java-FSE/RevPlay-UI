import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AdminService } from '../../core/services/admin.service';
import { ApiService } from '../../core/services/api';

@Component({
  selector: 'app-dashboard',
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule]
})
export class DashboardComponent implements OnInit, OnDestroy {
  private readonly userEmailCacheKey = 'revplay_user_email_map';
  private readonly registrationLogCacheKey = 'revplay_pending_registration_logs';
  metrics: any = {
    totalPlatformPlays: 0,
    playsLast24Hours: 0,
    activeUsers: { last7Days: 0, last30Days: 0 }
  };
  recentLogs: any[] = [];
  recentRegistrations: any[] = [];
  topArtists: any[] = [];
  topContent: any[] = [];
  isLoading = false;
  error: string | null = null;
  partialWarning: string | null = null;
  private autoRefreshTimer: number | null = null;

  constructor(
    private adminService: AdminService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadDashboardData();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  loadDashboardData(): void {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.partialWarning = null;
    const failedSections: string[] = [];

    forkJoin({
      metrics: this.adminService.getDashboardMetrics().pipe(
        catchError(() => {
          failedSections.push('Metrics');
          return of(null);
        })
      ),
      topArtists: this.adminService.getTopArtists(10).pipe(
        catchError(() => {
          failedSections.push('Top Artists');
          return of([]);
        })
      ),
      topContent: this.adminService.getTopContent(10).pipe(
        catchError(() => {
          failedSections.push('Top Content');
          return of([]);
        })
      ),
      logsPage: this.adminService.getAuditLogs({ page: 0, size: 50, fresh: true }).pipe(
        catchError(() => {
          failedSections.push('Recent Activity');
          return of({ content: [] });
        })
      )
    }).subscribe({
      next: ({ metrics, topArtists, topContent, logsPage }) => {
        const userContactById = this.buildUserContactMap(logsPage?.content ?? []);
        const normalizedServerLogs = (logsPage?.content ?? [])
          .map((log: any) => this.normalizeLog(log, userContactById))
          .sort((a: any, b: any) => this.toTimestamp(b.timestamp) - this.toTimestamp(a.timestamp));

        const normalizedLogs = this.mergeLogsWithPendingRegistrations(normalizedServerLogs);
        const normalizedTopArtists = this.normalizeTopArtists(topArtists ?? []);
        const topArtistNameById = new Map<number, string>();
        for (const artist of normalizedTopArtists) {
          const artistId = Number(artist?.artistId ?? 0);
          const artistName = String(artist?.name ?? '').trim();
          if (artistId > 0 && artistName) {
            topArtistNameById.set(artistId, artistName);
          }
        }
        const normalizedTopContent = this.normalizeTopContent(topContent ?? [], topArtistNameById);

        forkJoin({
          enrichedLogs: this.enrichLogEmailsFromProfiles(normalizedLogs),
          enrichedTopContent: this.enrichTopContentWithSongDetails(normalizedTopContent, topArtistNameById)
        }).subscribe({
          next: ({ enrichedLogs, enrichedTopContent }) => {
            this.metrics = this.normalizeMetrics(metrics);
            this.topArtists = normalizedTopArtists;
            this.topContent = enrichedTopContent;
            this.recentLogs = enrichedLogs
              .filter((log: any) => !this.isSmokeEntityText(log?.actorName) && !this.isSmokeEntityText(log?.details))
              .slice(0, 10);

            const registrationLogs = enrichedLogs
              .filter((log: any) => this.isRegistrationAction(log))
              .slice(0, 8);

            this.partialWarning = failedSections.length > 0
              ? `Some sections could not be loaded: ${failedSections.join(', ')}.`
              : null;

            if (registrationLogs.length > 0) {
              this.recentRegistrations = registrationLogs;
              this.isLoading = false;
              this.cdr.markForCheck();
              return;
            }

            this.adminService.getUsersPage(0, 12, '').pipe(
              catchError(() => of({ content: [] }))
            ).subscribe((page: any) => {
              const users = Array.isArray(page?.content) ? page.content : [];
              this.recentRegistrations = this.normalizeRegistrationFallback(users).slice(0, 8);
              this.isLoading = false;
              this.cdr.markForCheck();
            });
          },
          error: () => {
            this.metrics = this.normalizeMetrics(metrics);
            this.topArtists = normalizedTopArtists;
            this.topContent = normalizedTopContent;
            this.recentLogs = normalizedLogs
              .filter((log: any) => !this.isSmokeEntityText(log?.actorName) && !this.isSmokeEntityText(log?.details))
              .slice(0, 10);
            this.recentRegistrations = normalizedLogs
              .filter((log: any) => this.isRegistrationAction(log))
              .slice(0, 8);
            this.partialWarning = failedSections.length > 0
              ? `Some sections could not be loaded: ${failedSections.join(', ')}.`
              : null;
            this.isLoading = false;
            this.cdr.markForCheck();
          }
        });
      },
      error: () => {
        this.error = 'Failed to load dashboard data.';
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  private normalizeMetrics(metrics: any): any {
    return {
      totalPlatformPlays: Number(metrics?.totalPlatformPlays ?? 0),
      playsLast24Hours: Number(metrics?.playsLast24Hours ?? 0),
      activeUsers: {
        last7Days: Number(metrics?.activeUsers?.last7Days ?? 0),
        last30Days: Number(metrics?.activeUsers?.last30Days ?? 0)
      }
    };
  }

  private normalizeTopArtists(items: any[]): any[] {
    return (items ?? [])
      .map((artist: any, index: number) => ({
        rank: index + 1,
        artistId: Number(artist?.artistId ?? artist?.id ?? artist?.artist?.artistId ?? artist?.artist?.id ?? 0),
        name:
          artist?.name ??
          artist?.displayName ??
          artist?.artistName ??
          artist?.artist?.displayName ??
          artist?.artist?.name ??
          `Artist #${artist?.artistId ?? artist?.id ?? index + 1}`,
        playCount: Number(
          artist?.playCount ??
          artist?.totalPlays ??
          artist?.streams ??
          artist?.count ??
          artist?.artistPlayCount ??
          0
        )
      }))
      .filter((artist: any) => !this.isSmokeEntityText(artist?.name));
  }

  private normalizeTopContent(items: any[], topArtistNameById: Map<number, string>): any[] {
    return (items ?? [])
      .map((item: any, index: number) => ({
        rank: index + 1,
        contentId: Number(item?.contentId ?? item?.songId ?? item?.id ?? 0),
        artistId: Number(item?.artistId ?? item?.artist?.artistId ?? item?.artist?.id ?? item?.creatorId ?? 0),
        title: item?.title ?? item?.name ?? item?.contentName ?? `Content #${item?.contentId ?? item?.id ?? index + 1}`,
        type: String(item?.type ?? item?.contentType ?? item?.mediaType ?? '-').toUpperCase(),
        artistName: this.resolveArtistName(item) || topArtistNameById.get(Number(item?.artistId ?? item?.artist?.artistId ?? item?.artist?.id ?? item?.creatorId ?? 0)) || '',
        playCount: Number(item?.playCount ?? item?.totalPlays ?? item?.streams ?? item?.count ?? 0)
      }))
      .filter((item: any) => !this.isSmokeEntityText(item?.title));
  }

  private isSmokeEntityText(value: any): boolean {
    return /(smoke|endpoint|tempdelete|test\.com|clnadm)/i.test(String(value ?? '').trim());
  }

  formatActionLabel(action: any): string {
    const raw = String(action ?? '').trim();
    if (!raw) {
      return '-';
    }

    return raw
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  private normalizeActorName(log: any): string {
    const actorId = this.resolveActorId(log);
    const actorLabel = actorId ? `User #${actorId}` : 'User';
    const explicit = String(log?.actorName ?? log?.username ?? '').trim();
    if (explicit) {
      if (/^user\s*#\d+$/i.test(explicit) || /^\d+$/.test(explicit)) {
        return actorLabel;
      }
      return explicit;
    }

    if (actorId) {
      return actorLabel;
    }

    return 'System';
  }

  private normalizeLog(log: any, userContactById: Map<number, string>): any {
    const actorId = this.resolveActorId(log);
    const actorName = this.normalizeActorName(log);
    const details = String(log?.details ?? log?.description ?? '').trim();
    const directEmail = this.normalizeEmail(log?.actorEmail ?? log?.userEmail ?? log?.email ?? '');
    const parsedEmail = this.extractEmail(details);
    const mappedEmail = actorId ? (userContactById.get(actorId) ?? '') : '';
    const cachedEmail = actorId ? this.getCachedEmailByUserId(actorId) : '';
    const actorEmail = directEmail || parsedEmail || mappedEmail || cachedEmail;

    return {
      ...log,
      actionType: String(log?.action ?? log?.actionType ?? '').toUpperCase(),
      details: details || '-',
      actorId,
      actorName,
      actorEmail,
      entityType: log?.entityType ?? log?.entity ?? '-',
      timestamp: log?.timestamp ?? log?.createdAt ?? null
    };
  }

  private buildUserContactMap(logs: any[]): Map<number, string> {
    const mapByUser = new Map<number, string>();

    for (const log of logs ?? []) {
      const actorId = this.resolveActorId(log);
      if (!actorId || mapByUser.has(actorId)) {
        continue;
      }

      const email = this.normalizeEmail(log?.actorEmail ?? log?.userEmail ?? log?.email ?? '')
        || this.extractEmail(log?.details ?? log?.description ?? '');
      if (email) {
        mapByUser.set(actorId, email);
      }
    }

    return mapByUser;
  }

  private isRegistrationAction(log: any): boolean {
    const action = String(log?.actionType ?? log?.action ?? '').toUpperCase();
    const details = String(log?.details ?? log?.description ?? '').toUpperCase();
    return /REGISTER|SIGNUP|USER_CREATED|ACCOUNT_CREATED/.test(action) || /REGISTER|SIGNED UP|ACCOUNT CREATED/.test(details);
  }

  private mergeLogsWithPendingRegistrations(logs: any[]): any[] {
    const serverLogs = Array.isArray(logs) ? logs : [];
    const pending = this.getPendingRegistrationLogs().map((log: any) => this.normalizeLog(log, new Map<number, string>()));
    const byKey = new Map<string, any>();

    for (const log of [...serverLogs, ...pending]) {
      const key = this.getLogKey(log);
      if (!byKey.has(key)) {
        byKey.set(key, log);
      }
    }

    return Array.from(byKey.values())
      .sort((a: any, b: any) => this.toTimestamp(b.timestamp) - this.toTimestamp(a.timestamp));
  }

  private getPendingRegistrationLogs(): any[] {
    try {
      const raw = localStorage.getItem(this.registrationLogCacheKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private getLogKey(log: any): string {
    const actorId = Number(log?.actorId ?? log?.performedBy ?? log?.userId ?? 0) || 0;
    const action = String(log?.actionType ?? log?.action ?? '').trim().toUpperCase();
    const email = String(log?.actorEmail ?? this.extractEmail(log?.details ?? '')).trim().toLowerCase();
    const entity = String(log?.entityType ?? log?.entity ?? '').trim().toUpperCase();
    const name = String(log?.actorName ?? '').trim().toLowerCase();
    return `${action}|${entity}|${actorId}|${email}|${name}`;
  }

  private resolveActorId(log: any): number | null {
    const candidates = [log?.performedBy, log?.performedById, log?.userId, log?.actorId];
    for (const candidate of candidates) {
      const value = Number(candidate ?? 0);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }
    return null;
  }

  private extractEmail(value: any): string {
    const text = String(value ?? '');
    const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return String(match?.[0] ?? '').toLowerCase();
  }

  private normalizeEmail(value: any): string {
    const email = String(value ?? '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email) ? email : '';
  }

  private resolveArtistName(value: any): string {
    const candidates = [
      value?.artistName,
      value?.artistDisplayName,
      value?.artist?.name,
      value?.artist?.displayName,
      value?.creatorName,
      value?.uploaderName,
      value?.subtitle
    ];

    for (const candidate of candidates) {
      const text = String(candidate ?? '').trim();
      if (text) {
        return text;
      }
    }

    return '';
  }

  private normalizeRegistrationFallback(users: any[]): any[] {
    const source = Array.isArray(users) ? users : [];
    return source.map((user: any) => {
      const actorId = Number(user?.userId ?? user?.id ?? 0) || null;
      const actorName = String(
        user?.displayName ??
        user?.fullName ??
        user?.name ??
        user?.username ??
        (actorId ? `User #${actorId}` : 'User')
      ).trim();
      const actorEmail = this.normalizeEmail(
        String(user?.email ?? user?.userEmail ?? user?.contactEmail ?? '').trim().toLowerCase()
      );
      const timestamp =
        user?.createdAt ??
        user?.createdOn ??
        user?.createdDate ??
        user?.registeredAt ??
        user?.registeredOn ??
        user?.joinedAt ??
        user?.joinDate ??
        user?.signupDate ??
        user?.signUpDate ??
        user?.updatedAt ??
        null;
      return {
        actorId,
        actorName: actorName || 'User',
        actorEmail: actorEmail || '-',
        actionType: 'REGISTER',
        details: 'User registered',
        entityType: 'USER',
        timestamp
      };
    });
  }

  private enrichTopContentWithSongDetails(items: any[], topArtistNameById: Map<number, string>) {
    const source = Array.isArray(items) ? items : [];
    if (source.length === 0) {
      return of([]);
    }

    const missingArtistTitleFallbackBudget = { count: 0, max: 6 };

    const requests = source.map((item: any) => {
      const type = String(item?.type ?? '').toUpperCase();
      const contentId = Number(item?.contentId ?? item?.id ?? 0);
      const hasArtist = !!String(item?.artistName ?? '').trim();
      if (type !== 'SONG' || contentId <= 0 || hasArtist) {
        return of(item);
      }

      return this.apiService.get<any>(`/songs/${contentId}`).pipe(
        map((response) => response?.data ?? response),
        map((song) => {
          const artistName = this.resolveArtistName(song)
            || topArtistNameById.get(Number(item?.artistId ?? 0))
            || item?.artistName
            || '';
          return { ...item, artistName };
        }),
        catchError(() => of(item)),
        switchMap((resolvedItem: any) => {
          const alreadyResolved = !!String(resolvedItem?.artistName ?? '').trim();
          const title = String(resolvedItem?.title ?? '').trim();
          if (alreadyResolved || !title) {
            return of(resolvedItem);
          }

          if (missingArtistTitleFallbackBudget.count >= missingArtistTitleFallbackBudget.max) {
            return of(resolvedItem);
          }
          missingArtistTitleFallbackBudget.count += 1;

          return this.resolveArtistBySongTitle(title).pipe(
            map((artistName) => ({ ...resolvedItem, artistName: artistName || resolvedItem?.artistName || '' })),
            catchError(() => of(resolvedItem))
          );
        })
      );
    });

    return forkJoin(requests);
  }

  private resolveArtistBySongTitle(title: string) {
    const query = String(title ?? '').trim();
    if (!query) {
      return of('');
    }

    return this.apiService.get<any>(`/search?q=${encodeURIComponent(query)}&type=SONG&page=0&size=5`).pipe(
      map((response) => {
        const list = Array.isArray(response?.content) ? response.content : (Array.isArray(response) ? response : []);
        if (!Array.isArray(list) || list.length === 0) {
          return '';
        }

        const normalizedQuery = query.toLowerCase();
        const best = list.find((item: any) => String(item?.title ?? '').trim().toLowerCase() === normalizedQuery) ?? list[0];
        return this.resolveArtistName(best);
      }),
      catchError(() => of(''))
    );
  }

  private enrichLogEmailsFromProfiles(logs: any[]) {
    const source = Array.isArray(logs) ? logs : [];
    if (source.length === 0) {
      return of([]);
    }

    return this.adminService.getUsersPage(0, 20, '').pipe(
      catchError(() => of({ content: [] })),
      map((page: any) => {
        const users = Array.isArray(page?.content) ? page.content : [];
        const emailByActorId = new Map<number, string>();

        for (const user of users) {
          const actorId = Number(user?.userId ?? user?.id ?? 0);
          if (actorId <= 0) {
            continue;
          }
          const email = this.normalizeEmail(this.extractEmailFromAny(user));
          if (!email) {
            continue;
          }
          emailByActorId.set(actorId, email);
          this.persistCachedEmailByUserId(actorId, email);
        }

        return source.map((log: any) => {
          const currentEmail = this.normalizeEmail(log?.actorEmail);
          if (currentEmail) {
            return log;
          }

          const actorId = Number(log?.actorId ?? 0);
          const mappedEmail = this.normalizeEmail(emailByActorId.get(actorId) ?? this.getCachedEmailByUserId(actorId));
          if (!mappedEmail) {
            return log;
          }

          return { ...log, actorEmail: mappedEmail };
        });
      }),
      catchError(() => of(source))
    );
  }

  private extractEmailFromAny(value: any): string {
    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      return this.extractEmail(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const email = this.extractEmailFromAny(item);
        if (email) {
          return email;
        }
      }
      return '';
    }

    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const email = this.extractEmailFromAny((value as any)[key]);
        if (email) {
          return email;
        }
      }
    }

    return '';
  }

  private persistCachedEmailByUserId(userId: number, email: string): void {
    const normalizedUserId = Number(userId ?? 0);
    const normalizedEmail = this.normalizeEmail(email);
    if (!normalizedUserId || !normalizedEmail) {
      return;
    }

    try {
      const raw = localStorage.getItem(this.userEmailCacheKey);
      const map = raw ? JSON.parse(raw) : {};
      map[String(normalizedUserId)] = normalizedEmail;
      localStorage.setItem(this.userEmailCacheKey, JSON.stringify(map));
    } catch {
      return;
    }
  }

  private toTimestamp(value: any): number {
    const parsed = new Date(value ?? 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private getCachedEmailByUserId(userId: number): string {
    const normalized = Number(userId ?? 0);
    if (!normalized) {
      return '';
    }

    try {
      const raw = localStorage.getItem(this.userEmailCacheKey);
      if (!raw) {
        return '';
      }
      const map = JSON.parse(raw);
      const value = String(map?.[String(normalized)] ?? '').trim().toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(value) ? value : '';
    } catch {
      return '';
    }
  }

  private startAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      return;
    }

    this.autoRefreshTimer = window.setInterval(() => {
      this.loadDashboardData();
    }, 12000);
  }
}
