// Removed `/// <reference lib="deno.ns" />` as it was causing a type definition error.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

const MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Fixed: Added type assertion `(Deno as any)` to resolve `Cannot find name 'Deno'` error.
    const murekaApiKey = (Deno as any).env.get('MUREKA_API_KEY');

    if (!murekaApiKey) {
      return new Response(JSON.stringify({ error: 'MUREKA_API_KEY not configured on Supabase Edge Function.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Espera que o corpo da requisição da Edge Function contenha os detalhes para a API Mureka
    const { murekaApiPath, method, requestBody, queryParams } = await req.json();

    if (!murekaApiPath || !method) {
        return new Response(JSON.stringify({ error: 'Missing murekaApiPath or method in request body for Mureka proxy.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${murekaApiKey}`,
    };

    let murekaUrl = `${MUREKA_API_BASE_URL}/${murekaApiPath}`;
    if (queryParams) {
        const params = new URLSearchParams(queryParams);
        murekaUrl += `?${params.toString()}`;
    }

    let murekaResponse: Response;

    if (method === 'POST') {
      murekaResponse = await fetch(murekaUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    } else if (method === 'GET') {
      murekaResponse = await fetch(murekaUrl, {
        method: 'GET',
        headers,
      });
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported method for Mureka API via proxy.' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const murekaData = await murekaResponse.json();

    return new Response(JSON.stringify(murekaData), {
      status: murekaResponse.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in Mureka proxy:', error.message);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error in Mureka proxy.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});