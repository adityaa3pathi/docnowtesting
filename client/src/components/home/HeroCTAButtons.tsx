"use client";

import { useRouter } from 'next/navigation';

export function HeroCTAButtons() {
  const router = useRouter();

  return (
    <div className="flex flex-wrap gap-4 mb-10">
      <button
        onClick={() => router.push('/search?type=TEST')}
        className="border border-white text-white font-inter font-semibold text-base px-6 py-3 rounded-lg hover:bg-white/10 transition-all whitespace-nowrap"
      >
        Book a Test Now
      </button>
      <button
        onClick={() => router.push('/search?type=PACKAGE')}
        className="border border-white text-white font-inter font-semibold text-base px-6 py-3 rounded-lg hover:bg-white/10 transition-all whitespace-nowrap"
      >
        View Health Packages
      </button>
    </div>
  );
}
