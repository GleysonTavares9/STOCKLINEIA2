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
    // 1. Busca a chave secreta do Stripe de forma robusta.
    //    Primeiro, procura pelo nome correto ('STRIPE_SECRET_KEY').
    //    Se não encontrar, procura pelo nome antigo/incorreto ('STRIPE_PUBLISHABLE_KEY') como fallback
    //    para não quebrar setups existentes, mas emite um aviso.
    let stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      console.warn("Stripe Proxy Aviso: O segredo 'STRIPE_SECRET_KEY' não foi encontrado. Procurando pelo nome de fallback 'STRIPE_PUBLISHABLE_KEY'. Esta é uma configuração incorreta e deve ser corrigida. Por favor, renomeie o segredo para 'STRIPE_SECRET_KEY' no seu painel do Supabase.");
      stripeSecretKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
    }

    // VALIDAÇÃO DA CHAVE SECRETA DO STRIPE
    if (!stripeSecretKey) {
      // Se nenhuma das chaves foi encontrada, lança um erro.
      throw new Error('A variável de ambiente STRIPE_SECRET_KEY não está configurada nos segredos da Edge Function do Supabase.');
    }
    
    // Valida se a chave encontrada não é uma chave publicável.
    if (stripeSecretKey.startsWith('pk_')) {
        throw new Error('ERRO DE CONFIGURAÇÃO CRÍTICO: A chave fornecida para o segredo do Stripe é uma chave publicável (começa com "pk_..."). Você DEVE usar sua chave secreta (que começa com "sk_...") nos segredos desta Edge Function.');
    }

    // 2. Log para confirmar que a chave foi carregada com sucesso (mostrando apenas os 4 últimos caracteres por segurança).
    console.log('Stripe Proxy: Chave secreta do Stripe carregada com sucesso (terminando em ...' + stripeSecretKey.slice(-4) + ').');

    // 3. Extrai os dados enviados pelo frontend
    const { priceId, userId, userEmail, isCreditPack } = await req.json();

    if (!priceId || !userId || !userEmail || typeof isCreditPack === 'undefined') {
      return new Response(JSON.stringify({ error: 'Parâmetros obrigatórios ausentes: priceId, userId, userEmail, isCreditPack.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Define a URL do site para os redirecionamentos do Stripe de forma robusta.
    //    A abordagem recomendada é configurar SITE_URL como um segredo no Supabase.
    //    Como fallback, tentaremos usar o header 'Origin' ou 'Referer' da requisição.
    let siteUrl = Deno.env.get('SITE_URL');
    if (!siteUrl) {
      const origin = req.headers.get('Origin');
      const referer = req.headers.get('Referer');
      
      if (origin) {
        siteUrl = origin;
        console.warn(`Stripe Proxy Aviso: A variável de ambiente SITE_URL não está configurada. Usando o header 'Origin' como fallback: ${siteUrl}.`);
      } else if (referer) {
        // O header Referer contém o caminho completo, então precisamos extrair a origem.
        const refererUrl = new URL(referer);
        siteUrl = refererUrl.origin;
        console.warn(`Stripe Proxy Aviso: A variável de ambiente SITE_URL não está configurada e 'Origin' não foi encontrado. Usando o header 'Referer' como fallback: ${siteUrl}.`);
      } else {
        // Se não houver SITE_URL nem headers, a função não pode continuar.
        console.error("Stripe Proxy Erro Crítico: A variável de ambiente SITE_URL não está configurada e os headers 'Origin' e 'Referer' não foram encontrados na requisição. Não é possível determinar as URLs de redirecionamento do Stripe.");
        throw new Error("A configuração da URL do site (SITE_URL) é necessária para o checkout, mas não foi encontrada. Defina-a nos segredos da sua Edge Function ou garanta que um header de origem ('Origin' ou 'Referer') seja enviado pelo cliente.");
      }
    }

    // 5. Inicializa o cliente Stripe com a chave secreta
    const stripe = new Stripe(stripeSecretKey, {
      // @ts-ignore: Necessário para compatibilidade com o ambiente Deno
      httpClient: Stripe.createFetchHttpClient(),
      apiVersion: '2024-06-20',
    });
    
    // 6. Determina o modo de checkout e prepara metadados para o webhook
    const mode = isCreditPack ? 'payment' : 'subscription';
    const metadata = { userId: userId };

    // 7. Cria a sessão de checkout no Stripe
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

    // 8. Retorna a sessão criada para o frontend
    return new Response(JSON.stringify({ session }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Erro ao criar a sessão de checkout do Stripe:', error);
    // Tenta obter uma mensagem de erro mais específica dos erros do Stripe
    const errorMessage = error.raw?.message || error.message || 'Erro interno do servidor.';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});