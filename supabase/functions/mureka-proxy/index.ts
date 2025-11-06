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

// This URL remains pointed at the underlying service provider.
const API_BASE_URL = 'https://api.mureka.ai/v1';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const stocklineAiApiKey = Deno.env.get('STOCKLINE_AI_API_KEY');

    if (!stocklineAiApiKey) {
      console.error('STOCKLINE AI Proxy: STOCKLINE_AI_API_KEY environment variable is not configured.');
      return new Response(JSON.stringify({ error: 'STOCKLINE_AI_API_KEY not configured on Supabase Edge Function. Please check your Supabase secrets.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('STOCKLINE AI Proxy: Using API Key (last 4 chars):', stocklineAiApiKey.slice(-4));
    
    const parsedBody = await req.json();
    const { apiPath, method, requestBody, queryParams, isFileUpload } = parsedBody;

    if (!apiPath || !method) {
        return new Response(JSON.stringify({ error: 'Missing apiPath or method in request body for STOCKLINE AI proxy.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const headers: HeadersInit = {
      'Authorization': `Bearer ${stocklineAiApiKey}`,
    };
    
    let body: BodyInit | undefined = undefined;

    if (method === 'POST' && requestBody) {
      if (isFileUpload) {
          console.log('STOCKLINE AI Proxy: Handling file upload (multipart/form-data).');
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
          console.log('STOCKLINE AI Proxy: Handling JSON POST request.');
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(requestBody);
      }
    } else {
      console.log('STOCKLINE AI Proxy: Handling GET or non-body request.');
    }

    let apiUrl = `${API_BASE_URL}/${apiPath}`;
    if (queryParams) {
        const params = new URLSearchParams(queryParams);
        apiUrl += `?${params.toString()}`;
    }

    console.log(`STOCKLINE AI Proxy: Forwarding ${method} request to URL: ${apiUrl}`);
    if (body && typeof body === 'string') {
      console.log('STOCKLINE AI Proxy: Request body:', body);
    }
    
    const apiResponse = await fetch(apiUrl, {
        method,
        headers,
        body,
    });

    console.log('STOCKLINE AI Proxy: Raw API response status:', apiResponse.status);
    const rawApiResponseBody = await apiResponse.text();
    console.log('STOCKLINE AI Proxy: Raw API response body:', rawApiResponseBody);

    if (!apiResponse.ok) {
        let apiErrorData;
        try {
            apiErrorData = JSON.parse(rawApiResponseBody);
        } catch {
            apiErrorData = { message: rawApiResponseBody || 'Could not parse API error response or empty body.' };
        }
        console.error(`STOCKLINE AI Proxy: API returned error status ${apiResponse.status}:`, apiErrorData);
        return new Response(JSON.stringify({ 
            error: 'AI API call failed', 
            status: apiResponse.status, 
            details: apiErrorData 
        }), {
            status: apiResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Safely parse the JSON body, handling cases where the response might be empty.
    // This prevents the function from crashing on a successful (2xx) but empty response.
    let apiData = {};
    if (rawApiResponseBody.trim()) {
      try {
        apiData = JSON.parse(rawApiResponseBody);
      } catch (e) {
        console.error('STOCKLINE AI Proxy: Failed to parse successful API response:', e.message);
        // This is a server-side issue: the proxy's contract with the API is broken.
        return new Response(JSON.stringify({ 
          error: 'The AI API returned a malformed successful response.', 
          details: rawApiResponseBody 
        }), {
          status: 502, // Bad Gateway, as the upstream response was invalid
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(apiData), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('STOCKLINE AI Proxy: Uncaught error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error in the AI proxy.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
