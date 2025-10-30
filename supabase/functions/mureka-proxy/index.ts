// /supabase/functions/mureka-proxy/index.ts
import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

const MUREKA_API_KEY = Deno.env.get("MUREKA_API_KEY");
const MUREKA_API_BASE_URL = "https://api.mureka.ai/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!MUREKA_API_KEY) {
      throw new Error("MUREKA_API_KEY not configured on Supabase Edge Function.");
    }

    const { murekaApiPath, method, requestBody, queryParams } = await req.json();

    if (!murekaApiPath || !method) {
      return new Response(JSON.stringify({ error: "Missing required fields: murekaApiPath and method." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let targetUrl = `${MUREKA_API_BASE_URL}/${murekaApiPath}`;
    
    if (queryParams && Object.keys(queryParams).length > 0) {
        const params = new URLSearchParams(queryParams);
        targetUrl += `?${params.toString()}`;
    }

    console.log(`[Mureka Proxy] Forwarding ${method} request to: ${targetUrl}`);
    if (requestBody) {
        console.log(`[Mureka Proxy] With body:`, JSON.stringify(requestBody, null, 2));
    }

    const murekaResponse = await fetch(targetUrl, {
      method: method,
      headers: {
        "Authorization": `Bearer ${MUREKA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: requestBody ? JSON.stringify(requestBody) : undefined,
    });

    // FIX: Read body as text first to avoid parsing errors in the fetch client.
    const responseBodyText = await murekaResponse.text();

    if (!murekaResponse.ok) {
      console.error(`[Mureka Proxy] Mureka API Error (Status: ${murekaResponse.status}):`, responseBodyText);
      
      let details;
      try {
        details = JSON.parse(responseBodyText);
      } catch (e) {
        details = { message: responseBodyText };
      }
      
      return new Response(JSON.stringify({
        error: "Mureka API request failed",
        status: murekaResponse.status,
        details: details
      }), {
        status: murekaResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Safely parse the JSON response from the text body
    let responseData;
    try {
      // An empty response body will cause JSON.parse to throw an error.
      // This is expected for some Mureka API responses, so we handle it gracefully.
      if (responseBodyText) {
        responseData = JSON.parse(responseBodyText);
      } else {
        responseData = {}; // Return an empty object for empty responses
      }
    } catch (e) {
      console.error(`[Mureka Proxy] Failed to parse JSON from Mureka API. Raw text: "${responseBodyText}"`, e);
      // Return a structured error that the client can understand
      return new Response(JSON.stringify({ 
        error: "Mureka API returned invalid JSON",
        details: { message: e.message, rawResponse: responseBodyText }
      }), {
        status: 502, // Bad Gateway is more appropriate here
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[Mureka Proxy] Internal Server Error:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error", message: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});