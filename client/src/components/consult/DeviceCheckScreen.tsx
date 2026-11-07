'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Mic, Video, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

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
}

type Status = 'checking' | 'ok' | 'error';

function problemText(err: unknown): string {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotAllowedError') return 'Camera or microphone is blocked. Tap the lock icon next to the web address and allow them.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera or microphone was found.';
    if (name === 'NotReadableError') return 'Another app is using your camera or microphone. Close it, then check again.';
    return 'We could not check your camera and microphone.';
}

export function DeviceCheckScreen({ videoAllowed, joining, onJoin, onCancel }: DeviceCheckScreenProps) {
    const [status, setStatus] = useState<Status>('checking');
    const [problem, setProblem] = useState<string | null>(null);
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
                setProblem(problemText(err));
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
        ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-hidden />
        : status === 'ok'
            ? <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden />
            : <AlertCircle className="h-4 w-4 text-red-600" aria-hidden />;
    const selectClass = 'w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

    return (
        <div className="mx-auto max-w-2xl space-y-6">
            <div className="space-y-2 text-center">
                <h2 className="text-2xl font-bold text-foreground">Device check</h2>
                <p className="text-sm text-muted-foreground">Make sure your camera and microphone work before joining.</p>
            </div>

            {videoAllowed && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Video className="h-4 w-4" aria-hidden /> Camera</span>
                        {statusIcon}
                    </div>
                    <div className="relative aspect-video overflow-hidden rounded-2xl bg-gray-900">
                        {/* Always mounted so the stream can be attached as soon as it arrives. */}
                        <video ref={videoRef} autoPlay muted playsInline className={cn('h-full w-full -scale-x-100 object-cover', !showVideo && 'hidden')} />
                        {!showVideo && (
                            <div className="absolute inset-0 flex items-center justify-center text-sm text-white">
                                {status === 'checking' ? 'Starting camera...' : 'Camera not available'}
                            </div>
                        )}
                    </div>
                    {cameras.length > 1 && (
                        <select aria-label="Camera" value={active.videoDeviceId ?? pickedCamera} onChange={(e) => setPickedCamera(e.target.value)} className={selectClass}>
                            {cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                        </select>
                    )}
                </div>
            )}

            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Mic className="h-4 w-4" aria-hidden /> Microphone</span>
                    {statusIcon}
                </div>
                <div className="flex items-center gap-3 rounded-xl bg-gray-50 p-4">
                    <Volume2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
                        <div
                            className={cn('h-full rounded-full transition-all duration-100', level > 70 ? 'bg-green-500' : level > 30 ? 'bg-yellow-500' : 'bg-gray-400')}
                            style={{ width: `${level}%` }}
                        />
                    </div>
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">{level > 5 ? 'Speaking' : 'Quiet'}</span>
                </div>
                {mics.length > 1 && (
                    <select aria-label="Microphone" value={active.audioDeviceId ?? pickedMic} onChange={(e) => setPickedMic(e.target.value)} className={selectClass}>
                        {mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                    </select>
                )}
                <p className="text-xs text-muted-foreground">Speak to test your microphone. The bar should move when you talk.</p>
            </div>

            {problem && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-100 bg-red-50 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden />
                    <div className="space-y-2">
                        <p className="text-sm font-semibold text-red-900">{problem}</p>
                        <p className="text-xs text-red-700">You can still join, but the other side may not see or hear you.</p>
                        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>Check again</Button>
                    </div>
                </div>
            )}

            <div className="flex gap-3 pt-4">
                <Button variant="outline" className="flex-1" disabled={joining} onClick={onCancel}>Cancel</Button>
                <Button className="flex-1" disabled={status === 'checking' || joining} onClick={() => onJoin(active)}>
                    {joining
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Joining</>
                        : status === 'checking' ? 'Checking devices...' : status === 'error' ? 'Join anyway' : 'Join call'}
                </Button>
            </div>
        </div>
    );
}
