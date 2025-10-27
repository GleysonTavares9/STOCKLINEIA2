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
 * **ATENÇÃO ESPECIAL: CHAVE_API_MUREKA e CHAVE_API_GIMINI_AI**
 * 
 * A `CHAVE_API_MUREKA` e `CHAVE_API_GIMINI_AI` são **CHAVES SECRETAS DE BACKEND**. Incluí-las diretamente no frontend
 * (como feito AGORA para permitir testes locais) é uma **ENORME VULNERABILIDADE DE SEGURANÇA**.
 * 
 * Qualquer pessoa que inspecionar o código do seu navegador poderá ver e roubar estas chaves.
 * Se isso acontecer, suas chaves podem ser usadas indevidamente, gerando custos significativos
 * em sua conta Mureka e Gemini AI sem sua autorização.
 * 
 * A implementação correta para produção seria usar variáveis de ambiente injetadas no build do frontend
 * (como `process.env.CHAVE_API_GIMINI_AI`), ou um proxy de backend (Edge Function) para chaves verdadeiramente secretas.
 * 
 * POR FAVOR, REMOVA OS VALORES HARDCODIFICADOS E USE VARIÁVEIS DE AMBIENTE ANTES DE IMPLANTAR EM PRODUÇÃO!
 * 
 * --------------------------------------------------------------------------
 * 
 * **INSTRUÇÕES DE CONFIGURAÇÃO (para produção):**
 * 
 * Para que a implantação funcione, você DEVE configurar as seguintes variáveis
 * no painel de controle da sua plataforma de hospedagem (Vercel, AI Studio, etc.) com os nomes exatos:
 * 
 *    - `CHAVE_API_GIMINI_AI`: Sua chave secreta do Google Gemini.
 *    - `PRÓXIMO_URL_PÚBLICO_SUPABASE`: A URL do seu projeto Supabase.
 *    - `PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY`: A chave anônima (public) do seu projeto Supabase.
 *    - `PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA`: Sua chave publicável (pk_...) do Stripe.
 *    - `CHAVE_API_MUREKA`: Sua chave da API Mureka.
 * 
 */

// Permite o acesso a `process.env` que é preenchido por ferramentas de build (como no Vercel).
// As variáveis de ambiente devem ser definidas nas configurações do seu provedor de hospedagem.
declare var process: any;

export const environment = {
  // Chave para a API Gemini (usada no frontend)
  // 🚨 ATENÇÃO: VALOR HARDCODIFICADO PARA TESTES LOCAIS. REMOVA PARA PRODUÇÃO!
  geminiApiKey: 'AIzaSyBZSr0vt6EJgMW728oRCqM-GWwRu_LDJwc', // process.env.CHAVE_API_GIMINI_AI

  // URL e chave anônima (public) do seu projeto Supabase
  // 🚨 ATENÇÃO: VALORES HARDCODIFICADOS PARA TESTES LOCAIS. REMOVA PARA PRODUÇÃO!
  supabaseUrl: 'https://mranwpmfdqvuucgppiem.supabase.co', // process.env.PRÓXIMO_URL_PÚBLICO_SUPABASE
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yYW53cG1mZHF2dXVjZ3BwaWVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwNTI3NzcsImV4cCI6MjA3NTYyODc3N30.iOkY-UiQO4NfSCUnw5is8TSTygNysqdWQXRRqixiwfU', // process.env.PRÓXIMA_CHAVE_PÚBLICA_SUPABASE_ANON_KEY

  // ATENÇÃO: Use APENAS a chave publicável (pk_...), NUNCA a chave secreta (sk_...).
  // 🚨 ATENÇÃO: VALOR HARDCODIFICADO PARA TESTES LOCAIS. REMOVA PARA PRODUÇÃO!
  stripePublishableKey: 'pk_live_51S4aLDEaMssn2zemC0j9pNmfK967EvroR3FPkKBN1bHj5fBoTirHQ4BHFgW3D8NHm2Uz93grf5gySr5ak4acXVUA009EyYRMXP', // process.env.PRÓXIMA_CHAVE_PUBLICÁVEL_DA_FAIXA_PÚBLICA

  // --------------------------------------------------------------------------
  // 🚨🚨🚨 ATENÇÃO: CHAVE_API_MUREKA AGORA É EXPOSTA NO FRONTEND. 🚨🚨🚨
  // ESTA É UMA CHAVE SECRETA E NÃO DEVERIA ESTAR AQUI EM PRODUÇÃO.
  // ISSO CRIA UM RISCO DE SEGURANÇA SIGNIFICATIVO.
  // 🚨 ATENÇÃO: VALOR HARDCODIFICADO PARA TESTES LOCAIS. REMOVA PARA PRODUÇÃO!
  // --------------------------------------------------------------------------
  murekaApiKey: 'op_mfsjty5x8ki4FpjGBDz36a9QFsXhtB7', // process.env.CHAVE_API_MUREKA
};