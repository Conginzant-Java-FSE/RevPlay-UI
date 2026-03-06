import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { resolveHttpErrorMessage } from '../../core/utils/error-message.util';
import { finalize, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './reset-password.html',
  styleUrl: './reset-password.scss',
})
export class ResetPassword {
  token = '';
  newPassword = '';
  confirmPassword = '';
  isLoading = false;
  error: string | null = null;
  resetSuccessful = false;
  invalidOrExpiredToken = false;

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router
  ) {
    const tokenFromQuery = this.route.snapshot.queryParamMap.get('token');
    if (tokenFromQuery) {
      this.token = tokenFromQuery;
    } else {
      this.invalidOrExpiredToken = true;
    }
  }

  onSubmit(): void {
    if (!this.token.trim()) {
      this.invalidOrExpiredToken = true;
      this.error = null;
      return;
    }

    if (!this.newPassword || !this.confirmPassword) {
      this.error = 'Password fields are required.';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.error = 'Confirm password must match new password.';
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.invalidOrExpiredToken = false;
    this.resetSuccessful = false;

    this.authService.resetPassword({ token: this.token, newPassword: this.newPassword }).pipe(
      timeout(8000),
      finalize(() => {
        this.isLoading = false;
      })
    ).subscribe({
      next: () => {
        this.resetSuccessful = true;
        this.newPassword = '';
        this.confirmPassword = '';
        setTimeout(() => this.goToLogin(), 900);
      },
      error: (err) => {
        const timeoutErrorName = String(err?.name ?? '').toLowerCase();
        if (timeoutErrorName === 'timeouterror') {
          this.error = 'Reset request timed out. Please try again.';
          return;
        }
        if (this.isTokenInvalidOrExpiredError(err)) {
          this.invalidOrExpiredToken = true;
          this.error = null;
          return;
        }
        this.error = resolveHttpErrorMessage(err, '/auth/reset-password');
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  goToForgotPassword(): void {
    this.router.navigate(['/auth/forgot-password']);
  }

  get isSubmitDisabled(): boolean {
    return this.isLoading || !this.newPassword || !this.confirmPassword || this.newPassword !== this.confirmPassword;
  }

  private isTokenInvalidOrExpiredError(err: any): boolean {
    const status = Number(err?.status ?? 0);
    if ([400, 401, 403, 404, 410].includes(status)) {
      return true;
    }

    const message = String(
      err?.error?.message ??
      err?.error?.detail ??
      err?.message ??
      ''
    ).toLowerCase();

    return message.includes('token') && (message.includes('invalid') || message.includes('expired'));
  }
}
