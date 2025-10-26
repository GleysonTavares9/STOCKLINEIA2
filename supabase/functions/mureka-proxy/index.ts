// FIX: The Deno type reference URL is now version-pinned to prevent breakages from CDN changes.
/// <reference types="https://esm.sh/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MUREKA_API_URL = 'https://api.mureka.ai/v1';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // For production, you should lock this to your app's URL.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

serve(async (req) => {
  // This is needed for CORS preflight requests.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    // 1. Create a Supabase client with the user's auth token.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    // 2. Verify that the user is authenticated.
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 3. Get the Mureka API Key from Supabase secrets.
    const murekaApiKey = Deno.env.get('MUREKA_API_KEY');
    if (!murekaApiKey) {
      console.error('MUREKA_API_KEY environment variable not set');
      return new Response(JSON.stringify({ error: 'Mureka API key not configured on the server.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 4. Forward the request to the actual Mureka API.
    const url = new URL(req.url);
    // Correctly strip the Supabase function path to get the target Mureka path.
    const proxyPathRegex = /^\/functions\/v1\/mureka-proxy/;
    const murekaPath = url.pathname.replace(proxyPathRegex, '');
    const targetUrl = `${MUREKA_API_URL}${murekaPath}${url.search}`;

    const murekaHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${murekaApiKey}`,
    };
    
    const murekaResponse = await fetch(targetUrl, {
        method: req.method,
        headers: murekaHeaders,
        body: req.method === 'POST' || req.method === 'PUT' ? req.body : null,
    });
    
    // 5. Return Mureka's response back to the client application.
    const responseData = await murekaResponse.text();

    // Copy headers from Mureka response, but add CORS headers
    const responseHeaders = new Headers(murekaResponse.headers);
    Object.entries(CORS_HEADERS).forEach(([key, value]) => {
      responseHeaders.set(key, value);
    });

    return new Response(responseData, {
      status: murekaResponse.status,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Error in Mureka proxy function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
