/**
 * Android App Links: lets the DocNow app open docnow.in/call/<token> directly when installed.
 * ANDROID_CERT_SHA256 is the signing certificate fingerprint(s), comma separated (from EAS / Play).
 */
const PACKAGE = process.env.ANDROID_PACKAGE || 'in.docnow.app';

export function GET() {
    const fingerprints = (process.env.ANDROID_CERT_SHA256 || '').split(',').map((f) => f.trim()).filter(Boolean);
    if (!fingerprints.length) return new Response('Not configured', { status: 404 });
    return Response.json(
        [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: fingerprints } }],
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
}
