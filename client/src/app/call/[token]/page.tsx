import type { Metadata } from 'next';
import { GuestRoom } from './GuestRoom';

export const metadata: Metadata = {
    title: 'DocNow · Your doctor consultation',
    description: 'Join your video consultation with your DocNow doctor. No app or login needed.',
    // The link is a private invitation; keep it out of search engines and link previews' indexes.
    robots: { index: false, follow: false },
};

export default async function GuestCallPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = await params;
    return <GuestRoom token={token} />;
}
