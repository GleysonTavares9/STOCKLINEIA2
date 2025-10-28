// Fix: Declare global Deno namespace to satisfy TypeScript for Deno.env.get.
// This workaround is used if the TypeScript environment doesn't natively recognize Deno globals
// or fails to resolve the 'deno.ns' reference library.
declare global {
  namespace Deno {
    namespace env {
      function get(key: string): string | undefined;
    }
  }
}

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Inlined CORS headers to make the function self-contained.
// Adjust 'Access-Control-Allow-Origin' for production to your specific frontend URL, e.g., 'https://your-app.com'.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MUREKA_API_BASE_URL = 'https://api.mureka.ai/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const murekaApiKey = Deno.env.get('MUREKA_API_KEY');

    if (!murekaApiKey) {
      console.error('Mureka Proxy: MUREKA_API_KEY environment variable is not configured.');
      return new Response(JSON.stringify({ error: 'MUREKA_API_KEY not configured on Supabase Edge Function. Please check your Supabase secrets.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Log parcial da chave para depuração sem expor a chave completa
    console.log('Mureka Proxy: Using API Key (last 4 chars):', murekaApiKey.slice(-4));

    // Log the raw incoming request body for debugging
    const rawRequestBody = await req.clone().text();
    console.log('Mureka Proxy: Received raw request body:', rawRequestBody);
    
    let parsedBody;
    try {
        parsedBody = JSON.parse(rawRequestBody);
    } catch (parseError) {
        console.error('Mureka Proxy: Failed to parse incoming request body as JSON:', parseError);
        return new Response(JSON.stringify({ error: 'Invalid JSON in request body.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const { murekaApiPath, method, requestBody, queryParams } = parsedBody;

    console.log('Mureka Proxy: Parsed request for Mureka:', { murekaApiPath, method, requestBody, queryParams });

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

    console.log(`Mureka Proxy: Forwarding ${method} request to Mureka URL: ${murekaUrl}`);
    if (method === 'POST' && requestBody) {
      console.log('Mureka Proxy: Mureka request body (POST):', JSON.stringify(requestBody, null, 2));
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

    console.log('Mureka Proxy: Raw Mureka API response status:', murekaResponse.status);
    const rawMurekaResponseBody = await murekaResponse.text();
    console.log('Mureka Proxy: Raw Mureka API response body:', rawMurekaResponseBody);

    // Check if Mureka API returned a non-OK status
    if (!murekaResponse.ok) {
        let murekaErrorData;
        try {
            murekaErrorData = JSON.parse(rawMurekaResponseBody);
        } catch {
            murekaErrorData = { message: rawMurekaResponseBody || 'Could not parse Mureka API error response or empty body.' };
        }
        console.error(`Mureka Proxy: Mureka API returned error status ${murekaResponse.status}:`, murekaErrorData);
        // Propagate the Mureka API error details and status code back to the client
        return new Response(JSON.stringify({ 
            error: 'Mureka API call failed', 
            status: murekaResponse.status, 
            details: murekaErrorData 
        }), {
            status: murekaResponse.status, // Use the actual status from Mureka
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Fix: Parse the raw response body into a variable and return it.
    const murekaData = JSON.parse(rawMurekaResponseBody); 
    return new Response(JSON.stringify(murekaData), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Mureka Proxy: Uncaught error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error in Mureka proxy.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});