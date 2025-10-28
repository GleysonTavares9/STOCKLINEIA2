import { Component, ChangeDetectionStrategy, signal, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService, Plan } from '../services/supabase.service';
import { Router } from '@angular/router';
import { environment } from '../auth/config';

// Declara a variável global Stripe injetada pelo script no index.html
declare var Stripe: any;

@Component({
  selector: 'app-subscribe',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './subscribe.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscribeComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly router = inject(Router);

  billingCycle = signal<'annual' | 'monthly'>('monthly');
  isLoading = signal<string | null>(null); // Plan ID for purchase button
  purchaseError = signal<string | null>(null);
  isLoadingPlans = signal<boolean>(true); // For initial
  
  plans = signal<Plan[]>([]);
  currentUser = this.supabase.currentUser;
  currentUserProfile = this.supabase.currentUserProfile;

  isStripeConfigured = signal(true); // Default to true, check in ngOnInit

  // Computed properties for filtering and displaying plans
  displayedPlans = computed(() => {
    const currentCycle = this.billingCycle();
    const allPlans = this.plans();

    // Separar pacotes de crédito (sempre exibidos) das assinaturas
    const creditPacks = allPlans.filter(plan => plan.is_credit_pack);
    let subscriptionPlans: Plan[] = [];

    if (currentCycle === 'annual') {
        // Tenta filtrar por planos explicitamente anuais
        const annualOnly = allPlans.filter(plan => plan.billing_cycle === 'annual' && !plan.is_credit_pack);
        if (annualOnly.length > 0) {
            subscriptionPlans = annualOnly;
        } else {
            // Fallback: se não houver planos anuais, mostra os mensais quando 'Anual' está selecionado
            subscriptionPlans = allPlans.filter(plan => plan.billing_cycle === 'monthly' && !plan.is_credit_pack);
        }
    } else { // 'monthly'
        subscriptionPlans = allPlans.filter(plan => plan.billing_cycle === 'monthly' && !plan.is_credit_pack);
    }
    return [...creditPacks, ...subscriptionPlans];
  });

  hasAnnualPlans = computed(() => 
    this.plans().some(plan => plan.billing_cycle === 'annual' && !plan.is_credit_pack)
  );

  totalAnnualCredits = computed(() => {
    if (this.billingCycle() !== 'annual') return 0;
    // Soma os créditos dos planos que estão sendo exibidos (excluindo pacotes de crédito)
    const plansToSum = this.displayedPlans().filter(plan => !plan.is_credit_pack);
    return plansToSum.reduce((sum, plan) => sum + (plan.credits || 0), 0);
  });

  constructor() {
    // Redirection logic is handled globally by AppComponent.
  }

  ngOnInit(): void {
    const stripeKey = environment.stripePublishableKey;
    if (!stripeKey || stripeKey.trim() === '' || stripeKey.includes('YOUR_STRIPE_PUBLISHABLE_KEY') || !stripeKey.startsWith('pk_')) {
      this.isStripeConfigured.set(false);
      console.warn('Stripe Publishable Key is not configured correctly. Stripe payments will be disabled.');
      this.purchaseError.set('A chave publicável do Stripe não está configurada corretamente. Por favor, adicione sua chave Stripe.');
      this.isLoadingPlans.set(false); // Stop loading plans if Stripe is not configured
      return;
    }

    this.loadPlans();
  }

  isSecurityError(): boolean {
    return this.purchaseError()?.includes('chave publicável do Stripe') || false;
  }

  async loadPlans(): Promise<void> {
    this.isLoadingPlans.set(true);
    try {
      const fetchedPlans = await this.supabase.getPlans();
      this.plans.set(fetchedPlans);
      if (fetchedPlans.length === 0) {
        console.warn('No plans loaded from Supabase. Possible RLS issue or no active plans in DB.');
      }
    } catch (error) {
      console.error('Error loading plans:', error);
      this.purchaseError.set('Falha ao carregar os planos. Tente novamente mais tarde.');
    } finally {
      this.isLoadingPlans.set(false);
    }
  }

  async purchase(plan: Plan): Promise<void> {
    if (!this.isStripeConfigured() || !plan.price_id || !this.currentUser()) {
      this.purchaseError.set('Não é possível processar a compra: configuração de pagamento incompleta ou usuário não autenticado.');
      return;
    }
    this.isLoading.set(plan.id);
    this.purchaseError.set(null);

    try {
      const stripe = Stripe(environment.stripePublishableKey);
      // #region Fix: Replaced direct access to private `supabase` client with the public `invokeFunction` method.
      const { data, error: callError } = await this.supabase.invokeFunction('dynamic-api', {
          body: {
            priceId: plan.price_id,
            userId: this.currentUser()!.id,
            userEmail: this.currentUser()!.email,
            isCreditPack: plan.is_credit_pack, // Adicionado para informar o backend
          }
        });
      // #endregion

      if (callError) {
        throw new Error(callError.message);
      }

      // #region Fix: Access `session` directly from the `data` object returned by `invokeFunction`.
      if (data?.session?.url) {
        window.location.href = data.session.url; // Redirect to Stripe Checkout
      } else {
        throw new Error('Não foi possível iniciar a sessão de checkout do Stripe.');
      }
      // #endregion

    } catch (error) {
      console.error('Error during Stripe checkout:', error);
      const message = error instanceof Error ? error.message : 'Ocorreu um erro desconhecido durante o checkout.';
      this.purchaseError.set(`Erro na compra: ${message}`);
    } finally {
      this.isLoading.set(null);
    }
  }
}