import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  email = '';
  isLoading = false;
  error: string | null = null;
  successMessage: string | null = null;

  constructor(private authService: AuthService) { }

  onSubmit(): void {
    const immediateMessage = 'Reset link sent to your mail.';
    const normalizedEmail = String(this.email ?? '').trim().toLowerCase();
    if (!normalizedEmail) {
      this.error = 'Please enter your registered email.';
      return;
    }
    if (!this.isEmailValid(normalizedEmail)) {
      this.error = 'Please enter a valid email address.';
      return;
    }

    this.error = null;
    this.successMessage = immediateMessage;
    this.isLoading = true;

    // Keep spinner very short; show confirmation immediately.
    setTimeout(() => {
      this.isLoading = false;
    }, 350);

    this.authService.forgotPassword(normalizedEmail).pipe(
      timeout(8000),
      catchError(() => of(null))
    ).subscribe({
      next: (response) => {
        this.successMessage = this.resolveSuccessMessage(response, immediateMessage);
      }
    });
  }

  private isEmailValid(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email ?? '').trim());
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
