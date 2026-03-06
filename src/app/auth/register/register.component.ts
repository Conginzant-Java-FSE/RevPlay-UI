import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { ChangeDetectorRef } from '@angular/core';
import { finalize, timeout } from 'rxjs/operators';

@Component({
    selector: 'app-register',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule],
    templateUrl: './register.html',
    styleUrl: './register.scss',
})
export class RegisterComponent {
    private readonly registerTimeoutMs = 45000;
    private readonly userEmailCacheKey = 'revplay_user_email_map';
    private readonly usernameCacheKey = 'revplay_registered_username_map';
    private readonly registrationLogCacheKey = 'revplay_pending_registration_logs';
    readonly minPasswordLength = 8;
    userData = {
        fullName: '',
        username: '',
        email: '',
        password: '',
        confirmPassword: '',
        role: 'LISTENER' // Default role
    };
    isLoading = false;
    error: string | null = null;

    constructor(
        private authService: AuthService,
        private router: Router,
        private cdr: ChangeDetectorRef
    ) { }

    onSubmit() {
        const payload = {
            fullName: String(this.userData.fullName ?? '').trim(),
            username: String(this.userData.username ?? '').trim(),
            email: String(this.userData.email ?? '').trim().toLowerCase(),
            password: String(this.userData.password ?? ''),
            role: String(this.userData.role ?? 'LISTENER').trim().toUpperCase()
        };
        const confirmPassword = String(this.userData.confirmPassword ?? '');

        if (!payload.fullName || !payload.username || !payload.email || !payload.password || !confirmPassword) {
            this.error = 'Please fill all required fields.';
            return;
        }
        if (!this.isFullNameValid()) {
            this.error = 'Please enter a valid full name (minimum 2 letters).';
            return;
        }
        if (!this.isUsernameValid()) {
            this.error = 'Username must start with a letter and can use letters, numbers, dot or underscore.';
            return;
        }
        if (this.isUsernameAlreadyReserved(payload.username)) {
            this.error = 'This username is already in use. Try another username.';
            return;
        }
        if (!this.isEmailValid()) {
            this.error = 'Please enter a valid email address.';
            return;
        }
        if (!this.isPasswordStrong()) {
            this.error = `Password must be at least ${this.minPasswordLength} characters and include uppercase, lowercase, number, and special character.`;
            return;
        }
        if (!this.isPasswordMatch()) {
            this.error = 'Passwords do not match. Please re-enter both passwords.';
            return;
        }

        this.isLoading = true;
        this.error = null;

        this.authService.register(payload).pipe(
            timeout(this.registerTimeoutMs),
            finalize(() => {
                this.isLoading = false;
                this.cdr.markForCheck();
            })
        ).subscribe({
            next: (response) => {
                const userId = this.extractRegisteredUserId(response);
                this.persistRegisteredEmail(userId, payload.email);
                this.persistRegisteredUsername(userId, payload.username);
                this.persistPendingRegistrationLog(userId, payload);
                const infoMessage = this.resolveSuccessMessage(
                    response,
                    'Registration successful. Verification code has been sent to your email.'
                );
                this.router.navigate(['/verify-email'], {
                    queryParams: { email: payload.email, message: infoMessage }
                });
            },
            error: (err) => {
                this.error = this.resolveRegisterError(err);
                this.cdr.markForCheck();
            }
        });
    }

    isPasswordMatch(): boolean {
        return String(this.userData.password ?? '') === String(this.userData.confirmPassword ?? '');
    }

    isEmailValid(): boolean {
        const email = String(this.userData.email ?? '').trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    }

    isUsernameValid(): boolean {
        const username = String(this.userData.username ?? '').trim();
        return /^[a-zA-Z][a-zA-Z0-9_.]{2,29}$/.test(username);
    }

    isFullNameValid(): boolean {
        const fullName = String(this.userData.fullName ?? '').trim();
        return /^[a-zA-Z][a-zA-Z\s]{1,59}$/.test(fullName);
    }

    isPasswordStrong(): boolean {
        const password = String(this.userData.password ?? '');
        if (password.length < this.minPasswordLength) {
            return false;
        }
        const hasUpper = /[A-Z]/.test(password);
        const hasLower = /[a-z]/.test(password);
        const hasDigit = /[0-9]/.test(password);
        const hasSpecial = /[^A-Za-z0-9]/.test(password);
        return hasUpper && hasLower && hasDigit && hasSpecial;
    }

    private resolveRegisterError(err: any): string {
        const status = Number(err?.status ?? err?.error?.status ?? 0);
        const timeoutErrorName = String(err?.name ?? '').toLowerCase();
        const fieldErrors = Array.isArray(err?.error?.errors) ? err.error.errors : [];
        const backendMessage = String(
            err?.error?.userMessage ??
            err?.error?.message ??
            err?.error?.error ??
            err?.message ??
            ''
        ).trim();
        const normalized = backendMessage.toLowerCase();
        const usernameFieldError = fieldErrors.find((item: any) => String(item?.field ?? '').toLowerCase().includes('username'));
        const usernameFieldReason = String(usernameFieldError?.reason ?? '').toLowerCase();

        if (usernameFieldReason.includes('exist') || usernameFieldReason.includes('already') || usernameFieldReason.includes('duplicate')) {
            return 'This username is already in use. Try another username.';
        }

        if (normalized.includes('username') && (normalized.includes('exists') || normalized.includes('taken') || normalized.includes('already'))) {
            return 'This username is already in use. Try another username.';
        }

        if (normalized.includes('email') && (normalized.includes('exists') || normalized.includes('taken') || normalized.includes('already'))) {
            return 'This email is already linked to an account. Use a different email.';
        }

        if (normalized.includes('password') && (normalized.includes('already used') || normalized.includes('reuse') || normalized.includes('same'))) {
            return 'This password was already used. Choose a different password.';
        }

        if (normalized.includes('password') && (normalized.includes('8') || normalized.includes('weak') || normalized.includes('length'))) {
            return 'Use a stronger password with at least 8 characters.';
        }

        if (status === 409) {
            return 'This email or username is already registered. Try a different one.';
        }
        if (status === 400 && (normalized.includes('duplicate') || normalized.includes('exists') || normalized.includes('already'))) {
            return 'This email or username is already registered. Try a different one.';
        }

        if (timeoutErrorName === 'timeouterror') {
            return 'Registration is taking longer than expected. Please retry in a moment.';
        }

        if (backendMessage) {
            return backendMessage;
        }

        return 'Unable to create account right now. Please try again.';
    }

    private extractRegisteredUserId(response: any): number | null {
        const candidates = [
            response?.user?.userId,
            response?.user?.id,
            response?.userId,
            response?.id
        ];

        for (const candidate of candidates) {
            const value = Number(candidate ?? 0);
            if (Number.isFinite(value) && value > 0) {
                return Math.floor(value);
            }
        }

        return null;
    }

    private resolveSuccessMessage(response: any, fallback: string): string {
        const message = String(
            response?.userMessage ??
            response?.message ??
            response?.detail ??
            ''
        ).trim();
        return message || fallback;
    }

    private persistRegisteredEmail(userId: number | null, email: string): void {
        if (!userId || !email) {
            return;
        }

        try {
            const raw = localStorage.getItem(this.userEmailCacheKey);
            const map = raw ? JSON.parse(raw) : {};
            map[String(userId)] = String(email ?? '').trim().toLowerCase();
            localStorage.setItem(this.userEmailCacheKey, JSON.stringify(map));
        } catch {
            return;
        }
    }

    private persistRegisteredUsername(userId: number | null, username: string): void {
        const normalized = String(username ?? '').trim().toLowerCase();
        if (!normalized) {
            return;
        }

        try {
            const raw = localStorage.getItem(this.usernameCacheKey);
            const parsed = raw ? JSON.parse(raw) : {};
            const map = parsed && typeof parsed === 'object' ? parsed : {};
            map[normalized] = Number(userId ?? 0) > 0 ? Number(userId) : Date.now();
            localStorage.setItem(this.usernameCacheKey, JSON.stringify(map));
        } catch {
            return;
        }
    }

    private isUsernameAlreadyReserved(username: string): boolean {
        const normalized = String(username ?? '').trim().toLowerCase();
        if (!normalized) {
            return false;
        }

        try {
            const raw = localStorage.getItem(this.usernameCacheKey);
            const parsed = raw ? JSON.parse(raw) : {};
            return !!parsed?.[normalized];
        } catch {
            return false;
        }
    }

    private persistPendingRegistrationLog(
        userId: number | null,
        payload: { fullName: string; username: string; email: string; role: string }
    ): void {
        const actorId = Number(userId ?? 0);
        if (!actorId) {
            return;
        }

        const actorName = String(payload.fullName ?? payload.username ?? '').trim() || `User #${actorId}`;
        const actorEmail = String(payload.email ?? '').trim().toLowerCase();
        const role = String(payload.role ?? '').trim().toUpperCase();
        const timestamp = new Date().toISOString();
        const details = `User registered | fullName=${payload.fullName} | username=${payload.username} | email=${actorEmail} | role=${role}`;
        const nextEntry = {
            id: `local-register-${actorId}-${Date.now()}`,
            action: 'USER_REGISTERED',
            actionType: 'USER_REGISTERED',
            performedBy: actorId,
            actorId,
            actorName,
            actorEmail,
            entityType: 'USER',
            entityId: actorId,
            details,
            description: details,
            timestamp,
            localOnly: true
        };

        try {
            const raw = localStorage.getItem(this.registrationLogCacheKey);
            const parsed = raw ? JSON.parse(raw) : [];
            const existing = Array.isArray(parsed) ? parsed : [];
            const merged = [nextEntry, ...existing]
                .filter((item) => item && typeof item === 'object')
                .slice(0, 300);
            localStorage.setItem(this.registrationLogCacheKey, JSON.stringify(merged));
        } catch {
            return;
        }
    }
}
