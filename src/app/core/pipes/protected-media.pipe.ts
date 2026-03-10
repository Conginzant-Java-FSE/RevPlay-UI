import { Pipe, PipeTransform } from '@angular/core';
import { Observable } from 'rxjs';
import { ProtectedMediaService } from '../services/protected-media.service';

@Pipe({
    name: 'protectedMedia',
    standalone: true
})
export class ProtectedMediaPipe implements PipeTransform {
    constructor(private protectedMediaService: ProtectedMediaService) { }

    transform(value: string | null | undefined): Observable<string> {
        return this.protectedMediaService.resolveImageUrl(String(value ?? '').trim());
    }
}
