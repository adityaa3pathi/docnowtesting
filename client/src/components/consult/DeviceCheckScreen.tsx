'use client';
import { useState, useEffect, useRef } from 'react';
import { Video, Mic, Volume2, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface DeviceCheckScreenProps {
    onJoin: () => void;
    onCancel: () => void;
    videoAllowed: boolean;
}

export function DeviceCheckScreen({ onJoin, onCancel, videoAllowed }: DeviceCheckScreenProps) {
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
    const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedVideoDevice, setSelectedVideoDevice] = useState<string>('');
    const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');
    const [videoStatus, setVideoStatus] = useState<'checking' | 'success' | 'error'>('checking');
    const [audioStatus, setAudioStatus] = useState<'checking' | 'success' | 'error'>('checking');
    const [audioLevel, setAudioLevel] = useState(0);
    const [permissionDenied, setPermissionDenied] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // Get available devices
    useEffect(() => {
        async function getDevices() {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoDev = devices.filter(d => d.kind === 'videoinput');
                const audioDev = devices.filter(d => d.kind === 'audioinput');

                setVideoDevices(videoDev);
                setAudioDevices(audioDev);

                if (videoDev.length > 0 && !selectedVideoDevice) {
                    setSelectedVideoDevice(videoDev[0].deviceId);
                }
                if (audioDev.length > 0 && !selectedAudioDevice) {
                    setSelectedAudioDevice(audioDev[0].deviceId);
                }
            } catch (err) {
                console.error('Error getting devices:', err);
            }
        }

        getDevices();
    }, []);

    // Get video stream
    useEffect(() => {
        if (!videoAllowed || !selectedVideoDevice) return;

        let stream: MediaStream | null = null;

        async function startVideo() {
            setVideoStatus('checking');
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: selectedVideoDevice ? { exact: selectedVideoDevice } : undefined },
                    audio: false
                });

                setVideoStream(stream);
                setVideoStatus('success');

                if (videoRef.current) {
                    videoRef.current.srcObject = stream;
                }
            } catch (err) {
                console.error('Video error:', err);
                setVideoStatus('error');
                if (err instanceof Error && err.name === 'NotAllowedError') {
                    setPermissionDenied(true);
                }
            }
        }

        startVideo();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [selectedVideoDevice, videoAllowed]);

    // Get audio stream and analyze
    useEffect(() => {
        if (!selectedAudioDevice) return;

        let stream: MediaStream | null = null;

        async function startAudio() {
            setAudioStatus('checking');
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined },
                    video: false
                });

                setAudioStream(stream);
                setAudioStatus('success');

                // Setup audio level monitoring
                const audioContext = new AudioContext();
                const analyser = audioContext.createAnalyser();
                const microphone = audioContext.createMediaStreamSource(stream);
                const dataArray = new Uint8Array(analyser.frequencyBinCount);

                analyser.smoothingTimeConstant = 0.8;
                analyser.fftSize = 1024;
                microphone.connect(analyser);

                audioContextRef.current = audioContext;
                analyserRef.current = analyser;

                function updateAudioLevel() {
                    if (!analyserRef.current) return;

                    analyserRef.current.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                    setAudioLevel(Math.min(100, (average / 255) * 200)); // Amplify for visibility

                    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
                }

                updateAudioLevel();
            } catch (err) {
                console.error('Audio error:', err);
                setAudioStatus('error');
                if (err instanceof Error && err.name === 'NotAllowedError') {
                    setPermissionDenied(true);
                }
            }
        }

        startAudio();

        return () => {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [selectedAudioDevice]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (videoStream) {
                videoStream.getTracks().forEach(track => track.stop());
            }
            if (audioStream) {
                audioStream.getTracks().forEach(track => track.stop());
            }
        };
    }, [videoStream, audioStream]);

    const isReady = (!videoAllowed || videoStatus === 'success') && audioStatus === 'success';

    return (
        <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold text-foreground">Device Check</h2>
                <p className="text-sm text-muted-foreground">
                    Make sure your camera and microphone are working before joining
                </p>
            </div>

            {/* Video preview */}
            {videoAllowed && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                            <Video className="h-4 w-4" />
                            Camera
                        </label>
                        <div className="flex items-center gap-2">
                            {videoStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                            {videoStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                            {videoStatus === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
                        </div>
                    </div>

                    <div className="relative aspect-video bg-gray-900 rounded-2xl overflow-hidden">
                        {videoStream ? (
                            <video
                                ref={videoRef}
                                autoPlay
                                muted
                                playsInline
                                className="w-full h-full object-cover -scale-x-100"
                            />
                        ) : (
                            <div className="flex items-center justify-center h-full text-white text-sm">
                                {videoStatus === 'checking' ? 'Starting camera...' : 'Camera not available'}
                            </div>
                        )}
                    </div>

                    {videoDevices.length > 1 && (
                        <select
                            value={selectedVideoDevice}
                            onChange={(e) => setSelectedVideoDevice(e.target.value)}
                            className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        >
                            {videoDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>
                                    {device.label || `Camera ${device.deviceId.slice(0, 5)}`}
                                </option>
                            ))}
                        </select>
                    )}
                </div>
            )}

            {/* Audio preview */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <Mic className="h-4 w-4" />
                        Microphone
                    </label>
                    <div className="flex items-center gap-2">
                        {audioStatus === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                        {audioStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                        {audioStatus === 'error' && <AlertCircle className="h-4 w-4 text-red-600" />}
                    </div>
                </div>

                {/* Audio level meter */}
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-xl">
                    <Volume2 className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                            className={cn(
                                "h-full transition-all duration-100 rounded-full",
                                audioLevel > 70 ? "bg-green-500" :
                                audioLevel > 30 ? "bg-yellow-500" :
                                "bg-gray-400"
                            )}
                            style={{ width: `${audioLevel}%` }}
                        />
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 w-16">
                        {audioLevel > 5 ? 'Speaking' : 'Quiet'}
                    </span>
                </div>

                {audioDevices.length > 1 && (
                    <select
                        value={selectedAudioDevice}
                        onChange={(e) => setSelectedAudioDevice(e.target.value)}
                        className="w-full rounded-xl border border-border bg-input px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    >
                        {audioDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>
                                {device.label || `Microphone ${device.deviceId.slice(0, 5)}`}
                            </option>
                        ))}
                    </select>
                )}

                <p className="text-xs text-muted-foreground">
                    Speak to test your microphone. The bar should move when you talk.
                </p>
            </div>

            {/* Permission denied warning */}
            {permissionDenied && (
                <div className="rounded-xl bg-red-50 border border-red-100 p-4">
                    <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <p className="text-sm font-semibold text-red-900">Permission denied</p>
                            <p className="text-xs text-red-700">
                                Click the lock icon in your browser's address bar and allow camera and microphone access.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-4">
                <Button
                    variant="outline"
                    className="flex-1"
                    onClick={onCancel}
                >
                    Cancel
                </Button>
                <Button
                    className="flex-1"
                    disabled={!isReady}
                    onClick={onJoin}
                >
                    {isReady ? 'Join Call' : 'Checking devices...'}
                </Button>
            </div>
        </div>
    );
}
