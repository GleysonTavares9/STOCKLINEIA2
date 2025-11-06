import { Component, ChangeDetectionStrategy, inject, computed, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { SupabaseService, ActivityHistoryItem, Notification } from '../services/supabase.service';
import { StocklineAiService } from '../services/mureka.service';

@Component({
  selector: 'app-account',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './account.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly stocklineAiService = inject(StocklineAiService);
  // Fix: Correctly inject ActivatedRoute instead of Router.
  private readonly route: ActivatedRoute = inject(ActivatedRoute);

  currentUser = this.supabase.currentUser;
  currentUserProfile = this.supabase.currentUserProfile;
  userMusic = this.stocklineAiService.userMusic;

  isManaging = signal(false);
  managementError = signal<string | null>(null);

  // New state for tabs and data
  activeTab = signal<'overview' | 'history' | 'notifications'>('overview');
  activityHistory = signal<ActivityHistoryItem[]>([]);
  // Use notifications from the centralized service
  notifications = this.supabase.notifications;
  isLoadingHistory = signal(true);
  isLoadingNotifications = this.supabase.isLoadingNotifications;

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

  constructor() {
    effect(() => {
      const user = this.currentUser();
      if (user) {
        this.loadActivityHistory(user.id);
        // Notifications are loaded by SupabaseService effect, so that's fine.
      } else {
        // If user logs out while on this page, clear the data
        this.activityHistory.set([]);
      }
    });

    // Check for 'tab' query parameter to set the active tab
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab === 'notifications' || tab === 'history' || tab === 'overview') {
        this.activeTab.set(tab);
      }
    });
  }

  async loadActivityHistory(userId: string) {
    this.isLoadingHistory.set(true);
    const data = await this.supabase.getActivityHistory(userId);
    this.activityHistory.set(data);
    this.isLoadingHistory.set(false);
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