// Fix: Declare global Deno namespace to satisfy TypeScript for Deno.env.get.
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

    console.log('Mureka Proxy: Using API Key (last 4 chars):', murekaApiKey.slice(-4));
    
    const parsedBody = await req.json();
    const { murekaApiPath, method, requestBody, queryParams, isFileUpload } = parsedBody;

    if (!murekaApiPath || !method) {
        return new Response(JSON.stringify({ error: 'Missing murekaApiPath or method in request body for Mureka proxy.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const headers: HeadersInit = {
      'Authorization': `Bearer ${murekaApiKey}`,
    };
    
    let body: BodyInit | undefined = undefined;

    if (method === 'POST' && requestBody) {
      if (isFileUpload) {
          console.log('Mureka Proxy: Handling file upload (multipart/form-data).');
          const { fileContent, fileName, fileType, purpose } = requestBody;
          
          if (!purpose) {
            return new Response(JSON.stringify({ error: 'Missing purpose for file upload in requestBody.' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          const binaryString = atob(fileContent);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: fileType });
          
          const formData = new FormData();
          formData.append('file', blob, fileName);
          formData.append('purpose', purpose);
          body = formData;
      } else {
          console.log('Mureka Proxy: Handling JSON POST request.');
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(requestBody);
      }
    } else {
      console.log('Mureka Proxy: Handling GET or non-body request.');
    }

    let murekaUrl = `${MUREKA_API_BASE_URL}/${murekaApiPath}`;
    if (queryParams) {
        const params = new URLSearchParams(queryParams);
        murekaUrl += `?${params.toString()}`;
    }

    console.log(`Mureka Proxy: Forwarding ${method} request to Mureka URL: ${murekaUrl}`);
    if (body && typeof body === 'string') {
      console.log('Mureka Proxy: Mureka request body:', body);
    }
    
    const murekaResponse = await fetch(murekaUrl, {
        method,
        headers,
        body,
    });

    console.log('Mureka Proxy: Raw Mureka API response status:', murekaResponse.status);
    const rawMurekaResponseBody = await murekaResponse.text();
    console.log('Mureka Proxy: Raw Mureka API response body:', rawMurekaResponseBody);

    if (!murekaResponse.ok) {
        let murekaErrorData;
        try {
            murekaErrorData = JSON.parse(rawMurekaResponseBody);
        } catch {
            murekaErrorData = { message: rawMurekaResponseBody || 'Could not parse Mureka API error response or empty body.' };
        }
        console.error(`Mureka Proxy: Mureka API returned error status ${murekaResponse.status}:`, murekaErrorData);
        return new Response(JSON.stringify({ 
            error: 'Mureka API call failed', 
            status: murekaResponse.status, 
            details: murekaErrorData 
        }), {
            status: murekaResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

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
