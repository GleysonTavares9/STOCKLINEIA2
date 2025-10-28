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

serve(async (req) => {
  // Trata a requisição pre-flight OPTIONS do navegador
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Obtém a chave secreta do Stripe dos segredos da Edge Function
    const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('A variável de ambiente STRIPE_SECRET_KEY não está configurada nos segredos da Edge Function do Supabase.');
    }

    // 2. Extrai os dados enviados pelo frontend
    const { priceId, userId, userEmail, isCreditPack } = await req.json();

    if (!priceId || !userId || !userEmail || typeof isCreditPack === 'undefined') {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes: priceId, userId, userEmail, isCreditPack.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Define a URL do site para os redirecionamentos de sucesso/cancelamento do Stripe
    // É recomendado configurar SITE_URL como um segredo no Supabase.
    const siteUrl = Deno.env.get('SITE_URL') || new URL(req.headers.get('referer')!).origin;

    // 4. Inicializa o cliente Stripe com a chave secreta
    const stripe = new Stripe(stripeSecretKey, {
      // @ts-ignore: Necessário para compatibilidade com o ambiente Deno
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: '2024-06-20',
    });
    
    // 5. Determina o modo de checkout e prepara metadados para o webhook
    const mode = isCreditPack ? 'payment' : 'subscription';
    const metadata = { userId: userId };

    // 6. Cria a sessão de checkout no Stripe
    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: mode,
      success_url: `${siteUrl}/#/library?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/#/subscribe?status=cancelled`,
      customer_email: userEmail,
      client_reference_id: userId,
      // Anexa metadados ao objeto correto dependendo do modo
      ...(mode === 'subscription' && { subscription_data: { metadata } }),
      ...(mode === 'payment' && { payment_intent_data: { metadata } }),
    });

    // 7. Retorna a sessão criada para o frontend
    return new Response(JSON.stringify({ session }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Erro ao criar a sessão de checkout do Stripe:', error);
    return new Response(JSON.stringify({ error: error.message || 'Erro interno do servidor.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});