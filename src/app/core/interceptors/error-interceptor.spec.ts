import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpInterceptorFn, HttpRequest, HttpResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { errorInterceptor } from './error-interceptor';

describe('errorInterceptor', () => {
  const interceptor: HttpInterceptorFn = (req, next) =>
    TestBed.runInInjectionContext(() => errorInterceptor(req, next));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(interceptor).toBeTruthy();
  });

  it('should forward the request unchanged', () => {
    const request = new HttpRequest('POST', '/demo', { id: 1 });
    let captured: HttpRequest<unknown> | undefined;

    interceptor(request, (nextReq) => {
      captured = nextReq;
      return of(new HttpResponse({ status: 200 }));
    }).subscribe();

    expect(captured).toBe(request);
  });

  it('should propagate downstream errors without swallowing them', () => {
    const request = new HttpRequest('GET', '/error-case');
    let capturedStatus: any = null;

    interceptor(request, () => throwError(() => new HttpErrorResponse({ status: 500 }))).subscribe({
      next: () => fail('expected error'),
      error: (err: any) => {
        capturedStatus = err?.status;
      }
    });

    expect(Number(capturedStatus)).toBe(500);
  });
});


