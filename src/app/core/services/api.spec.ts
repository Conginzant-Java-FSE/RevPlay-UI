import { TestBed } from '@angular/core/testing';
import { HttpParams } from '@angular/common/http';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api';
import { environment } from '../../../environments/environment';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService]
    });

    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should unwrap API envelope for GET and cache it', () => {
    let firstResult: any;
    let secondResult: any;

    service.get<any>('/sample').subscribe((response) => {
      firstResult = response;
    });

    const firstRequest = httpMock.expectOne(`${environment.apiUrl}/sample`);
    expect(firstRequest.request.method).toBe('GET');
    firstRequest.flush({ success: true, data: { id: 1, name: 'alpha' } });

    service.get<any>('/sample').subscribe((response) => {
      secondResult = response;
    });

    httpMock.expectNone(`${environment.apiUrl}/sample`);
    expect(firstResult).toEqual({ id: 1, name: 'alpha' });
    expect(secondResult).toEqual({ id: 1, name: 'alpha' });
  });

  it('should send POST requests and unwrap envelope', () => {
    let result: any;

    service.post<any>('/items', { name: 'demo' }).subscribe((response) => {
      result = response;
    });

    const request = httpMock.expectOne(`${environment.apiUrl}/items`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ name: 'demo' });
    request.flush({ success: true, data: { id: 10 } });

    expect(result).toEqual({ id: 10 });
  });

  it('should return raw response when envelope is not present', () => {
    let result: any;

    service.get<any>('/raw').subscribe((response) => {
      result = response;
    });

    const request = httpMock.expectOne(`${environment.apiUrl}/raw`);
    request.flush({ id: 11, name: 'raw-data' });

    expect(result).toEqual({ id: 11, name: 'raw-data' });
  });

  it('should de-duplicate in-flight GET requests for the same cache key', () => {
    let firstResult: any;
    let secondResult: any;

    service.get<any>('/in-flight').subscribe((response) => {
      firstResult = response;
    });
    service.get<any>('/in-flight').subscribe((response) => {
      secondResult = response;
    });

    const requests = httpMock.match(`${environment.apiUrl}/in-flight`);
    expect(requests.length).toBe(1);
    requests[0].flush({ success: true, data: { ok: true } });

    expect(firstResult).toEqual({ ok: true });
    expect(secondResult).toEqual({ ok: true });
  });

  it('should bypass GET cache for auth endpoints', () => {
    let firstResult: any;
    let secondResult: any;

    service.get<any>('/auth/me').subscribe((response) => {
      firstResult = response;
    });
    const firstRequest = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    firstRequest.flush({ success: true, data: { id: 1 } });

    service.get<any>('/auth/me').subscribe((response) => {
      secondResult = response;
    });
    const secondRequest = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    secondRequest.flush({ success: true, data: { id: 2 } });

    expect(firstResult).toEqual({ id: 1 });
    expect(secondResult).toEqual({ id: 2 });
  });

  it('should bypass GET cache for files endpoints', () => {
    service.get<any>('/files/images/avatar.png').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/files/images/avatar.png`).flush({ success: true, data: { v: 1 } });

    service.get<any>('/files/images/avatar.png').subscribe();
    const secondRequest = httpMock.expectOne(`${environment.apiUrl}/files/images/avatar.png`);
    expect(secondRequest.request.method).toBe('GET');
    secondRequest.flush({ success: true, data: { v: 2 } });
  });

  it('should treat differently ordered params as the same GET cache key', () => {
    const firstParams = new HttpParams().set('b', '2').set('a', '1');
    const secondParams = new HttpParams().set('a', '1').set('b', '2');

    service.get<any>('/users', firstParams).subscribe();
    const firstRequest = httpMock.expectOne((req) => req.url === `${environment.apiUrl}/users`);
    expect(firstRequest.request.method).toBe('GET');
    firstRequest.flush({ success: true, data: [{ id: 1 }] });

    service.get<any>('/users', secondParams).subscribe();
    httpMock.expectNone(`${environment.apiUrl}/users`);
  });

  it('should invalidate GET cache after POST', () => {
    service.get<any>('/cache-target').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/cache-target`).flush({ success: true, data: { version: 1 } });

    service.get<any>('/cache-target').subscribe();
    httpMock.expectNone(`${environment.apiUrl}/cache-target`);

    service.post<any>('/items', { name: 'new' }).subscribe();
    const postRequest = httpMock.expectOne(`${environment.apiUrl}/items`);
    expect(postRequest.request.method).toBe('POST');
    postRequest.flush({ success: true, data: { id: 20 } });

    service.get<any>('/cache-target').subscribe();
    const refreshedRequest = httpMock.expectOne(`${environment.apiUrl}/cache-target`);
    refreshedRequest.flush({ success: true, data: { version: 2 } });
  });

  it('should invalidate GET cache after PUT, PATCH and DELETE', () => {
    service.get<any>('/cache-mutated').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/cache-mutated`).flush({ success: true, data: { version: 1 } });

    service.put<any>('/items/1', { name: 'put' }).subscribe();
    const putRequest = httpMock.expectOne(`${environment.apiUrl}/items/1`);
    expect(putRequest.request.method).toBe('PUT');
    putRequest.flush({ success: true, data: { ok: true } });

    service.get<any>('/cache-mutated').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/cache-mutated`).flush({ success: true, data: { version: 2 } });

    service.patch<any>('/items/1', { status: 'patched' }).subscribe();
    const patchRequest = httpMock.expectOne(`${environment.apiUrl}/items/1`);
    expect(patchRequest.request.method).toBe('PATCH');
    patchRequest.flush({ success: true, data: { ok: true } });

    service.get<any>('/cache-mutated').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/cache-mutated`).flush({ success: true, data: { version: 3 } });

    service.delete<any>('/items/1').subscribe();
    const deleteRequest = httpMock.expectOne(`${environment.apiUrl}/items/1`);
    expect(deleteRequest.request.method).toBe('DELETE');
    deleteRequest.flush({ success: true, data: { ok: true } });

    service.get<any>('/cache-mutated').subscribe();
    httpMock.expectOne(`${environment.apiUrl}/cache-mutated`).flush({ success: true, data: { version: 4 } });
  });

  it('should call postRaw without envelope unwrapping', () => {
    let result: any;

    service.postRaw<any>('/raw-post', { value: 1 }).subscribe((response) => {
      result = response;
    });

    const request = httpMock.expectOne(`${environment.apiUrl}/raw-post`);
    expect(request.request.method).toBe('POST');
    request.flush({ success: true, data: { payload: 99 } });

    expect(result).toEqual({ success: true, data: { payload: 99 } });
  });

  it('should send multipart requests with progress observation', () => {
    const formData = new FormData();
    formData.append('file', new Blob(['test'], { type: 'text/plain' }), 'demo.txt');

    service.postMultipart<any>('/upload', formData).subscribe();
    const postMultipartRequest = httpMock.expectOne(`${environment.apiUrl}/upload`);
    expect(postMultipartRequest.request.method).toBe('POST');
    expect(postMultipartRequest.request.reportProgress).toBeTrue();
    expect(postMultipartRequest.request.body).toBe(formData);
    postMultipartRequest.flush({});

    service.putMultipart<any>('/upload/1', formData).subscribe();
    const putMultipartRequest = httpMock.expectOne(`${environment.apiUrl}/upload/1`);
    expect(putMultipartRequest.request.method).toBe('PUT');
    expect(putMultipartRequest.request.reportProgress).toBeTrue();
    expect(putMultipartRequest.request.body).toBe(formData);
    putMultipartRequest.flush({});
  });

  it('should clear in-flight GET entry after request error and allow retry', () => {
    let errorCount = 0;

    service.get<any>('/retry-after-error').subscribe({
      next: () => fail('expected request error'),
      error: () => {
        errorCount += 1;
      }
    });

    const firstRequest = httpMock.expectOne(`${environment.apiUrl}/retry-after-error`);
    expect(firstRequest.request.method).toBe('GET');
    firstRequest.flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    service.get<any>('/retry-after-error').subscribe({
      next: () => fail('expected request error'),
      error: () => {
        errorCount += 1;
      }
    });

    const secondRequest = httpMock.expectOne(`${environment.apiUrl}/retry-after-error`);
    expect(secondRequest.request.method).toBe('GET');
    secondRequest.flush({ message: 'boom-again' }, { status: 500, statusText: 'Server Error' });
    expect(errorCount).toBe(2);
  });

  it('should not share GET cache for different param values', () => {
    const paramsA = new HttpParams().set('q', 'rock');
    const paramsB = new HttpParams().set('q', 'jazz');

    service.get<any>('/search', paramsA).subscribe();
    service.get<any>('/search', paramsB).subscribe();

    const requests = httpMock.match((req) => req.url === `${environment.apiUrl}/search`);
    expect(requests.length).toBe(2);
    requests[0].flush({ success: true, data: [] });
    requests[1].flush({ success: true, data: [] });
  });

  it('should unwrap envelope even when success flag is false but data exists', () => {
    let result: any;

    service.post<any>('/envelope-false', { id: 1 }).subscribe((response) => {
      result = response;
    });

    const request = httpMock.expectOne(`${environment.apiUrl}/envelope-false`);
    request.flush({ success: false, data: { id: 3, ok: false } });

    expect(result).toEqual({ id: 3, ok: false });
  });

  it('should keep non-envelope success objects unchanged', () => {
    let result: any;

    service.get<any>('/non-envelope').subscribe((response) => {
      result = response;
    });

    const request = httpMock.expectOne(`${environment.apiUrl}/non-envelope`);
    request.flush({ success: true, message: 'no-data-field' });

    expect(result).toEqual({ success: true, message: 'no-data-field' });
  });
});


