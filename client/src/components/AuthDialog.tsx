"use client";

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui'; // Imports from components/ui.tsx
import { Loader2, ArrowLeft, ShieldCheck, Mail, Smartphone, Lock, User as UserIcon, Calendar, Gift, KeyRound, RefreshCw, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

interface AuthDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

type AuthView = 'LOGIN' | 'SIGNUP' | 'FORGOT_PASSWORD';
type LoginMethod = 'PASSWORD' | 'OTP';

export function AuthDialog({ isOpen, onClose }: AuthDialogProps) {
    const { login } = useAuth();

    // Global State
    const [view, setView] = useState<AuthView>('LOGIN');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Login Data
    const [loginMethod, setLoginMethod] = useState<LoginMethod>('PASSWORD');
    const [loginMobile, setLoginMobile] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginOtp, setLoginOtp] = useState('');
    const [loginStep, setLoginStep] = useState<'INPUT' | 'OTP'>('INPUT'); // For OTP flow

    // Signup Data
    const [signupStep, setSignupStep] = useState<'DETAILS' | 'OTP'>('DETAILS');
    const [signupData, setSignupData] = useState({
        mobile: '',
        age: '',
        password: '',
        confirmPassword: '',
        email: '',
        name: '',
        referralCode: ''
    });
    const [signupOtp, setSignupOtp] = useState('');

    // Forgot Password Data
    const [forgotStep, setForgotStep] = useState<'MOBILE' | 'RESET' | 'SUCCESS'>('MOBILE');
    const [forgotMobile, setForgotMobile] = useState('');
    const [forgotOtp, setForgotOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');

    // Timers
    const [resendTimer, setResendTimer] = useState(0);

    useEffect(() => {
        let timer: any;
        if (resendTimer > 0) {
            timer = setInterval(() => setResendTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(timer);
    }, [resendTimer]);

    // Reset state on open/close or view change (basic cleanup)
    useEffect(() => {
        if (!isOpen) {
            setView('LOGIN');
            setError(null);
            setLoading(false);
        }
    }, [isOpen]);

    const handleError = (err: any) => {
        setError(err.response?.data?.error || 'Something went wrong. Please try again.');
        setLoading(false);
    };

    // --- LOGIN HANDLERS ---
    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (loginMethod === 'PASSWORD') {
                const res = await api.post('/auth/login/password', {
                    mobile: loginMobile,
                    password: loginPassword
                });
                login(res.data.user, res.data.token);
                onClose();
            } else {
                // OTP Login Flow
                if (loginStep === 'INPUT') {
                    await api.post('/auth/login/send-otp', { mobile: loginMobile });
                    setLoginStep('OTP');
                    setResendTimer(60);
                    setLoading(false);
                    return;
                }

                // Verify OTP
                const res = await api.post('/auth/login/verify-otp', {
                    mobile: loginMobile,
                    code: loginOtp
                });
                login(res.data.user, res.data.token);
                onClose();
            }
        } catch (err) {
            handleError(err);
        }
    };

    // --- SIGNUP HANDLERS ---
    const handleSignupSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (signupStep === 'DETAILS') {
            if (signupData.password !== signupData.confirmPassword) {
                setError("Passwords do not match");
                return;
            }
            if (signupData.password.length < 6) {
                setError("Password must be at least 6 characters");
                return;
            }
            if (!/^\d{10}$/.test(signupData.mobile)) {
                setError("Please enter a valid 10-digit mobile number");
                return;
            }

            setLoading(true);
            try {
                await api.post('/auth/signup/send-otp', {
                    mobile: signupData.mobile,
                    email: signupData.email || undefined
                });
                setSignupStep('OTP');
                setResendTimer(60);
                setLoading(false);
            } catch (err) {
                handleError(err);
            }
        } else {
            // Verify Signup OTP
            setLoading(true);
            try {
                const res = await api.post('/auth/signup/verify', {
                    ...signupData,
                    age: parseInt(signupData.age),
                    code: signupOtp
                });
                login(res.data.user, res.data.token);
                onClose();
            } catch (err) {
                handleError(err);
            }
        }
    };

    // --- FORGOT PASSWORD HANDLERS ---
    const handleForgotSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        if (forgotStep === 'MOBILE') {
            if (!/^\d{10}$/.test(forgotMobile)) {
                setError("Please enter a valid 10-digit mobile number");
                setLoading(false);
                return;
            }
            try {
                await api.post('/auth/forgot-password/send-otp', { mobile: forgotMobile });
                setForgotStep('RESET');
                setResendTimer(60);
                setLoading(false);
            } catch (err: any) {
                handleError(err);
            }
        } else {
            // Validate passwords match
            if (newPassword !== confirmNewPassword) {
                setError("Passwords do not match");
                setLoading(false);
                return;
            }
            if (newPassword.length < 6) {
                setError("Password must be at least 6 characters");
                setLoading(false);
                return;
            }
            try {
                await api.post('/auth/forgot-password/verify-reset', {
                    mobile: forgotMobile,
                    code: forgotOtp,
                    newPassword
                });
                setLoading(false);
                setForgotStep('SUCCESS');
            } catch (err: any) {
                handleError(err);
            }
        }
    };

    const handleResendForgotOtp = async () => {
        if (resendTimer > 0) return;
        setError(null);
        try {
            await api.post('/auth/forgot-password/send-otp', { mobile: forgotMobile });
            setResendTimer(60);
        } catch (err: any) {
            handleError(err);
        }
    };

    // --- RENDERERS ---

    const renderLogin = () => (
        <form onSubmit={handleLoginSubmit} className="space-y-4">
            {/* Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-6">
                <button
                    type="button"
                    onClick={() => { setLoginMethod('PASSWORD'); setLoginStep('INPUT'); setError(null); }}
                    className={cn(
                        "py-2 text-sm font-bold rounded-lg transition-all",
                        loginMethod === 'PASSWORD'
                            ? "bg-white text-primary shadow-sm"
                            : "text-muted-foreground hover:text-gray-900"
                    )}
                >
                    Password
                </button>
                <button
                    type="button"
                    onClick={() => { setLoginMethod('OTP'); setLoginStep('INPUT'); setError(null); }}
                    className={cn(
                        "py-2 text-sm font-bold rounded-lg transition-all",
                        loginMethod === 'OTP'
                            ? "bg-white text-primary shadow-sm"
                            : "text-muted-foreground hover:text-gray-900"
                    )}
                >
                    OTP
                </button>
            </div>

            {loginStep === 'INPUT' && (
                <>
                    <div className="space-y-2">
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Mobile Number"
                                value={loginMobile}
                                onChange={(e) => setLoginMobile(e.target.value)}
                                className="pl-10"
                                required
                            />
                        </div>
                        {loginMethod === 'PASSWORD' && (
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="password"
                                    placeholder="Password"
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    className="pl-10"
                                    required
                                />
                            </div>
                        )}
                    </div>
                    {loginMethod === 'PASSWORD' && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={() => { setView('FORGOT_PASSWORD'); setForgotStep('MOBILE'); setError(null); }}
                                className="text-xs font-semibold text-primary hover:underline"
                            >
                                Forgot Password?
                            </button>
                        </div>
                    )}
                </>
            )}

            {loginStep === 'OTP' && (
                <div className="space-y-2">
                    <p className="text-sm text-center text-muted-foreground mb-4">
                        Enter code sent to <b>{loginMobile}</b>
                    </p>
                    <Input
                        placeholder="Enter 6-digit OTP"
                        value={loginOtp}
                        onChange={(e) => setLoginOtp(e.target.value)}
                        maxLength={6}
                        className="text-center text-xl tracking-widest font-bold"
                        required
                    />
                </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loginStep === 'OTP' ? 'Verify & Login' : (loginMethod === 'OTP' ? 'Get OTP' : 'Login')}
            </Button>

            <div className="text-center mt-4">
                <p className="text-sm text-muted-foreground">
                    New to DocNow?{' '}
                    <button
                        type="button"
                        onClick={() => { setView('SIGNUP'); setSignupStep('DETAILS'); setError(null); }}
                        className="font-bold text-primary hover:underline"
                    >
                        Create Account
                    </button>
                </p>
            </div>
        </form>
    );

    const renderSignup = () => (
        <form onSubmit={handleSignupSubmit} className="space-y-4">
            {signupStep === 'DETAILS' ? (
                <>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative">
                            <UserIcon className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Full Name (Optional)"
                                value={signupData.name}
                                onChange={(e) => setSignupData({ ...signupData, name: e.target.value })}
                                className="pl-10"
                            />
                        </div>
                        <div className="relative">
                            <Calendar className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="number"
                                placeholder="Age"
                                value={signupData.age}
                                onChange={(e) => setSignupData({ ...signupData, age: e.target.value })}
                                className="pl-10"
                                required
                            />
                        </div>
                    </div>

                    <div className="relative">
                        <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Mobile Number"
                            value={signupData.mobile}
                            onChange={(e) => setSignupData({ ...signupData, mobile: e.target.value })}
                            className="pl-10"
                            maxLength={10}
                            required
                        />
                    </div>

                    <div className="relative">
                        <Mail className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                        <Input
                            type="email"
                            placeholder="Email Address (Optional)"
                            value={signupData.email}
                            onChange={(e) => setSignupData({ ...signupData, email: e.target.value })}
                            className="pl-10"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="Password"
                                value={signupData.password}
                                onChange={(e) => setSignupData({ ...signupData, password: e.target.value })}
                                className="pl-10"
                                required
                            />
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="Confirm"
                                value={signupData.confirmPassword}
                                onChange={(e) => setSignupData({ ...signupData, confirmPassword: e.target.value })}
                                className="pl-10"
                                required
                            />
                        </div>
                    </div>

                    {/* Referral Code (Optional) */}
                    <div className="relative">
                        <Gift className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Referral Code (Optional)"
                            value={signupData.referralCode}
                            onChange={(e) => setSignupData({ ...signupData, referralCode: e.target.value.toUpperCase() })}
                            className="pl-10 uppercase tracking-wider"
                            maxLength={12}
                        />
                    </div>
                </>
            ) : (
                <div className="space-y-4">
                    <p className="text-sm text-center text-muted-foreground mb-4">
                        We sent a code to <b>{signupData.mobile}</b>
                    </p>
                    <Input
                        placeholder="Enter 6-digit OTP"
                        value={signupOtp}
                        onChange={(e) => setSignupOtp(e.target.value)}
                        maxLength={6}
                        className="text-center text-xl tracking-widest font-bold"
                        required
                    />
                </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {signupStep === 'DETAILS' ? 'Send OTP' : 'Verify & Create Account'}
            </Button>

            <div className="text-center mt-4">
                <p className="text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <button
                        type="button"
                        onClick={() => { setView('LOGIN'); setError(null); }}
                        className="font-bold text-primary hover:underline"
                    >
                        Login
                    </button>
                </p>
            </div>
        </form>
    );

    const renderForgot = () => {
        // Success state
        if (forgotStep === 'SUCCESS') {
            return (
                <div className="text-center space-y-5 py-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mx-auto">
                        <CheckCircle2 className="w-8 h-8 text-green-600" />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-900 mb-1">Password Reset Successful</h3>
                        <p className="text-sm text-muted-foreground">
                            Your password has been updated. You can now login with your new password.
                        </p>
                    </div>
                    <Button
                        className="w-full"
                        onClick={() => {
                            setView('LOGIN');
                            setLoginMethod('PASSWORD');
                            setLoginMobile(forgotMobile);
                            setError(null);
                            setForgotStep('MOBILE');
                            setForgotOtp('');
                            setNewPassword('');
                            setConfirmNewPassword('');
                        }}
                    >
                        Go to Login
                    </Button>
                </div>
            );
        }

        return (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
                {forgotStep === 'MOBILE' ? (
                    <>
                        <p className="text-sm text-center text-muted-foreground mb-2">
                            Enter your registered mobile number to receive a reset code
                        </p>
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Mobile Number"
                                value={forgotMobile}
                                onChange={(e) => setForgotMobile(e.target.value)}
                                className="pl-10"
                                maxLength={10}
                                required
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <p className="text-sm text-center text-muted-foreground mb-2">
                            Enter the 6-digit code sent to <b>{forgotMobile}</b>
                        </p>

                        {/* OTP Input */}
                        <div className="relative">
                            <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Enter 6-digit Code"
                                value={forgotOtp}
                                onChange={(e) => setForgotOtp(e.target.value)}
                                maxLength={6}
                                className="pl-10 text-center text-lg tracking-widest font-bold"
                                required
                            />
                        </div>

                        {/* Resend OTP */}
                        <div className="flex justify-center">
                            <button
                                type="button"
                                onClick={handleResendForgotOtp}
                                disabled={resendTimer > 0}
                                className={cn(
                                    "flex items-center gap-1.5 text-xs font-semibold transition-colors",
                                    resendTimer > 0
                                        ? "text-muted-foreground cursor-not-allowed"
                                        : "text-primary hover:underline"
                                )}
                            >
                                <RefreshCw className="w-3.5 h-3.5" />
                                {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend Code'}
                            </button>
                        </div>

                        {/* New Password */}
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="New Password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="pl-10"
                                required
                            />
                        </div>

                        {/* Confirm Password */}
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="password"
                                placeholder="Confirm New Password"
                                value={confirmNewPassword}
                                onChange={(e) => setConfirmNewPassword(e.target.value)}
                                className="pl-10"
                                required
                            />
                        </div>

                        {/* Password hint */}
                        <p className="text-[11px] text-muted-foreground text-center">
                            Min 6 characters with at least one letter and one number
                        </p>
                    </>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {forgotStep === 'MOBILE' ? 'Send Reset Code' : 'Reset Password'}
                </Button>

                <div className="text-center mt-4">
                    <button
                        type="button"
                        onClick={() => { setView('LOGIN'); setError(null); setForgotStep('MOBILE'); }}
                        className="flex items-center justify-center gap-1 mx-auto text-sm font-medium text-muted-foreground hover:text-primary"
                    >
                        <ArrowLeft className="w-4 h-4" /> Back to Login
                    </button>
                </div>
            </form>
        );
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-[420px] max-h-[90vh] overflow-y-auto border-none shadow-2xl p-0">
                <div className="bg-primary/5 p-6 text-center border-b border-primary/10">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary mb-3">
                        <ShieldCheck className="w-6 h-6" />
                    </div>
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black text-center">
                            {view === 'LOGIN' && 'Welcome Back'}
                            {view === 'SIGNUP' && 'Create Account'}
                            {view === 'FORGOT_PASSWORD' && 'Reset Password'}
                        </DialogTitle>
                    </DialogHeader>
                </div>

                <div className="p-6">
                    {error && (
                        <div className="mb-6 p-3 bg-red-50 border border-red-100 text-red-600 text-sm rounded-lg font-medium text-center">
                            {error}
                        </div>
                    )}

                    {view === 'LOGIN' && renderLogin()}
                    {view === 'SIGNUP' && renderSignup()}
                    {view === 'FORGOT_PASSWORD' && renderForgot()}
                </div>
            </DialogContent>
        </Dialog>
    );
}
