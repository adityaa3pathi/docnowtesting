// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ post: vi.fn(), login: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: { post: m.post } }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ login: m.login }) }));
const { AuthDialog } = await import('./AuthDialog');

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Radix portals the dialog into document.body, so queries run against the whole document.
const text = () => document.body.textContent ?? '';
const byPlaceholder = (p: string) => document.body.querySelector(`[placeholder="${p}"]`) as HTMLInputElement;
const buttons = () => Array.from(document.body.querySelectorAll('button'));
const button = (label: string) => buttons().find((b) => b.textContent?.trim() === label);

// React tracks the last value it wrote, so the prototype setter is needed for onChange to fire.
const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
async function type(placeholder: string, value: string) {
    const input = byPlaceholder(placeholder);
    await act(async () => {
        nativeValue.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}
const click = async (el: Element | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const tick = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

let root: ReturnType<typeof createRoot>;
function open() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<AuthDialog isOpen onClose={() => {}} />));
}

beforeEach(() => {
    vi.useFakeTimers();
    m.post.mockReset();
    m.post.mockResolvedValue({ data: { ok: true } });
    open();
});

afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = '';
    vi.useRealTimers();
});

/** Every flow lands on the same ResendOtp gate: blocked for 10s, then one resend per click. */
async function expectResendGate(url: string, callsSoFar: number) {
    expect(text()).toContain("Didn't receive the OTP?");
    expect(text()).toContain('Resend in 10s');
    expect(button('Resend OTP')).toBeUndefined();

    await tick(9_000);
    expect(text()).toContain('Resend in 1s');
    expect(button('Resend OTP')).toBeUndefined();
    expect(m.post).toHaveBeenCalledTimes(callsSoFar);

    await tick(1_000);
    expect(text()).not.toContain('Resend in');
    await click(button('Resend OTP'));

    expect(m.post).toHaveBeenCalledTimes(callsSoFar + 1);
    expect(m.post.mock.lastCall?.[0]).toBe(url);
    expect(text()).toContain('Resend in 10s');
}

describe('AuthDialog resend OTP', () => {
    it('blocks resend for 10s on the OTP login flow', async () => {
        await click(button('OTP'));
        await type('Enter your WhatsApp number', '9876543210');
        await click(button('Get OTP'));

        expect(m.post).toHaveBeenCalledWith('/auth/login/send-otp', { mobile: '9876543210' });
        expect(text()).toContain('OTP sent on WhatsApp to');
        await expectResendGate('/auth/login/send-otp', 1);
    });

    it('blocks resend for 10s on the signup flow', async () => {
        await click(button('Create Account'));
        await type('Full Name', 'Asha Devi');
        await type('Age', '32');
        await click(button('Female'));
        await type('WhatsApp mobile number', '9876543210');
        await type('Password', 'secret1');
        await type('Confirm password', 'secret1');
        await click(button('Send OTP'));

        expect(m.post).toHaveBeenCalledWith('/auth/signup/send-otp', { mobile: '9876543210', email: undefined });
        expect(text()).toContain('OTP sent on WhatsApp to');
        await expectResendGate('/auth/signup/send-otp', 1);
    });

    it('blocks resend for 10s on the forgot-password flow', async () => {
        await click(button('Forgot Password?'));
        await type('Enter your WhatsApp number', '9876543210');
        await click(button('Send Reset Code'));

        expect(m.post).toHaveBeenCalledWith('/auth/forgot-password/send-otp', { mobile: '9876543210' });
        expect(text()).toContain('Enter the 6-digit OTP sent on WhatsApp to');
        await expectResendGate('/auth/forgot-password/send-otp', 1);
    });
});

describe('AuthDialog WhatsApp wording', () => {
    it('asks for a WhatsApp number on login and for the WhatsApp mobile number on signup', async () => {
        expect(byPlaceholder('Enter your WhatsApp number')).toBeTruthy();

        await click(button('Create Account'));
        expect(byPlaceholder('WhatsApp mobile number')).toBeTruthy();
    });
});
