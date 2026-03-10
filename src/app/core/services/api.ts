import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Observable, of } from 'rxjs';
import { finalize, map, shareReplay, tap } from 'rxjs/operators';

interface ApiEnvelope<T> {
  success: boolean;
  message?: string;
  data?: T;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = environment.apiUrl;
  private readonly getCacheTtlMs = 15000;
  private readonly responseCache = new Map<string, { expiresAt: number; data: unknown }>();
  private readonly inFlightGet = new Map<string, Observable<unknown>>();

  constructor(private http: HttpClient) { }

  get<T>(path: string, params: HttpParams = new HttpParams()): Observable<T> {
    const url = `${this.baseUrl}${path}`;
    const cacheKey = this.buildGetCacheKey(url, params);
    const skipCache = this.shouldBypassCache(path);

    if (!skipCache) {
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return of(cached.data as T);
      }

      const pending = this.inFlightGet.get(cacheKey);
      if (pending) {
        return pending as Observable<T>;
      }
    }

    const request$ = this.http.get<T | ApiEnvelope<T>>(url, { params }).pipe(
      map(response => this.unwrapResponse<T>(response)),
      tap((resolved) => {
        if (skipCache) {
          return;
        }
        this.responseCache.set(cacheKey, {
          expiresAt: Date.now() + this.getCacheTtlMs,
          data: resolved as unknown
        });
      }),
      finalize(() => {
        if (!skipCache) {
          this.inFlightGet.delete(cacheKey);
        }
      }),
      shareReplay(1)
    );

    if (!skipCache) {
      this.inFlightGet.set(cacheKey, request$ as Observable<unknown>);
    }

    return request$;
  }

  post<T>(path: string, body: any): Observable<T> {
    this.invalidateGetCache();
    return this.http.post<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body).pipe(
      map(response => this.unwrapResponse<T>(response))
    );
  }

  postRaw<T>(path: string, body: any): Observable<T> {
    this.invalidateGetCache();
    return this.http.post<T>(`${this.baseUrl}${path}`, body);
  }

  postMultipart<T>(path: string, formData: FormData, params: HttpParams = new HttpParams()): Observable<any> {
    this.invalidateGetCache();
    return this.http.post<T>(`${this.baseUrl}${path}`, formData, {
      params,
      reportProgress: true,
      observe: 'events'
    });
  }

  putMultipart<T>(path: string, formData: FormData): Observable<any> {
    this.invalidateGetCache();
    return this.http.put<T>(`${this.baseUrl}${path}`, formData, {
      reportProgress: true,
      observe: 'events'
    });
  }

  put<T>(path: string, body: any): Observable<T> {
    this.invalidateGetCache();
    return this.http.put<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body).pipe(
      map(response => this.unwrapResponse<T>(response))
    );
  }

  patch<T>(path: string, body: any): Observable<T> {
    this.invalidateGetCache();
    return this.http.patch<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`, body).pipe(
      map(response => this.unwrapResponse<T>(response))
    );
  }

  delete<T>(path: string): Observable<T> {
    this.invalidateGetCache();
    return this.http.delete<T | ApiEnvelope<T>>(`${this.baseUrl}${path}`).pipe(
      map(response => this.unwrapResponse<T>(response))
    );
  }

  private unwrapResponse<T>(response: T | ApiEnvelope<T>): T {
    if (
      response &&
      typeof response === 'object' &&
      'success' in response &&
      'data' in response
    ) {
      return (response as ApiEnvelope<T>).data as T;
    }

    return response as T;
  }

  private invalidateGetCache(): void {
    this.responseCache.clear();
    this.inFlightGet.clear();
  }

  private shouldBypassCache(path: string): boolean {
    const normalized = String(path ?? '').toLowerCase();
    return normalized.includes('/auth/') || normalized.includes('/files/');
  }

  private buildGetCacheKey(url: string, params: HttpParams): string {
    const keys = (params?.keys?.() ?? []).slice().sort();
    if (keys.length === 0) {
      return url;
    }

    const serialized = keys
      .map((key) => {
        const values = params.getAll(key) ?? [];
        if (values.length === 0) {
          return encodeURIComponent(key);
        }
        return values
          .map((value) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
          .join('&');
      })
      .join('&');

    return serialized ? `${url}?${serialized}` : url;
  }
}
