import { Component, ChangeDetectionStrategy, inject, computed, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SupabaseService, CreditTransaction, Notification } from '../services/supabase.service';
import { MurekaService } from '../services/mureka.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './account.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly murekaService = inject(MurekaService);
  // Fix: Explicitly type the injected ActivatedRoute to resolve type inference issues.
  private readonly route: ActivatedRoute = inject(ActivatedRoute);

  currentUser = this.supabase.currentUser;
  currentUserProfile = this.supabase.currentUserProfile;
  userMusic = this.murekaService.userMusic;

  isManaging = signal(false);
  managementError = signal<string | null>(null);

  // New state for tabs and data
  activeTab = signal<'overview' | 'history' | 'notifications'>('overview');
  transactions = signal<CreditTransaction[]>([]);
  // Use notifications from the centralized service
  notifications = this.supabase.notifications;
  isLoadingTransactions = signal(true);
  isLoadingNotifications = signal(false); // No longer loading here, data comes from service

  hasActiveSubscription = computed(() => !!this.currentUserProfile()?.stripe_customer_id);

  accountCreationDate = computed(() => {
    const createdAt = this.currentUser()?.created_at;
    if (!createdAt) return 'Não disponível';
    return new Date(createdAt).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    });
  });

  // Use computed signal from the centralized service
  unreadNotificationsCount = this.supabase.unreadNotificationsCount;

  ngOnInit(): void {
    const user = this.currentUser();
    if (user) {
      this.loadTransactions(user.id);
      // Notifications are now loaded automatically by SupabaseService on auth change.
    }

    // Check for 'tab' query parameter to set the active tab
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'notifications' || tab === 'history' || tab === 'overview') {
        this.activeTab.set(tab);
      }
    });
  }

  async loadTransactions(userId: string) {
    this.isLoadingTransactions.set(true);
    const data = await this.supabase.getCreditTransactionsForUser(userId);
    this.transactions.set(data);
    this.isLoadingTransactions.set(false);
  }

  async markAsRead(notification: Notification) {
    if (notification.read) return;
    // The service now handles both the API call and the local state update
    await this.supabase.markNotificationAsRead(notification.id);
  }

  async manageSubscription(): Promise<void> {
    this.isManaging.set(true);
    this.managementError.set(null);

    try {
      const { url, error } = await this.supabase.createBillingPortalSession();
      if (error) {
        throw new Error(error);
      }
      if (url) {
        window.location.href = url;
      } else {
        throw new Error('Não foi possível obter o link para o portal de gerenciamento.');
      }
    } catch (error: any) {
      this.managementError.set(error.message || 'Ocorreu um erro inesperado ao tentar acessar o portal de faturamento.');
    } finally {
      this.isManaging.set(false);
    }
  }
}
