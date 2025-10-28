// Fix: Removed Supabase functions type reference.
// The types were not being used in this function and the reference was causing a build error.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

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

    const { prompt } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing or invalid "prompt" in request body.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Reconstruct the full prompt and system instruction from the original GeminiService
    const fullPrompt = `Gere uma letra de música baseada na seguinte ideia: "${prompt}".

REGRAS ESTRITAS DE FORMATAÇÃO DA RESPOSTA:
1.  **NÃO** inclua um título.
2.  **NÃO** inclua marcadores de seção como "[Verso 1]", "[Refrão]", etc.
3.  **NÃO** inclua introduções, explicações ou qualquer texto que não seja parte da letra da música.
4.  Responda APENAS com o texto bruto da letra.`;

    const systemInstruction = `Você é um compositor de músicas profissional. Sua tarefa é criar letras poéticas e bem estruturadas.
Você DEVE seguir TODAS as regras de formatação da resposta solicitadas pelo usuário, sem exceções. Sua resposta deve conter APENAS a letra da música.`;

    const geminiRequestBody = {
      contents: [{ parts: [{ text: fullPrompt }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: 0.7,
        topP: 0.95,
      },
    };
    
    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequestBody),
    });

    if (!geminiResponse.ok) {
        const errorBody = await geminiResponse.json();
        console.error('Gemini API Error:', errorBody);
        return new Response(JSON.stringify({ error: 'Gemini API call failed', details: errorBody }), {
            status: geminiResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const responseData = await geminiResponse.json();
    const generatedText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (typeof generatedText !== 'string') {
        console.error('Gemini Proxy: No text found in Gemini API response:', responseData);
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
    return new Response(JSON.stringify({ error: error.message || 'Internal server error in Gemini proxy.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
