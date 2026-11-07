'use client';
import { useEffect, useRef, type RefObject } from 'react';
import { MicOff, SignalHigh, SignalLow, SignalMedium, WifiOff } from 'lucide-react';
import { ConnectionQuality, Track, type Participant } from 'livekit-client';
import { cn } from '@/lib/utils';
import type { CallCopy } from './callCopy';

export function cameraTrack(p: Participant) {
    const pub = p.getTrackPublication(Track.Source.Camera);
    return pub && !pub.isMuted ? pub.videoTrack : undefined;
}

interface VideoTileProps {
    participant: Participant;
    label: string;
    mutedLabel: string;
    local?: boolean;
    className?: string;
    videoRef?: RefObject<HTMLVideoElement | null>;
}

export function VideoTile({ participant, label, mutedLabel, local, className, videoRef }: VideoTileProps) {
    const internalRef = useRef<HTMLVideoElement>(null);
    const ref = videoRef || internalRef;
    const track = cameraTrack(participant);
    // A back camera shows the world, so mirroring it would flip any text the patient holds up.
    const mirror = local && track?.mediaStreamTrack.getSettings().facingMode !== 'environment';

    useEffect(() => {
        const el = ref.current;
        if (!el || !track) return;
        track.attach(el);
        return () => void track.detach(el);
    }, [track, ref]);

    return (
        <div className={cn('relative overflow-hidden rounded-2xl bg-gray-900', className)}>
            {track ? (
                <video ref={ref} autoPlay muted playsInline className={cn('h-full w-full', local ? 'object-contain' : 'object-cover', mirror && '-scale-x-100')} />
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-white">
                        {label.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                </div>
            )}
            <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">
                {!participant.isMicrophoneEnabled && (
                    <>
                        <MicOff className="h-3.5 w-3.5 text-red-400" aria-hidden />
                        <span className="sr-only">{mutedLabel}:</span>
                    </>
                )}
                {label}
            </span>
        </div>
    );
}

const QUALITY_LOOK = {
    [ConnectionQuality.Excellent]: { Icon: SignalHigh, color: 'text-green-400' },
    [ConnectionQuality.Good]: { Icon: SignalMedium, color: 'text-yellow-300' },
    [ConnectionQuality.Poor]: { Icon: SignalLow, color: 'text-red-400' },
    [ConnectionQuality.Lost]: { Icon: WifiOff, color: 'text-red-400' },
};

/** Signal icon plus a word, so it reads on phones (no hover) and for screen readers. */
export function QualityBadge({ quality, copy }: { quality: ConnectionQuality; copy: CallCopy }) {
    if (quality === ConnectionQuality.Unknown) return null;
    const { Icon, color } = QUALITY_LOOK[quality];
    return (
        <span className="flex items-center gap-1 rounded-lg bg-black/60 px-2 py-1 text-xs font-semibold text-white">
            <Icon className={cn('h-4 w-4', color)} aria-hidden />
            <span className="sr-only">{copy.connection}:</span>
            {copy.quality[quality]}
        </span>
    );
}
