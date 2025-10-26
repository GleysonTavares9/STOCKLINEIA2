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
 * 
 * - `GEMINI_API_KEY`: Sua chave secreta do Google Gemini.
 * - `SUPABASE_URL`: A URL do seu projeto Supabase.
 * - `SUPABASE_ANON_KEY`: A chave anônima (public) do seu projeto Supabase.
 * - `STRIPE_PUBLISHABLE_KEY`: Sua chave publicável (pk_...) do Stripe.
 * 
 * **PARA A FUNÇÃO DE BACKEND (SUPABASE EDGE FUNCTION):**
 * A chave da Mureka agora é usada com segurança no backend. Você precisa configurá-la como um "secret" no seu projeto Supabase:
 * - `MUREKA_API_KEY`: Sua chave secreta da Mureka AI. (Execute `supabase secrets set MUREKA_API_KEY sua_chave_aqui`)
 * 
 */

// Permite o acesso a `process.env` que é preenchido por ferramentas de build (como no Vercel).
// As variáveis de ambiente devem ser definidas nas configurações do seu provedor de hospedagem.
declare var process: any;

export const environment = {
  // ATENÇÃO: A chave da Mureka foi movida para uma Função Edge segura no Supabase.
  // Você deve configurar MUREKA_API_KEY como um segredo nas configurações da sua função.
  geminiApiKey: process.env.GEMINI_API_KEY || 'AIzaSyAdZIGbJf7u-nbFfXzxwtkfdzhi6MMe2bU',
  
  supabaseUrl: process.env.SUPABASE_URL || 'https://mranwpmfdqvuucgppiem.supabase.co',
  supabaseKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yYW53cG1mZHF2dXVjZ3BwaWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNTI3NzcsImV4cCI6MjA3NTYyODc3N30.iOkY-UiQO4NfSCUnw5is8TSTygNysqdWQXRRqixiwfU',
  
  // ATENÇÃO: Use APENAS a chave publicável (pk_...), NUNCA a chave secreta (sk_...).
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_live_51S4aLDEaMssn2zemC0j9pNmfK967EvroR3FPkKBN1bHj5fBoTirHQ4BHFgW3D8NHm2Uz93grf5gySr5ak4acXVUA009EyYRMXP'
};