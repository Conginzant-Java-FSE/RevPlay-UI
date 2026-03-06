import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from './api';
import { TokenService } from './token';

export interface PremiumStatus {
    isPremium: boolean;
    plan: string;
    expiresAt: string | null;
    statusCode?: number;
}

@Injectable({
    providedIn: 'root'
})
export class PremiumService {
    private readonly STORAGE_KEY = 'revplay_premium_status';
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
            map((response) => this.normalizeStatus(response)),
            tap((status) => this.setStatus(status)),
            catchError((err) => {
                const fallback = this.normalizeStatus({
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
        return this.apiService.post<any>(`/premium/upgrade?${query}`, payload);
    }

    clearStatus(): void {
        const fallback = this.normalizeStatus(null);
        this.setStatus(fallback);
    }

    private setStatus(status: PremiumStatus): void {
        const normalized = this.normalizeStatus(status);
        this.statusSubject.next(normalized);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(normalized));
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
        return {
            isPremium: Boolean(status?.isPremium ?? false),
            plan: String(status?.plan ?? '').trim().toUpperCase(),
            expiresAt: status?.expiresAt
                ? String(status.expiresAt)
                : (status?.expiryDate ? String(status.expiryDate) : null),
            statusCode: Number(status?.statusCode ?? 0) || undefined
        };
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
}
