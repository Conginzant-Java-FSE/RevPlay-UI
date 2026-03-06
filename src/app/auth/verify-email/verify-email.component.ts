import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { resolveHttpErrorMessage } from '../../core/utils/error-message.util';
import { finalize, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.scss',
})
export class VerifyEmailComponent {
  readonly otpLength = 6;
  email = '';
  otp = '';
  isVerifying = false;
  isResending = false;
  isVerified = false;
  error: string | null = null;
  infoMessage: string | null = null;
  resendSuccessMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService,
    private router: Router
  ) {
    const emailFromQuery = this.route.snapshot.queryParamMap.get('email');
    const infoFromQuery = this.route.snapshot.queryParamMap.get('message');
    if (emailFromQuery) {
      this.email = String(emailFromQuery).trim().toLowerCase();
      this.infoMessage = String(infoFromQuery ?? '').trim() || 'A verification code has been sent to your email.';
    } else {
      this.error = 'Email is required for verification. Please register or log in again.';
    }
  }

  verifyEmail(): void {
    if (!this.email) {
      this.error = 'Email is required for verification. Please register or log in again.';
      return;
    }

    const normalizedOtp = this.normalizeOtp(this.otp);
    this.otp = normalizedOtp;

    if (!normalizedOtp) {
      this.error = 'Please enter the OTP code.';
      return;
    }

    if (normalizedOtp.length !== this.otpLength) {
      this.error = `Please enter a valid ${this.otpLength}-digit OTP code.`;
      return;
    }

    this.isVerifying = true;
    this.error = null;
    this.resendSuccessMessage = null;

    this.authService.verifyEmail(this.email, normalizedOtp).pipe(
      timeout(15000),
      finalize(() => {
        this.isVerifying = false;
      })
    ).subscribe({
      next: (response) => {
        this.isVerified = true;
        this.infoMessage = this.resolveSuccessMessage(response, 'Email verified successfully.');
        setTimeout(() => this.goToLogin(), 1200);
      },
      error: (err) => {
        const timeoutErrorName = String(err?.name ?? '').toLowerCase();
        if (timeoutErrorName === 'timeouterror') {
          this.error = 'Verification request timed out. Please try again.';
          return;
        }
        if (this.isOtpInvalidOrExpired(err)) {
          this.error = 'Invalid or expired verification code. Please try again.';
          return;
        }
        this.error = resolveHttpErrorMessage(err, '/auth/verify-email');
      }
    });
  }

  resendCode(): void {
    if (!this.email || this.isResending || this.isVerifying) {
      return;
    }

    this.isResending = true;
    this.error = null;
    this.resendSuccessMessage = null;

    this.authService.resendVerification(this.email).pipe(
      timeout(15000),
      finalize(() => {
        this.isResending = false;
      })
    ).subscribe({
      next: (response) => {
        this.resendSuccessMessage = this.resolveSuccessMessage(response, 'A new verification code has been sent.');
      },
      error: (err) => {
        const timeoutErrorName = String(err?.name ?? '').toLowerCase();
        if (timeoutErrorName === 'timeouterror') {
          this.error = 'Resend request timed out. Please try again.';
          return;
        }
        this.error = resolveHttpErrorMessage(err, '/auth/resend-verification');
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  get isVerifyDisabled(): boolean {
    return this.isVerifying || this.isResending || this.normalizeOtp(this.otp).length !== this.otpLength || !this.email;
  }

  get isResendDisabled(): boolean {
    return this.isVerifying || this.isResending || !this.email;
  }

  private isOtpInvalidOrExpired(err: any): boolean {
    const status = Number(err?.status ?? 0);
    if ([400, 401, 403, 404, 410].includes(status)) {
      return true;
    }

    const code = String(err?.error?.code ?? err?.error?.errorCode ?? '').trim().toUpperCase();
    if (code.includes('OTP') && (code.includes('INVALID') || code.includes('EXPIRED'))) {
      return true;
    }

    const message = String(
      err?.error?.userMessage ??
      err?.error?.message ??
      err?.error?.detail ??
      err?.message ??
      ''
    ).toLowerCase();

    return (message.includes('otp') || message.includes('verification code')) &&
      (message.includes('invalid') || message.includes('expired'));
  }

  onOtpInput(value: string): void {
    this.otp = this.normalizeOtp(value);
  }

  private normalizeOtp(value: string): string {
    return String(value ?? '').replace(/\D/g, '').slice(0, this.otpLength);
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
}
