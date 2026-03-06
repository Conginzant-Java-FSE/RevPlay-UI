import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { resolvePrimaryRole } from '../../core/utils/role.util';
import { TokenService } from '../../core/services/token';
import { ChangeDetectorRef } from '@angular/core';
import { finalize, timeout } from 'rxjs/operators';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    templateUrl: './login.html',
    styleUrl: './login.scss',
})
export class LoginComponent {
    credentials = {
        usernameOrEmail: '',
        password: ''
    };
    isLoading = false;
    error: string | null = null;
    returnUrl = '';

    constructor(
        private authService: AuthService,
        private tokenService: TokenService,
        private router: Router,
        private route: ActivatedRoute,
        private cdr: ChangeDetectorRef
    ) {
        this.tokenService.clearTokens();
        localStorage.removeItem('revplay_user');
        this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    }

    onSubmit() {
        const usernameOrEmailRaw = String(this.credentials.usernameOrEmail ?? '');
        const passwordRaw = String(this.credentials.password ?? '');
        const usernameOrEmail = usernameOrEmailRaw.trim();
        const password = passwordRaw;

        if (!usernameOrEmail || !password) {
            this.error = 'Please enter username/email and password.';
            return;
        }
        if (this.looksLikeEmail(usernameOrEmail) && !this.isEmailValid(usernameOrEmail)) {
            this.error = 'Please enter a valid email address.';
            return;
        }

        const normalizedUsernameOrEmail = usernameOrEmail.includes('@')
            ? usernameOrEmail.toLowerCase()
            : usernameOrEmail;

        this.isLoading = true;
        this.error = null;

        this.authService.login({
            usernameOrEmail: normalizedUsernameOrEmail,
            password
        }).pipe(
            timeout(15000),
            finalize(() => {
                this.isLoading = false;
                this.cdr.markForCheck();
            })
        ).subscribe({
            next: (authData) => {
                const role = resolvePrimaryRole(authData?.user ?? this.authService.getCurrentUserSnapshot());
                const landingPath = this.returnUrl || this.authService.getPostLoginRedirect(role);
                this.router.navigateByUrl(landingPath);
            },
            error: (err) => {
                if (this.handleUnverifiedEmail(err, normalizedUsernameOrEmail)) {
                    this.error = null;
                    this.cdr.markForCheck();
                    return;
                }
                this.error = this.resolveLoginError(err, normalizedUsernameOrEmail);
                this.cdr.markForCheck();
            }
        });
    }

    private handleUnverifiedEmail(err: any, usernameOrEmail: string): boolean {
        const code = String(err?.error?.code ?? err?.error?.errorCode ?? '').trim().toUpperCase();
        const backendMessageUpper = String(
            err?.error?.userMessage ??
            err?.error?.message ??
            err?.error?.error ??
            err?.message ??
            ''
        ).trim().toUpperCase();

        const isNotVerified =
            code === 'EMAIL_NOT_VERIFIED' ||
            backendMessageUpper.includes('EMAIL_NOT_VERIFIED') ||
            (backendMessageUpper.includes('EMAIL') && backendMessageUpper.includes('NOT VERIFIED'));

        if (!isNotVerified) {
            return false;
        }

        const emailFromError = String(err?.error?.email ?? err?.error?.data?.email ?? '').trim().toLowerCase();
        const fallbackEmail = this.looksLikeEmail(usernameOrEmail) ? usernameOrEmail.trim().toLowerCase() : '';
        const email = emailFromError || fallbackEmail;
        const backendMessage = String(
            err?.error?.userMessage ??
            err?.error?.message ??
            err?.error?.detail ??
            ''
        ).trim();

        this.router.navigate(['/verify-email'], {
            queryParams: {
                ...(email ? { email } : {}),
                ...(backendMessage ? { message: backendMessage } : {})
            }
        });
        return true;
    }

    private resolveLoginError(err: any, usernameOrEmail: string): string {
        const status = Number(err?.status ?? 0);
        const backendMessage = String(
            err?.error?.userMessage ??
            err?.error?.message ??
            err?.error?.error ??
            err?.message ??
            ''
        ).trim();
        const normalized = backendMessage.toLowerCase();
        const usingEmail = this.looksLikeEmail(usernameOrEmail);

        if (normalized.includes('email') && normalized.includes('not found')) {
            return 'This email is not registered.';
        }

        if (normalized.includes('username') && normalized.includes('not found')) {
            return 'This username does not exist.';
        }

        if (normalized.includes('password') && (normalized.includes('wrong') || normalized.includes('invalid') || normalized.includes('incorrect'))) {
            return 'Password is incorrect.';
        }

        if (status === 401 || normalized.includes('invalid credentials') || normalized.includes('bad credentials')) {
            return usingEmail ? 'Password is incorrect or email is not registered.' : 'Password is incorrect or username is not registered.';
        }

        if (status === 403 || normalized.includes('disabled') || normalized.includes('inactive') || normalized.includes('blocked')) {
            return 'This account is not allowed to sign in right now. Contact support.';
        }

        if (backendMessage) {
            return backendMessage;
        }

        return 'Unable to log in right now. Please try again.';
    }

    private looksLikeEmail(value: string): boolean {
        return String(value ?? '').includes('@');
    }

    private isEmailValid(value: string): boolean {
        const email = String(value ?? '').trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    }
}
