// FIX: The original type reference was incorrect and did not provide Deno runtime types.
// It has been removed and replaced with a minimal Deno global declaration to resolve type errors.
declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
};

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
    // 1. Get all required variables and headers, and validate them upfront.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const murekaApiKey = Deno.env.get('MUREKA_API_KEY');
    const authorization = req.headers.get('Authorization');

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error('SUPABASE_URL or SUPABASE_ANON_KEY environment variable not set on the server.');
      return new Response(JSON.stringify({ error: 'Supabase environment variables not configured on the server.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!murekaApiKey) {
      console.error('MUREKA_API_KEY environment variable not set');
      return new Response(JSON.stringify({ error: 'Mureka API key not configured on the server.' }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (!authorization) {
      return new Response(JSON.stringify({ error: 'Authorization header is missing' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 2. Create a Supabase client with the user's auth token.
    const supabaseClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      { global: { headers: { Authorization: authorization } } }
    );

    // 3. Verify that the user is authenticated.
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // 4. Forward the request to the actual Mureka API.
    const url = new URL(req.url);
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
