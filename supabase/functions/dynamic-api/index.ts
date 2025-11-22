// Adiciona a declaração do namespace global Deno para compatibilidade com o TypeScript
declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }
  }
}

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// Importa o cliente Stripe compatível com Deno
import Stripe from 'https://esm.sh/stripe@16.2.0?target=deno&no-check';

// Headers CORS para permitir requisições do frontend.
// Em produção, restrinja 'Access-Control-Allow-Origin' para a URL do seu app.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Helper para obter a URL do site de forma robusta
const getSiteUrl = (req: Request): string => {
  let siteUrl = Deno.env.get('SITE_URL');
  if (!siteUrl) {
    const origin = req.headers.get('Origin');
    const referer = req.headers.get('Referer');
    
    if (origin) {
      siteUrl = origin;
      console.warn(`Stripe Proxy Aviso: A variável de ambiente SITE_URL não está configurada. Usando o header 'Origin' como fallback: ${siteUrl}.`);
    } else if (referer) {
      const refererUrl = new URL(referer);
      siteUrl = refererUrl.origin;
      console.warn(`Stripe Proxy Aviso: A variável de ambiente SITE_URL não está configurada e 'Origin' não foi encontrado. Usando o header 'Referer' como fallback: ${siteUrl}.`);
    } else {
      // Fallback final para evitar crash se tudo falhar, útil para dev local
      console.error("A configuração da URL do site (SITE_URL) é necessária para os redirecionamentos, mas não foi encontrada.");
      siteUrl = origin || 'http://localhost:4200'; 
    }
  }
  return siteUrl;
}

const handleCreateCheckoutSession = async (stripe: Stripe, siteUrl: string, body: any) => {
  const { priceId, userId, userEmail, isCreditPack, customerId } = body;

  if (!priceId || !userId || !userEmail || typeof isCreditPack === 'undefined') {
    throw new Error('Parâmetros obrigatórios ausentes: priceId, userId, userEmail, isCreditPack.');
  }

  const mode = isCreditPack ? 'payment' : 'subscription';
  const metadata = { userId: userId };

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    line_items: [{ price: priceId, quantity: 1 }],
    mode: mode,
    success_url: `${siteUrl}/#/library?status=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/#/subscribe?status=cancelled`,
    client_reference_id: userId,
    ...(mode === 'subscription' && { subscription_data: { metadata } }),
    ...(mode === 'payment' && { payment_intent_data: { metadata } }),
  };

  if (customerId) {
    sessionParams.customer = customerId;
  } else {
    sessionParams.customer_email = userEmail;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  return new Response(JSON.stringify({ session }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

const handleCreateBillingPortalSession = async (stripe: Stripe, siteUrl: string, body: any) => {
  const { customerId } = body;
  if (!customerId) {
    throw new Error('Parâmetro obrigatório ausente: customerId.');
  }

  const returnUrl = `${siteUrl}/#/usage`;
  
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return new Response(JSON.stringify({ url: portalSession.url }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

const handleGetCheckoutSession = async (stripe: Stripe, body: any) => {
  const { sessionId } = body;
  if (!sessionId) {
    throw new Error('Parâmetro obrigatório ausente: sessionId.');
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items']
  });

  const priceId = session.line_items?.data[0]?.price?.id;

  return new Response(JSON.stringify({ 
      customer: session.customer,
      subscription: session.subscription,
      priceId: priceId
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

// Busca a quantidade de créditos dinamicamente do banco de dados
const getCreditsFromPriceId = async (priceId: string, quantity: number): Promise<number> => {
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Variáveis de ambiente do Supabase não configuradas para busca de créditos.');
    }

    // Usa a chave de serviço para ter permissões de leitura na tabela de planos.
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: plan, error } = await supabase
      .from('plans')
      .select('credits')
      .eq('price_id', priceId)
      .single();

    if (error) {
      throw new Error(`Erro ao buscar plano no BD: ${error.message}`);
    }

    if (!plan) {
      console.error(`PriceId não encontrado na tabela 'plans': ${priceId}`);
      return 0; // Retorno seguro
    }

    const credits = plan.credits || 0;
    console.log(`Plano identificado via BD: ${credits} créditos`);
    return credits * quantity;

  } catch (e) {
    console.error(`Falha ao obter créditos do BD para o priceId ${priceId}:`, e.message);
    return 0; // Retorno seguro em caso de falha
  }
};

// Função para adicionar créditos ao usuário (usando Supabase)
const addCreditsToUser = async (userId: string, credits: number): Promise<void> => {
  try {
    // Importar o cliente Supabase
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Variáveis de ambiente do Supabase não configuradas.');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // FIX: Target the 'profiles' table instead of 'users' to correctly update user credits.
    const { data: profileData, error: fetchError } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error(`Erro ao buscar perfil para o usuário ${userId}:`, fetchError);
      throw new Error(`Erro ao buscar perfil do usuário: ${fetchError.message}`);
    }

    if (!profileData) {
      console.error(`Perfil não encontrado para o usuário ${userId}.`);
      throw new Error(`Perfil não encontrado para o usuário ${userId}.`);
    }

    const currentCredits = profileData.credits || 0;
    const newCredits = currentCredits + credits;

    // FIX: Update the 'profiles' table.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ 
        credits: newCredits,
      })
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Erro ao atualizar créditos: ${updateError.message}`);
    }

    // Registrar a transação (opcional, mas recomendado)
    const { error: transactionError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        type: 'purchase',
        amount: credits,
        description: `Compra de ${credits} créditos`,
        created_at: new Date().toISOString()
      });

    if (transactionError) {
      console.warn('Erro ao registrar transação (não crítico):', transactionError.message);
    }

    console.log(`✅ Créditos atualizados: Usuário ${userId} - De ${currentCredits} para ${newCredits} créditos`);

  } catch (error) {
    console.error('Erro em addCreditsToUser:', error);
    throw error;
  }
};

const handleProcessCredits = async (stripe: Stripe, body: any) => {
  const { sessionId, userId } = body;

  if (!sessionId || !userId) {
    throw new Error('Parâmetros obrigatórios ausentes: sessionId, userId.');
  }

  // Recupera a sessão do Stripe
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'payment_intent']
  });

  // Verifica se o pagamento foi bem-sucedido
  if (session.payment_status !== 'paid') {
    throw new Error('Pagamento não foi concluído com sucesso.');
  }

  // Recupera informações do preço/produto
  const priceId = session.line_items?.data[0]?.price?.id;
  const quantity = session.line_items?.data[0]?.quantity || 1;

  if (!priceId) {
    throw new Error('Não foi possível identificar o produto comprado.');
  }

  // Busca os créditos baseado no priceId usando sua lista de planos
  const creditsToAdd = await getCreditsFromPriceId(priceId, quantity);
  
  if (creditsToAdd === 0) {
    throw new Error(`PriceId não encontrado ou plano não configurado: ${priceId}`);
  }

  // Adiciona créditos ao usuário
  await addCreditsToUser(userId, creditsToAdd);

  return new Response(JSON.stringify({ 
    success: true, 
    creditsAdded: creditsToAdd,
    message: `✅ ${creditsToAdd} créditos adicionados com sucesso!` 
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
};

const handleStripeWebhook = async (stripe: Stripe, req: Request) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    throw new Error('Assinatura do webhook não encontrada.');
  }

  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET não configurado.');
  }

  const payload = await req.text();
  
  try {
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    console.log(`Evento do webhook recebido: ${event.type}`);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      
      // Processa créditos para pagamentos únicos (packs de créditos)
      if (session.mode === 'payment' && session.payment_status === 'paid') {
        const userId = session.client_reference_id;
        const sessionId = session.id;

        if (userId) {
          console.log(`Processando créditos para usuário: ${userId}, sessão: ${sessionId}`);
          
          // Chama a função de processamento de créditos
          await handleProcessCredits(stripe, { sessionId, userId });
          console.log(`✅ Créditos processados com sucesso para usuário: ${userId}`);
        } else {
          console.warn('UserId não encontrado na sessão:', sessionId);
        }
      }
      
      // Para subscriptions, você pode adicionar lógica similar aqui
      if (session.mode === 'subscription' && session.payment_status === 'paid') {
        console.log('Subscription criada - adicione lógica para subscriptions se necessário');
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`❌ Erro no webhook: ${err.message}`);
    return new Response(JSON.stringify({ error: `Webhook Error: ${err.message}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      console.warn("Stripe Proxy Aviso: O segredo 'STRIPE_SECRET_KEY' não foi encontrado. Procurando pelo nome de fallback 'STRIPE_PUBLISHABLE_KEY'. Corrija o nome do segredo.");
      stripeSecretKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
    }

    if (!stripeSecretKey) {
      throw new Error('A variável de ambiente STRIPE_SECRET_KEY não está configurada nos segredos da Edge Function.');
    }
    
    if (stripeSecretKey.startsWith('pk_')) {
        throw new Error('ERRO DE CONFIGURAÇÃO CRÍTICO: Foi fornecida uma chave publicável (pk_...) em vez da chave secreta (sk_...) no backend.');
    }

    // Verifica se é um webhook do Stripe
    const isWebhook = req.headers.get('stripe-signature') !== null;
    
    if (isWebhook) {
      const stripe = new Stripe(stripeSecretKey, {
        // @ts-ignore
        httpClient: Stripe.createFetchHttpClient(),
        apiVersion: '2024-06-20',
      });
      return await handleStripeWebhook(stripe, req);
    }

    // Processa requisições normais da API
    // SAFE JSON PARSING: Prevent crash on empty/invalid body
    let reqBody: any = {};
    try {
      const rawBody = await req.text();
      reqBody = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body in request', details: e.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { action, ...body } = reqBody;

    const stripe = new Stripe(stripeSecretKey, {
      // @ts-ignore
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: '2024-06-20',
    });
    
    const siteUrl = getSiteUrl(req);

    switch(action) {
      case 'create_checkout_session':
        return await handleCreateCheckoutSession(stripe, siteUrl, body);
      case 'create_billing_portal_session':
        return await handleCreateBillingPortalSession(stripe, siteUrl, body);
      case 'get_checkout_session':
        return await handleGetCheckoutSession(stripe, body);
      case 'process_credits':
        return await handleProcessCredits(stripe, body);
      default:
        return new Response(JSON.stringify({ error: `Ação inválida ou não especificada: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

  } catch (error) {
    console.error('Erro na função dynamic-api:', error);
    const errorMessage = error.raw?.message || error.message || 'Erro interno do servidor.';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});