import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class ProtectedMediaService {
    private readonly resolvedImageCache = new Map<string, Observable<string>>();
    private readonly apiOrigin = environment.apiUrl.replace(/\/api\/v1$/, '');

    constructor(private http: HttpClient) { }

    resolveImageUrl(imageUrl: string): Observable<string> {
        const value = this.normalizeImageUrl(imageUrl);
        if (!value) {
            return of('');
        }

        const cached = this.resolvedImageCache.get(value);
        if (cached) {
            return cached;
        }

        const request$ = this.shouldFetchAsProtectedBlob(value)
            ? this.http.get(value, { responseType: 'blob' }).pipe(
                map((blob) => URL.createObjectURL(blob)),
                catchError(() => of(value)),
                shareReplay(1)
            )
            : of(value).pipe(shareReplay(1));

        this.resolvedImageCache.set(value, request$);
        return request$;
    }

    private shouldFetchAsProtectedBlob(value: string): boolean {
        const normalized = String(value ?? '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        return normalized.includes('/api/v1/files/') || normalized.includes('/files/');
    }

    private normalizeImageUrl(rawValue: string): string {
        const value = String(rawValue ?? '').trim();
        if (!value) {
            return '';
        }

        const normalized = value.split('?')[0].replace(/\/+$/, '').toLowerCase();
        if (
            normalized.endsWith('/api/v1/files/images') ||
            normalized.endsWith('/files/images') ||
            normalized === 'files/images'
        ) {
            return '';
        }

        if (
            value.startsWith('data:image/') ||
            value.startsWith('blob:') ||
            value.startsWith('assets/')
        ) {
            return value;
        }

        if (value.startsWith('http://') || value.startsWith('https://')) {
            return value;
        }

        if (value.startsWith('/api/v1/')) {
            return `${this.apiOrigin}${value}`;
        }

        if (value.startsWith('/files/images/') || value.startsWith('/files/')) {
            return `${this.apiOrigin}/api/v1${value}`;
        }

        if (value.startsWith('files/images/') || value.startsWith('files/')) {
            return `${this.apiOrigin}/api/v1/${value}`;
        }

        if (value.startsWith('/uploads/') || value.startsWith('uploads/') || value.startsWith('/images/') || value.startsWith('images/')) {
            const fileName = this.extractFileName(value);
            return fileName && this.isLikelyImageFile(fileName)
                ? `${environment.apiUrl}/files/images/${encodeURIComponent(fileName)}`
                : '';
        }

        if (!value.includes('/') && this.isLikelyImageFile(value)) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(value)}`;
        }

        const fileName = this.extractFileName(value);
        if (fileName && this.isLikelyImageFile(fileName)) {
            return `${environment.apiUrl}/files/images/${encodeURIComponent(fileName)}`;
        }

        if (value.startsWith('/')) {
            return `${this.apiOrigin}${value}`;
        }

        return value;
    }

    private extractFileName(rawPath: string): string {
        const normalized = String(rawPath ?? '').trim().split('?')[0];
        if (!normalized) {
            return '';
        }

        const segments = normalized.split(/[\\/]/).filter(Boolean);
        return segments[segments.length - 1] ?? '';
    }

    private isLikelyImageFile(fileName: string): boolean {
        return /\.(png|jpe?g|webp|gif|avif|svg)$/i.test(String(fileName ?? '').trim());
    }
}
