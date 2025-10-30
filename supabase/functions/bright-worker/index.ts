// Fix: Adiciona a declaração do namespace global Deno para compatibilidade com o TypeScript
declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }
  }
}

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Busca a chave da API Gemini de forma segura a partir dos segredos da Edge Function.
    //    Tenta usar o nome novo ('GIMINI_AI_API_KEY') e, como fallback, o nome antigo ('GEMINI_API_KEY')
    //    para garantir retrocompatibilidade com configurações de ambiente antigas.
    const giminiAiApiKey = Deno.env.get('GIMINI_AI_API_KEY');
    const legacyGeminiApiKey = Deno.env.get('GEMINI_API_KEY');
    let geminiApiKey: string | undefined;
    let apiKeyNameUsed: string;

    if (giminiAiApiKey) {
      geminiApiKey = giminiAiApiKey;
      apiKeyNameUsed = 'GIMINI_AI_API_KEY';
    } else if (legacyGeminiApiKey) {
      geminiApiKey = legacyGeminiApiKey;
      apiKeyNameUsed = 'GEMINI_API_KEY (legacy fallback)';
      console.warn('Gemini Proxy Warning: Using legacy environment variable GEMINI_API_KEY. Please update to GIMINI_AI_API_KEY.');
    }

    if (!geminiApiKey) {
      console.error('Gemini Proxy Error: A variável de ambiente GIMINI_AI_API_KEY (ou a antiga GEMINI_API_KEY) não está configurada nos segredos da função.');
      // A mensagem de erro para o cliente padroniza no nome novo para encorajar a migração.
      return new Response(JSON.stringify({ error: 'GIMINI_AI_API_KEY not configured on Supabase Edge Function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 2. Log para confirmar que a chave foi carregada com sucesso (mostrando apenas os 4 últimos caracteres por segurança).
    console.log(`Gemini Proxy: Chave da API Gemini '${apiKeyNameUsed}' carregada com sucesso (terminando em ...${geminiApiKey.slice(-4)}).`);


    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid "prompt" in request body.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fullPrompt = `Gere uma letra de música baseada na seguinte ideia: "${prompt}".

REGRAS ESTRITAS DE FORMATAÇÃO DA RESPOSTA:
1.  **NÃO** inclua um título.
2.  **NÃO** inclua marcadores de seção como "[Verso 1]", "[Refrão]", etc.
3.  **NÃO** inclua introduções, explicações ou qualquer texto que não seja parte da letra da música.
4.  Responda APENAS com o texto bruto da letra.`;
      
    const systemInstruction = `Você é um compositor de músicas profissional. Sua tarefa é`;