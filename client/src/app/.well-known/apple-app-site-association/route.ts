/**
 * iOS universal links: lets the DocNow app open docnow.in/call/<token> (the family call link)
 * directly when installed; Safari opens the web room otherwise. Needs APPLE_TEAM_ID.
 */
const BUNDLE_ID = process.env.IOS_BUNDLE_ID || 'in.docnow.app';

export function GET() {
    const team = process.env.APPLE_TEAM_ID;
    if (!team) return new Response('Not configured', { status: 404 });
    return Response.json(
        { applinks: { details: [{ appIDs: [`${team}.${BUNDLE_ID}`], components: [{ '/': '/call/*', comment: 'Family consultation call links' }] }] } },
        { headers: { 'Cache-Control': 'public, max-age=3600' } },
    );
}
