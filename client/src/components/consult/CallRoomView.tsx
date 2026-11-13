'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Volume2 } from 'lucide-react';
import { ConnectionQuality, type Participant } from 'livekit-client';
import { Button } from '@/components/ui';
import { arrangeTiles, partyOf, partyOfRole } from '@/lib/consult/guest';
import { cn } from '@/lib/utils';
import { callCopy, type CallLanguage } from './call/callCopy';
import { ControlBar } from './call/ControlBar';
import { useCallRoom } from './call/useCallRoom';
import { formatDuration, iosVideoFullscreen, useAutoHide, useCallShortcuts, useCallTimer, useFullscreen, useWeakNetworkPrompt } from './call/useCallUi';
import { QualityBadge, VideoTile, cameraTrack } from './call/VideoTile';
import { WaitingRoom } from './call/WaitingRoom';

export interface ConsultCallRoomProps {
    /** LiveKit server URL and access token from the join call. The token carries the display name. */
    url: string;
    token: string;
    /** Video role from the join call; `*-audio` roles may only publish the microphone. */
    role: string;
    /** Who the other side is, for the waiting message. */
    otherParty: 'doctor' | 'patient';
    onLeave: () => void;
    /** Called when the doctor enters the room (the family web room plays a chime). */
    onDoctorJoined?: () => void;
    /** Large buttons and text for the family web room. */
    senior?: boolean;
    /** Screen language; the family room passes its Hindi/English choice. */
    language?: CallLanguage;
    /** Camera and microphone picked on the device check; browser default when absent. */
    audioDeviceId?: string;
    videoDeviceId?: string;
}

const PARTY_LABEL = { doctor: 'Doctor', patient: 'Patient', caretaker: 'Family' } as const;

export default function CallRoomView({ url, token, role, otherParty, onLeave, onDoctorJoined, senior = false, language = 'en', audioDeviceId, videoDeviceId }: ConsultCallRoomProps) {
    const copy = callCopy(language);
    const videoAllowed = !role.endsWith('-audio');
    const viewer = partyOfRole(role);
    const {
        room, audioBox, error, notice, setNotice, connected, reconnecting, quality, canFlip, attempt,
        toggle, flipCamera, retry, leave: leaveRoom, redraw,
    } = useCallRoom({ url, token, videoAllowed, audioDeviceId, videoDeviceId, onLeave, onDoctorJoined });
    const containerRef = useRef<HTMLDivElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const [confirmingLeave, setConfirmingLeave] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const controls = useAutoHide();
    const fs = useFullscreen(containerRef, remoteVideoRef, controls.show);

    const local = room?.localParticipant;
    const { primary: remote, others } = arrangeTiles(room ? [...room.remoteParticipants.values()] : [], viewer);
    const remoteCam = remote ? cameraTrack(remote) : undefined;
    const labelOf = (p: Participant) => p.name || PARTY_LABEL[partyOf(p.identity) ?? otherParty];
    const micOn = !!local?.isMicrophoneEnabled;
    const camOn = !!local?.isCameraEnabled;
    const seconds = useCallTimer(connected && !!remote, attempt);
    const weak = useWeakNetworkPrompt(quality === ConnectionQuality.Poor && camOn);
    const canFullscreen = fs.native || (iosVideoFullscreen && !!remoteCam);
    // Phone browsers pause the call while the page sits in the mini window, so it is desktop only.
    const canPip = videoAllowed && !!remoteCam && document.pictureInPictureEnabled === true && !window.matchMedia('(pointer: coarse)').matches;

    // Hides the floating support chat, which would sit on the call controls.
    useEffect(() => {
        document.documentElement.dataset.inCall = '';
        return () => void delete document.documentElement.dataset.inCall;
    }, []);

    useCallShortcuts(connected, (key) => {
        if (key === 'm') void toggle('mic', !micOn);
        else if (key === 'v' && videoAllowed) void toggle('camera', !camOn);
        else if (key === 'f' && canFullscreen) fs.toggle();
    });

    if (error) {
        return (
            <div role="alert" className="flex flex-col items-center gap-4 rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                <div className="space-y-2">
                    <p className={cn('font-semibold text-destructive', senior ? 'text-lg' : 'text-sm')}>{copy.errors[error]}</p>
                    {error === 'network' && <p className="text-xs text-muted-foreground">{copy.networkHint}</p>}
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size={senior ? 'lg' : 'sm'} onClick={onLeave}>{copy.back}</Button>
                    {/* An expired token fails the same way again, so only Back is offered. */}
                    {error !== 'expired' && <Button size={senior ? 'lg' : 'sm'} onClick={retry}>{copy.retry}</Button>}
                </div>
            </div>
        );
    }

    async function togglePictureInPicture() {
        try {
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else await remoteVideoRef.current?.requestPictureInPicture();
        } catch {
            setNotice('pipUnsupported');
        }
    }

    async function leave() {
        setLeaving(true);
        await leaveRoom();
    }

    const { fullscreen } = fs;
    const showControls = fullscreen ? controls.show : undefined;
    return (
        <div
            ref={containerRef}
            className={cn('space-y-3', fullscreen && 'fixed inset-0 z-50 space-y-0 bg-black')}
            onPointerMove={showControls}
            onPointerDown={showControls}
            onFocusCapture={showControls}
        >
            <div ref={audioBox} hidden />
            <div className={cn('relative w-full overflow-hidden bg-gray-900', fullscreen ? 'h-screen' : 'h-[60vh] min-h-80 rounded-2xl sm:h-[70vh]')}>
                {/* A fixed height lets a portrait phone video fit whole instead of overflowing and looking zoomed. */}
                {!connected ? (
                    <div role="status" className="flex h-full items-center justify-center gap-2 text-sm text-white">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> {copy.connecting}
                    </div>
                ) : remote ? (
                    <VideoTile participant={remote} label={labelOf(remote)} mutedLabel={copy.muted} className="h-full w-full" videoRef={remoteVideoRef} />
                ) : (
                    <WaitingRoom otherParty={otherParty} copy={copy} senior={senior} />
                )}
                {connected && local && videoAllowed && (
                    <VideoTile participant={local} label={copy.you} mutedLabel={copy.muted} local
                        className={cn('absolute right-3 border-2 border-white/70 shadow-lg', 'aspect-[3/4]', fullscreen ? 'bottom-32 w-24 sm:w-28' : 'bottom-3 w-28 sm:w-36')} />
                )}
                {/* Three-way calls: the caregiver (or patient, for the doctor) as small tiles. */}
                {connected && others.length > 0 && (
                    <div className="absolute left-3 top-14 flex flex-col gap-2">
                        {others.map((p) => (
                            <VideoTile key={p.identity} participant={p} label={labelOf(p)} mutedLabel={copy.muted} className="aspect-video w-28 border-2 border-white/70 sm:w-36" />
                        ))}
                    </div>
                )}
                {connected && (
                    <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
                        {seconds > 0 ? (
                            <span className="rounded-lg bg-black/60 px-3 py-1 font-mono text-xs font-semibold text-white">{formatDuration(seconds)}</span>
                        ) : <span />}
                        {reconnecting && (
                            <p role="status" className="rounded-lg bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{copy.reconnecting}</p>
                        )}
                        <QualityBadge quality={quality} copy={copy} />
                    </div>
                )}
            </div>

            {/* In fullscreen these float over the video; otherwise they sit under it. */}
            <div className={cn('space-y-2', fullscreen && 'absolute inset-x-3 top-14 z-10')}>
                {connected && room && !room.canPlaybackAudio && (
                    <Button className="w-full" onClick={() => void room.startAudio().then(redraw)}>
                        <Volume2 className="mr-2 h-4 w-4" aria-hidden /> {copy.enableSound}
                    </Button>
                )}
                {weak.show && (
                    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-4 py-3">
                        <p className={cn('flex-1 font-semibold text-amber-900', senior ? 'text-lg' : 'text-sm')}>{copy.weak}</p>
                        <Button size="sm" onClick={() => void toggle('camera', false)}>{copy.switchAudio}</Button>
                        <Button size="sm" variant="outline" onClick={weak.dismiss}>{copy.notNow}</Button>
                    </div>
                )}
                {notice && (
                    <p role="alert" className={cn('rounded-xl bg-amber-50 px-4 py-3 font-semibold text-amber-800', senior ? 'text-lg' : 'text-sm')}>
                        {copy.notices[notice]}
                    </p>
                )}
            </div>

            <div className={cn(
                'transition-opacity duration-300',
                fullscreen && 'absolute bottom-6 left-1/2 -translate-x-1/2 rounded-3xl bg-black/60 px-4 py-2',
                fullscreen && !controls.visible && !confirmingLeave && 'pointer-events-none opacity-0',
            )}>
                <ControlBar
                    copy={copy}
                    senior={senior}
                    connected={connected}
                    micOn={micOn}
                    camOn={camOn}
                    videoAllowed={videoAllowed}
                    canFlip={canFlip}
                    canFullscreen={canFullscreen}
                    fullscreen={fullscreen}
                    canPip={canPip}
                    leaving={leaving}
                    confirmingLeave={confirmingLeave}
                    onMic={() => void toggle('mic', !micOn)}
                    onCamera={() => void toggle('camera', !camOn)}
                    onFlip={() => void flipCamera()}
                    onFullscreen={fs.toggle}
                    onPip={() => void togglePictureInPicture()}
                    onAskLeave={setConfirmingLeave}
                    onLeave={() => void leave()}
                />
            </div>
        </div>
    );
}
