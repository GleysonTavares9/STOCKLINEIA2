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
 * **INSTRUÇÕES PARA AMBIENTES DE IMPLANTAÇÃO (Vercel, Netlify, etc.):**
 * Este aplicativo está configurado para ler as chaves de variáveis de ambiente no momento da compilação.
 * Para que a implantação funcione, você DEVE configurar as seguintes variáveis
 * no painel de controle da sua plataforma de hospedagem:
 * ⅚
 * - `MUREKA_API_KEY`: Sua chave secreta da Mureka AI.
 * - `GEMINI_API_KEY`: Sua chave secreta do Google Gemini.
 * - `SUPABASE_URL`: A URL do seu projeto Supabase.
 * - `SUPABASE_ANON_KEY`: A chave anônima (public) do seu projeto Supabase.
 * - `STRIPE_PUBLISHABLE_KEY`: Sua chave publicável (pk_...) do Stripe.
 * 
 * A exposição de MUREKA_API_KEY e GEMINI_API_KEY no frontend é INSEGURA para produção.
 * Para um aplicativo real, mova a lógica que usa essas chaves para um backend seguro,
 * como as Funções Edge do Supabase.
 * 
 */

// Permite o acesso a `process.env` que é preenchido por ferramentas de build (como no Vercel).
// As variáveis de ambiente devem ser definidas nas configurações do seu provedor de hospedagem.
declare var process: any;

export const environment = {
  // ATENÇÃO: As chaves são lidas das variáveis de ambiente. 
  // Os valores abaixo são apenas para fallback e para evitar erros se as variáveis não estiverem definidas.
  murekaApiKey: process.env.MUREKA_API_KEY || 'COLE_SUA_CHAVE_MUREKA_API_AQUI',
  geminiApiKey: process.env.GEMINI_API_KEY || 'COLE_SUA_CHAVE_GEMINI_API_AQUI',
  
  supabaseUrl: process.env.SUPABASE_URL || 'YOUR_SUPABASE_URL',
  supabaseKey: process.env.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY',
  
  // ATENÇÃO: Use APENAS a chave publicável (pk_...), NUNCA a chave secreta (sk_...).
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'COLE_SUA_CHAVE_PUBLICAVEL_AQUI'
};
