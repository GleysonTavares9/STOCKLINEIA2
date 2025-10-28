

// Fix: Adiciona a declaração do namespace global Deno para compatibilidade com o TypeScript
declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }
  }
}

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
// #region Fix: Refatorado para usar o SDK oficial do Google GenAI para maior robustez e manutenibilidade.
import { GoogleGenAI } from "npm:@google/genai@^1.27.0";
// #endregion

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      console.error('Gemini Proxy: GEMINI_API_KEY not configured.');
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured on Supabase Edge Function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Gemini Proxy: Using API Key (last 4 chars):', geminiApiKey.slice(-4));

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
    
    // #region Fix: Utiliza o SDK do GenAI em vez de uma chamada fetch manual.
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });

    console.log('Gemini Proxy: Sending request to Gemini via SDK.');

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: fullPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        topP: 0.95,
      },
    });

    const generatedText = response.text;
    // #endregion

    if (typeof generatedText !== 'string') {
        console.error('Gemini Proxy: No text found in Gemini API SDK response:', response);
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
    // #region Fix: Melhora o tratamento de erro para incluir a mensagem do erro da API
    const errorMessage = error.message || 'Internal server error in Gemini proxy.';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    // #endregion
  }
});