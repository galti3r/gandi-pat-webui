export const config = { runtime: 'edge' };

const GANDI_ID = 'https://id.gandi.net';

export default async function handler(request) {
    if (request.method !== 'GET') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const targetUrl = `${GANDI_ID}/tokeninfo`;

    const proxyHeaders = {};
    const authorization = request.headers.get('authorization');
    if (authorization) {
        proxyHeaders['Authorization'] = authorization;
    }

    try {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: proxyHeaders,
        });

        const responseHeaders = new Headers();
        const contentType = response.headers.get('content-type');
        if (contentType) {
            responseHeaders.set('Content-Type', contentType);
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
