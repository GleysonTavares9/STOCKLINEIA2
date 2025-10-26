import { Component, ChangeDetectionStrategy, signal, inject, computed, OnInit, effect } from '@angular/core';
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
  isLoading = signal<string | null>(null); // Plan ID
  purchaseError = signal<string | null>(null);
  
  allPlans = signal<Plan[]>([]);
  
  monthlyPlans = computed(() => this.allPlans().filter(p => (!p.valid_days || p.valid_days <= 31) && !p.is_credit_pack).sort((a,b) => a.price - b.price));
  annualPlans = computed(() => this.allPlans().filter(p => p.valid_days && p.valid_days > 31 && !p.is_credit_pack).sort((a,b) => a.price - b.price));
  
  hasAnnualPlans = computed(() => this.annualPlans().length > 0);

  displayedPlans = computed(() => {
    return this.billingCycle() === 'monthly' ? this.monthlyPlans() : this.annualPlans();
  });

  totalAnnualCredits = computed(() => {
    const popularPlan = this.annualPlans().find(p => p.is_popular);
    return popularPlan ? popularPlan.credits : 0;
  });

  private stripe: any;
  isStripeConfigured = signal<boolean>(true);
  isSecurityError = signal<boolean>(false);

  constructor() {
    this.loadPlans();

    effect(() => {
      if (!this.supabase.currentUser()) {
        this.router.navigate(['/auth'], { queryParams: { message: 'Faça login para ver os planos de assinatura.' } });
      }
    });
  }

  ngOnInit(): void {
    const stripeKey = environment.stripePublishableKey;
    let errorMessage: string | null = null;
    this.isSecurityError.set(false);

    if (stripeKey.startsWith('sk_')) {
      errorMessage = "ALERTA DE SEGURANÇA: Uma chave secreta ('sk_...') do Stripe foi detectada no código. Isso é um risco grave. Por segurança, o pagamento foi desabilitado. REVOGUE esta chave imediatamente em seu painel Stripe e use apenas sua chave publicável ('pk_...').";
      this.isSecurityError.set(true);
    } else if (!stripeKey || stripeKey.includes('COLE_SUA_CHAVE_PUBLICAVEL_AQUI') || stripeKey.includes('DUMMYSTRIPEKEYREPLACEME')) {
      errorMessage = "Erro de Configuração: A chave do Stripe não foi configurada. Localmente, adicione-a em `src/config.ts`. Em produção (Vercel), configure a variável de ambiente `STRIPE_PUBLISHABLE_KEY`.";
    } else if (!stripeKey.startsWith('pk_test_') && !stripeKey.startsWith('pk_live_')) {
      errorMessage = "Erro de Configuração do Stripe: A chave fornecida parece inválida. Certifique-se de que é a sua 'Chave Publicável' completa, que começa com 'pk_live_' ou 'pk_test_'.";
    }

    if (errorMessage) {
      console.error(errorMessage);
      this.isStripeConfigured.set(false);
      this.purchaseError.set(errorMessage);
    } else {
      this.isStripeConfigured.set(true);
      this.stripe = Stripe(stripeKey);
    }
  }

  async loadPlans() {
    const plans = await this.supabase.getPlans();
    this.allPlans.set(plans);
  }

  async purchase(plan: Plan) {
    if (!this.isStripeConfigured()) {
        return;
    }

    this.isLoading.set(plan.id);
    this.purchaseError.set(null);
    
    const profile = this.supabase.currentUserProfile();
    if (!profile) {
      this.purchaseError.set('Você precisa estar logado para comprar.');
      this.isLoading.set(null);
      this.router.navigate(['/auth']);
      return;
    }

    if (!plan.price_id) {
        this.purchaseError.set('ID de preço não configurado para este plano.');
        this.isLoading.set(null);
        return;
    }

    try {
      const mode = plan.is_credit_pack ? 'payment' : 'subscription';
      const successUrl = `${window.location.origin}${window.location.pathname}#/library?purchase=success`;
      const cancelUrl = `${window.location.origin}${window.location.pathname}#/subscribe`;

      // Redireciona para a página de checkout do Stripe
      const { error } = await this.stripe.redirectToCheckout({
        lineItems: [{ price: plan.price_id, quantity: 1 }],
        mode: mode,
        successUrl: successUrl,
        cancelUrl: cancelUrl,
        customerEmail: profile.email,
        clientReferenceId: profile.id, // Essencial para o webhook identificar o usuário
      });

      if (error) {
        console.error('Stripe redirectToCheckout error:', error);
        this.purchaseError.set(`Erro do Stripe: ${error.message}`);
      }
    } catch (e) {
      console.error('Erro ao redirecionar para o checkout:', e);
      this.purchaseError.set('Ocorreu um erro inesperado ao iniciar o pagamento.');
    } finally {
      this.isLoading.set(null);
    }
  }
}