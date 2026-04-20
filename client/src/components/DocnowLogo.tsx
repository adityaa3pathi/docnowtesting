'use client';

import Image from 'next/image';
import Link from 'next/link';

type DocnowLogoProps = {
    href?: string;
    width?: number;
    height?: number;
    priority?: boolean;
    panel?: boolean;
    /** When true, renders /no-bg-logo.png inside the white SVG blob (for dark/purple backgrounds) */
    noBackground?: boolean;
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
    noBackground = false,
    className = '',
    imageClassName = '',
    subtitle,
    subtitleClassName = '',
}: DocnowLogoProps) {
    const content = (
        <div className={`flex items-center gap-3 ${className}`}>
            {noBackground ? (
                /* White blob shape + transparent-bg logo — for dark/purple navbars */
                <div className="relative w-[140px] h-[52px]">
                    <svg
                        viewBox="0 0 233 101"
                        className="absolute -top-3 -left-4 w-[180px] h-[78px]"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M224.623 71.854C206.03 92.293 161.642 101 105.482 101C49.3212 101 0 58.4089 0 33.3241C0 8.23932 49.3212 10.1599 105.482 10.1599C254.977 -26.6303 237.903 46.4188 224.623 71.854Z"
                            fill="white"
                        />
                    </svg>
                    <Image
                        src="/no-bg-logo.png"
                        alt="DOCNOW"
                        width={width}
                        height={height}
                        priority={priority}
                        className={`relative z-10 h-[47px] w-auto object-contain top-1.5 left-1 ${imageClassName}`}
                    />
                </div>
            ) : (
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
            )}
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
