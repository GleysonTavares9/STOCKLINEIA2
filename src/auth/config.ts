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
 * **ATENÇÃO ESPECIAL: CHAVES DE API SECRETAS (MUREKA & GEMINI)**
 * 
 * As chaves `MUREKA_API_KEY` e `GEMINI_API_KEY` são **CHAVES SECRETAS DE BACKEND**. Elas NÃO DEVEM
 * ser incluídas diretamente no frontend. A comunicação com essas APIs agora é feita através de 
 * Edge Functions do Supabase (`mureka-proxy`, `gemini-proxy`), que é a prática recomendada de 
 * segurança para proteger suas chaves.
 * 
 * Você DEVE configurar as seguintes variáveis de ambiente diretamente nas suas Edge Functions
 * no painel do Supabase:
 *  - `MUREKA_API_KEY`: Na Edge Function `mureka-proxy`.
 *  - `GEMINI_API_KEY`: Na Edge Function `gemini-proxy`.
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
 *    - `SUPABASE_URL` (ou `PRÓXIMO_URL_PÚBLICO_SUPABASE`): A URL do seu projeto Supabase (ex: `https://abcdefg.supabase.co`).
 *    - `SUPABASE_ANON_KEY` (ou `PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY`): A chave anônima (public) do seu projeto Supabase.
 *    - `STRIPE_PUBLISHABLE_KEY` (ou `PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA`): Sua chave publicável (pk_...) do Stripe.
 *    - `MUREKA_API_KEY`: Sua chave da API Mureka (para a Edge Function `mureka-proxy` no Supabase).
 *    - `GEMINI_API_KEY`: Sua chave da API Gemini (para a Edge Function `gemini-proxy` no Supabase).
 * 
 * PARA DESENVOLvimento LOCAL:
 * Se você não está usando um sistema que injeta `process.env` (ou se suas variáveis de ambiente não estão configuradas localmente),
 * você DEVE substituir os placeholders ('YOUR_...') abaixo pelos seus valores REAIS para que a aplicação funcione.
 *
 * ATUALIZAÇÃO: As credenciais do seu projeto Supabase foram preenchidas com base nas informações fornecidas.
 * A chave anônima (supabaseKey) é um valor de exemplo e DEVE ser substituída pela sua chave real.
 * A chave do Stripe também é um exemplo.
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
        console.log(`Config: Using environment variable for ${name}: ${process.env[name].substring(0, 5)}...`);
        return process.env[name];
      }
    }
  }
  console.warn(`Config: Environment variable not found for names: ${names.join(', ')}. Using default value (first 5 chars): ${defaultValue.substring(0, 5)}...`);
  return defaultValue;
};

export const environment = {
  // Chave para a API Gemini (usada no frontend)
  // 🚨 REMOVIDO: A chave da API do Gemini agora é gerenciada com segurança no backend pela Edge Function `gemini-proxy`.

  // URL e chave anônima (public) do seu projeto Supabase
  // A URL foi preenchida com base no seu projeto. A chave anônima abaixo é um EXEMPLO e DEVE ser substituída.
  supabaseUrl: getEnvVar(['SUPABASE_URL', 'PRÓXIMO_URL_PÚBLICO_SUPABASE'], 'https://mranwpmfdqvuucgppiem.supabase.co'),
  supabaseKey: getEnvVar(['SUPABASE_ANON_KEY', 'PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY'], 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yYW53cG1mZHF2dXVjZ3BwaWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNTI3NzcsImV4cCI6MjA3NTYyODc3N30.iOkY-UiQO4NfSCUnw5is8TSTygNysqdWQXRRqixiwfU'),

  // Chave publicável do Stripe (pk_...) - NUNCA a chave secreta (sk_...).
  // Substitua este VALOR DE EXEMPLO pela sua chave publicável real do Stripe (começa com pk_...).
  stripePublishableKey: getEnvVar(['STRIPE_PUBLISHABLE_KEY', 'PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA'], 'pk_test_51FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEDUMMY'),

  // --------------------------------------------------------------------------
  // 🚨🚨🚨 NOTA: A CHAVE_API_MUREKA AGORA É MANIPULADA EXCLUSIVAMENTE NO BACKEND. 🚨🚨🚨
  // Não é mais exposta diretamente no frontend. A comunicação com a Mureka API
  // é feita através de uma Edge Function do Supabase, o que é a prática recomendada de segurança.
  // Você DEVE configurar a variável de ambiente `MUREKA_API_KEY` na sua Edge Function `mureka-proxy`
  // no painel do Supabase.
  // --------------------------------------------------------------------------
};