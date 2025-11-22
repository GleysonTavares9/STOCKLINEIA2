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
  // Handle CORS preflight requests
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

    // Parse body safely to avoid 500 on empty/invalid body
    let parsedBody: any = {};
    const rawText = await req.text();
    
    if (rawText && rawText.trim().length > 0) {
        try {
            parsedBody = JSON.parse(rawText);
        } catch (e) {
            console.error('STOCKLINE AI Proxy: Failed to parse request JSON:', e);
            return new Response(JSON.stringify({ error: 'Invalid JSON body in request.', details: e.message }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }
    }
    
    // Accept either apiPath (standard) or murekaApiPath (legacy/alternative) to be robust
    const apiPath = parsedBody.apiPath || parsedBody.murekaApiPath;
    const method = parsedBody.method;
    const requestBody = parsedBody.requestBody;
    const queryParams = parsedBody.queryParams;
    const isFileUpload = parsedBody.isFileUpload;

    if (!apiPath || !method) {
        console.error('STOCKLINE AI Proxy: Missing apiPath or method. Received body keys:', Object.keys(parsedBody));
        return new Response(JSON.stringify({ 
            error: 'Missing apiPath or method in request body for STOCKLINE AI proxy.',
            received: parsedBody 
        }), {
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

          // Reconstruct the file from base64
          try {
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
              // Do NOT set Content-Type header for FormData, let fetch set it with boundary
          } catch (e) {
              console.error('STOCKLINE AI Proxy: Error processing file upload data:', e);
              return new Response(JSON.stringify({ error: 'Failed to process file data.', details: e.message }), {
                  status: 400,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              });
          }
      } else {
          console.log(`STOCKLINE AI Proxy: Handling JSON POST request to ${apiPath}`);
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(requestBody);
      }
    } else {
      console.log(`STOCKLINE AI Proxy: Handling ${method} request to ${apiPath}`);
    }

    let apiUrl = `${API_BASE_URL}/${apiPath}`;
    if (queryParams) {
        const params = new URLSearchParams(queryParams);
        apiUrl += `?${params.toString()}`;
    }

    const apiResponse = await fetch(apiUrl, {
        method,
        headers,
        body,
    });

    const rawApiResponseBody = await apiResponse.text();

    if (!apiResponse.ok) {
        let apiErrorData;
        try {
            apiErrorData = JSON.parse(rawApiResponseBody);
        } catch {
            apiErrorData = { message: rawApiResponseBody || 'Could not parse API error response or empty body.' };
        }
        console.error(`STOCKLINE AI Proxy: Upstream API error (${apiResponse.status}):`, apiErrorData);
        return new Response(JSON.stringify({ 
            error: 'AI API call failed', 
            status: apiResponse.status, 
            details: apiErrorData 
        }), {
            status: apiResponse.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Safely parse the JSON body from the upstream API
    let apiData = {};
    if (rawApiResponseBody.trim()) {
      try {
        apiData = JSON.parse(rawApiResponseBody);
      } catch (e) {
        console.error('STOCKLINE AI Proxy: Failed to parse successful upstream response:', e.message);
        return new Response(JSON.stringify({ 
          error: 'The AI API returned a malformed successful response.', 
          details: rawApiResponseBody 
        }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(apiData), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('STOCKLINE AI Proxy: Uncaught Internal Error:', error);
    return new Response(JSON.stringify({ 
        error: error.message || 'Internal server error in the AI proxy.',
        stack: error.stack 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});