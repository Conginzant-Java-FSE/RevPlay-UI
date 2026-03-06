import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';

@Component({
  selector: 'app-audit-logs',
  templateUrl: './audit-logs.component.html',
  styleUrls: ['./audit-logs.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule]
})
export class AuditLogsComponent implements OnInit, OnDestroy {
  private readonly userEmailCacheKey = 'revplay_user_email_map';
  private readonly registrationLogCacheKey = 'revplay_pending_registration_logs';
  logs: any[] = [];
  actionOptions: string[] = [];
  filters = {
    user: '',
    action: '',
    date: ''
  };

  pageSize = 20;
  currentPage = 1;
  totalPages = 1;
  totalItems = 0;
  isLoading = false;
  error: string | null = null;
  private autoRefreshTimer: number | null = null;

  constructor(
    private adminService: AdminService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadLogs(1);
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
  }

  loadLogs(page = this.currentPage): void {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.currentPage = Math.max(1, page);

    const userFilter = this.filters.user.trim();
    const parsedUserId = Number(userFilter);
    const isUserIdFilter = Number.isFinite(parsedUserId) && parsedUserId > 0;
    const serverUserFilter = isUserIdFilter ? parsedUserId : undefined;

    this.adminService.getAuditLogs({
      page: this.currentPage - 1,
      size: this.pageSize,
      user: serverUserFilter,
      action: this.filters.action.trim() || undefined,
      from: this.filters.date || undefined,
      to: this.filters.date || undefined,
      fresh: true
    }).subscribe({
      next: (paged) => {
        const normalizedServerLogs = (paged?.content ?? [])
          .map((log: any) => this.normalizeLog(log))
          .sort((a: any, b: any) => this.toTimestamp(b.timestamp) - this.toTimestamp(a.timestamp));
        const normalizedLogs = this.mergeLogsWithPendingRegistrations(normalizedServerLogs);

        const keywordFilter = !isUserIdFilter ? userFilter.toLowerCase() : '';
        this.logs = keywordFilter
          ? normalizedLogs.filter((log) =>
            String(log.actorDisplay ?? '').toLowerCase().includes(keywordFilter) ||
            String(log.actorName ?? '').toLowerCase().includes(keywordFilter) ||
            String(log.actorEmail ?? '').toLowerCase().includes(keywordFilter) ||
            String(log.actorId ?? '').includes(keywordFilter)
          )
          : normalizedLogs;

        const actionSet = new Set(this.actionOptions);
        for (const action of normalizedLogs
          .map((log: any) => String(log.actionType ?? '').trim().toUpperCase())
          .filter(Boolean)) {
          actionSet.add(action);
        }
        this.actionOptions = Array.from(actionSet).sort();

        if (keywordFilter) {
          this.totalItems = this.logs.length;
          this.totalPages = 1;
          this.currentPage = 1;
        } else {
          this.totalItems = Math.max(this.logs.length, Number(paged?.totalElements ?? this.logs.length));
          this.totalPages = Math.max(1, Number(paged?.totalPages ?? Math.ceil(this.totalItems / this.pageSize)));
        }

        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to load audit logs.';
        this.logs = [];
        this.totalItems = 0;
        this.totalPages = 1;
        this.isLoading = false;
        this.cdr.markForCheck();
      }
    });
  }

  applyFilters(): void {
    this.currentPage = 1;
    this.loadLogs(1);
  }

  clearFilters(): void {
    this.filters = { user: '', action: '', date: '' };
    this.currentPage = 1;
    this.loadLogs(1);
  }

  goToPage(page: number): void {
    const nextPage = Math.min(Math.max(1, page), this.totalPages);
    if (nextPage === this.currentPage) {
      return;
    }

    this.loadLogs(nextPage);
  }

  getPageList(): number[] {
    const pages: number[] = [];
    const windowSize = 5;
    const start = Math.max(1, this.currentPage - 2);
    const end = Math.min(this.totalPages, start + windowSize - 1);

    for (let p = start; p <= end; p += 1) {
      pages.push(p);
    }
    return pages;
  }

  private normalizeLog(log: any): any {
    const actionType = String(log?.action ?? log?.actionType ?? '').trim().toUpperCase();
    const actorId = this.resolveActorId(log);
    const actorName = this.resolveActorName(log, actorId);
    const details = String(log?.details ?? log?.description ?? '').trim();
    const directEmail = this.normalizeEmail(log?.actorEmail ?? log?.userEmail ?? log?.email ?? '');
    const actorEmail = directEmail || this.extractEmail(details) || (actorId ? this.getCachedEmailByUserId(actorId) : '');

    return {
      ...log,
      actionType,
      actorId,
      actorName,
      actorEmail,
      actorDisplay: actorEmail ? `${actorName} (${actorEmail})` : actorName,
      entityType: log?.entityType ?? log?.entity ?? '-',
      details: details || '-',
      timestamp: log?.timestamp ?? log?.createdAt ?? null
    };
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

  private resolveActorName(log: any, actorId: number | null): string {
    const candidates = [
      String(log?.actorName ?? '').trim(),
      String(log?.username ?? '').trim(),
      String(log?.performedByName ?? '').trim()
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (/^\d+$/.test(candidate)) {
        continue;
      }
      if (/^user\s*#\d+$/i.test(candidate) && actorId) {
        return `User #${actorId}`;
      }
      return candidate;
    }

    return actorId ? `User #${actorId}` : 'System';
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

  private toTimestamp(value: any): number {
    const parsed = new Date(value ?? 0).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private mergeLogsWithPendingRegistrations(logs: any[]): any[] {
    const serverLogs = Array.isArray(logs) ? logs : [];
    const pending = this.getPendingRegistrationLogs().map((log: any) => this.normalizeLog(log));
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
      this.loadLogs(this.currentPage);
    }, 12000);
  }
}
