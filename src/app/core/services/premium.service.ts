import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from './api';
import { TokenService } from './token';
import { resolvePrimaryRole } from '../utils/role.util';

export interface PremiumStatus {
    isPremium: boolean;
    plan: string;
    planAmount?: number | null;
    expiresAt: string | null;
    statusCode?: number;
}

@Injectable({
    providedIn: 'root'
})
export class PremiumService {
    private readonly STORAGE_KEY = 'revplay_premium_status';
    private readonly PLAN_CACHE_KEY = 'revplay_premium_plan_by_user';
    private readonly statusSubject = new BehaviorSubject<PremiumStatus>(this.getStoredStatus());
    readonly status$ = this.statusSubject.asObservable();

    constructor(
        private apiService: ApiService,
        private tokenService: TokenService
    ) { }

    get statusSnapshot(): PremiumStatus {
        return this.statusSubject.value;
    }

    get isPremiumUser(): boolean {
        return !!this.statusSubject.value?.isPremium;
    }

    refreshStatus(): Observable<PremiumStatus> {
        const userId = this.resolveCurrentUserId();
        if (userId <= 0) {
            const fallback = this.normalizeStatus(null);
            this.setStatus(fallback);
            return of(fallback);
        }

        return this.apiService.get<any>(`/premium/status?userId=${encodeURIComponent(String(userId))}`).pipe(
            map((response) => {
                const normalized = this.normalizeStatus({
                    ...this.statusSubject.value,
                    ...(response?.data && typeof response.data === 'object' ? response.data : response)
                });
                return this.applyUserPlanFallback(userId, normalized);
            }),
            tap((status) => this.setStatus(status)),
            catchError((err) => {
                const existing = this.statusSubject.value;
                const fallback = this.normalizeStatus({
                    ...existing,
                    statusCode: Number(err?.status ?? err?.error?.status ?? 0)
                });
                this.setStatus(fallback);
                return of(fallback);
            })
        );
    }

    upgradePremium(plan: 'MONTHLY' | 'YEARLY' = 'MONTHLY'): Observable<any> {
        const normalizedPlan = String(plan ?? 'MONTHLY').trim().toUpperCase() === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
        const userId = this.resolveCurrentUserId();
        const query = `userId=${encodeURIComponent(String(userId))}&planType=${encodeURIComponent(normalizedPlan)}&plan=${encodeURIComponent(normalizedPlan)}`;
        const payload: any = {
            userId,
            plan: normalizedPlan,
            planType: normalizedPlan,
            billingCycle: normalizedPlan.toLowerCase()
        };
        return this.apiService.post<any>(`/premium/upgrade?${query}`, payload).pipe(
            tap((response) => {
                const normalized = this.normalizeStatus({
                    ...this.statusSubject.value,
                    ...response,
                    isPremium: true,
                    plan: response?.plan ?? response?.planType ?? normalizedPlan,
                    planAmount: response?.planAmount ?? response?.amount ?? response?.price ?? this.resolvePlanAmount(normalizedPlan),
                    statusCode: 0
                });
                this.setStatus(normalized);
            })
        );
    }

    clearStatus(): void {
        const fallback = this.normalizeStatus(null);
        this.setStatus(fallback);
    }

    private setStatus(status: PremiumStatus): void {
        const normalized = this.normalizeStatus(status);
        this.statusSubject.next(normalized);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(normalized));
        this.cachePlanForCurrentUser(normalized);
    }

    private getStoredStatus(): PremiumStatus {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) {
            return this.normalizeStatus(null);
        }

        try {
            const parsed = JSON.parse(raw);
            return this.normalizeStatus(parsed);
        } catch {
            localStorage.removeItem(this.STORAGE_KEY);
            return this.normalizeStatus(null);
        }
    }

    private normalizeStatus(status: any): PremiumStatus {
        const normalizedState = String(
            status?.status ??
            status?.subscriptionStatus ??
            status?.premiumStatus ??
            ''
        ).trim().toUpperCase();

        return {
            isPremium: Boolean(
                status?.isPremium ??
                status?.premium ??
                status?.premiumActive ??
                status?.active ??
                (normalizedState === 'ACTIVE')
            ),
            plan: String(
                status?.plan ??
                status?.planType ??
                status?.subscriptionPlan ??
                ''
            ).trim().toUpperCase(),
            planAmount: this.normalizePlanAmount(
                status?.planAmount ??
                status?.amount ??
                status?.price ??
                status?.subscriptionAmount ??
                status?.subscriptionPrice ??
                status?.data?.planAmount ??
                status?.data?.amount ??
                status?.data?.price ??
                status?.data?.subscriptionAmount ??
                status?.data?.subscriptionPrice
            ),
            expiresAt: status?.expiresAt
                ? String(status.expiresAt)
                : (status?.expiryDate
                    ? String(status.expiryDate)
                    : (status?.expiresOn ? String(status.expiresOn) : null)),
            statusCode: Number(status?.statusCode ?? 0) || undefined
        };
    }

    private normalizePlanAmount(value: any): number | null {
        const amount = Number(value ?? 0);
        return Number.isFinite(amount) && amount > 0 ? amount : null;
    }

    private resolvePlanAmount(plan: string): number | null {
        const normalized = String(plan ?? '').trim().toUpperCase();
        if (normalized === 'YEARLY') {
            return 1499;
        }
        if (normalized === 'MONTHLY') {
            return 199;
        }
        return null;
    }

    private cachePlanForCurrentUser(status: PremiumStatus): void {
        if (!status?.isPremium) {
            return;
        }
        const hasPlan = !!String(status?.plan ?? '').trim();
        const hasAmount = Number(status?.planAmount ?? 0) > 0;
        if (!hasPlan && !hasAmount) {
            return;
        }
        const userId = this.resolveCurrentUserId();
        if (userId <= 0) {
            return;
        }
        const cache = this.readPlanCache();
        cache[String(userId)] = {
            plan: String(status?.plan ?? '').trim().toUpperCase(),
            planAmount: Number(status?.planAmount ?? 0) || null
        };
        localStorage.setItem(this.PLAN_CACHE_KEY, JSON.stringify(cache));
    }

    private applyUserPlanFallback(userId: number, status: PremiumStatus): PremiumStatus {
        if (!status?.isPremium) {
            return status;
        }
        const hasPlan = !!String(status?.plan ?? '').trim();
        const hasAmount = Number(status?.planAmount ?? 0) > 0;
        if (hasPlan || hasAmount) {
            return status;
        }
        const cache = this.readPlanCache();
        const cached = cache[String(userId)] ?? null;
        if (!cached) {
            return status;
        }
        return this.normalizeStatus({
            ...status,
            plan: cached.plan,
            planAmount: cached.planAmount
        });
    }

    private readPlanCache(): Record<string, { plan?: string; planAmount?: number | null }> {
        try {
            const raw = localStorage.getItem(this.PLAN_CACHE_KEY);
            if (!raw) {
                return {};
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    private resolveCurrentUserId(): number {
        const fromToken = this.readUserIdFromToken();
        if (fromToken > 0) {
            return fromToken;
        }

        const fromStoredUser = this.readUserIdFromStorage();
        if (fromStoredUser > 0) {
            return fromStoredUser;
        }

        return 0;
    }

    private readUserIdFromStorage(): number {
        try {
            const rawUser = localStorage.getItem('revplay_user') ?? localStorage.getItem('user');
            if (!rawUser) {
                return 0;
            }
            const parsed = JSON.parse(rawUser);
            const candidates = [
                parsed?.userId,
                parsed?.id,
                parsed?.user_id,
                parsed?.uid,
                parsed?.user?.userId,
                parsed?.user?.id,
                parsed?.user?.user_id,
                parsed?.data?.userId,
                parsed?.data?.id
            ];
            for (const value of candidates) {
                const id = Number(value ?? 0);
                if (id > 0) {
                    return Math.floor(id);
                }
            }
            return 0;
        } catch {
            return 0;
        }
    }

    private resolveCurrentRole(): string {
        return this.readRoleFromStorage() || this.readRoleFromToken();
    }

    private readRoleFromStorage(): string {
        try {
            const rawUser = localStorage.getItem('revplay_user') ?? localStorage.getItem('user');
            if (!rawUser) {
                return '';
            }
            const parsed = JSON.parse(rawUser);
            return resolvePrimaryRole(parsed?.user ?? parsed);
        } catch {
            return '';
        }
    }

    private readUserIdFromToken(): number {
        try {
            const token = String(this.tokenService.getToken() ?? '').trim();
            if (!token) {
                return 0;
            }
            const parts = token.split('.');
            if (parts.length < 2) {
                return 0;
            }

            const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const normalized = payloadBase64 + '='.repeat((4 - payloadBase64.length % 4) % 4);
            const payloadJson = atob(normalized);
            const claims = JSON.parse(payloadJson);
            const candidates = [
                claims?.userId,
                claims?.user_id,
                claims?.id,
                claims?.uid,
                claims?.sub
            ];
            for (const value of candidates) {
                const id = Number(value ?? 0);
                if (id > 0) {
                    return Math.floor(id);
                }
            }
            return 0;
        } catch {
            return 0;
        }
    }

    private readRoleFromToken(): string {
        try {
            const token = String(this.tokenService.getToken() ?? '').trim();
            if (!token) {
                return '';
            }
            const parts = token.split('.');
            if (parts.length < 2) {
                return '';
            }

            const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const normalized = payloadBase64 + '='.repeat((4 - payloadBase64.length % 4) % 4);
            const payloadJson = atob(normalized);
            const claims = JSON.parse(payloadJson);
            return resolvePrimaryRole({
                role: claims?.role,
                roles: claims?.roles,
                authorities: claims?.authorities
            });
        } catch {
            return '';
        }
    }
}
