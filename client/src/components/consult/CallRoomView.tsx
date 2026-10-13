'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Loader2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import {
    HMSNotificationTypes, HMSReactiveStore, HMSRoomState, selectIsAllowedToPublish, selectIsLocalAudioEnabled,
    selectIsLocalVideoEnabled, selectIsPeerVideoEnabled, selectLocalPeer, selectRemotePeers, selectRoomState,
    type HMSActions, type HMSStore, type HMSStoreWrapper,
} from '@100mslive/hms-video-store';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ConsultCallRoomProps {
    token: string;
    userName: string;
    /** Who the other side is, for the waiting message. */
    otherParty: 'doctor' | 'patient';
    onLeave: () => void;
}

type Room = { actions: HMSActions; store: HMSStoreWrapper };

// Fixed fallbacks: useSyncExternalStore loops forever if a snapshot is a new object each render.
const NO_PEERS: never[] = [];
const NO_PUBLISH = { video: false, audio: false, screen: false };

const JOIN_FAILED = 'We could not connect the call. Check your internet and allow camera and microphone, then try again.';

function useHms<T>(store: HMSStoreWrapper | null, selector: (s: HMSStore) => T, fallback: T): T {
    return useSyncExternalStore(
        (cb) => (store ? store.subscribe(cb, selector) : () => {}),
        () => (store ? store.getState(selector) : fallback),
        () => fallback,
    );
}

function VideoTile({ room, peerId, trackId, label, local, className }: {
    room: Room; peerId: string; trackId?: string; label: string; local?: boolean; className?: string;
}) {
    const ref = useRef<HTMLVideoElement>(null);
    const enabledSelector = useMemo(() => selectIsPeerVideoEnabled(peerId), [peerId]);
    const videoOn = useHms(room.store, enabledSelector, false);

    useEffect(() => {
        const el = ref.current;
        if (!el || !trackId || !videoOn) return;
        void room.actions.attachVideo(trackId, el);
        return () => void room.actions.detachVideo(trackId, el);
    }, [room, trackId, videoOn]);

    return (
        <div className={cn('relative overflow-hidden rounded-2xl bg-gray-900', className)}>
            {videoOn && trackId ? (
                <video ref={ref} autoPlay muted playsInline className={cn('h-full w-full object-cover', local && '-scale-x-100')} />
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-white">
                        {label.trim().charAt(0).toUpperCase() || '?'}
                    </span>
                </div>
            )}
            <span className="absolute bottom-2 left-2 rounded-lg bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{label}</span>
        </div>
    );
}

/** Our own call screen on 100ms's plain JS SDK. Always leaves the room on unmount or page close. */
export default function CallRoomView({ token, userName, otherParty, onLeave }: ConsultCallRoomProps) {
    const [room, setRoom] = useState<Room | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [leaving, setLeaving] = useState(false);
    const onLeaveRef = useRef(onLeave);
    useEffect(() => {
        onLeaveRef.current = onLeave;
    }, [onLeave]);

    useEffect(() => {
        const hms = new HMSReactiveStore();
        hms.triggerOnSubscribe();
        const actions = hms.getActions();
        setRoom({ actions, store: hms.getStore() });
        setError(null);
        const stopErrors = hms.getNotifications().onNotification((n) => {
            if (n.data.isTerminal) setError(JOIN_FAILED);
        }, HMSNotificationTypes.ERROR);
        // The server closes the room when the doctor ends the consultation.
        const stopEnded = hms.getNotifications().onNotification(
            () => onLeaveRef.current(),
            [HMSNotificationTypes.ROOM_ENDED, HMSNotificationTypes.REMOVED_FROM_ROOM],
        );
        const leave = () => void actions.leave();
        window.addEventListener('beforeunload', leave);
        actions.join({ userName, authToken: token }).catch(() => setError(JOIN_FAILED));
        return () => {
            window.removeEventListener('beforeunload', leave);
            stopErrors();
            stopEnded();
            leave();
        };
    }, [token, userName]);

    const store = room?.store ?? null;
    const state = useHms(store, selectRoomState, HMSRoomState.Disconnected);
    const local = useHms(store, selectLocalPeer, null);
    const remotes = useHms(store, selectRemotePeers, NO_PEERS);
    const micOn = useHms(store, selectIsLocalAudioEnabled, false);
    const camOn = useHms(store, selectIsLocalVideoEnabled, false);
    const canVideo = useHms(store, selectIsAllowedToPublish, NO_PUBLISH).video;

    async function leave() {
        setLeaving(true);
        try {
            await room?.actions.leave();
        } finally {
            onLeave();
        }
    }

    if (error) {
        return (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                <p className="text-sm font-semibold text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={onLeave}>Back</Button>
            </div>
        );
    }

    const remote = remotes[0];
    const connected = state === HMSRoomState.Connected || state === HMSRoomState.Reconnecting;

    return (
        <div className="space-y-3">
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-gray-900">
                {!connected ? (
                    <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-white">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Connecting...
                    </div>
                ) : remote && room ? (
                    <VideoTile room={room} peerId={remote.id} trackId={remote.videoTrack} label={remote.name} className="h-full w-full" />
                ) : (
                    <p role="status" className="flex h-full items-center justify-center px-6 text-center text-sm text-white">
                        Waiting for the {otherParty} to join...
                    </p>
                )}
                {connected && local && room && canVideo && (
                    <VideoTile room={room} peerId={local.id} trackId={local.videoTrack} label="You" local
                        className="absolute bottom-3 right-3 aspect-video w-1/4 min-w-28 border-2 border-white/70" />
                )}
                {state === HMSRoomState.Reconnecting && (
                    <p role="status" className="absolute inset-x-0 top-3 mx-auto w-fit rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        Reconnecting...
                    </p>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" disabled={!connected} aria-pressed={!micOn}
                    onClick={() => void room?.actions.setLocalAudioEnabled(!micOn)}>
                    {micOn ? <><MicOff className="mr-1.5 h-4 w-4" aria-hidden /> Mute</> : <><Mic className="mr-1.5 h-4 w-4" aria-hidden /> Unmute</>}
                </Button>
                {canVideo && (
                    <Button variant="outline" size="sm" disabled={!connected} aria-pressed={!camOn}
                        onClick={() => void room?.actions.setLocalVideoEnabled(!camOn)}>
                        {camOn ? <><VideoOff className="mr-1.5 h-4 w-4" aria-hidden /> Camera off</> : <><Video className="mr-1.5 h-4 w-4" aria-hidden /> Camera on</>}
                    </Button>
                )}
                {canVideo && camOn && (
                    <Button variant="outline" size="sm" disabled={!connected} onClick={() => void room?.actions.setLocalVideoEnabled(false)}>
                        Switch to audio
                    </Button>
                )}
                <Button size="sm" disabled={leaving} onClick={() => void leave()} className="bg-destructive hover:bg-destructive/90">
                    <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden /> Leave
                </Button>
            </div>
        </div>
    );
}
