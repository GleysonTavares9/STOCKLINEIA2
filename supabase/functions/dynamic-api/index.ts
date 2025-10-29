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
      throw new Error("A configuração da URL do site (SITE_URL) é necessária para os redirecionamentos, mas não foi encontrada.");
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

    console.log('Stripe Proxy: Chave secreta carregada (terminando em ...' + stripeSecretKey.slice(-4) + ').');

    const { action, ...body } = await req.json();

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
      default:
        return new Response(JSON.stringify({ error: 'Ação inválida ou não especificada.' }), {
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