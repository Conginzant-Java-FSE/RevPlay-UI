import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';
import { hasAnyRole, resolvePrimaryRole } from '../utils/role.util';

@Injectable({
    providedIn: 'root'
})
export class RoleGuard implements CanActivate {

    constructor(private authService: AuthService, private router: Router) { }

    canActivate(
        route: ActivatedRouteSnapshot,
        state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {

        return this.authService.currentUser$.pipe(
            take(1),
            map(user => {
                const expectedRoles = route.data['roles'] as Array<string>;

                if (!user) {
                    this.router.navigate(['/auth/login'], { queryParams: { returnUrl: state.url } });
                    return false;
                }

                if ((expectedRoles ?? []).length > 0) {
                    if (!hasAnyRole(user, expectedRoles)) {
                        const role = resolvePrimaryRole(user);
                        this.router.navigateByUrl(this.authService.getPostLoginRedirect(role));
                        return false;
                    }
                }

                return true;
            })
        );
    }
}
