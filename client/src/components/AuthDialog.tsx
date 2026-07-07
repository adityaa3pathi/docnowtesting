"use client";

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui'; // Imports from components/ui.tsx
import { Loader2, ArrowLeft, ShieldCheck, Mail, Smartphone, Lock, User as UserIcon, Calendar, Gift, KeyRound, RefreshCw, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// --- Zod Schemas ---

// Login: password method
const loginPasswordSchema = z.object({
    mobile: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit mobile number'),
    password: z.string().min(1, 'Password is required'),
});
type LoginPasswordData = z.infer<typeof loginPasswordSchema>;

// Login: OTP method — single schema, OTP validated manually in step 2
const loginOtpSchema = z.object({
    mobile: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit mobile number'),
    otp: z.string().optional(),
});
type LoginOtpData = z.infer<typeof loginOtpSchema>;

// Signup
const signupSchema = z.object({
    name: z.string().min(1, 'Full Name is required').refine(v => !/\d/.test(v), 'Name cannot contain numbers'),
    age: z.string().min(1, 'Age is required').refine(v => { const n = parseInt(v); return n > 0 && n <= 120; }, 'Please enter a valid age'),
    gender: z.string().min(1, 'Please select a gender'),
    mobile: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit mobile number'),
    email: z.string().email('Invalid email').optional().or(z.literal('')),
    password: z.string().min(6, 'Password must be at least 6 characters'),
    confirmPassword: z.string(),
    referralCode: z.string().optional(),
}).refine(d => d.password === d.confirmPassword, {
    message: 'Passwords do not match', path: ['confirmPassword'],
});
type SignupData = z.infer<typeof signupSchema>;

// Signup OTP step
const signupOtpSchema = z.object({
    otp: z.string().regex(/^\d{6}$/, 'Please enter a valid 6-digit OTP'),
});
type SignupOtpData = z.infer<typeof signupOtpSchema>;

// Forgot password: step 1 (mobile)
const forgotMobileSchema = z.object({
    mobile: z.string().regex(/^\d{10}$/, 'Please enter a valid 10-digit mobile number'),
});
type ForgotMobileData = z.infer<typeof forgotMobileSchema>;

// Forgot password: step 2 (reset)
const forgotResetSchema = z.object({
    otp: z.string().regex(/^\d{6}$/, 'Please enter a valid 6-digit code'),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
    confirmNewPassword: z.string(),
}).refine(d => d.newPassword === d.confirmNewPassword, {
    message: 'Passwords do not match', path: ['confirmNewPassword'],
});
type ForgotResetData = z.infer<typeof forgotResetSchema>;

// --- Component ---

interface AuthDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess?: () => void;
}

type AuthView = 'LOGIN' | 'SIGNUP' | 'FORGOT_PASSWORD';
type LoginMethod = 'PASSWORD' | 'OTP';

export function AuthDialog({ isOpen, onClose, onLoginSuccess }: AuthDialogProps) {
    const { login } = useAuth();

    // Global State
    const [view, setView] = useState<AuthView>('LOGIN');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null); // API errors only

    // Login State
    const [loginMethod, setLoginMethod] = useState<LoginMethod>('PASSWORD');
    const [loginStep, setLoginStep] = useState<'INPUT' | 'OTP'>('INPUT'); // For OTP flow

    // Signup State
    const [signupStep, setSignupStep] = useState<'DETAILS' | 'OTP'>('DETAILS');

    // Forgot Password State
    const [forgotStep, setForgotStep] = useState<'MOBILE' | 'RESET' | 'SUCCESS'>('MOBILE');

    // UI State
    const [showPassword, setShowPassword] = useState(false);

    // Timers
    const [resendTimer, setResendTimer] = useState(0);

    // --- Form instances ---

    const loginPasswordForm = useForm<LoginPasswordData>({
        resolver: zodResolver(loginPasswordSchema),
        defaultValues: { mobile: '', password: '' },
    });

    const loginOtpForm = useForm<LoginOtpData>({
        resolver: zodResolver(loginOtpSchema),
        defaultValues: { mobile: '', otp: '' },
    });

    const signupForm = useForm<SignupData>({
        resolver: zodResolver(signupSchema),
        defaultValues: {
            mobile: '', age: '', gender: '', password: '',
            confirmPassword: '', email: '', name: '', referralCode: '',
        },
    });

    const signupOtpForm = useForm<SignupOtpData>({
        resolver: zodResolver(signupOtpSchema),
        defaultValues: { otp: '' },
    });

    const forgotMobileForm = useForm<ForgotMobileData>({
        resolver: zodResolver(forgotMobileSchema),
        defaultValues: { mobile: '' },
    });

    const forgotResetForm = useForm<ForgotResetData>({
        resolver: zodResolver(forgotResetSchema),
        defaultValues: { otp: '', newPassword: '', confirmNewPassword: '' },
    });

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

    useEffect(() => {
        if (!isOpen || typeof window === 'undefined') return;

        const params = new URLSearchParams(window.location.search);
        const referralCode = params.get('ref') || params.get('referralCode');
        if (!referralCode) return;

        signupForm.setValue('referralCode', referralCode.toUpperCase());
        setView('SIGNUP');
        setSignupStep('DETAILS');
    }, [isOpen]);

    const handleError = (err: any) => {
        setError(err.response?.data?.error || 'Something went wrong. Please try again.');
        setLoading(false);
    };

    // --- LOGIN HANDLERS ---
    const handleLoginPasswordSubmit = async (data: LoginPasswordData) => {
        setError(null);
        setLoading(true);
        try {
            const res = await api.post('/auth/login/password', {
                mobile: data.mobile,
                password: data.password
            });
            login(res.data.user);
            if (onLoginSuccess) { onLoginSuccess(); } else { onClose(); }
        } catch (err) {
            handleError(err);
        }
    };

    const handleLoginOtpSubmit = async (data: LoginOtpData) => {
        setError(null);
        setLoading(true);
        try {
            if (loginStep === 'INPUT') {
                await api.post('/auth/login/send-otp', { mobile: data.mobile });
                setLoginStep('OTP');
                setResendTimer(60);
                setLoading(false);
                return;
            }

            // Verify OTP — manual validation since schema has otp as optional
            if (!data.otp || !/^\d{6}$/.test(data.otp)) {
                setError('Please enter a valid 6-digit OTP');
                setLoading(false);
                return;
            }

            const res = await api.post('/auth/login/verify-otp', {
                mobile: data.mobile,
                code: data.otp
            });
            login(res.data.user);
            if (onLoginSuccess) { onLoginSuccess(); } else { onClose(); }
        } catch (err) {
            handleError(err);
        }
    };

    // --- SIGNUP HANDLERS ---
    const handleSignupDetailsSubmit = async (data: SignupData) => {
        setError(null);
        setLoading(true);
        try {
            await api.post('/auth/signup/send-otp', {
                mobile: data.mobile,
                email: data.email || undefined
            });
            setSignupStep('OTP');
            setResendTimer(60);
            setLoading(false);
        } catch (err) {
            handleError(err);
        }
    };

    const handleSignupOtpSubmit = async (otpData: SignupOtpData) => {
        setError(null);
        setLoading(true);
        try {
            const signupData = signupForm.getValues();
            const res = await api.post('/auth/signup/verify', {
                ...signupData,
                age: parseInt(signupData.age),
                code: otpData.otp
            });
            login(res.data.user);
            if (onLoginSuccess) { onLoginSuccess(); } else { onClose(); }
        } catch (err) {
            handleError(err);
        }
    };

    // --- FORGOT PASSWORD HANDLERS ---
    const handleForgotMobileSubmit = async (data: ForgotMobileData) => {
        setError(null);
        setLoading(true);
        try {
            await api.post('/auth/forgot-password/send-otp', { mobile: data.mobile });
            setForgotStep('RESET');
            setResendTimer(60);
            setLoading(false);
        } catch (err: any) {
            handleError(err);
        }
    };

    const handleForgotResetSubmit = async (data: ForgotResetData) => {
        setError(null);
        setLoading(true);
        try {
            const forgotMobile = forgotMobileForm.getValues('mobile');
            await api.post('/auth/forgot-password/verify-reset', {
                mobile: forgotMobile,
                code: data.otp,
                newPassword: data.newPassword
            });
            setLoading(false);
            setForgotStep('SUCCESS');
        } catch (err: any) {
            handleError(err);
        }
    };

    const handleResendForgotOtp = async () => {
        if (resendTimer > 0) return;
        setError(null);
        try {
            const forgotMobile = forgotMobileForm.getValues('mobile');
            await api.post('/auth/forgot-password/send-otp', { mobile: forgotMobile });
            setResendTimer(60);
        } catch (err: any) {
            handleError(err);
        }
    };

    // --- RENDERERS ---

    const renderLogin = () => {
        const isPasswordMethod = loginMethod === 'PASSWORD';

        if (isPasswordMethod) {
            const { register, handleSubmit, formState: { errors } } = loginPasswordForm;
            return (
                <form onSubmit={handleSubmit(handleLoginPasswordSubmit)} className="space-y-4">
                    {/* Tabs */}
                    <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-6">
                        <button
                            type="button"
                            onClick={() => { setLoginMethod('PASSWORD'); setLoginStep('INPUT'); setError(null); }}
                            className={cn(
                                "py-2 text-sm font-bold rounded-lg transition-all",
                                "bg-white text-primary shadow-sm"
                            )}
                        >
                            Password
                        </button>
                        <button
                            type="button"
                            onClick={() => { setLoginMethod('OTP'); setLoginStep('INPUT'); setError(null); }}
                            className={cn(
                                "py-2 text-sm font-bold rounded-lg transition-all",
                                "text-muted-foreground hover:text-gray-900"
                            )}
                        >
                            OTP
                        </button>
                    </div>

                    <div className="space-y-2">
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Mobile Number"
                                {...register('mobile')}
                                className="pl-10"
                            />
                            {errors.mobile && (
                                <p className="text-xs text-red-500 mt-1">{errors.mobile.message}</p>
                            )}
                        </div>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type={showPassword ? "text" : "password"}
                                placeholder="Password"
                                {...register('password')}
                                className="pl-10 pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                            >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                            </button>
                            {errors.password && (
                                <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={() => { setView('FORGOT_PASSWORD'); setForgotStep('MOBILE'); setError(null); }}
                            className="text-xs font-semibold text-primary hover:underline"
                        >
                            Forgot Password?
                        </button>
                    </div>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Login
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
        }

        // OTP login method
        const { register, handleSubmit, formState: { errors } } = loginOtpForm;
        return (
            <form onSubmit={handleSubmit(handleLoginOtpSubmit)} className="space-y-4">
                {/* Tabs */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-6">
                    <button
                        type="button"
                        onClick={() => { setLoginMethod('PASSWORD'); setLoginStep('INPUT'); setError(null); }}
                        className={cn(
                            "py-2 text-sm font-bold rounded-lg transition-all",
                            "text-muted-foreground hover:text-gray-900"
                        )}
                    >
                        Password
                    </button>
                    <button
                        type="button"
                        onClick={() => { setLoginMethod('OTP'); setLoginStep('INPUT'); setError(null); }}
                        className={cn(
                            "py-2 text-sm font-bold rounded-lg transition-all",
                            "bg-white text-primary shadow-sm"
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
                                    {...register('mobile')}
                                    className="pl-10"
                                />
                                {errors.mobile && (
                                    <p className="text-xs text-red-500 mt-1">{errors.mobile.message}</p>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {loginStep === 'OTP' && (
                    <div className="space-y-2">
                        <p className="text-sm text-center text-muted-foreground mb-4">
                            Enter code sent to <b>{loginOtpForm.getValues('mobile')}</b>
                        </p>
                        <Input
                            placeholder="Enter 6-digit OTP"
                            {...register('otp')}
                            maxLength={6}
                            className="text-center text-xl tracking-widest font-bold"
                        />
                        {errors.otp && (
                            <p className="text-xs text-red-500 mt-1">{errors.otp.message}</p>
                        )}
                    </div>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {loginStep === 'OTP' ? 'Verify & Login' : 'Get OTP'}
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
    };

    const renderSignup = () => {
        if (signupStep === 'DETAILS') {
            const { register, handleSubmit, formState: { errors }, watch, setValue } = signupForm;
            const gender = watch('gender');
            return (
                <form onSubmit={handleSubmit(handleSignupDetailsSubmit)} className="space-y-4">
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                                <UserIcon className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <Input
                                    placeholder="Full Name"
                                    {...register('name')}
                                    className="pl-10"
                                />
                                {errors.name && (
                                    <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>
                                )}
                            </div>
                            <div className="relative">
                                <Calendar className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type="number"
                                    placeholder="Age"
                                    {...register('age')}
                                    className="pl-10"
                                    min="1"
                                    max="120"
                                />
                                {errors.age && (
                                    <p className="text-xs text-red-500 mt-1">{errors.age.message}</p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                            <button
                                type="button"
                                onClick={() => setValue('gender', 'Male', { shouldValidate: true })}
                                className={cn(
                                    "py-2 text-sm font-bold rounded-lg transition-all",
                                    gender === 'Male'
                                        ? "bg-white text-primary shadow-sm"
                                        : "text-muted-foreground hover:text-gray-900"
                                )}
                            >
                                Male
                            </button>
                            <button
                                type="button"
                                onClick={() => setValue('gender', 'Female', { shouldValidate: true })}
                                className={cn(
                                    "py-2 text-sm font-bold rounded-lg transition-all",
                                    gender === 'Female'
                                        ? "bg-white text-primary shadow-sm"
                                        : "text-muted-foreground hover:text-gray-900"
                                )}
                            >
                                Female
                            </button>
                        </div>
                        {errors.gender && (
                            <p className="text-xs text-red-500 mt-1">{errors.gender.message}</p>
                        )}

                        <div className="relative">
                            <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Mobile Number"
                                {...register('mobile')}
                                className="pl-10"
                                maxLength={10}
                            />
                            {errors.mobile && (
                                <p className="text-xs text-red-500 mt-1">{errors.mobile.message}</p>
                            )}
                        </div>

                        <div className="relative">
                            <Mail className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                type="email"
                                placeholder="Email Address (Optional)"
                                {...register('email')}
                                className="pl-10"
                            />
                            {errors.email && (
                                <p className="text-xs text-red-500 mt-1">{errors.email.message}</p>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Password"
                                    {...register('password')}
                                    className="pl-10 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                                {errors.password && (
                                    <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>
                                )}
                            </div>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                                <Input
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Confirm"
                                    {...register('confirmPassword')}
                                    className="pl-10 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                                >
                                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                                </button>
                                {errors.confirmPassword && (
                                    <p className="text-xs text-red-500 mt-1">{errors.confirmPassword.message}</p>
                                )}
                            </div>
                        </div>

                        {/* Referral Code (Optional) */}
                        <div className="relative">
                            <Gift className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Referral Code (Optional)"
                                {...register('referralCode', {
                                    onChange: (e) => {
                                        e.target.value = e.target.value.toUpperCase();
                                    }
                                })}
                                className="pl-10 uppercase tracking-wider"
                                maxLength={12}
                            />
                        </div>
                    </>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send OTP
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
        }

        // OTP step
        const { register, handleSubmit, formState: { errors } } = signupOtpForm;
        return (
            <form onSubmit={handleSubmit(handleSignupOtpSubmit)} className="space-y-4">
                <div className="space-y-4">
                    <p className="text-sm text-center text-muted-foreground mb-4">
                        We sent a code to <b>{signupForm.getValues('mobile')}</b>
                    </p>
                    <Input
                        placeholder="Enter 6-digit OTP"
                        {...register('otp')}
                        maxLength={6}
                        className="text-center text-xl tracking-widest font-bold"
                    />
                    {errors.otp && (
                        <p className="text-xs text-red-500 mt-1">{errors.otp.message}</p>
                    )}
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Verify & Create Account
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
    };

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
                            loginPasswordForm.setValue('mobile', forgotMobileForm.getValues('mobile'));
                            setError(null);
                            setForgotStep('MOBILE');
                            forgotResetForm.reset();
                            forgotMobileForm.reset();
                        }}
                    >
                        Go to Login
                    </Button>
                </div>
            );
        }

        if (forgotStep === 'MOBILE') {
            const { register, handleSubmit, formState: { errors } } = forgotMobileForm;
            return (
                <form onSubmit={handleSubmit(handleForgotMobileSubmit)} className="space-y-4">
                    <>
                        <p className="text-sm text-center text-muted-foreground mb-2">
                            Enter your registered mobile number to receive a reset code
                        </p>
                        <div className="relative">
                            <Smartphone className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                            <Input
                                placeholder="Mobile Number"
                                {...register('mobile')}
                                className="pl-10"
                                maxLength={10}
                            />
                            {errors.mobile && (
                                <p className="text-xs text-red-500 mt-1">{errors.mobile.message}</p>
                            )}
                        </div>
                    </>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Send Reset Code
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
        }

        // RESET step
        const { register, handleSubmit, formState: { errors } } = forgotResetForm;
        return (
            <form onSubmit={handleSubmit(handleForgotResetSubmit)} className="space-y-4">
                <>
                    <p className="text-sm text-center text-muted-foreground mb-2">
                        Enter the 6-digit code sent to <b>{forgotMobileForm.getValues('mobile')}</b>
                    </p>

                    {/* OTP Input */}
                    <div className="relative">
                        <KeyRound className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                        <Input
                            placeholder="Enter 6-digit Code"
                            {...register('otp')}
                            maxLength={6}
                            className="pl-10 text-center text-lg tracking-widest font-bold"
                        />
                        {errors.otp && (
                            <p className="text-xs text-red-500 mt-1">{errors.otp.message}</p>
                        )}
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
                            type={showPassword ? "text" : "password"}
                            placeholder="New Password"
                            {...register('newPassword')}
                            className="pl-10 pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                        {errors.newPassword && (
                            <p className="text-xs text-red-500 mt-1">{errors.newPassword.message}</p>
                        )}
                    </div>

                    {/* Confirm Password */}
                    <div className="relative">
                        <Lock className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
                        <Input
                            type={showPassword ? "text" : "password"}
                            placeholder="Confirm New Password"
                            {...register('confirmNewPassword')}
                            className="pl-10 pr-10"
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                            {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                        {errors.confirmNewPassword && (
                            <p className="text-xs text-red-500 mt-1">{errors.confirmNewPassword.message}</p>
                        )}
                    </div>

                    {/* Password hint */}
                    <p className="text-[11px] text-muted-foreground text-center">
                        Min 6 characters with at least one letter and one number
                    </p>
                </>

                <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Reset Password
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
