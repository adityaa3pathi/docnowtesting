'use client';
import type { ComponentType } from 'react';
import { Maximize, Mic, MicOff, Minimize, PhoneOff, PictureInPicture2, SwitchCamera, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { CallCopy } from './callCopy';

interface CallButtonProps {
    icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
    label: string;
    onClick: () => void;
    /** Red tint: the mic or camera is off, or the button ends the call. */
    tone?: 'normal' | 'off' | 'danger';
    title?: string;
    disabled?: boolean;
    senior?: boolean;
    dark?: boolean;
}

/** Round icon button. The word shows on wider screens and always for seniors; screen readers always get it. */
function CallButton({ icon: Icon, label, onClick, tone = 'normal', title, disabled, senior, dark }: CallButtonProps) {
    return (
        <button type="button" onClick={onClick} disabled={disabled} title={title}
            className="flex min-w-14 flex-col items-center gap-1 rounded-xl p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
            <span className={cn(
                'flex items-center justify-center rounded-full transition-colors',
                senior ? 'h-16 w-16' : 'h-12 w-12',
                tone === 'danger' && 'bg-destructive text-white',
                tone === 'off' && 'bg-red-100 text-red-700',
                tone === 'normal' && (dark ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-900'),
            )}>
                <Icon className={senior ? 'h-7 w-7' : 'h-5 w-5'} aria-hidden />
            </span>
            <span className={cn('font-semibold', senior ? 'text-base' : 'sr-only text-xs sm:not-sr-only', dark ? 'text-white' : 'text-foreground')}>
                {label}
            </span>
        </button>
    );
}

interface ControlBarProps {
    copy: CallCopy;
    connected: boolean;
    micOn: boolean;
    camOn: boolean;
    videoAllowed: boolean;
    canFlip: boolean;
    canFullscreen: boolean;
    fullscreen: boolean;
    canPip: boolean;
    leaving: boolean;
    confirmingLeave: boolean;
    senior?: boolean;
    onMic: () => void;
    onCamera: () => void;
    onFlip: () => void;
    onFullscreen: () => void;
    onPip: () => void;
    onAskLeave: (asking: boolean) => void;
    onLeave: () => void;
}

export function ControlBar(p: ControlBarProps) {
    const { copy, senior, fullscreen: dark } = p;

    // One stray tap must not end a paid consultation, so Leave asks first.
    if (p.confirmingLeave) {
        return (
            <div role="alertdialog" aria-label={copy.leaveConfirm} className="flex flex-wrap items-center justify-center gap-3">
                <p className={cn('font-semibold', senior ? 'text-lg' : 'text-sm', dark ? 'text-white' : 'text-foreground')}>{copy.leaveConfirm}</p>
                <Button variant="outline" size={senior ? 'lg' : 'sm'} autoFocus onClick={() => p.onAskLeave(false)}>{copy.stay}</Button>
                <Button size={senior ? 'lg' : 'sm'} disabled={p.leaving} className="bg-destructive hover:bg-destructive/90" onClick={p.onLeave}>
                    <PhoneOff className="mr-1.5 h-4 w-4" aria-hidden /> {copy.yesLeave}
                </Button>
            </div>
        );
    }

    const common = { senior, dark, disabled: !p.connected };
    return (
        <div className="flex flex-wrap items-start justify-center gap-1 sm:gap-3">
            <CallButton {...common} icon={p.micOn ? Mic : MicOff} label={p.micOn ? copy.mute : copy.unmute} tone={p.micOn ? 'normal' : 'off'} title="M" onClick={p.onMic} />
            {p.videoAllowed && (
                <CallButton {...common} icon={p.camOn ? Video : VideoOff} label={p.camOn ? copy.cameraOff : copy.cameraOn} tone={p.camOn ? 'normal' : 'off'} title="V" onClick={p.onCamera} />
            )}
            {p.videoAllowed && p.camOn && p.canFlip && <CallButton {...common} icon={SwitchCamera} label={copy.flip} onClick={p.onFlip} />}
            {p.canFullscreen && (
                <CallButton {...common} icon={p.fullscreen ? Minimize : Maximize} label={p.fullscreen ? copy.exitFullscreen : copy.fullscreen} title="F" onClick={p.onFullscreen} />
            )}
            {p.canPip && <CallButton {...common} icon={PictureInPicture2} label={copy.pip} onClick={p.onPip} />}
            <CallButton senior={senior} dark={dark} icon={PhoneOff} label={copy.leave} tone="danger" disabled={p.leaving} onClick={() => p.onAskLeave(true)} />
        </div>
    );
}
