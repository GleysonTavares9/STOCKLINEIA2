/**
 * 
 * 🚨 ALERTA DE SEGURANÇA CRÍTICO - LEIA COM ATENÇÃO 🚨
 * 
 * Este arquivo contém configurações para chaves de API. É VITAL que você
 * entenda a diferença entre chaves publicáveis e chaves secretas.
 * 
 * !!! NUNCA, EM HIPÓTESE ALGUMA, COLOQUE UMA CHAVE SECRETA (que começa com 'sk_...') NESTE ARQUIVO !!!
 * 
 * Expor uma chave secreta no código do frontend é o mesmo que compartilhar a senha da sua conta.
 * Qualquer pessoa poderá usá-la para realizar cobranças e reembolsos em seu nome.
 * Se você acidentalmente expôs uma chave secreta, REVOGUE-A IMEDIATAMENTE no seu painel Stripe.
 * 
 * --------------------------------------------------------------------------
 * 
 * **INSTRUÇÕES SUPABASE:**
 * 1. Vá para o painel do seu projeto Supabase > "Project Settings" > "API".
 * 2. Copie a "Project URL" e a "Project API key" (anon).
 * 3. Cole-as nos campos `supabaseUrl` e `supabaseKey` abaixo.
 * 
 * **INSTRUÇÕES STRIPE (ESSENCIAL):**
 * 1. Vá para o seu Painel Stripe: https://dashboard.stripe.com/apikeys
 * 2. Encontre sua "Chave publicável". Ela SEMPRE começa com `pk_test_` ou `pk_live_`.
 * 3. Copie a chave publicável e cole-a no campo `stripePublishableKey` abaixo.
 * 
 * **INSTRUÇÕES MUREKA & GEMINI (PARA DESENVOLVIMENTO):**
 * Para fazer o aplicativo funcionar sem um backend, você precisará adicionar suas chaves de API aqui.
 * Lembre-se: Isso é INSEGURO para produção. Para um aplicativo real, você deve criar um backend
 * (como Funções Supabase Edge) para proteger essas chaves.
 * 1. Obtenha sua chave de API da Mureka e cole-a em `murekaApiKey`.
 * 2. Obtenha sua chave de API do Google Gemini e cole-a em `geminiApiKey`.
 * 
 */
export const environment = {
  // ATENÇÃO: Adicionar chaves aqui é apenas para desenvolvimento e é INSEGURO para produção.
  murekaApiKey: 'COLE_SUA_CHAVE_MUREKA_API_AQUI',
  geminiApiKey: 'COLE_SUA_CHAVE_GEMINI_API_AQUI',
  
  supabaseUrl: 'YOUR_SUPABASE_URL',
  supabaseKey: 'YOUR_SUPABASE_ANON_KEY',
  
  // !!! AÇÃO NECESSÁRIA: Substitua o valor abaixo pela sua chave publicável REAL do Stripe. !!!
  // O valor atual é um exemplo para remover a mensagem de erro, mas não funcionará para pagamentos reais.
  // 
  // 1. Vá para o seu Painel Stripe: https://dashboard.stripe.com/apikeys
  // 2. Copie sua "Chave publicável" (ex: pk_test_51... ou pk_live_...).
  // 3. Cole a chave completa aqui, substituindo todo o texto entre as aspas.
  //
  // ATENÇÃO: Use APENAS a chave publicável (pk_...), NUNCA a chave secreta (sk_...).
  //
  stripePublishableKey: 'COLE_SUA_CHAVE_PUBLICAVEL_AQUI' // <-- SUBSTITUA PELA SUA CHAVE PUBLICÁVEL (pk_...). NUNCA a chave secreta (sk_...).
};