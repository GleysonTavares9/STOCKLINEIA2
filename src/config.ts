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
 * **NÃO USE a chave `service_role` (secreta) aqui. Ela é apenas para o backend.**
 */
export const environment = {
  murekaApiKey: 'op_mfsjty5x8ki4FpjGBDz36a9QFsXhtB7',
  supabaseUrl: 'https://mranwpmfdqvuucgppiem.supabase.co',
  // A chave anterior era a chave secreta (service_role), o que é um risco de segurança.
  // Substitua o placeholder abaixo pela sua chave PÚBLICA (anon) do Supabase.
  supabaseKey: 'sb_publishable_YXbOMuJZzp4z1QAy2ts8Hw_cIlZK59b'
};