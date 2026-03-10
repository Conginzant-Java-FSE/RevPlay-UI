import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PremiumService, PremiumStatus } from '../../core/services/premium.service';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-premium',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './premium.component.html',
  styleUrl: './premium.component.scss'
})
export class PremiumComponent implements OnInit, OnDestroy {
  selectedPlan: 'MONTHLY' | 'YEARLY' = 'MONTHLY';
  isUpgrading = false;
  errorMessage: string | null = null;
  showSuccessModal = false;
  premiumStatus: PremiumStatus = { isPremium: false, plan: '', planAmount: null, expiresAt: null };
  private statusSub?: Subscription;

  constructor(
    private premiumService: PremiumService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.premiumStatus = this.premiumService.statusSnapshot;
    this.statusSub = this.premiumService.status$.subscribe((status) => {
      this.premiumStatus = status;
    });
    this.premiumService.refreshStatus().subscribe({ error: () => { } });
  }

  ngOnDestroy(): void {
    this.statusSub?.unsubscribe();
  }

  selectPlan(plan: 'MONTHLY' | 'YEARLY'): void {
    this.selectedPlan = plan;
  }

  upgradeToPremium(): void {
    this.isUpgrading = true;
    this.errorMessage = null;

    this.premiumService.upgradePremium(this.selectedPlan).subscribe({
      next: () => {
        this.isUpgrading = false;
        this.showSuccessModal = true;
        this.premiumService.refreshStatus().subscribe({ error: () => { } });
      },
      error: (err) => {
        this.isUpgrading = false;
        this.errorMessage = this.resolveUpgradeError(err);
      }
    });
  }

  closeSuccessModal(): void {
    this.showSuccessModal = false;
  }

  closePage(): void {
    this.router.navigate(['/home']);
  }

  get isPremiumActive(): boolean {
    return Boolean(this.premiumStatus?.isPremium);
  }

  get premiumPlanLabel(): string {
    const normalized = String(this.premiumStatus?.plan ?? '').trim().toUpperCase();
    const amount = Number(this.premiumStatus?.planAmount ?? 0);
    if (Number.isFinite(amount) && amount > 0) {
      return `₹${amount}`;
    }
    if (normalized === 'YEARLY') {
      return '₹1499';
    }
    if (normalized === 'MONTHLY') {
      return '₹199';
    }
    return '-';
  }

  get premiumExpiryLabel(): string {
    const raw = String(this.premiumStatus?.expiresAt ?? '').trim();
    if (!raw) {
      return '-';
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return raw;
    }
    return date.toLocaleString();
  }

  get premiumStatusErrorMessage(): string {
    const statusCode = Number(this.premiumStatus?.statusCode ?? 0);
    if (statusCode === 403) {
      return 'Premium details cannot be shown for this account (403 Forbidden). Please re-login with the correct account.';
    }
    if (statusCode === 401) {
      return 'Session expired. Please login again to view premium details.';
    }
    return '';
  }

  private resolveUpgradeError(err: any): string {
    const status = Number(err?.status ?? err?.error?.status ?? 0);
    const backendMessage = String(
      err?.error?.userMessage ??
      err?.error?.message ??
      err?.error?.error ??
      err?.message ??
      ''
    ).trim();

    if (backendMessage) {
      return backendMessage;
    }
    if (status === 400) {
      return 'Invalid premium upgrade request. Please sign in again and retry.';
    }
    if (status === 401 || status === 403) {
      return 'Your session is expired or unauthorized. Please login again.';
    }
    return 'Unable to activate premium right now. Please try again.';
  }
}
