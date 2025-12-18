/**
 * Cloudflare Worker Proxy for HentaiStream Addon
 * 
 * This worker acts as a proxy to bypass Cloudflare protection.
 * Deploy this to Cloudflare Workers (free tier: 100K requests/day)
 * 
 * Setup:
 * 1. Go to https://dash.cloudflare.com/
 * 2. Create account (free)
 * 3. Go to Workers & Pages > Create Worker
 * 4. Paste this code and deploy
 * 5. Copy the worker URL (e.g., https://your-worker.your-subdomain.workers.dev)
 * 6. Set CF_PROXY_URL environment variable in Render to this URL
 */

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    const methodOverride = url.searchParams.get('method'); // Support method override via URL param
    const bodyParam = url.searchParams.get('body'); // Support body via URL param for GET-based proxy

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      // Decode the URL
      const decodedUrl = decodeURIComponent(targetUrl);
      
      // Determine the actual method to use
      const actualMethod = methodOverride || request.method;
      
      // Build headers that mimic a real browser
      const headers = new Headers({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      });

      // For POST requests, get body from URL param or request body
      let body = null;
      if (actualMethod === 'POST') {
        if (bodyParam) {
          // Body passed as URL parameter (for GET-based proxy calls)
          body = decodeURIComponent(bodyParam);
        } else if (request.method === 'POST') {
          // Body from actual POST request
          body = await request.text();
        }
        headers.set('Content-Type', 'application/x-www-form-urlencoded');
      }

      // Fetch the target URL
      const response = await fetch(decodedUrl, {
        method: actualMethod,
        headers,
        body,
        redirect: 'follow',
      });

      // Get the response body
      const responseBody = await response.text();

      // Return the response with CORS headers
      return new Response(responseBody, {
        status: response.status,
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'text/html',
          'Access-Control-Allow-Origin': '*',
          'X-Proxied-Status': response.status.toString(),
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
