'use client';

import Image from 'next/image';
import Link from 'next/link';

type DocnowLogoProps = {
    href?: string;
    width?: number;
    height?: number;
    priority?: boolean;
    panel?: boolean;
    className?: string;
    imageClassName?: string;
    subtitle?: string;
    subtitleClassName?: string;
};

export function DocnowLogo({
    href,
    width = 180,
    height = 44,
    priority = false,
    panel = false,
    className = '',
    imageClassName = '',
    subtitle,
    subtitleClassName = '',
}: DocnowLogoProps) {
    const content = (
        <div className={`flex items-center gap-3 ${className}`}>
            <div className={panel ? 'rounded-xl bg-white px-3 py-2 shadow-sm' : ''}>
                <Image
                    src="/docnow-logo.png"
                    alt="DOCNOW"
                    width={width}
                    height={height}
                    priority={priority}
                    className={`h-auto w-auto object-contain ${imageClassName}`}
                />
            </div>
            {subtitle ? (
                <div className={`min-w-0 ${subtitleClassName}`}>
                    <p className="text-xs font-semibold uppercase tracking-[0.22em]">{subtitle}</p>
                </div>
            ) : null}
        </div>
    );

    if (!href) {
        return content;
    }

    return (
        <Link href={href} className="inline-flex items-center" aria-label="DOCNOW home">
            {content}
        </Link>
    );
}
