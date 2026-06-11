"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { Button, Input } from '@/components/ui';
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Phone,
} from 'lucide-react';

export function CallbackForm() {
  const [callbackName, setCallbackName] = useState('');
  const [callbackMobile, setCallbackMobile] = useState('');
  const [submittingCallback, setSubmittingCallback] = useState(false);
  const [callbackSent, setCallbackSent] = useState(false);

  const handleCallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!callbackName.trim() || !callbackMobile.trim()) {
      toast.error('Please enter your name and mobile number');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(callbackMobile.replace(/\s/g, ''))) {
      toast.error('Please enter a valid 10-digit mobile number');
      return;
    }
    setSubmittingCallback(true);
    try {
      await api.post('/callback/request', {
        name: callbackName.trim(),
        mobile: callbackMobile.trim(),
      });
      setCallbackSent(true);
      toast.success('Callback request submitted! We\'ll call you shortly.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmittingCallback(false);
    }
  };

  if (callbackSent) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Request Received!</h3>
        <p className="text-gray-500 font-medium">
          Our team will call you within 15 minutes. Thank you!
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleCallbackSubmit} className="space-y-4">
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Your Name</label>
        <Input
          placeholder="Enter your full name"
          value={callbackName}
          onChange={(e) => setCallbackName(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="text-sm font-semibold text-gray-700 mb-1.5 block">Mobile Number</label>
        <Input
          placeholder="10-digit mobile number"
          value={callbackMobile}
          onChange={(e) => setCallbackMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
          required
        />
      </div>
      <Button
        size="lg"
        className="w-full py-7 text-lg mt-2"
        disabled={submittingCallback}
      >
        {submittingCallback ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Submitting...
          </>
        ) : (
          <>
            <Phone className="w-5 h-5 mr-2" />
            Request Callback
          </>
        )}
      </Button>
      <p className="text-xs text-gray-400 text-center font-medium mt-2">
        By requesting a callback, you agree to our{' '}
        <a href="/privacy" className="text-purple-600 underline">Privacy Policy</a>.
      </p>
      <div className="rounded-2xl border border-purple-100 bg-purple-50 px-4 py-4 text-left">
        <p className="text-sm font-bold text-[#2d1670]">Need a corporate diagnostics partner instead?</p>
        <p className="mt-1 text-sm text-gray-600">
          Talk to our corporate team for employee wellness programs, onsite camps, and bulk testing partnerships.
        </p>
        <Link href="/corporate" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[#4b2192] hover:text-[#2d1670]">
          Talk to our corporate team
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </form>
  );
}
