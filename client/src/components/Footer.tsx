'use client';

import { useState } from 'react';
import { Facebook, Instagram, Linkedin, Mail, Phone, MapPin, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { DocnowLogo } from './DocnowLogo';
import {
    SUPPORT_ADDRESS,
    SUPPORT_EMAIL,
    SUPPORT_PHONE_DISPLAY,
    SUPPORT_PHONE_LINK,
} from '@/lib/supportConfig';

interface AccordionSectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

function FooterAccordion({ title, children, defaultOpen = false }: AccordionSectionProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-100 md:border-0">
            {/* Mobile: Clickable Header */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex w-full items-center justify-between py-3 md:hidden"
                aria-expanded={isOpen}
            >
                <h3 className="text-xs font-black uppercase tracking-widest text-foreground">
                    {title}
                </h3>
                <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {/* Desktop: static header */}
            <h3 className="mb-4 hidden text-xs font-black uppercase tracking-widest text-foreground md:block">
                {title}
            </h3>

            {/* Content — collapsed on mobile, always visible on desktop */}
            <div
                className={`overflow-hidden transition-all duration-200 md:!max-h-none md:!opacity-100 md:!pb-0 ${
                    isOpen ? 'max-h-96 opacity-100 pb-3' : 'max-h-0 opacity-0'
                }`}
            >
                {children}
            </div>
        </div>
    );
}

export function Footer() {
    return (
        <footer className="border-t border-border bg-white">
            <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 md:py-12">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-4 md:gap-8">
                    {/* Company Info — always visible */}
                    <div className="pb-4 md:pb-0">
                        <div className="mb-4 md:mb-6">
                            <DocnowLogo href="/" width={196} height={48} imageClassName="max-h-10 md:max-h-12 w-auto" />
                        </div>
                        <p className="text-sm text-muted-foreground font-medium">
                            Your trusted partner for diagnostic and healthcare services. Fast reports, home visits, and certified labs.
                        </p>
                    </div>

                    {/* Quick Links — accordion on mobile */}
                    <FooterAccordion title="Quick Links">
                        <ul className="space-y-2.5 md:space-y-3">
                            <li>
                                <Link href="/about" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    About Us
                                </Link>
                            </li>
                            <li>
                                <Link href="/search" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    Tests & Packages
                                </Link>
                            </li>
                            <li>
                                <Link href="/cart" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    My Cart
                                </Link>
                            </li>
                            <li>
                                <Link href="/contact" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    Contact
                                </Link>
                            </li>
                            <li>
                                <Link href="/corporate" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    For Corporates
                                </Link>
                            </li>
                        </ul>
                    </FooterAccordion>

                    {/* Support — accordion on mobile */}
                    <FooterAccordion title="Support">
                        <ul className="space-y-2.5 md:space-y-3">
                            <li>
                                <Link href="/help" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    Help Center
                                </Link>
                            </li>
                            <li>
                                <Link href="/privacy" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    Privacy Policy
                                </Link>
                            </li>
                            <li>
                                <Link href="/terms" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    Terms of Service
                                </Link>
                            </li>
                            <li>
                                <Link href="/faqs" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                                    FAQs
                                </Link>
                            </li>
                        </ul>
                    </FooterAccordion>

                    {/* Contact — accordion on mobile */}
                    <FooterAccordion title="Contact Us">
                        <ul className="space-y-3 md:space-y-4">
                            <li className="flex items-center text-sm font-medium text-muted-foreground">
                                <Phone className="mr-3 h-4 w-4 text-primary flex-shrink-0" />
                                <a href={`tel:${SUPPORT_PHONE_LINK}`} className="hover:text-primary">
                                    {SUPPORT_PHONE_DISPLAY}
                                </a>
                            </li>
                            <li className="flex items-center text-sm font-medium text-muted-foreground">
                                <Mail className="mr-3 h-4 w-4 text-primary flex-shrink-0" />
                                <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-primary">
                                    {SUPPORT_EMAIL}
                                </a>
                            </li>
                            <li className="flex items-start text-sm font-medium text-muted-foreground">
                                <MapPin className="mr-3 h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                                {SUPPORT_ADDRESS}
                            </li>
                        </ul>
                    </FooterAccordion>
                </div>

                {/* Social Media & Copyright */}
                <div className="mt-6 border-t border-border pt-6 md:mt-12 md:pt-8">
                    <div className="flex flex-col items-center justify-between gap-4 md:flex-row md:gap-6">
                        <p className="text-xs md:text-sm font-medium text-muted-foreground">
                            © 2026 DOCNOW Healthcare. All rights reserved.
                        </p>
                        <div className="flex space-x-6">
                            <a
                                href="https://www.facebook.com/watch/?v=1810258263472338&vanity=61582166162822"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary transition-colors"
                            >
                                <Facebook className="h-5 w-5" />
                            </a>
                            <a
                                href="https://www.instagram.com/docnow.in?igsh=aGtybGhxdXFvOHc="
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary transition-colors"
                            >
                                <Instagram className="h-5 w-5" />
                            </a>
                            <a
                                href="https://www.linkedin.com/company/docnow-healthcare/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-muted-foreground hover:text-primary transition-colors"
                            >
                                <Linkedin className="h-5 w-5" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}
