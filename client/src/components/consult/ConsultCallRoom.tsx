'use client';
import dynamic from 'next/dynamic';
import { LoadingBlock } from './States';

export type { ConsultCallRoomProps } from './CallRoomView';

/** The LiveKit client needs browser media APIs, so the call screen is never rendered on the server. */
export const ConsultCallRoom = dynamic(() => import('./CallRoomView'), {
    ssr: false,
    loading: () => <LoadingBlock label="Opening the call" />,
});
