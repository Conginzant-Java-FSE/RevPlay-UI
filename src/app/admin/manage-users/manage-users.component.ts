import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { AdminService } from '../../core/services/admin.service';
import { ApiService } from '../../core/services/api';

interface UserSuggestion {
  userId: number;
  label: string;
  email: string;
  username: string;
}

@Component({
  selector: 'app-manage-users',
  templateUrl: './manage-users.component.html',
  styleUrls: ['./manage-users.component.scss'],
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule]
})
export class ManageUsersComponent implements OnInit, OnDestroy {
  private readonly userEmailCacheKey = 'revplay_user_email_map';
  private readonly registrationLogCacheKey = 'revplay_pending_registration_logs';
  private readonly deletedUserFallback = { username: 'Deleted User' };
  private readonly missingUserIds = new Set<number>();
  users: UserSuggestion[] = [];
  isLoading = false;
  error: string | null = null;
  statusMessage: string | null = null;
  targetUserId: number | null = null;
  selectedUserLabel = '';
  selectedUserEmail = '';
  userSearch = '';
  targetIsActive = true;
  targetRole = 'LISTENER';
  isDeletingUser = false;
  private userLookupVersion = 0;
  private autoRefreshTimer: number | null = null;
  private searchDebounceTimer: number | null = null;
  private activeSearchVersion = 0;
  private artistCatalogCache: UserSuggestion[] = [];
  private artistCatalogLoadedAt = 0;
  private readonly artistCatalogTtlMs = 120000;

  constructor(
    private adminService: AdminService,
    private apiService: ApiService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadUsers();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.autoRefreshTimer !== null) {
      window.clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }
  }

  loadUsers(): void {
    if (this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.loadUsersFromDirectory('');
  }

  get filteredUsers(): UserSuggestion[] {
    const query = this.userSearch.trim().toLowerCase();
    const source = this.users ?? [];
    if (!query) {
      return source;
    }

    return source.filter((user) =>
      user.label.toLowerCase().includes(query) ||
      String(user.userId).includes(query) ||
      user.username.toLowerCase().includes(query)
    );
  }

  hasUsableUsername(value: string): boolean {
    const text = String(value ?? '').trim();
    return !!text && !this.isEmail(text) && !/^\d+$/.test(text);
  }

  selectUser(user: UserSuggestion): void {
    this.targetUserId = user.userId;
    this.selectedUserLabel = user.label;
    this.selectedUserEmail = this.resolveUserContact(user);
    this.statusMessage = `Selected ${user.label} (ID: ${user.userId}).`;
    this.error = null;
    this.cdr.markForCheck();

    const needsEnrichment = this.isGenericUserLabel(user.label) || !user.email;
    if (!needsEnrichment) {
      return;
    }

    this.fetchUserDetails(user.userId).subscribe((details) => {
      if (!details) {
        return;
      }

      const merged = this.mergeSuggestionWithDetails(user, details);
      this.upsertSuggestion(merged);

      if (this.targetUserId === merged.userId) {
        this.selectedUserLabel = merged.label;
        this.selectedUserEmail = merged.email;
      }

      this.cdr.markForCheck();
    });
  }

  clearSelection(): void {
    this.targetUserId = null;
    this.selectedUserLabel = '';
    this.selectedUserEmail = '';
    this.statusMessage = null;
    this.error = null;
    this.cdr.markForCheck();
  }

  onUserIdChange(): void {
    const userId = Number(this.targetUserId ?? 0);
    if (!userId) {
      this.userLookupVersion++;
      this.selectedUserLabel = '';
      this.selectedUserEmail = '';
      return;
    }

    const lookupVersion = ++this.userLookupVersion;
    const matched = (this.users ?? []).find((user) => user.userId === userId);
    this.selectedUserLabel = matched?.label ?? `User #${userId}`;
    this.selectedUserEmail = matched ? this.resolveUserContact(matched) : '';

    this.fetchUserDetails(userId).subscribe((details) => {
      if (lookupVersion !== this.userLookupVersion || !details) {
        return;
      }

      const merged = this.mergeSuggestionWithDetails(
        matched ?? { userId, label: this.selectedUserLabel, email: '', username: '' },
        details
      );

      this.upsertSuggestion(merged);
      this.selectedUserLabel = merged.label;
      this.selectedUserEmail = this.resolveUserContact(merged);
      this.cdr.markForCheck();
    });
  }

  onUserSearchChange(value: string): void {
    this.userSearch = String(value ?? '');
    const query = this.userSearch.trim();

    if (this.searchDebounceTimer !== null) {
      window.clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (query.length < 2) {
      return;
    }

    this.searchDebounceTimer = window.setTimeout(() => {
      this.loadUsersFromDirectory(query);
    }, 300);
  }

  updateUserStatus(): void {
    if (!this.targetUserId) {
      return;
    }

    this.error = null;
    this.statusMessage = null;
    this.adminService.updateUserStatus(this.targetUserId, this.targetIsActive).subscribe({
      next: () => {
        const label = this.selectedUserLabel || `User #${this.targetUserId}`;
        this.statusMessage = `${label} status updated successfully.`;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to update user status.';
        this.cdr.markForCheck();
      }
    });
  }

  updateUserRole(): void {
    if (!this.targetUserId || !this.targetRole.trim()) {
      return;
    }

    this.error = null;
    this.statusMessage = null;
    const normalizedRole = this.targetRole.trim().toUpperCase();

    this.adminService.updateUserRole(this.targetUserId, normalizedRole).subscribe({
      next: () => {
        const label = this.selectedUserLabel || `User #${this.targetUserId}`;
        this.statusMessage = `${label} role updated to ${normalizedRole}.`;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Failed to update user role.';
        this.cdr.markForCheck();
      }
    });
  }

  deleteSelectedUser(): void {
    const userId = Number(this.targetUserId ?? 0);
    if (!userId || this.isDeletingUser) {
      return;
    }

    const label = this.selectedUserLabel || `User #${userId}`;
    const confirmed = confirm(
      `Delete ${label} (ID: ${userId})?\n\nThis is manual action and cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    this.isDeletingUser = true;
    this.error = null;
    this.statusMessage = null;
    this.cdr.markForCheck();

    this.adminService.deleteUser(userId).subscribe({
      next: () => {
        this.isDeletingUser = false;
        this.removeSuggestion(userId);
        this.clearSelection();
        this.statusMessage = `${label} deleted successfully.`;
        this.cdr.markForCheck();
      },
      error: () => {
        this.deleteUserDataFallback(userId, label);
      }
    });
  }

  trackUserById(_: number, user: UserSuggestion): number {
    return user.userId;
  }

  private deleteUserDataFallback(userId: number, label: string): void {
    this.adminService.getUserLikes(userId).pipe(
      catchError(() => of([])),
      switchMap((likes) => {
        const likeDeleteRequests = (likes ?? [])
          .map((item) => this.extractLikeId(item))
          .filter((likeId): likeId is number => typeof likeId === 'number' && likeId > 0)
          .map((likeId) => this.adminService.deleteLike(likeId).pipe(catchError(() => of(null))));

        const deleteLikes$ = likeDeleteRequests.length > 0 ? forkJoin(likeDeleteRequests) : of([]);

        return forkJoin({
          likes: deleteLikes$,
          history: this.adminService.clearUserPlayHistory(userId).pipe(catchError(() => of(null))),
          deactivate: this.adminService.updateUserStatus(userId, false).pipe(catchError(() => of(null)))
        });
      })
    ).subscribe({
      next: () => {
        this.isDeletingUser = false;
        this.removeSuggestion(userId);
        this.clearSelection();
        this.statusMessage = `${label} data cleared (likes/history) and account set to inactive.`;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isDeletingUser = false;
        this.error = `Failed to delete ${label}.`;
        this.cdr.markForCheck();
      }
    });
  }

  private extractUserId(log: any): number | null {
    const entityType = String(log?.entityType ?? log?.entity ?? '').trim().toUpperCase();
    const entityIdCandidate = Number(log?.entityId ?? 0);
    const numericCandidates = [
      log?.userId,
      log?.actorId,
      log?.performedBy,
      log?.targetUserId,
      log?.performedById
    ];

    if (entityType === 'USER' && Number.isFinite(entityIdCandidate) && entityIdCandidate > 0) {
      numericCandidates.push(entityIdCandidate);
    }

    for (const candidate of numericCandidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    const textCandidates = [
      String(log?.actorName ?? ''),
      String(log?.performedBy ?? ''),
      String(log?.details ?? '')
    ];

    for (const text of textCandidates) {
      const hashMatch = text.match(/#(\d{1,10})/);
      if (hashMatch?.[1]) {
        return Number(hashMatch[1]);
      }
      const userIdMatch = text.match(/user\s*id[:\s-]*(\d{1,10})/i);
      if (userIdMatch?.[1]) {
        return Number(userIdMatch[1]);
      }
    }

    return null;
  }

  private extractLikeId(item: any): number | null {
    const candidates = [
      item?.id,
      item?.likeId,
      item?.like_id,
      item?.like?.id
    ];

    for (const candidate of candidates) {
      const value = Number(candidate ?? 0);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    return null;
  }

  private extractUserLabel(log: any, userId: number): string {
    const detailsText = String(log?.details ?? log?.description ?? '').trim();
    const detailName = this.extractNameFromText(detailsText);
    const candidates = [
      String(log?.actorName ?? '').trim(),
      String(log?.username ?? '').trim(),
      String(log?.performedBy ?? '').trim(),
      detailName
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (/^user\s*#?\d+$/i.test(candidate)) {
        continue;
      }
      if (/^\d+$/.test(candidate)) {
        continue;
      }
      if (this.isEmail(candidate)) {
        continue;
      }
      if (this.looksLikeActionText(candidate)) {
        continue;
      }
      return candidate;
    }

    return `User #${userId}`;
  }

  private extractUserEmail(log: any): string {
    const detailsEmail = this.extractEmailFromAny(log?.details ?? log?.description ?? null);
    const directCandidates = [
      String(log?.email ?? '').trim(),
      String(log?.actorEmail ?? '').trim(),
      String(log?.userEmail ?? '').trim(),
      String(log?.username ?? '').trim(),
      String(detailsEmail ?? '').trim()
    ];

    for (const candidate of directCandidates) {
      const normalized = candidate.toLowerCase();
      if (this.isEmail(normalized)) {
        return normalized;
      }
    }

    const textCandidates = [
      String(log?.details ?? ''),
      String(log?.description ?? ''),
      String(log?.actorName ?? ''),
      String(log?.performedBy ?? '')
    ];

    for (const text of textCandidates) {
      const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      if (match?.[0]) {
        return match[0].toLowerCase();
      }
    }

    return '';
  }

  private isGenericUserLabel(value: string): boolean {
    return /^user\s*#?\d+$/i.test(String(value ?? '').trim());
  }

  private isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(String(value ?? '').trim());
  }

  private isSuspiciousTestData(value: any): boolean {
    return /(smoke|endpoint|tempdelete|clnadm|reactadm|deactadm|cleanup admin|reactivate admin|deactivate temp admin|admin smoke)/i
      .test(String(value ?? '').trim());
  }

  private resolveUserContact(user: UserSuggestion | null | undefined): string {
    if (!user) {
      return '';
    }
    if (user.email) {
      return user.email;
    }
    if (user.username) {
      return `@${user.username}`;
    }
    return '';
  }

  private fetchUserDetails(userId: number): Observable<any | null> {
    const normalizedUserId = Number(userId ?? 0);
    if (!normalizedUserId) {
      return of(null);
    }

    if (this.missingUserIds.has(normalizedUserId)) {
      return of(this.deletedUserFallback);
    }

    return this.apiService.get<any>(`/admin/users/${normalizedUserId}`).pipe(
      map((response) => response?.data ?? response),
      map((payload) => (payload && typeof payload === 'object' ? payload : null)),
      catchError((error) => {
        if (Number(error?.status ?? 0) === 404) {
          this.missingUserIds.add(normalizedUserId);
          return of(this.deletedUserFallback);
        }
        return of(null);
      })
    );
  }

  private buildUserSuggestionsFromLogs(logs: any[]): UserSuggestion[] {
    const usersById = new Map<number, UserSuggestion>();
    const source = Array.isArray(logs) ? logs : [];

    for (const log of source) {
      const userId = this.extractUserId(log);
      if (!userId) {
        continue;
      }

      const candidateLabel = this.extractUserLabel(log, userId);
      const candidateEmail = this.extractUserEmail(log) || this.getCachedEmailByUserId(userId);
      const candidateUsername = this.extractUserUsername(log);
      const suspicious = this.isSuspiciousTestData(candidateLabel) || this.isSuspiciousTestData(candidateEmail);
      if (suspicious) {
        continue;
      }
      const existing = usersById.get(userId);

      if (!existing) {
        const seeded: UserSuggestion = {
          userId,
          label: this.resolveBestLabel('', candidateLabel, userId),
          email: this.resolveBestEmail('', candidateEmail, userId),
          username: this.resolveBestUsername('', candidateUsername)
        };
        usersById.set(userId, seeded);
        continue;
      }

      existing.label = this.resolveBestLabel(existing.label, candidateLabel, userId);
      existing.email = this.resolveBestEmail(existing.email, candidateEmail, userId);
      existing.username = this.resolveBestUsername(existing.username, candidateUsername);
    }

    return Array.from(usersById.values())
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private enrichUsersWithProfiles(users: UserSuggestion[]): Observable<UserSuggestion[]> {
    const list = users ?? [];
    if (list.length === 0) {
      return of([]);
    }

    const requests = list.map((user) =>
      this.fetchUserDetails(user.userId).pipe(
        map((details) => this.mergeSuggestionWithDetails(user, details)),
        catchError(() => of(user))
      )
    );

    return forkJoin(requests).pipe(
      map((enriched) => enriched.sort((a, b) => a.label.localeCompare(b.label)))
    );
  }

  private mergeSuggestionWithDetails(user: UserSuggestion, details: any): UserSuggestion {
    if (!details || typeof details !== 'object') {
      return user;
    }

    const profileName = this.extractProfileName(details);
    const profileEmail = this.extractProfileEmail(details);
    const profileUsername = this.extractProfileUsername(details);

    const label = this.resolveBestLabel(user.label, profileName, user.userId);
    const email = this.resolveBestEmail(user.email, profileEmail, user.userId);
    const username = this.resolveBestUsername(user.username, profileUsername);

    return {
      userId: user.userId,
      label,
      email,
      username
    };
  }

  private extractProfileName(profile: any): string {
    const payload = profile?.data ?? profile;
    const nested = [payload, payload?.user, payload?.profile, payload?.account].filter(Boolean);
    const candidates: string[] = [];

    for (const source of nested) {
      candidates.push(
        String(source?.fullName ?? '').trim(),
        String(source?.full_name ?? '').trim(),
        String(source?.displayName ?? '').trim(),
        String(source?.display_name ?? '').trim(),
        String(source?.name ?? '').trim(),
        String(source?.username ?? '').trim()
      );

      const firstName = String(source?.firstName ?? '').trim();
      const lastName = String(source?.lastName ?? '').trim();
      if (firstName || lastName) {
        candidates.push(`${firstName} ${lastName}`.trim());
      }
    }

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (/^\d+$/.test(candidate) || this.isEmail(candidate) || this.isGenericUserLabel(candidate)) {
        continue;
      }
      if (this.looksLikeActionText(candidate)) {
        continue;
      }
      return candidate;
    }

    return '';
  }

  private extractProfileEmail(profile: any): string {
    const payload = profile?.data ?? profile;
    const nested = [payload, payload?.user, payload?.profile, payload?.account].filter(Boolean);
    const candidates: string[] = [];

    for (const source of nested) {
      candidates.push(
        String(source?.email ?? '').trim().toLowerCase(),
        String(source?.user_email ?? '').trim().toLowerCase(),
        String(source?.userEmail ?? '').trim().toLowerCase(),
        String(source?.contactEmail ?? '').trim().toLowerCase(),
        String(source?.username ?? '').trim().toLowerCase()
      );
    }

    for (const candidate of candidates) {
      if (this.isEmail(candidate)) {
        return candidate;
      }
    }

    const deepEmail = this.extractEmailFromAny(payload);
    if (deepEmail) {
      return deepEmail;
    }

    return '';
  }

  private extractProfileUsername(profile: any): string {
    const payload = profile?.data ?? profile;
    const nested = [payload, payload?.user, payload?.profile, payload?.account].filter(Boolean);
    const candidates: string[] = [];

    for (const source of nested) {
      candidates.push(
        String(source?.username ?? '').trim(),
        String(source?.user_name ?? '').trim(),
        String(source?.userName ?? '').trim(),
        String(source?.login ?? '').trim()
      );
    }

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (this.isEmail(candidate)) {
        continue;
      }
      return candidate;
    }

    return '';
  }

  private extractUserUsername(log: any): string {
    const detailsText = String(log?.details ?? log?.description ?? '').trim();
    const detailUsername = this.extractUsernameFromText(detailsText);
    const candidates = [
      String(log?.username ?? '').trim(),
      String(log?.actorName ?? '').trim(),
      String(log?.performedBy ?? '').trim(),
      detailUsername
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      if (this.isEmail(candidate) || /^user\s*#?\d+$/i.test(candidate) || /^\d+$/.test(candidate)) {
        continue;
      }
      return candidate;
    }

    return '';
  }

  private extractNameFromText(text: string): string {
    const source = String(text ?? '').trim();
    if (!source) {
      return '';
    }

    const patterns = [
      /full\s*name\s*[:=]\s*["']?([^,;"'}\]\n]+)/i,
      /display\s*name\s*[:=]\s*["']?([^,;"'}\]\n]+)/i,
      /name\s*[:=]\s*["']?([^,;"'}\]\n]+)/i
    ];

    for (const pattern of patterns) {
      const match = source.match(pattern);
      const value = String(match?.[1] ?? '').trim();
      if (value && !this.isEmail(value) && !/^user\s*#?\d+$/i.test(value)) {
        return value;
      }
    }

    return '';
  }

  private extractUsernameFromText(text: string): string {
    const source = String(text ?? '').trim();
    if (!source) {
      return '';
    }

    const match = source.match(/username\s*[:=]\s*["']?([a-zA-Z0-9._-]{3,100})/i);
    const value = String(match?.[1] ?? '').trim();
    if (!value || this.isEmail(value)) {
      return '';
    }

    return value;
  }

  private extractEmailFromAny(value: any): string {
    if (value == null) {
      return '';
    }

    if (typeof value === 'string') {
      const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      return match?.[0]?.toLowerCase() ?? '';
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.extractEmailFromAny(item);
        if (found) {
          return found;
        }
      }
      return '';
    }

    if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const found = this.extractEmailFromAny((value as any)[key]);
        if (found) {
          return found;
        }
      }
    }

    return '';
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
      return this.isEmail(value) ? value : '';
    } catch {
      return '';
    }
  }

  private resolvePageIndexes(totalPages: number): number[] {
    if (totalPages <= 120) {
      return Array.from({ length: totalPages }, (_, index) => index);
    }

    const indexes = new Set<number>();
    for (let i = 0; i < 90; i++) {
      indexes.add(i);
    }
    for (let i = 60; i > 0; i--) {
      indexes.add(Math.max(0, totalPages - i));
    }

    return Array.from(indexes)
      .filter((index) => index >= 0 && index < totalPages)
      .sort((a, b) => a - b);
  }

  private mergeUniqueLogs(logs: any[]): any[] {
    const source = Array.isArray(logs) ? logs : [];
    const byKey = new Map<string, any>();

    for (const log of source) {
      const key = String(log?.id ?? `${log?.timestamp ?? ''}|${log?.action ?? ''}|${log?.performedBy ?? ''}|${log?.entityId ?? ''}`);
      if (!byKey.has(key)) {
        byKey.set(key, log);
      }
    }

    return Array.from(byKey.values());
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

  private looksLikeActionText(value: string): boolean {
    const text = String(value ?? '').trim();
    if (!text) {
      return false;
    }

    return /\b(updated|deleted|created|added|removed|changed|status|role|playlist|profile)\b/i.test(text);
  }

  private startAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      return;
    }

    this.autoRefreshTimer = window.setInterval(() => {
      this.loadUsers();
    }, 15000);
  }

  private fetchUsersFromServerSearch(query: string): void {
    const keyword = String(query ?? '').trim();
    if (!keyword) {
      return;
    }
    this.loadUsersFromDirectory(keyword);
  }

  private loadUsersFromDirectory(search = ''): void {
    this.adminService.getUsersPage(0, 20, search).pipe(
      catchError(() => of({ content: [] }))
    ).subscribe((firstPage: any) => {
      const items = Array.isArray(firstPage?.content) ? firstPage.content : [];
      const suggestions = this.buildSuggestionsFromUserDirectory(items)
        .filter((user) => !this.isSuspiciousTestData(user?.label) && !this.isSuspiciousTestData(user?.email));

      if (String(search ?? '').trim()) {
        this.users = suggestions;
      } else {
        this.users = suggestions;
        this.isLoading = false;
      }

      for (const suggestion of suggestions) {
        if (suggestion.userId && suggestion.email) {
          this.persistCachedEmailByUserId(suggestion.userId, suggestion.email);
        }
      }

      this.cdr.markForCheck();
    }, () => {
      this.users = [];
      this.isLoading = false;
      this.error = 'Could not load users list.';
      this.cdr.markForCheck();
    });
  }

  private buildSuggestionsFromUserDirectory(items: any[]): UserSuggestion[] {
    const list = Array.isArray(items) ? items : [];
    const byId = new Map<number, UserSuggestion>();

    for (const item of list) {
      const userId = this.extractUserIdFromDirectoryEntry(item);
      if (!userId) {
        continue;
      }

      const label = this.extractUserLabelFromDirectoryEntry(item, userId);
      const email = this.extractUserEmailFromDirectoryEntry(item);
      const username = this.extractUserUsernameFromDirectoryEntry(item);
      const existing = byId.get(userId);

      if (!existing) {
        const seeded: UserSuggestion = {
          userId,
          label: this.resolveBestLabel('', label, userId),
          email: this.resolveBestEmail('', email, userId),
          username: this.resolveBestUsername('', username)
        };
        byId.set(userId, seeded);
        continue;
      }

      existing.label = this.resolveBestLabel(existing.label, label, userId);
      existing.email = this.resolveBestEmail(existing.email, email, userId);
      existing.username = this.resolveBestUsername(existing.username, username);
    }

    return Array.from(byId.values())
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private extractUserIdFromDirectoryEntry(entry: any): number | null {
    const candidates = [
      entry?.userId,
      entry?.id,
      entry?.user?.userId,
      entry?.user?.id,
      entry?.account?.userId,
      entry?.profile?.userId
    ];

    for (const candidate of candidates) {
      const value = Number(candidate ?? 0);
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    }

    return null;
  }

  private extractUserLabelFromDirectoryEntry(entry: any, userId: number): string {
    const candidates = [
      entry?.fullName,
      entry?.full_name,
      entry?.displayName,
      entry?.display_name,
      entry?.name,
      entry?.user?.fullName,
      entry?.user?.full_name,
      entry?.user?.displayName,
      entry?.user?.display_name,
      entry?.user?.name,
      entry?.profile?.fullName,
      entry?.profile?.full_name,
      entry?.username,
      entry?.user_name,
      entry?.user?.username
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (!value) {
        continue;
      }
      if (this.looksLikeActionText(value)) {
        continue;
      }
      if (this.isEmail(value) || /^\d+$/.test(value) || this.isGenericUserLabel(value)) {
        continue;
      }
      return value;
    }

    return `User #${userId}`;
  }

  private extractUserEmailFromDirectoryEntry(entry: any): string {
    const candidates = [
      entry?.email,
      entry?.user_email,
      entry?.userEmail,
      entry?.contactEmail,
      entry?.user?.email,
      entry?.user?.user_email,
      entry?.profile?.email,
      entry?.profile?.user_email,
      entry?.account?.email,
      entry?.username,
      entry?.user?.username
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim().toLowerCase();
      if (this.isEmail(value)) {
        return value;
      }
    }

    const deepEmail = this.extractEmailFromAny(entry);
    if (this.isEmail(deepEmail)) {
      return deepEmail;
    }

    return '';
  }

  private extractUserUsernameFromDirectoryEntry(entry: any): string {
    const candidates = [
      entry?.username,
      entry?.user_name,
      entry?.userName,
      entry?.login,
      entry?.user?.username,
      entry?.user?.user_name,
      entry?.user?.userName
    ];

    for (const candidate of candidates) {
      const value = String(candidate ?? '').trim();
      if (!value || this.isEmail(value) || /^\d+$/.test(value)) {
        continue;
      }
      return value;
    }

    return '';
  }

  private persistCachedEmailByUserId(userId: number, email: string): void {
    const normalizedUserId = Number(userId ?? 0);
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!normalizedUserId || !this.isEmail(normalizedEmail)) {
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

  private upsertSuggestion(next: UserSuggestion): void {
    const normalizedNext: UserSuggestion = {
      userId: next.userId,
      label: this.resolveBestLabel('', next.label, next.userId),
      email: this.resolveBestEmail('', next.email, next.userId),
      username: this.resolveBestUsername('', next.username)
    };

    const source = this.users ?? [];
    const index = source.findIndex((user) => user.userId === normalizedNext.userId);
    if (index === -1) {
      this.users = [...source, normalizedNext].sort((a, b) => a.label.localeCompare(b.label));
      if (normalizedNext.userId && normalizedNext.email) {
        this.persistCachedEmailByUserId(normalizedNext.userId, normalizedNext.email);
      }
      return;
    }

    const merged: UserSuggestion = {
      userId: normalizedNext.userId,
      label: this.resolveBestLabel(source[index].label, normalizedNext.label, normalizedNext.userId),
      email: this.resolveBestEmail(source[index].email, normalizedNext.email, normalizedNext.userId),
      username: this.resolveBestUsername(source[index].username, normalizedNext.username)
    };
    const updated = source.slice();
    updated[index] = merged;
    this.users = updated.sort((a, b) => a.label.localeCompare(b.label));
    if (merged.userId && merged.email) {
      this.persistCachedEmailByUserId(merged.userId, merged.email);
    }
  }

  private resolveBestLabel(existingValue: string, incomingValue: string, userId: number): string {
    const existing = String(existingValue ?? '').trim();
    const incoming = String(incomingValue ?? '').trim();
    const fallback = `User #${userId}`;
    const existingWeak = this.isWeakUserLabel(existing);
    const incomingWeak = this.isWeakUserLabel(incoming);

    if (!incomingWeak) {
      return incoming;
    }
    if (!existingWeak) {
      return existing;
    }
    return fallback;
  }

  private resolveBestEmail(existingValue: string, incomingValue: string, userId: number): string {
    const incoming = String(incomingValue ?? '').trim().toLowerCase();
    if (this.isEmail(incoming)) {
      return incoming;
    }

    const existing = String(existingValue ?? '').trim().toLowerCase();
    if (this.isEmail(existing)) {
      return existing;
    }

    const cached = this.getCachedEmailByUserId(userId);
    return this.isEmail(cached) ? cached : '';
  }

  private resolveBestUsername(existingValue: string, incomingValue: string): string {
    const incoming = String(incomingValue ?? '').trim();
    if (this.hasUsableUsername(incoming)) {
      return incoming;
    }

    const existing = String(existingValue ?? '').trim();
    return this.hasUsableUsername(existing) ? existing : '';
  }

  private isWeakUserLabel(value: string): boolean {
    const text = String(value ?? '').trim();
    if (!text) {
      return true;
    }
    if (/^\d+$/.test(text)) {
      return true;
    }
    if (this.isGenericUserLabel(text)) {
      return true;
    }
    if (this.isEmail(text)) {
      return true;
    }
    return this.looksLikeActionText(text);
  }

  private isLowValueSuggestion(_user: UserSuggestion | null | undefined): boolean {
    return false;
  }

  private removeSuggestion(userId: number): void {
    this.users = (this.users ?? []).filter((user) => user.userId !== userId);
  }

  private mergeSuggestions(...groups: UserSuggestion[][]): UserSuggestion[] {
    const byId = new Map<number, UserSuggestion>();
    for (const group of groups) {
      for (const item of group ?? []) {
        if (!item?.userId) {
          continue;
        }
        const existing = byId.get(item.userId);
        if (!existing) {
          byId.set(item.userId, {
            userId: item.userId,
            label: this.resolveBestLabel('', item.label, item.userId),
            email: this.resolveBestEmail('', item.email, item.userId),
            username: this.resolveBestUsername('', item.username)
          });
          continue;
        }

        existing.label = this.resolveBestLabel(existing.label, item.label, item.userId);
        existing.email = this.resolveBestEmail(existing.email, item.email, item.userId);
        existing.username = this.resolveBestUsername(existing.username, item.username);
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.label.localeCompare(b.label));
  }

  private enrichUsersFromArtistLogs(logs: any[]): Observable<UserSuggestion[]> {
    const artistIds = this.extractArtistIdsFromLogs(logs);
    if (artistIds.length === 0) {
      return of([]);
    }

    const requests = artistIds.map((artistId) =>
      this.apiService.get<any>(`/artists/${artistId}`).pipe(
        map((response) => response?.data ?? response),
        map((artist) => this.mapArtistToUserSuggestion(artist)),
        catchError(() => of(null))
      )
    );

    return forkJoin(requests).pipe(
      map((users) => (users ?? []).filter((user): user is UserSuggestion => !!user))
    );
  }

  private loadArtistUsersFromCatalog(): Observable<UserSuggestion[]> {
    const now = Date.now();
    if (this.artistCatalogCache.length > 0 && (now - this.artistCatalogLoadedAt) < this.artistCatalogTtlMs) {
      return of(this.artistCatalogCache);
    }

    const queries = ['a', 'm', 's'];
    const searchRequests = queries.map((query) =>
      this.apiService.get<any>(`/search?q=${encodeURIComponent(query)}&type=ARTIST&page=0&size=50`).pipe(
        map((response) => {
          const payload = response?.data ?? response;
          const content = Array.isArray(payload?.content) ? payload.content : [];
          return content;
        }),
        catchError(() => of([]))
      )
    );

    return forkJoin(searchRequests).pipe(
      map((groups) => groups.flatMap((items) => (Array.isArray(items) ? items : []))),
      map((items) => {
        const ids = new Set<number>();
        for (const item of items) {
          const type = String(item?.type ?? '').trim().toUpperCase();
          if (type && type !== 'ARTIST') {
            continue;
          }
          const artistId = Number(item?.artistId ?? item?.contentId ?? 0);
          if (artistId > 0) {
            ids.add(Math.floor(artistId));
          }
        }
        return Array.from(ids.values());
      }),
      switchMap((artistIds) => {
        if (artistIds.length === 0) {
          this.artistCatalogCache = [];
          this.artistCatalogLoadedAt = now;
          return of([]);
        }

        const requests = artistIds.map((artistId) =>
          this.apiService.get<any>(`/artists/${artistId}`).pipe(
            map((response) => response?.data ?? response),
            map((artist) => this.mapArtistToUserSuggestion(artist)),
            catchError(() => of(null))
          )
        );

        return forkJoin(requests).pipe(
          map((users) => (users ?? []).filter((user): user is UserSuggestion => !!user)),
          map((users) => this.mergeSuggestions(users)),
          map((users) => {
            this.artistCatalogCache = users;
            this.artistCatalogLoadedAt = Date.now();
            return users;
          })
        );
      }),
      catchError(() => of([]))
    );
  }

  private extractArtistIdsFromLogs(logs: any[]): number[] {
    const ids = new Set<number>();
    for (const log of logs ?? []) {
      const entityType = String(log?.entityType ?? log?.entity ?? '').trim().toUpperCase();
      const direct = Number(log?.artistId ?? 0);
      const entityId = Number(log?.entityId ?? 0);

      if (direct > 0) {
        ids.add(Math.floor(direct));
      }
      if (entityType === 'ARTIST' && entityId > 0) {
        ids.add(Math.floor(entityId));
      }

      const details = String(log?.details ?? log?.description ?? '');
      const fromText = details.match(/artist\s*id\s*[:=\-]?\s*(\d{1,10})/i) ?? details.match(/artistId\s*[:=\-]?\s*(\d{1,10})/i);
      const parsed = Number(fromText?.[1] ?? 0);
      if (parsed > 0) {
        ids.add(Math.floor(parsed));
      }
    }

    return Array.from(ids.values());
  }

  private mapArtistToUserSuggestion(artist: any): UserSuggestion | null {
    if (!artist || typeof artist !== 'object') {
      return null;
    }

    const userId = Number(
      artist?.userId ??
      artist?.user?.id ??
      artist?.user?.userId ??
      artist?.profile?.userId ??
      0
    );

    if (!Number.isFinite(userId) || userId <= 0) {
      return null;
    }

    const label = this.resolveBestLabel(
      '',
      String(
        artist?.displayName ??
        artist?.display_name ??
        artist?.name ??
        artist?.user?.fullName ??
        artist?.user?.full_name ??
        artist?.user?.name ??
        ''
      ).trim(),
      userId
    );

    const email = this.resolveBestEmail(
      '',
      String(
        artist?.email ??
        artist?.user?.email ??
        artist?.user?.user_email ??
        ''
      ).trim().toLowerCase(),
      userId
    );

    const username = this.resolveBestUsername(
      '',
      String(artist?.user?.username ?? artist?.username ?? '').trim()
    );

    return { userId, label, email, username };
  }
}
