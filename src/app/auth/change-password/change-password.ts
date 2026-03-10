import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { resolveHttpErrorMessage } from '../../core/utils/error-message.util';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './change-password.html',
  styleUrl: './change-password.scss',
})
export class ChangePassword {
  readonly minPasswordLength = 8;
  currentPassword = '';
  newPassword = '';
  confirmNewPassword = '';
  isLoading = false;
  error: string | null = null;
  successMessage: string | null = null;

  constructor(private authService: AuthService) { }

  onSubmit(): void {
    if (!this.currentPassword.trim() || !this.newPassword.trim() || !this.confirmNewPassword.trim()) {
      this.error = 'Please fill all required fields.';
      this.successMessage = null;
      return;
    }

    if (!this.isPasswordStrong()) {
      this.error = `Password must be at least ${this.minPasswordLength} characters and include uppercase, lowercase, number, and special character.`;
      this.successMessage = null;
      return;
    }

    if (!this.isPasswordMatch()) {
      this.error = 'Passwords do not match.';
      this.successMessage = null;
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.successMessage = null;

    this.authService.changePassword({
      currentPassword: this.currentPassword,
      newPassword: this.newPassword
    }).pipe(
      finalize(() => {
        this.isLoading = false;
      })
    ).subscribe({
      next: (response: any) => {
        this.isLoading = false;
        if (response && response.success === false) {
          this.error = this.resolveMessage(response) || 'Password change failed. Please try again.';
          this.successMessage = null;
          return;
        }
        this.error = null;
        this.successMessage = this.resolveMessage(response) || 'Password changed successfully.';
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmNewPassword = '';
      },
      error: (err) => {
        this.isLoading = false;
        this.error = resolveHttpErrorMessage(err, '/auth/change-password');
      }
    });
  }

  private resolveMessage(response: any): string | null {
    if (typeof response === 'string') {
      return response.trim() || null;
    }
    const candidate = response?.data?.message ?? response?.message ?? response?.data ?? response?.data?.data?.message;
    const resolved = typeof candidate === 'string' ? candidate.trim() : '';
    return resolved || null;
  }

  isPasswordMatch(): boolean {
    return String(this.newPassword ?? '') === String(this.confirmNewPassword ?? '');
  }

  isPasswordStrong(): boolean {
    const password = String(this.newPassword ?? '');
    if (password.length < this.minPasswordLength) {
      return false;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecial = /[^A-Za-z0-9]/.test(password);
    return hasUpper && hasLower && hasDigit && hasSpecial;
  }
}
