import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';
import { StocklineAiService } from '../services/mureka.service';

@Component({
  selector: 'app-usage',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './usage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsageComponent {
  private readonly supabase = inject(SupabaseService);
  private readonly stocklineAiService = inject(StocklineAiService);

  currentUser = this.supabase.currentUser;
  currentUserProfile = this.supabase.currentUserProfile;
  userMusic = this.stocklineAiService.userMusic;

  isManaging = signal(false);
  managementError = signal<string | null>(null);

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
