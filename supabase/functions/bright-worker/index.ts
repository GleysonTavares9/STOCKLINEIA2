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
    const geminiApiKey = Deno.env.get('GIMINI_AI_API_KEY') || Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('Gemini Proxy Error: A variável de ambiente GIMINI_AI_API_KEY (ou a antiga GEMINI_API_KEY) não está configurada nos segredos da função.');
      // A mensagem de erro para o cliente padroniza no nome novo para encorajar a migração.
      return new Response(JSON.stringify({ error: 'GIMINI_AI_API_KEY not configured on Supabase Edge Function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // 2. Log para confirmar que a chave foi carregada com sucesso (mostrando apenas os 4 últimos caracteres por segurança).
    console.log('Gemini Proxy: Chave da API Gemini carregada com sucesso (terminando em ...' + geminiApiKey.slice(-4) + ').');


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
      
    const systemInstruction = `Você é um compositor de músicas profissional. Sua tarefa é criar letras poéticas e bem estruturadas.
Você DEVE seguir TODAS as regras de formatação da resposta solicitadas pelo usuário, sem exceções. Sua resposta deve conter APENAS a letra da música.`;

    const requestBody = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
      }
    };

    console.log('Gemini Proxy: Sending request to Gemini via REST API.');
    
    const geminiResponse = await fetch(`${GEMINI_API_BASE_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error(`Gemini Proxy: Gemini API returned error status ${geminiResponse.status}:`, geminiData);
      const errorMessage = geminiData?.error?.message || 'Gemini API call failed';
      return new Response(JSON.stringify({ 
          error: 'Gemini API call failed', 
          status: geminiResponse.status, 
          details: { message: errorMessage, ...geminiData.error }
      }), {
          status: geminiResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const generatedText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof generatedText !== 'string') {
        console.error('Gemini Proxy: No text found in Gemini API response:', geminiData);
        return new Response(JSON.stringify({ error: 'Failed to extract text from Gemini response.' }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify({ text: generatedText }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Gemini Proxy: Uncaught error:', error);
    const errorMessage = error.message || 'Internal server error in Gemini proxy.';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});