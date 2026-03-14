export const config = { runtime: 'edge' };

const GANDI_API = 'https://api.gandi.net';

const FORWARDED_RESPONSE_HEADERS = [
    'content-type',
    'retry-after',
    'total-count',
    'link',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
];

export default async function handler(request) {
    const url = new URL(request.url);
    // Strip /api prefix added by Vercel routing
    const path = url.pathname.replace(/^\/api/, '');

    // Validate path: must start with /v5/, reject traversal and double slashes
    if (!path.startsWith('/v5/') || path.includes('..') || path.includes('//')) {
        return new Response(
            JSON.stringify({ error: 'Invalid API path' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const targetUrl = `${GANDI_API}${path}${url.search}`;

    const proxyHeaders = {};
    const authorization = request.headers.get('authorization');
    if (authorization) {
        proxyHeaders['Authorization'] = authorization;
    }
    const contentType = request.headers.get('content-type');
    if (contentType) {
        proxyHeaders['Content-Type'] = contentType;
    }
    const accept = request.headers.get('accept');
    if (accept) {
        proxyHeaders['Accept'] = accept;
    }

    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: proxyHeaders,
            body: request.method !== 'GET' && request.method !== 'HEAD'
                ? request.body
                : undefined,
        });

        const responseHeaders = new Headers();
        for (const name of FORWARDED_RESPONSE_HEADERS) {
            const value = response.headers.get(name);
            if (value !== null) {
                responseHeaders.set(name, value);
            }
        }
        responseHeaders.set('X-Content-Type-Options', 'nosniff');
        responseHeaders.set('Cache-Control', 'no-store');

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (err) {
        return new Response(
            JSON.stringify({ error: 'Upstream request failed', detail: err.message }),
            {
                status: 502,
                headers: {
                    'Content-Type': 'application/json',
                    'X-Content-Type-Options': 'nosniff',
                    'Cache-Control': 'no-store',
                },
            }
        );
    }
}
