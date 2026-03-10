import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

interface AiChatResponse {
  response?: string;
  data?: {
    response?: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private readonly apiBase = environment.apiUrl.replace(/\/api\/v1$/, '');

  constructor(private readonly http: HttpClient) {}

  sendMessage(prompt: string): Observable<string> {
    return this.http.post<AiChatResponse>(`${this.apiBase}/api/ai/chat`, { prompt }).pipe(
      map((response) => String(response?.data?.response ?? response?.response ?? '').replace(/\n/g, ' ').trim())
    );
  }
}
