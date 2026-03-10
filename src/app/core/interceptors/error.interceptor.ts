import { Injectable, Injector } from '@angular/core';
import {
    HttpRequest,
    HttpHandler,
    HttpEvent,
    HttpInterceptor,
    HttpErrorResponse,
    HttpContextToken
} from '@angular/common/http';
import { Observable, throwError, BehaviorSubject } from 'rxjs';
import { catchError, filter, take, switchMap } from 'rxjs/operators';
import { TokenService } from '../services/token';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { resolveHttpErrorMessage } from '../utils/error-message.util';

const RETRIED_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
    private isRefreshing = false;
    private readonly REFRESH_FAILED = '__REFRESH_FAILED__';
    private refreshTokenSubject: BehaviorSubject<string | null> = new BehaviorSubject<string | null>(null);

    constructor(private injector: Injector, private tokenService: TokenService, private router: Router) { }

    intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
        return next.handle(request).pipe(
            catchError((error: HttpErrorResponse) => {
                const alreadyRetried = request.context.get(RETRIED_AFTER_REFRESH);
                // Refresh token only on 401 (expired/invalid token). 403 is an authorization decision.
                const isRefreshableAuthError = error instanceof HttpErrorResponse && error.status === 401;
                if (
                    isRefreshableAuthError &&
                    !this.isAuthRequest(request.url) &&
                    !alreadyRetried &&
                    !!this.tokenService.getRefreshToken()
                ) {
                    return this.handleAuthError(request, next);
                }
                if (error instanceof HttpErrorResponse && error.status === 401 && !this.isAuthRequest(request.url)) {
                    this.performLogoutCleanup();
                }
                return throwError(() => this.decorateError(error, request.url));
            })
        );
    }

    private handleAuthError(request: HttpRequest<any>, next: HttpHandler) {
        if (!this.isRefreshing) {
            this.isRefreshing = true;
            this.refreshTokenSubject.next(null);

            const authService = this.injector.get(AuthService);
            return authService.refreshToken().pipe(
                switchMap((authData: any) => {
                    const nextAccessToken = authData?.accessToken;
                    if (!nextAccessToken) {
                        throw new Error('Refresh response missing access token');
                    }
                    this.isRefreshing = false;
                    this.refreshTokenSubject.next(nextAccessToken);
                    return next.handle(this.addTokenHeader(request, nextAccessToken, true));
                }),
                catchError((err) => {
                    this.isRefreshing = false;
                    this.refreshTokenSubject.next(this.REFRESH_FAILED);
                    this.performLogoutCleanup();
                    return throwError(() => err);
                })
            );
        }

        return this.refreshTokenSubject.pipe(
            filter(token => token !== null),
            take(1),
            switchMap((token) => {
                if (token === this.REFRESH_FAILED) {
                    this.performLogoutCleanup();
                    return throwError(() => new Error('Session expired'));
                }
                return next.handle(this.addTokenHeader(request, token, true));
            })
        );
    }

    private addTokenHeader(request: HttpRequest<any>, token: string, markRetried = false) {
        return request.clone({
            headers: request.headers.set('Authorization', 'Bearer ' + token),
            context: markRetried ? request.context.set(RETRIED_AFTER_REFRESH, true) : request.context
        });
    }

    private isAuthRequest(url: string): boolean {
        return url.includes('/auth/login') ||
            url.includes('/auth/register') ||
            url.includes('/auth/refresh') ||
            url.includes('/auth/forgot-password') ||
            url.includes('/auth/reset-password');
    }

    private performLogoutCleanup(): void {
        this.tokenService.clearTokens();
        localStorage.removeItem('revplay_user');
        this.router.navigate(['/auth/login']);
    }

    private decorateError(error: HttpErrorResponse, requestUrl: string): HttpErrorResponse {
        const userMessage = resolveHttpErrorMessage(error, requestUrl);
        const rawPayload = error?.error;
        const nextPayload = rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
            ? { ...rawPayload, userMessage, message: userMessage }
            : { message: userMessage, userMessage, raw: rawPayload };

        return new HttpErrorResponse({
            error: nextPayload,
            headers: error.headers,
            status: error.status,
            statusText: error.statusText,
            url: error.url ?? requestUrl
        });
    }
}
