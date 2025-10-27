/**
 * 
 * 🚨 ALERTA DE SEGURANÇA CRÍTICO - LEIA COM ATENÇÃO 🚨
 * 
 * Este arquivo contém configurações para chaves de API. É VITAL que você
 * entenda a diferença entre chaves publicáveis e chaves secretas.
 * 
 * !!! NUNCA, EM HIPÓTESE ALGUMA, COLOQUE UMA CHAVE SECRETA (que começa com 'sk_...') NESTE ARQUIVO
 *     PARA IMPLANTAÇÃO EM PRODUÇÃO!!!
 * 
 * Expor uma chave secreta no código do frontend é o mesmo que compartilhar a senha da sua conta.
 * Qualquer pessoa poderá usá-la para realizar cobranças e reembolsos em seu nome.
 * Se você acidentalmente expôs uma chave secreta, REVOGUE-A IMEDIATAMENTE no seu painel.
 * 
 * --------------------------------------------------------------------------
 * 
 * **ATENÇÃO ESPECIAL: CHAVE_API_MUREKA (MUREKA_API_KEY)**
 * 
 * A `MUREKA_API_KEY` é uma **CHAVE SECRETA DE BACKEND**. Ela NÃO DEVE mais ser incluída diretamente no frontend.
 * A comunicação com a API da Mureka agora é feita através de uma Edge Function do Supabase (mureka-proxy),
 * o que é a prática recomendada de segurança para proteger sua chave.
 * 
 * Você DEVE configurar a variável de ambiente `MUREKA_API_KEY` diretamente na sua Edge Function `mureka-proxy`
 * no painel do Supabase.
 * 
 * --------------------------------------------------------------------------
 * 
 * **INSTRUÇÕES DE CONFIGURAÇÃO:**
 * 
 * Este arquivo tenta ler as variáveis de ambiente (`process.env.*`) do seu ambiente de build
 * (como no AI Studio, Vercel, etc.) ou, se não estiverem definidas, usará os placeholders.
 * 
 * PARA PRODUÇÃO (AI Studio, Vercel, etc.):
 * Configure as seguintes variáveis de ambiente no painel da sua plataforma de hospedagem com os NOMES RECOMENDADOS (em inglês)
 * ou os nomes em português caso já os esteja utilizando. Os nomes em inglês terão prioridade se ambos existirem:
 * 
 *    - `GEMINI_API_KEY` (ou `CHAVE_API_GIMINI_AI`): Sua chave secreta do Google Gemini.
 *    - `SUPABASE_URL` (ou `PRÓXIMO_URL_PÚBLICO_SUPABASE`): A URL do seu projeto Supabase (ex: `https://abcdefg.supabase.co`).
 *    - `SUPABASE_ANON_KEY` (ou `PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY`): A chave anônima (public) do seu projeto Supabase.
 *    - `STRIPE_PUBLISHABLE_KEY` (ou `PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA`): Sua chave publicável (pk_...) do Stripe.
 *    - `MUREKA_API_KEY`: Sua chave da API Mureka (para a Edge Function `mureka-proxy` no Supabase).
 * 
 * PARA DESENVOLVIMENTO LOCAL:
 * Se você não está usando um sistema que injeta `process.env` (ou se suas variáveis de ambiente não estão configuradas localmente),
 * você DEVE substituir os placeholders ('YOUR_...') abaixo pelos seus valores REAIS para que a aplicação funcione.
 * 
 */

// Permite o acesso a `process.env` que é preenchido por ferramentas de build (como no Vercel).
// As variáveis de ambiente devem ser definidas nas configurações do seu provedor de hospedagem.
declare var process: any;

// Helper function to safely access process.env with multiple fallback names
const getEnvVar = (names: string[], defaultValue: string): string => {
  if (typeof process !== 'undefined' && process.env) {
    for (const name of names) {
      if (typeof process.env[name] === 'string' && process.env[name].trim() !== '') {
        return process.env[name];
      }
    }
  }
  return defaultValue;
};

export const environment = {
  // Chave para a API Gemini (usada no frontend)
  geminiApiKey: getEnvVar(['GEMINI_API_KEY', 'CHAVE_API_GIMINI_AI'], 'YOUR_GEMINI_API_KEY'),

  // URL e chave anônima (public) do seu projeto Supabase
  // Substitua 'https://mranwpmfdqvuucgppiem.supabase.co' e a chave pelos SEUS valores reais para desenvolvimento local.
  supabaseUrl: getEnvVar(['SUPABASE_URL', 'PRÓXIMO_URL_PÚBLICO_SUPABASE'], 'https://mranwpmfdqvuucgppiem.supabase.co'),
  supabaseKey: getEnvVar(['SUPABASE_ANON_KEY', 'PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY'], 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yYW53cG1mZHF2dXVjZ3BwaWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNTI3NzcsImV4cCI6MjA3NTYyODc3N30.iOkY-UiQO4NfSCUnw5is8TSTygNysqdWQXRRqixiwfU'),

  // Chave publicável do Stripe (pk_...) - NUNCA a chave secreta (sk_...).
  // FIX: Added a default Stripe test key to prevent configuration errors in development.
  // This is a public test key and is safe to use. Replace it with your actual publishable key in production.
  stripePublishableKey: getEnvVar(['STRIPE_PUBLISHABLE_KEY', 'PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA'], 'pk_test_TYooMQauvdEDq54NiTphI7jx'),

  // --------------------------------------------------------------------------
  // 🚨🚨🚨 NOTA: A CHAVE_API_MUREKA AGORA É MANIPULADA EXCLUSIVAMENTE NO BACKEND. 🚨🚨🚨
  // Não é mais exposta diretamente no frontend. A comunicação com a Mureka API
  // é feita através de uma Edge Function do Supabase, o que é a prática recomendada de segurança.
  // Você DEVE configurar a variável de ambiente `MUREKA_API_KEY` na sua Edge Function `mureka-proxy`
  // no painel do Supabase.
  // --------------------------------------------------------------------------
};