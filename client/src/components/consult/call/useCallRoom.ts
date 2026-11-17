'use client';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
    ConnectionError, ConnectionErrorReason, ConnectionQuality, ConnectionState, DisconnectReason, Room, RoomEvent, Track,
} from 'livekit-client';
import { callEvents, type CallEventName } from '@/lib/consult/api';
import { partyOf } from '@/lib/consult/guest';
import type { CallCopy } from './callCopy';

export type CallErrorKind = keyof CallCopy['errors'];
export type CallNotice = keyof CallCopy['notices'];

// Every event that changes what the screen shows; each one just triggers a re-render.
const REDRAW = [
    RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.AudioPlaybackStatusChanged,
    RoomEvent.ActiveDeviceChanged,
];

/** LiveKit gives a reason code on connect failures; matching on message text breaks when wording changes. */
export function classifyConnectError(err: unknown): CallErrorKind {
    if (!(err instanceof ConnectionError)) return 'unknown';
    if (err.reason === ConnectionErrorReason.NotAllowed) return 'expired';
    if ([ConnectionErrorReason.ServerUnreachable, ConnectionErrorReason.Timeout, ConnectionErrorReason.WebSocket].includes(err.reason)) return 'network';
    return 'unknown';
}

/** Short code for the server log, e.g. "Timeout" or "NotAllowed:401"; never message text, which may hold personal data. */
function reasonCode(err: unknown): string {
    if (err instanceof ConnectionError) return `${ConnectionErrorReason[err.reason]}${err.status ? `:${err.status}` : ''}`;
    return err instanceof Error ? err.name : 'unknown';
}

interface Options {
    url: string;
    token: string;
    videoAllowed: boolean;
    audioDeviceId?: string;
    videoDeviceId?: string;
    onLeave: () => void;
    onDoctorJoined?: () => void;
}

/** Owns the LiveKit room: connecting, retrying, device toggles and failures. The view only draws it. */
export function useCallRoom({ url, token, videoAllowed, audioDeviceId, videoDeviceId, onLeave, onDoctorJoined }: Options) {
    const [room, setRoom] = useState<Room | null>(null);
    const [error, setError] = useState<CallErrorKind | null>(null);
    const [notice, setNotice] = useState<CallNotice | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [quality, setQuality] = useState<ConnectionQuality>(ConnectionQuality.Unknown);
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    const audioBox = useRef<HTMLDivElement>(null);
    const leaveRef = useRef(onLeave);
    const doctorJoinedRef = useRef(onDoctorJoined);

    useEffect(() => {
        leaveRef.current = onLeave;
        doctorJoinedRef.current = onDoctorJoined;
    }, [onLeave, onDoctorJoined]);

    useEffect(() => {
        const r = new Room({
            adaptiveStream: true,
            dynacast: true,
            audioCaptureDefaults: audioDeviceId ? { deviceId: audioDeviceId } : undefined,
            videoCaptureDefaults: videoDeviceId ? { deviceId: videoDeviceId } : undefined,
        });
        let closed = false;
        let rejoinWhenVisible = false;
        // Fire-and-forget: a failed report must never disturb the call.
        const report = (event: CallEventName, reason?: string) => void callEvents.report(token, event, reason).catch(() => {});
        setRoom(r);
        for (const ev of REDRAW) r.on(ev, redraw);
        // Remote audio only plays once attached to an element on the page.
        r.on(RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === Track.Kind.Audio) audioBox.current?.appendChild(track.attach());
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) => {
            if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
        });
        r.on(RoomEvent.ParticipantConnected, (p) => {
            if (partyOf(p.identity) === 'doctor') doctorJoinedRef.current?.();
        });
        r.on(RoomEvent.ConnectionQualityChanged, () => setQuality(r.localParticipant.connectionQuality));
        r.on(RoomEvent.MediaDevicesChanged, () => void Room.getLocalDevices('videoinput', false).then(setCameras).catch(() => {}));
        r.on(RoomEvent.Disconnected, (reason) => {
            if (closed) return;
            if (reason === DisconnectReason.ROOM_DELETED) return leaveRef.current();
            report('disconnected', reason === undefined ? undefined : DisconnectReason[reason]);
            // Phones pause a hidden page (mini window, app switch); rejoin on return instead of showing an error.
            if (document.visibilityState === 'hidden') rejoinWhenVisible = true;
            else setError('dropped');
        });
        r.on(RoomEvent.Reconnected, () => report('reconnected'));
        const leave = () => void r.disconnect();
        const onVisible = () => {
            if (!rejoinWhenVisible || document.visibilityState !== 'visible') return;
            rejoinWhenVisible = false;
            setAttempt((n) => n + 1);
        };
        window.addEventListener('beforeunload', leave);
        document.addEventListener('visibilitychange', onVisible);

        (async () => {
            try {
                await r.connect(url, token);
            } catch (err) {
                if (closed) return;
                setError(classifyConnectError(err));
                report('connect_failed', reasonCode(err));
                return;
            }
            // The doctor may already be inside when we arrive.
            if ([...r.remoteParticipants.values()].some((p) => partyOf(p.identity) === 'doctor')) doctorJoinedRef.current?.();
            try {
                await r.localParticipant.setMicrophoneEnabled(true);
                if (videoAllowed) await r.localParticipant.setCameraEnabled(true);
            } catch (err) {
                if (closed) return;
                setNotice(err instanceof Error && err.name === 'NotAllowedError' ? 'mediaBlocked' : 'mediaFailed');
                report('media_failed', reasonCode(err));
            }
            // Device names are only listed once camera permission is granted.
            if (videoAllowed && !closed) setCameras(await Room.getLocalDevices('videoinput', false).catch(() => []));
        })();

        return () => {
            closed = true;
            window.removeEventListener('beforeunload', leave);
            document.removeEventListener('visibilitychange', onVisible);
            r.removeAllListeners();
            leave();
        };
    }, [url, token, videoAllowed, audioDeviceId, videoDeviceId, attempt]);

    const toggle = useCallback(async (kind: 'mic' | 'camera', on: boolean) => {
        if (!room) return;
        try {
            if (kind === 'mic') await room.localParticipant.setMicrophoneEnabled(on);
            else await room.localParticipant.setCameraEnabled(on);
            setNotice(null);
        } catch {
            setNotice(kind === 'mic' ? 'micFailed' : 'cameraFailed');
        }
        redraw();
    }, [room]);

    const flipCamera = useCallback(async () => {
        if (!room || cameras.length < 2) return;
        const current = cameras.findIndex((c) => c.deviceId === room.getActiveDevice('videoinput'));
        const next = cameras[(current + 1) % cameras.length];
        try {
            await room.switchActiveDevice('videoinput', next.deviceId);
        } catch {
            setNotice('flipFailed');
        }
        redraw();
    }, [room, cameras]);

    const retry = useCallback(() => {
        setError(null);
        setNotice(null);
        setQuality(ConnectionQuality.Unknown);
        setAttempt((n) => n + 1);
    }, []);

    const leave = useCallback(async () => {
        try {
            await room?.disconnect();
        } finally {
            leaveRef.current();
        }
    }, [room]);

    const state = room?.state ?? ConnectionState.Connecting;
    const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
    return {
        room,
        audioBox,
        error,
        notice,
        setNotice,
        connected: state === ConnectionState.Connected || reconnecting,
        reconnecting,
        quality,
        canFlip: cameras.length > 1,
        attempt,
        toggle,
        flipCamera,
        retry,
        leave,
        redraw,
    };
}
