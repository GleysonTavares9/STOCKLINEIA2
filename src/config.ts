/**
 * ATENÇÃO: Configuração de Chaves de API para Demonstração
 * 
 * Este arquivo contém chaves de API para facilitar a execução do aplicativo
 * em um ambiente de desenvolvimento ou demonstração onde variáveis de ambiente
 * podem não estar configuradas.
 * 
 * !!! NUNCA FAÇA COMMIT DE CHAVES DE API DIRETAMENTE NO CÓDIGO-FONTE EM UM PROJETO REAL/PRODUÇÃO !!!
 * 
 * Em produção, sempre utilize variáveis de ambiente (ex: process.env.GOOGLE_AI_API_KEY)
 * e mecanismos seguros de gerenciamento de segredos para proteger suas credenciais.
 * Expor chaves no código é um risco de segurança grave.
 * 
 * **INSTRUÇÕES SUPABASE:**
 * 1. Vá para o painel do seu projeto Supabase.
 * 2. Navegue até "Project Settings" (ícone de engrenagem) > "API".
 * 3. Encontre a "Project API key" do tipo "anon" (pública).
 * 4. Copie e cole a chave "anon" no campo `supabaseKey` abaixo.
 * 
 * **INSTRUÇÕES STRIPE:**
 * 1. Vá para o painel do seu Stripe Dashboard.
 * 2. Navegue até "Desenvolvedores" > "Chaves de API".
 * 3. Encontre sua "Chave publicável" (geralmente começa com `pk_test_` ou `pk_live_`).
 * 4. Copie e cole a chave no campo `stripePublishableKey` abaixo.
 * 
 * **NÃO USE a chave `service_role` (secreta) do Supabase aqui. Ela é apenas para o backend.**
 * **NÃO USE sua chave secreta do Stripe aqui.**
 */
export const environment = {
  murekaApiKey: 'op_mfsjty5x8ki4FpjGBDz36a9QFsXhtB7',
  supabaseUrl: 'https://mranwpmfdqvuucgppiem.supabase.co',
  supabaseKey: 'sb_publishable_YXbOMuJZzp4z1QAy2ts8Hw_cIlZK59b',
  stripePublishableKey: 'YOUR_STRIPE_PUBLISHABLE_KEY' // Adicione sua chave publicável do Stripe aqui
};