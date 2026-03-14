import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { jwtInterceptor } from './jwt-interceptor';

describe('jwtInterceptor', () => {
  const interceptor: HttpInterceptorFn = (req, next) =>
    TestBed.runInInjectionContext(() => jwtInterceptor(req, next));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(interceptor).toBeTruthy();
  });

  it('should forward the request unchanged', () => {
    const request = new HttpRequest('GET', '/demo');
    let captured: HttpRequest<unknown> | undefined;

    interceptor(request, (nextReq) => {
      captured = nextReq;
      return of(new HttpResponse({ status: 200 }));
    }).subscribe();

    expect(captured).toBe(request);
  });

  it('should propagate downstream HTTP errors', () => {
    const request = new HttpRequest('GET', '/secure');
    let capturedStatus: any = null;

    interceptor(request, () => throwError(() => new HttpErrorResponse({ status: 401 }))).subscribe({
      next: () => fail('expected error'),
      error: (err: any) => {
        capturedStatus = err?.status;
      }
    });

    expect(Number(capturedStatus)).toBe(401);
  });
});


