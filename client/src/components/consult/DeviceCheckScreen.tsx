'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mic, Video, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { callCopy, type CallCopy, type CallLanguage } from './call/callCopy';

/** Device IDs picked on the check screen; empty means the browser default. */
export interface ChosenDevices {
    audioDeviceId?: string;
    videoDeviceId?: string;
}

interface DeviceCheckScreenProps {
    videoAllowed: boolean;
    /** True while the join request is running, so Join cannot be sent twice. */
    joining: boolean;
    onJoin: (devices: ChosenDevices) => void;
    onCancel: () => void;
    /** Family room: Hindi or English, large text and buttons. */
    language?: CallLanguage;
    senior?: boolean;
}

type Status = 'checking' | 'ok' | 'error';

type Problem = keyof CallCopy['check']['problems'];

function problemOf(err: unknown): Problem {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError') return 'blocked';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'missing';
    if (name === 'NotReadableError') return 'busy';
    return 'other';
}

export function DeviceCheckScreen({ videoAllowed, joining, onJoin, onCancel, language = 'en', senior = false }: DeviceCheckScreenProps) {
    const t = callCopy(language).check;
    const [status, setStatus] = useState<Status>('checking');
    const [problem, setProblem] = useState<Problem | null>(null);
    const [attempt, setAttempt] = useState(0);
    const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
    const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
    // What the user picked (drives the stream) vs. what the browser actually opened (shown and sent on).
    const [pickedCamera, setPickedCamera] = useState('');
    const [pickedMic, setPickedMic] = useState('');
    const [active, setActive] = useState<ChosenDevices>({});
    const [level, setLevel] = useState(0);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Asking for the stream is what shows the permission prompt; device names are hidden until then.
    useEffect(() => {
        let cancelled = false;
        let stream: MediaStream | null = null;
        let audioCtx: AudioContext | null = null;
        let frame = 0;
        setStatus('checking');
        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
                const s = await navigator.mediaDevices.getUserMedia({
                    audio: pickedMic ? { deviceId: { exact: pickedMic } } : true,
                    video: videoAllowed ? (pickedCamera ? { deviceId: { exact: pickedCamera } } : true) : false,
                });
                if (cancelled) return s.getTracks().forEach((t) => t.stop());
                stream = s;
                const devices = await navigator.mediaDevices.enumerateDevices();
                if (cancelled) return;
                setCameras(devices.filter((d) => d.kind === 'videoinput' && d.deviceId));
                setMics(devices.filter((d) => d.kind === 'audioinput' && d.deviceId));
                setActive({
                    audioDeviceId: s.getAudioTracks()[0]?.getSettings().deviceId,
                    videoDeviceId: s.getVideoTracks()[0]?.getSettings().deviceId,
                });
                if (videoRef.current) videoRef.current.srcObject = s;

                audioCtx = new AudioContext();
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.8;
                audioCtx.createMediaStreamSource(s).connect(analyser);
                const data = new Uint8Array(analyser.frequencyBinCount);
                const tick = () => {
                    analyser.getByteFrequencyData(data);
                    const average = data.reduce((a, b) => a + b, 0) / data.length;
                    setLevel(Math.min(100, (average / 255) * 200)); // doubled so normal speech fills the bar
                    frame = requestAnimationFrame(tick);
                };
                tick();
                setProblem(null);
                setStatus('ok');
            } catch (err) {
                if (cancelled) return;
                setActive({});
                setProblem(problemOf(err));
                setStatus('error');
            }
        })();
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            stream?.getTracks().forEach((t) => t.stop());
            void audioCtx?.close();
        };
    }, [pickedCamera, pickedMic, videoAllowed, attempt]);

    const showVideo = status === 'ok'; // a successful stream always includes the camera when video is allowed
    const statusIcon = status === 'checking'
        ? <Loader2 className="h-4 w-4 animate-spin text-ink-subtle" aria-hidden />
        : status === 'ok'
            ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            : <AlertCircle className="h-4 w-4 text-danger" aria-hidden />;
    const size = senior ? 'lg' : 'md';
    const selectClass = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div className="space-y-2 text-center">
                <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
                <p className={cn('text-muted-foreground', senior ? 'text-lg' : 'text-sm')}>{t.subtitle}</p>
            </div>

            {videoAllowed && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Video className="h-4 w-4" aria-hidden /> {t.camera}</span>
                        {statusIcon}
                    </div>
                    <div className="relative aspect-video overflow-hidden rounded-2xl bg-ink">
                        {/* Always mounted so the stream can be attached as soon as it arrives. */}
                        <video ref={videoRef} autoPlay muted playsInline className={cn('h-full w-full -scale-x-100 object-cover', !showVideo && 'hidden')} />
                        {!showVideo && (
                            <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
                                {status === 'checking' ? t.startingCamera : t.noCamera}
                            </div>
                        )}
                    </div>
                    {cameras.length > 1 && (
                        <select aria-label={t.camera} value={active.videoDeviceId ?? pickedCamera} onChange={(e) => setPickedCamera(e.target.value)} className={selectClass}>
                            {cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                        </select>
                    )}
                </div>
            )}

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Mic className="h-4 w-4" aria-hidden /> {t.microphone}</span>
                    {statusIcon}
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-surface-subtle p-4">
                    <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
                        <div
                            className={cn('h-full rounded-full transition-all duration-100', level > 70 ? 'bg-success' : level > 30 ? 'bg-warning' : 'bg-border-strong')}
                            style={{ width: `${level}%` }}
                        />
                    </div>
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{level > 5 ? t.speaking : t.quiet}</span>
                </div>
                {mics.length > 1 && (
                    <select aria-label={t.microphone} value={active.audioDeviceId ?? pickedMic} onChange={(e) => setPickedMic(e.target.value)} className={selectClass}>
                        {mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                    </select>
                )}
                <p className={cn('text-muted-foreground', senior ? 'text-base' : 'text-xs')}>{t.speakHint}</p>
            </div>

            {problem && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-danger-soft bg-danger-soft p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
                    <div className="space-y-2">
                        <p className={cn('font-semibold text-danger-ink', senior ? 'text-lg' : 'text-sm')}>{t.problems[problem]}</p>
                        <p className={cn('text-danger-ink', senior ? 'text-base' : 'text-xs')}>{t.canStillJoin}</p>
                        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>{t.checkAgain}</Button>
                    </div>
                </div>
            )}

            <div className="flex gap-3 pt-4">
                <Button variant="outline" size={size} className="flex-1" disabled={joining} onClick={onCancel}>{t.cancel}</Button>
                <Button size={size} className="flex-1" disabled={status === 'checking' || joining} onClick={() => onJoin(active)}>
                    {joining
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t.joining}</>
                        : status === 'checking' ? t.checking : status === 'error' ? t.joinAnyway : t.join}
                </Button>
            </div>
        </div>
    );
}
