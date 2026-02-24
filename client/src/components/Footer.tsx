import { Facebook, Twitter, Instagram, Linkedin, Mail, Phone, MapPin } from 'lucide-react';
import Link from 'next/link';

export function Footer() {
    return (
        <footer className="border-t border-border bg-white">
            <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
                <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
                    {/* Company Info */}
                    <div>
                        <div className="flex items-center mb-6">
                            <div className="text-2xl font-black tracking-tight text-primary">
                                DOC<span className="text-foreground">NOW</span>
                            </div>
                        </div>
                        <p className="text-sm text-muted-foreground font-medium">
                            Your trusted partner for diagnostic and healthcare services. Fast reports, home visits, and certified labs.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-foreground">
                            Quick Links
                        </h3>
                        <ul className="space-y-3">
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
                        </ul>
                    </div>

                    {/* Support */}
                    <div>
                        <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-foreground">
                            Support
                        </h3>
                        <ul className="space-y-3">
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
                    </div>

                    {/* Contact */}
                    <div>
                        <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-foreground">
                            Contact Us
                        </h3>
                        <ul className="space-y-4">
                            <li className="flex items-center text-sm font-medium text-muted-foreground">
                                <Phone className="mr-3 h-4 w-4 text-primary" />
                                +91 9469 089 089
                            </li>
                            <li className="flex items-center text-sm font-medium text-muted-foreground">
                                <Mail className="mr-3 h-4 w-4 text-primary" />
                                harshagarwal@docnow.in
                            </li>
                            <li className="flex items-center text-sm font-medium text-muted-foreground">
                                <MapPin className="mr-3 h-4 w-4 text-primary" />
                                Shop No 21, Chandpole Bazar, Jaipur
                            </li>
                        </ul>
                    </div>
                </div>

                {/* Social Media & Copyright */}
                <div className="mt-12 border-t border-border pt-8">
                    <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
                        <p className="text-sm font-medium text-muted-foreground">
                            © 2026 DOCNOW Healthcare. All rights reserved.
                        </p>
                        <div className="flex space-x-6">
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                                <Facebook className="h-5 w-5" />
                            </a>
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                                <Twitter className="h-5 w-5" />
                            </a>
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                                <Instagram className="h-5 w-5" />
                            </a>
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors">
                                <Linkedin className="h-5 w-5" />
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    );
}
