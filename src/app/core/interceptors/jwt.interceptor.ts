import { Injectable } from '@angular/core';
import {
    HttpRequest,
    HttpHandler,
    HttpEvent,
    HttpInterceptor
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { TokenService } from '../services/token';

@Injectable()
export class JwtInterceptor implements HttpInterceptor {

    constructor(private tokenService: TokenService) { }

    intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
        if (this.isAuthRequest(request.url)) {
            return next.handle(request);
        }

        const token = this.tokenService.getToken();

        if (token) {
            request = request.clone({
                setHeaders: {
                    Authorization: `Bearer ${token}`
                }
            });
        }

        return next.handle(request);
    }

    private isAuthRequest(url: string): boolean {
        return url.includes('/auth/login') ||
            url.includes('/auth/register') ||
            url.includes('/auth/refresh') ||
            url.includes('/auth/forgot-password') ||
            url.includes('/auth/reset-password');
    }
}
