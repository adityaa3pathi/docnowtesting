"use client";
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    ShoppingCart, User, Users, Menu, X, MapPin, Search,
    Navigation, Loader2, Shield, Phone, LogOut, Delete, Building2,
} from 'lucide-react';
import { Button, Input } from './ui';
import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { useLocation } from '@/contexts/LocationContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useAuthGate } from '@/contexts/AuthGateContext';

import { getApiUrl } from '@/lib/api';
import { DocnowLogo } from './DocnowLogo';
import { GlobalSearch } from './global-search/GlobalSearch';

const metroCities = [
    { name: 'Bengaluru', icon: '🏛️' },
    { name: 'Chennai', icon: '🕌' },
    { name: 'Delhi', icon: '🏛️' },
    { name: 'Gurgaon', icon: '🏢' },
    { name: 'Hyderabad', icon: '🕌' },
    { name: 'Kolkata', icon: '🏛️' },
    { name: 'Mumbai', icon: '🏛️' },
    { name: 'Noida', icon: '🏢' },
    { name: 'Pune', icon: '⚡' },
];

const otherCities = [
    'Agra', 'Ahmadnagar', 'Ahmedabad', 'Aligarh', 'Allahabad', 'Almora', 'Alwar', 'Ambala', 'Ambedkar Nagar', 'Amravati', 'Amritsar', 'Amroha', 'Aurangabad', 'Ayodhya', 'Azamgarh', 'Baghpat', 'Bahadurgarh', 'Bardhaman', 'Bareilly', 'Belgaum', 'Bharatpur', 'Bhatinda', 'Bhilai', 'Bhilwara', 'Bhiwani', 'Bhopal', 'Bhubaneswar', 'Bijnor', 'Bikaner', 'Bilaspur', 'Bokaro', 'Bulandshahar', 'Chandigarh', 'Darbhanga', 'Dehradun', 'Deulpur', 'Dhampur', 'Dhanbad', 'Durgapur', 'Etah', 'Faizabad', 'Faridabad', 'Firozabad', 'Gadarpur', 'Gandhinagar', 'Ganganagar', 'Gaya', 'Ghaziabad', 'Ghazipur', 'Gonda', 'Gorakhpur', 'Greater Noida', 'Guwahati', 'Gwalior', 'Hajipur', 'Haldwani', 'Hapur', 'Hardoi', 'Haridwar', 'Hathras', 'Hazaribagh', 'Hisar', 'Hoshiarpur', 'Indore', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jamnagar', 'Jamshedpur', 'Jaunpur', 'Jhansi', 'Jodhpur', 'Kanpur', 'Karimnagar', 'Karnal', 'Kasganj', 'Kashipur', 'Khagaria', 'Khurja', 'Kota', 'Lakhimpur', 'Latur', 'Lucknow', 'Ludhiana', 'Mainpuri', 'Mathura', 'Meerut', 'Mehsana', 'Modinagar', 'Moga', 'Mohali', 'Moradabad', 'Munger', 'Muzaffarnagar', 'Mysuru', 'Nagpur', 'Nashik', 'Palwal', 'Panchkula', 'Panipat', 'Paschim Medinipur', 'Patiala', 'Patna', 'Pratapgarh', 'Prayagraj', 'Raebareli', 'Raipur', 'Rajkot', 'Rampur', 'Ranchi', 'Rewa', 'Rewari', 'Rishikesh', 'Rohtak', 'Roorkee', 'Rudrapur Udham Singh Nagar', 'Sagar', 'Saharanpur', 'Samastipur', 'Sambhal', 'Shahabad', 'Shamli', 'Sohna', 'Sonipat', 'Srinagar', 'Sultanpur', 'Surat', 'Tarn Taran', 'Udaipur', 'Ujjain', 'Una', 'Vadodara', 'Varanasi', 'Vijayawada', 'Visakhapatnam', 'Warangal', 'Yamuna Nagar'
];

const callbackCities = Array.from(new Set([...metroCities.map((city) => city.name), ...otherCities])).sort((a, b) =>
    a.localeCompare(b)
);

// Desktop nav links (3 only — "Get a Callback" is rendered as a button separately)
const desktopNavLinks = [
    { label: 'About Us', href: '/about' },
];

export function Header() {
    const pathname = usePathname();

    // Pages where the header search bar is redundant or distracting
    const hideSearch = ['/search', '/profile', '/cart'].some(p => pathname.startsWith(p));
    const { selectedCity, selectedPincode, updateCity, updatePincode, checkAndSetPincode, serviceabilityStatus } = useLocation();
    const { user, isAuthenticated, logout } = useAuth();
    const { cartCount } = useCart();
    const { openAuthDialog } = useAuthGate();

    const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
    const [citySearch, setCitySearch] = useState('');

    // Pincode Dialog State
    const [isPincodeDialogOpen, setIsPincodeDialogOpen] = useState(false);
    const [pincodeInput, setPincodeInput] = useState('');

    // Callback Form State
    const [isCallbackOpen, setIsCallbackOpen] = useState(false);
    const [callbackForm, setCallbackForm] = useState({ name: '', mobile: '', city: 'Gurgaon' });
    const [isSubmittingCallback, setIsSubmittingCallback] = useState(false);



    // Mobile Drawer State
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    // Scroll-aware search bar — accumulates distance + cooldown to prevent flicker
    const [isSearchHidden, setIsSearchHidden] = useState(false);
    const scrollRef = useRef({
        lastY: 0,
        anchorY: 0,
        direction: 'up' as 'up' | 'down',
        lastToggle: 0,
    });

    useEffect(() => {
        let ticking = false;
        const onScroll = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                const currentY = window.scrollY;
                const s = scrollRef.current;

                // Skip zero-delta events (no real movement)
                if (currentY === s.lastY) { ticking = false; return; }

                // Cooldown: ignore scroll for 600ms after any toggle
                // Covers: 300ms CSS transition + reflow + scroll anchoring settlement
                const now = Date.now();
                if (now - s.lastToggle < 600) {
                    s.lastY = currentY;
                    ticking = false;
                    return;
                }

                const newDir = currentY > s.lastY ? 'down' : 'up';

                // Direction changed — reset anchor
                if (newDir !== s.direction) {
                    s.anchorY = currentY;
                    s.direction = newDir;
                }

                // Near top — always show (threshold must be lower than
                // hide-point minus search-bar-height to avoid scroll-anchoring
                // false trigger: e.g. hide at scrollY=80, collapse shifts to 32,
                // which is still > 5, so no false show)
                if (currentY < 5) {
                    setIsSearchHidden(prev => { if (prev) s.lastToggle = now; return false; });
                }
                // Hide after scrolling 80px down from anchor
                else if (newDir === 'down' && currentY - s.anchorY > 80) {
                    setIsSearchHidden(prev => { if (!prev) s.lastToggle = now; return true; });
                }
                // Show after scrolling 40px up from anchor
                else if (newDir === 'up' && s.anchorY - currentY > 40) {
                    setIsSearchHidden(prev => { if (prev) s.lastToggle = now; return false; });
                }

                s.lastY = currentY;
                ticking = false;
            });
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Auto-open login dialog from URL param
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            if (params.get('login') === 'true') {
                openAuthDialog();
                window.history.replaceState({}, '', window.location.pathname);
            }
        }
    }, []);

    // Close mobile menu on resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth >= 768) setIsMobileMenuOpen(false);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Prevent body scroll when mobile menu is open
    useEffect(() => {
        document.body.style.overflow = isMobileMenuOpen ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [isMobileMenuOpen]);

    const handleCallbackSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmittingCallback(true);
        try {
            const response = await fetch(getApiUrl('/callback/request'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(callbackForm),
            });
            if (response.ok) {
                toast.success("Request submitted! Our health expert will call you shortly.");
                setCallbackForm({ name: '', mobile: '', city: 'Gurgaon' });
                setIsCallbackOpen(false);
            } else {
                toast.error("Failed to submit request. Please try again.");
            }
        } catch (error) {
            console.error("Callback error:", error);
            toast.error("Something went wrong. Please try again.");
        } finally {
            setIsSubmittingCallback(false);
        }
    };

    const filteredCities = citySearch
        ? otherCities.filter(city => city.toLowerCase().includes(citySearch.toLowerCase()))
        : otherCities;

    const handleCitySelect = (city: string) => {
        updateCity(city);
        setIsLocationDialogOpen(false);
        setCitySearch('');
    };

    const handlePincodeSubmit = async () => {
        if (pincodeInput.length === 6) {
            const ok = await checkAndSetPincode(pincodeInput);
            if (ok) {
                setIsPincodeDialogOpen(false);
                toast.success('Services available! Location updated.');
            } else {
                toast.error(`Services currently unavailable in pincode ${pincodeInput}.`);
            }
        } else {
            toast.error("Please enter a valid 6-digit Pincode");
        }
    };

    const handleKeypadClick = (num: string) => {
        if (pincodeInput.length < 6) setPincodeInput(prev => prev + num);
    };

    const handleBackspace = () => setPincodeInput(prev => prev.slice(0, -1));

    return (
        <>
            {/* ─── Main Navbar ─── */}
            <nav className="sticky top-0 z-50 w-full bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-100 transition-all duration-200">
                <div className="mx-auto flex h-14 md:h-16 max-w-[1380px] items-center justify-between gap-3 lg:gap-6 px-4 lg:px-10">

                    {/* Logo — 15% smaller on mobile */}
                    <DocnowLogo href="/" priority width={120} height={47} imageClassName="max-h-8 md:max-h-[47px] w-auto" />

                    {/* Desktop Global Search — hidden on pages with their own search */}
                    {!hideSearch && (
                        <div className="hidden md:flex flex-1 max-w-xl mx-8 relative">
                            <GlobalSearch />
                        </div>
                    )}

                    {/* Desktop Nav Links */}
                    <div className="hidden md:flex items-center gap-6 lg:gap-8">
                        {desktopNavLinks.map((link) => (
                            <Link
                                key={link.href}
                                href={link.href}
                                className={`text-gray-700 font-semibold text-base leading-none transition-colors hover:text-primary ${pathname === link.href ? 'text-primary underline underline-offset-4' : ''
                                    }`}
                            >
                                {link.label}
                            </Link>
                        ))}
                        {/* Get a Callback — styled as outlined pill */}
                        <button
                            onClick={() => setIsCallbackOpen(true)}
                            className="border border-primary text-primary font-semibold text-base px-5 py-2 rounded-[7px] hover:bg-primary/5 transition-all whitespace-nowrap"
                        >
                            Get a Callback
                        </button>
                    </div>

                    {/* Desktop Right Controls */}
                    <div className="hidden md:flex items-center gap-3">

                        {/* Select City */}
                        <Dialog open={isLocationDialogOpen} onOpenChange={setIsLocationDialogOpen}>
                            <DialogTrigger asChild>
                                <button className="flex items-center gap-1.5 text-gray-700 text-sm font-semibold px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-all min-w-[130px] truncate">
                                    <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                                    <span className="truncate">{selectedCity}</span>
                                </button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-hidden flex flex-col">
                                <DialogHeader><DialogTitle className="text-2xl font-black">Select your Location</DialogTitle></DialogHeader>
                                <div className="space-y-6 mt-4 flex-1 overflow-y-auto pr-2">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            type="text"
                                            placeholder="Search for your city..."
                                            value={citySearch}
                                            onChange={(e) => setCitySearch(e.target.value)}
                                            className="w-full pl-10"
                                        />
                                    </div>

                                    {!citySearch && (
                                        <div>
                                            <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">Metro Cities</h3>
                                            <div className="grid grid-cols-3 gap-3">
                                                {metroCities.map((city) => (
                                                    <button
                                                        key={city.name}
                                                        onClick={() => handleCitySelect(city.name)}
                                                        className="flex flex-col items-center justify-center rounded-2xl border border-border p-4 text-center hover:border-primary hover:bg-primary/5 transition-all group"
                                                    >
                                                        <span className="text-2xl mb-2 group-hover:scale-110 transition-transform">{city.icon}</span>
                                                        <span className="text-xs font-bold text-foreground">{city.name}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <div>
                                        {!citySearch && <h3 className="mb-4 text-xs font-black uppercase tracking-widest text-muted-foreground">Other Cities</h3>}
                                        <div className="grid grid-cols-3 gap-2">
                                            {filteredCities.map((city) => (
                                                <button
                                                    key={city}
                                                    onClick={() => handleCitySelect(city)}
                                                    className="rounded-xl border border-border px-3 py-2.5 text-xs font-bold text-foreground hover:border-primary hover:bg-primary/5 transition-all text-left truncate"
                                                >
                                                    {city}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>

                        {/* Select Pincode */}
                        <Dialog open={isPincodeDialogOpen} onOpenChange={setIsPincodeDialogOpen}>
                            <DialogTrigger asChild>
                                <button className="flex items-center gap-1.5 text-gray-700 text-sm font-semibold px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-all min-w-[120px] truncate">
                                    <MapPin className="h-4 w-4 text-primary flex-shrink-0" />
                                    <span className="truncate">{selectedPincode}</span>
                                </button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[400px]">
                                <DialogHeader><DialogTitle className="text-2xl font-black text-center">Enter Pincode</DialogTitle></DialogHeader>
                                <div className="space-y-6 mt-4">
                                    <div className="space-y-4">
                                        <input
                                            type="tel"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            maxLength={6}
                                            value={pincodeInput}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                                                setPincodeInput(val);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    handlePincodeSubmit();
                                                }
                                            }}
                                            placeholder="______"
                                            className="flex-1 h-12 w-full rounded-xl border-2 border-primary/20 bg-muted/30 text-center text-2xl font-bold tracking-widest text-primary placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 transition-colors"
                                            autoComplete="off"
                                        />

                                    </div>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                            <button
                                                key={num}
                                                onClick={() => handleKeypadClick(num.toString())}
                                                className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-primary/10 hover:text-primary transition-all active:scale-95"
                                            >
                                                {num}
                                            </button>
                                        ))}
                                        <button onClick={handleBackspace} className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-destructive/10 hover:text-destructive transition-all active:scale-95 flex items-center justify-center">
                                            <Delete className="w-6 h-6" />
                                        </button>
                                        <button onClick={() => handleKeypadClick('0')} className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-primary/10 hover:text-primary transition-all active:scale-95">0</button>
                                        <button
                                            onClick={handlePincodeSubmit}
                                            disabled={serviceabilityStatus === 'loading'}
                                            className="h-14 rounded-xl bg-primary text-primary-foreground text-xl font-bold hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {serviceabilityStatus === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" /> : 'OK'}
                                        </button>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>

                        {/* Cart */}
                        <Link href="/cart" className="relative p-2 text-gray-700 hover:text-primary transition-colors">
                            <ShoppingCart className="w-5 h-5" />
                            {cartCount > 0 && (
                                <span className="absolute -top-1 -right-1 bg-primary text-white text-xs font-black rounded-full h-5 w-5 flex items-center justify-center">
                                    {cartCount}
                                </span>
                            )}
                        </Link>

                        {/* Auth */}
                        {isAuthenticated ? (
                            <Link href="/profile" className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-black hover:bg-primary/90 transition-colors">
                                {user?.name?.[0]?.toUpperCase() || 'U'}
                            </Link>
                        ) : (
                            <button
                                onClick={() => openAuthDialog()}
                                className="border border-primary text-primary font-semibold text-sm px-5 py-2 rounded-[7px] hover:bg-primary/5 transition-all flex items-center gap-2"
                            >
                                <User className="h-4 w-4" />
                                Sign In
                            </button>
                        )}
                    </div>

                    {/* ─── Mobile: Hamburger Only ─── */}
                    <div className="flex md:hidden items-center">
                        <button
                            className="p-2 text-gray-700 hover:text-primary transition-colors"
                            onClick={() => setIsMobileMenuOpen(true)}
                            aria-label="Open navigation menu"
                        >
                            <Menu className="h-6 w-6" />
                        </button>
                    </div>
                </div>

                {/* Mobile Global Search — hidden on search/profile/cart pages */}
                {!hideSearch && (
                    <div
                        className="md:hidden grid transition-[grid-template-rows,opacity] duration-300 ease-in-out"
                        style={{
                            gridTemplateRows: isSearchHidden ? '0fr' : '1fr',
                            opacity: isSearchHidden ? 0 : 1,
                        }}
                    >
                        <div className="overflow-x-hidden">
                            <div className="px-4 pb-2.5">
                                <GlobalSearch />
                            </div>
                        </div>
                    </div>
                )}




                    {/* Callback Dialog */}
                    <Dialog open={isCallbackOpen} onOpenChange={setIsCallbackOpen}>
                        <DialogContent className="sm:max-w-[400px] border-none shadow-2xl">
                            <DialogHeader className="space-y-3">
                                <DialogTitle className="text-xl font-black">Need help with booking a test?</DialogTitle>
                                <p className="text-sm text-muted-foreground">Please share your details, and our health expert will assist you.</p>
                            </DialogHeader>
                            <form onSubmit={handleCallbackSubmit} className="space-y-4 mt-2">
                                <Input
                                    placeholder="Enter Your Mobile No. *"
                                    required
                                    value={callbackForm.mobile}
                                    onChange={(e) => setCallbackForm({ ...callbackForm, mobile: e.target.value })}
                                />
                                <Input
                                    placeholder="Enter Your Name *"
                                    required
                                    value={callbackForm.name}
                                    onChange={(e) => setCallbackForm({ ...callbackForm, name: e.target.value })}
                                />
                                <div className="relative">
                                    <Input
                                        list="callback-city-options"
                                        placeholder="Select or type your city *"
                                        required
                                        value={callbackForm.city}
                                        onChange={(e) => setCallbackForm({ ...callbackForm, city: e.target.value })}
                                    />
                                    <datalist id="callback-city-options">
                                        {callbackCities.map((city) => (
                                            <option key={city} value={city} />
                                        ))}
                                    </datalist>
                                </div>
                                <Button type="submit" className="w-full h-12 rounded-xl font-bold text-lg" disabled={isSubmittingCallback}>
                                    {isSubmittingCallback ? <Loader2 className="animate-spin" /> : "Submit"}
                                </Button>
                            </form>
                        </DialogContent>
                    </Dialog>
            </nav>

            {/* ─── Mobile Navigation Drawer ─── */}
            {/* Backdrop */}
            <div
                className={`fixed inset-0 bg-black/50 z-[60] transition-opacity duration-300 md:hidden ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}
                onClick={() => setIsMobileMenuOpen(false)}
            />

            {/* Drawer Panel — white bg so icons stay readable */}
            <div
                className={`fixed top-0 left-0 h-full w-[280px] bg-white z-[70] shadow-2xl transform transition-transform duration-300 ease-out md:hidden flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
            >
                {/* Drawer Header */}
                <div className="flex items-center justify-end px-5 h-16 border-b border-gray-100 flex-shrink-0 overflow-hidden bg-white">
                    <button
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                        aria-label="Close menu"
                    >
                        <X className="h-5 w-5" />
                    </button>
                </div>

                {/* Drawer Body */}
                <div className="flex-1 overflow-y-auto">
                    {/* User Info */}
                    {isAuthenticated ? (
                        <div className="px-5 py-4 bg-primary/5 border-b border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {user?.name?.[0]?.toUpperCase() || 'U'}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-bold text-gray-900 truncate">{user?.name || 'User'}</p>
                                    <p className="text-xs text-gray-500 truncate">{user?.mobile || user?.email}</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="px-5 py-4 border-b border-gray-100">
                            <Button
                                className="w-full rounded-xl font-bold"
                                onClick={() => {
                                    setIsMobileMenuOpen(false);
                                    openAuthDialog();
                                }}
                            >
                                <User className="mr-2 h-4 w-4" />
                                Sign In / Sign Up
                            </Button>
                        </div>
                    )}

                    {/* Location Quick View */}
                    <div className="px-5 py-3 border-b border-gray-100 space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Your Location</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    setIsMobileMenuOpen(false);
                                    setIsLocationDialogOpen(true);
                                }}
                                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
                            >
                                <p className="text-[10px] text-gray-400 leading-tight">City</p>
                                <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{selectedCity}</p>
                            </button>
                            <button
                                onClick={() => {
                                    setIsMobileMenuOpen(false);
                                    setIsPincodeDialogOpen(true);
                                }}
                                className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 hover:border-primary/40 hover:bg-primary/5 transition-all text-left"
                            >
                                <p className="text-[10px] text-gray-400 leading-tight">Pincode</p>
                                <p className="text-sm font-semibold text-gray-800 truncate leading-tight">{selectedPincode}</p>
                            </button>
                        </div>
                    </div>

                    {/* Navigation Links */}
                    <div className="px-3 py-3 space-y-0.5">
                        <Link
                            href="/"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all ${pathname === '/' ? 'text-primary bg-primary/5' : 'text-gray-700'}`}
                        >
                            <Search className="w-4 h-4 text-gray-400" />
                            Home
                        </Link>
                        <Link
                            href="/search?type=TEST"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all ${pathname === '/search' && typeof window !== 'undefined' && window.location.search.includes('TEST') ? 'text-primary bg-primary/5' : 'text-gray-700'}`}
                        >
                            <Search className="w-4 h-4 text-gray-400" />
                            Tests
                        </Link>
                        <Link
                            href="/search?type=PACKAGE"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all ${pathname === '/search' && typeof window !== 'undefined' && window.location.search.includes('PACKAGE') ? 'text-primary bg-primary/5' : 'text-gray-700'}`}
                        >
                            <Search className="w-4 h-4 text-gray-400" />
                            Packages
                        </Link>
                        {isAuthenticated && (
                            <Link
                                href="/profile?tab=bookings"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all text-gray-700`}
                            >
                                <ShoppingCart className="w-4 h-4 text-gray-400" />
                                My Orders
                            </Link>
                        )}
                        <Link
                            href="/cart"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all ${pathname === '/cart' ? 'text-primary bg-primary/5' : 'text-gray-700'}`}
                        >
                            <ShoppingCart className="w-4 h-4 text-gray-400" />
                            Cart
                            {cartCount > 0 && (
                                <span className="ml-auto bg-primary text-white text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center">
                                    {cartCount}
                                </span>
                            )}
                        </Link>
                        <Link
                            href="/contact"
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold hover:bg-gray-50 hover:text-primary transition-all ${pathname === '/contact' ? 'text-primary bg-primary/5' : 'text-gray-700'}`}
                        >
                            <Phone className="w-4 h-4 text-gray-400" />
                            Contact
                        </Link>
                    </div>

                    {/* Quick Action */}
                    <div className="px-3 py-2 border-t border-gray-100">
                        <button
                            onClick={() => {
                                setIsMobileMenuOpen(false);
                                setIsCallbackOpen(true);
                            }}
                            className="flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-semibold text-primary hover:bg-primary/5 transition-all"
                        >
                            <Phone className="w-4 h-4" />
                            Get a Callback
                        </button>
                    </div>

                    {/* Auth-only links */}
                    {isAuthenticated && (
                        <div className="px-3 py-2 border-t border-gray-100">
                            <Link
                                href="/profile"
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:text-primary transition-all"
                            >
                                <User className="w-4 h-4 text-gray-400" />
                                My Profile
                            </Link>
                            {(user?.role === 'MANAGER' || user?.role === 'SUPER_ADMIN') && (
                                <Link
                                    href="/manager"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-teal-700 hover:bg-teal-50 transition-all"
                                >
                                    <Shield className="w-4 h-4 text-teal-600" />
                                    Manager Dashboard
                                </Link>
                            )}
                            {user?.role === 'SUPER_ADMIN' && (
                                <Link
                                    href="/super-admin"
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold text-purple-700 hover:bg-purple-50 transition-all"
                                >
                                    <Shield className="w-4 h-4 text-purple-600" />
                                    Admin Panel
                                </Link>
                            )}
                        </div>
                    )}
                </div>

                {/* Drawer Footer */}
                {isAuthenticated && (
                    <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
                        <button
                            onClick={() => {
                                setIsMobileMenuOpen(false);
                                logout();
                            }}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold text-red-500 hover:bg-red-50 transition-all"
                        >
                            <LogOut className="w-4 h-4" />
                            Log Out
                        </button>
                    </div>
                )}
            </div>
        </>
    );
}
