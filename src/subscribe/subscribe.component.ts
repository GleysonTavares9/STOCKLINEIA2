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

  private async getPurchaseErrorMessage(error: any): Promise<string> {
    console.groupCollapsed('🚨 SubscribeComponent: getPurchaseErrorMessage - Debugging');
    console.log('Raw error object received:', error);

    // Default message if nothing else is found
    const defaultMessage = 'Ocorreu um erro desconhecido durante o checkout. Verifique o console para mais detalhes.';

    // Check for Supabase client initialization error first
    if (error?.message?.includes('Supabase client not initialized')) {
        console.log('Error Type: Supabase client not initialized.');
        console.groupEnd();
        return 'O Supabase não está configurado. Verifique as credenciais no `src/auth/config.ts`.';
    }

    // Attempt to extract detailed error from Supabase Edge Function's response body
    let bodyToParse: any = null;
    const bodyStream = error?.context?.body || error?.body; // Check both context.body and body

    if (bodyStream && typeof bodyStream.getReader === 'function') { // It's a ReadableStream
        console.log('Found a ReadableStream in error body, attempting to read it.');
        try {
            const reader = bodyStream.getReader();
            const decoder = new TextDecoder();
            let result = '';
            // Read the stream to completion
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                result += decoder.decode(value, { stream: true });
            }
            bodyToParse = result;
            console.log('Successfully read stream to string:', bodyToParse);
        } catch (streamError) {
            console.error('Failed to read error body stream:', streamError);
            bodyToParse = 'Falha ao ler o stream do corpo do erro.';
        }
    } else if (error?.context?.body) {
        bodyToParse = error.context.body;
        console.log('Found error.context.body (not a stream):', bodyToParse);
    } else if (error?.body) {
        bodyToParse = error.body;
        console.log('Found error.body (not a stream):', bodyToParse);
    }

    // Now, parse the extracted body content
    let parsedEdgeFunctionDetails: any = null;
    if (typeof bodyToParse === 'string') {
        try {
            parsedEdgeFunctionDetails = JSON.parse(bodyToParse);
            console.log('Successfully JSON.parsed bodyToParse:', parsedEdgeFunctionDetails);
        } catch (parseError) {
            console.warn('Failed to JSON.parse bodyToParse. It might be plain text or malformed JSON.', bodyToParse);
            // If it's not JSON, it could still be the error message itself
            parsedEdgeFunctionDetails = { error: bodyToParse };
        }
    } else if (typeof bodyToParse === 'object' && bodyToParse !== null) {
        // If it was already an object
        parsedEdgeFunctionDetails = bodyToParse;
        console.log('bodyToParse was already an object:', parsedEdgeFunctionDetails);
    }

    if (parsedEdgeFunctionDetails?.error) {
        const serverError = parsedEdgeFunctionDetails.error as string;
        console.log('Error Type: Specific message from Edge Function.');
        console.groupEnd();

        // Check for specific, actionable errors first
        if (serverError.includes('Expired API Key provided')) {
          return `Erro de pagamento: A chave da API do Stripe expirou. Por favor, gere uma nova chave secreta (sk_...) no seu painel do Stripe e atualize o segredo 'STRIPE_SECRET_KEY' na sua Edge Function 'dynamic-api' no Supabase.`;
        }
        if (serverError.includes('Invalid API Key provided')) {
          return `Erro de pagamento: A chave da API do Stripe é inválida. Verifique se o segredo 'STRIPE_SECRET_KEY' na sua Edge Function 'dynamic-api' no Supabase está correto. A chave deve começar com 'sk_...'.`;
        }
        if (serverError.includes('No such price')) {
          return `Erro de pagamento: O plano selecionado não foi encontrado no sistema de pagamento. Verifique a configuração do 'price_id' no Stripe e no banco de dados.`;
        }
        if (serverError.includes('ERRO DE CONFIGURAÇÃO CRÍTICO')) {
          // This will catch the pk_ vs sk_ error from the Edge Function
          return `Erro Crítico de Configuração: Uma chave publicável (pk_...) do Stripe foi usada no lugar da chave secreta (sk_...) no backend. Por favor, configure a chave secreta correta no segredo 'STRIPE_SECRET_KEY' da sua Edge Function 'dynamic-api'.`;
        }

        // If no specific pattern matched, return the generic server error
        return `Erro do servidor de pagamento: ${serverError}`;
    }

    // Fallback for generic invokeFunction errors if body parsing failed
    if (error?.message) {
      if (error.message.includes('Edge Function returned a non-2xx status code')) {
        console.log('Error Type: Raw Edge Function non-2xx message (fallback).');
        console.groupEnd();
        // At this point, body parsing failed or the body was empty.
        return `Erro de comunicação com o servidor de pagamento. Verifique os logs da função 'dynamic-api' no Supabase para a causa raiz.`;
      }
      console.log('Error Type: Generic Supabase invokeFunction error message (fallback).');
      console.groupEnd();
      return `Erro ao chamar o servidor de pagamento: ${error.message}`;
    }
    
    console.log('Error Type: Unknown error (final fallback).');
    console.groupEnd();
    return defaultMessage;
  }

  async purchase(plan: Plan): Promise<void> {
    if (!this.isStripeConfigured() || !plan.price_id || !this.currentUser()) {
      this.purchaseError.set('Não é possível processar a compra: configuração de pagamento incompleta ou usuário não autenticado.');
      return;
    }
    this.isLoading.set(plan.id);
    this.purchaseError.set(null);

    // A criação da sessão de checkout do Stripe é feita através da Edge Function 'dynamic-api'.
    // Isso é crucial para a segurança, pois permite que a chave secreta do Stripe (STRIPE_SECRET_KEY)
    // seja usada apenas no lado do servidor, sem nunca ser exposta no navegador do cliente.
    try {
      const stripe = Stripe(environment.stripePublishableKey);
      
      const { data, error: callError } = await this.supabase.invokeFunction('dynamic-api', {
          body: {
            priceId: plan.price_id,
            userId: this.currentUser()!.id,
            userEmail: this.currentUser()!.email,
            isCreditPack: plan.is_credit_pack, // Adicionado para informar o backend
          }
        });

      if (callError) {
        throw callError; // Lança o objeto de erro completo para ser analisado
      }

      if (data?.session?.url) {
        window.location.href = data.session.url; // Redireciona para o Checkout do Stripe
      } else {
        // Isso pode acontecer se a função retornar 200, mas com uma mensagem de erro interna (que agora é tratada pelo getPurchaseErrorMessage)
        throw new Error(data?.error || 'Não foi possível iniciar a sessão de checkout do Stripe.');
      }

    } catch (error: any) {
      console.error('Erro durante o checkout do Stripe:', error);
      this.purchaseError.set(await this.getPurchaseErrorMessage(error));
    } finally {
      this.isLoading.set(null);
    }
  }
}
