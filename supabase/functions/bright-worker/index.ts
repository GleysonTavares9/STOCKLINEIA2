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
    const giminiAiApiKey = Deno.env.get('GIMINI_AI_API_KEY');
    const legacyGeminiApiKey = Deno.env.get('GEMINI_API_KEY');
    let geminiApiKey: string | undefined;

    if (giminiAiApiKey) {
      geminiApiKey = giminiAiApiKey;
    } else if (legacyGeminiApiKey) {
      geminiApiKey = legacyGeminiApiKey;
    }

    if (!geminiApiKey) {
      console.error('Gemini Proxy Error: API key not configured.');
      return new Response(JSON.stringify({ error: 'GIMINI_AI_API_KEY not configured on Supabase Edge Function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Safe JSON parse
    let reqBody: any = {};
    try {
        const text = await req.text();
        reqBody = text ? JSON.parse(text) : {};
    } catch(e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const { prompt } = reqBody;

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
      
    const systemInstruction = `Você é um compositor de músicas profissional. Sua tarefa é gerar letras de música criativas e de alta qualidade.`;
    
    const geminiRequestBody = {
      contents: [{
        parts: [{ text: fullPrompt }]
      }],
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.8,
        topP: 1,
        topK: 32,
        maxOutputTokens: 1024,
      },
    };

    const geminiResponse = await fetch(`${GEMINI_API_BASE_URL}?key=${geminiApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiRequestBody),
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error('Gemini API call failed:', geminiData);
      return new Response(JSON.stringify({ error: 'Gemini API call failed', details: geminiData, status: geminiResponse.status }), {
        status: geminiResponse.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Gemini Proxy Uncaught Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error in Gemini proxy.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});