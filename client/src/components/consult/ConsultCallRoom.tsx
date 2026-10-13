'use client';
import dynamic from 'next/dynamic';
import { LoadingBlock } from './States';

export type { ConsultCallRoomProps } from './CallRoomView';

/** The 100ms SDK touches browser-only APIs on import, so it is never rendered on the server. */
export const ConsultCallRoom = dynamic(() => import('./CallRoomView'), {
    ssr: false,
    loading: () => <LoadingBlock label="Opening the call" />,
});
