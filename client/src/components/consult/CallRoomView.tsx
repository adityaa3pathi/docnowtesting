'use client';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Loader2, Maximize, Minimize, Mic, MicOff, PhoneOff, Video, VideoOff, Volume2 } from 'lucide-react';
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type Participant } from 'livekit-client';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface ConsultCallRoomProps {
    /** LiveKit server URL and access token from the join call. The token carries the display name. */
    url: string;
    token: string;
    /** Video role from the join call; `*-audio` roles may only publish the microphone. */
    role: string;
    /** Who the other side is, for the waiting message. */
    otherParty: 'doctor' | 'patient';
    onLeave: () => void;
}

const JOIN_FAILED = 'We could not connect the call. Check your internet and allow camera and microphone, then try again.';
const DROPPED = 'The call was disconnected. Go back and join again.';

// Every event that changes what the screen shows; each one just triggers a re-render.
const REDRAW = [
    RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.AudioPlaybackStatusChanged,
] as const;

function cameraTrack(p: Participant) {
    const pub = p.getTrackPublication(Track.Source.Camera);
    return pub && !pub.isMuted ? pub.videoTrack : undefined;
}

function VideoTile({ participant, label, local, className }: { participant: Participant; label: string; local?: boolean; className?: string }) {
    const ref = useRef<HTMLVideoElement>(null);
    const track = cameraTrack(participant);

    useEffect(() => {
        const el = ref.current;
        if (!el || !track) return;
        track.attach(el);
        return () => void track.detach(el);
    }, [track]);

    return (
        <div className={cn('relative overflow-hidden rounded-2xl bg-gray-900', className)}>
            {track ? (
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

/** Our own call screen on LiveKit's plain JS client. Always leaves the room on unmount or page close. */
export default function CallRoomView({ url, token, role, otherParty, onLeave }: ConsultCallRoomProps) {
    const [room, setRoom] = useState<Room | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [leaving, setLeaving] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    const audioBox = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const leaveRef = useRef(onLeave);
    const videoAllowed = !role.endsWith('-audio');

    useEffect(() => {
        leaveRef.current = onLeave;
    }, [onLeave]);

    useEffect(() => {
        const r = new Room({ adaptiveStream: true, dynacast: true });
        let closed = false;
        setRoom(r);
        setError(null);
        for (const ev of REDRAW) r.on(ev, redraw);
        // Remote audio only plays once attached to an element on the page.
        r.on(RoomEvent.TrackSubscribed, (track) => {
            if (track.kind === Track.Kind.Audio) audioBox.current?.appendChild(track.attach());
        });
        r.on(RoomEvent.TrackUnsubscribed, (track) => {
            if (track.kind === Track.Kind.Audio) track.detach().forEach((el) => el.remove());
        });
        r.on(RoomEvent.Disconnected, (reason) => {
            if (closed) return;
            if (reason === DisconnectReason.ROOM_DELETED) leaveRef.current();
            else setError(DROPPED);
        });
        const leave = () => void r.disconnect();
        window.addEventListener('beforeunload', leave);

        (async () => {
            try {
                await r.connect(url, token);
            } catch {
                if (!closed) setError(JOIN_FAILED);
                return;
            }
            try {
                await r.localParticipant.setMicrophoneEnabled(true);
                if (videoAllowed) await r.localParticipant.setCameraEnabled(true);
            } catch {
                if (!closed) setNotice('We could not start your camera or microphone. Check the browser permission, then use the buttons below.');
            }
        })();

        return () => {
            closed = true;
            window.removeEventListener('beforeunload', leave);
            r.removeAllListeners();
            leave();
        };
    }, [url, token, videoAllowed]);

    async function leave() {
        setLeaving(true);
        try {
            await room?.disconnect();
        } finally {
            onLeave();
        }
    }

    async function toggle(kind: 'mic' | 'camera', on: boolean) {
        if (!room) return;
        try {
            if (kind === 'mic') await room.localParticipant.setMicrophoneEnabled(on);
            else await room.localParticipant.setCameraEnabled(on);
            setNotice(null);
        } catch {
            setNotice(`We could not turn the ${kind === 'mic' ? 'microphone' : 'camera'} ${on ? 'on' : 'off'}. Check the browser permission.`);
        }
        redraw();
    }

    if (error) {
        return (
            <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                <p className="text-sm font-semibold text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={onLeave}>Back</Button>
            </div>
        );
    }

    const state = room?.state ?? ConnectionState.Connecting;
    const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
    const connected = state === ConnectionState.Connected || reconnecting;
    const local = room?.localParticipant;
    const remote = room ? [...room.remoteParticipants.values()][0] : undefined;
    const micOn = !!local?.isMicrophoneEnabled;
    const camOn = !!local?.isCameraEnabled;

    function toggleFullscreen() {
        if (!containerRef.current) return;
        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen().then(() => setFullscreen(true)).catch(() => {});
        } else {
            document.exitFullscreen().then(() => setFullscreen(false)).catch(() => {});
        }
    }

    // Listen for fullscreen changes (e.g., Escape key).
    useEffect(() => {
        const cb = () => setFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', cb);
        return () => document.removeEventListener('fullscreenchange', cb);
    }, []);

    return (
        <div className="space-y-3" ref={containerRef}>
            <div ref={audioBox} hidden />
            <div className="relative w-full overflow-hidden rounded-2xl bg-gray-900" style={{ minHeight: fullscreen ? '100vh' : '55vh', maxHeight: fullscreen ? '100vh' : '80vh' }}>
                {!connected ? (
                    <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-white">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> Connecting...
                    </div>
                ) : remote ? (
                    <VideoTile participant={remote} label={remote.name || `The ${otherParty}`} className="h-full w-full" />
                ) : (
                    <p role="status" className="flex h-full items-center justify-center px-6 text-center text-sm text-white">
                        Waiting for the {otherParty} to join...
                    </p>
                )}
                {connected && local && videoAllowed && (
                    <VideoTile participant={local} label="You" local
                        className="absolute bottom-3 right-3 aspect-video w-1/4 min-w-28 border-2 border-white/70" />
                )}
                {reconnecting && (
                    <p role="status" className="absolute inset-x-0 top-3 mx-auto w-fit rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        Reconnecting...
                    </p>
                )}
            </div>
            {connected && room && !room.canPlaybackAudio && (
                <Button className="w-full" onClick={() => void room.startAudio().then(redraw)}>
                    <Volume2 className="mr-2 h-4 w-4" aria-hidden /> Tap to enable sound
                </Button>
            )}
            {notice && <p role="alert" className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{notice}</p>}
            <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" size="sm" disabled={!connected} aria-pressed={!micOn} onClick={() => void toggle('mic', !micOn)}>
                    {micOn ? <><MicOff className="mr-1.5 h-4 w-4" aria-hidden /> Mute</> : <><Mic className="mr-1.5 h-4 w-4" aria-hidden /> Unmute</>}
                </Button>
                {videoAllowed && (
                    <Button variant="outline" size="sm" disabled={!connected} aria-pressed={!camOn} onClick={() => void toggle('camera', !camOn)}>
                        {camOn ? <><VideoOff className="mr-1.5 h-4 w-4" aria-hidden /> Camera off</> : <><Video className="mr-1.5 h-4 w-4" aria-hidden /> Camera on</>}
                    </Button>
                )}
                {videoAllowed && camOn && (
                    <Button variant="outline" size="sm" disabled={!connected} onClick={() => void toggle('camera', false)}>
                        Switch to audio
                    </Button>
                )}
                <Button variant="outline" size="sm" disabled={!connected} onClick={toggleFullscreen}>
                    {fullscreen ? <><Minimize className="mr-1.5 h-4 w-4" aria-hidden /> Exit fullscreen</> : <><Maximize className="mr-1.5 h-4 w-4" aria-hidden /> Fullscreen</>}
                </Button>
                <Button size="sm" disabled={leaving} onClick={() => void leave()} className="bg-destructive hover:bg-destructive/90">
                    <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden /> Leave
                </Button>
            </div>
        </div>
    );
}
