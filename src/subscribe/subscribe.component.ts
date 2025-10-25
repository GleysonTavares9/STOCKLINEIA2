import { Component, ChangeDetectionStrategy, signal, inject, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupabaseService, Plan } from '../services/supabase.service';
import { Router } from '@angular/router';
import { environment } from '../config';

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

  constructor() {
    this.loadPlans();
  }

  ngOnInit(): void {
    if (!environment.stripePublishableKey || environment.stripePublishableKey === 'YOUR_STRIPE_PUBLISHABLE_KEY') {
        console.error('Chave publicável do Stripe não configurada em src/config.ts');
        this.isStripeConfigured.set(false);
        this.purchaseError.set('A funcionalidade de pagamento não está configurada corretamente. O administrador precisa configurar a chave de API do Stripe.');
    } else {
        this.stripe = Stripe(environment.stripePublishableKey);
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