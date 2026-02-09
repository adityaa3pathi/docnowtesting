"use client";
import Link from 'next/link';
import { ShoppingCart, User, Menu, X, MapPin, Search, Navigation, Loader2 } from 'lucide-react';
import { Button, Input } from './ui';
import { useState } from 'react';
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
import { AuthDialog } from './AuthDialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export function Header() {
    const { selectedCity, selectedPincode, updateCity, updatePincode } = useLocation();
    const { user, isAuthenticated, logout } = useAuth();
    const { cartCount } = useCart();

    const [isLocationDialogOpen, setIsLocationDialogOpen] = useState(false);
    const [citySearch, setCitySearch] = useState('');
    const [isLoadingLocation, setIsLoadingLocation] = useState(false);

    // Pincode Dialog State
    const [isPincodeDialogOpen, setIsPincodeDialogOpen] = useState(false);
    const [pincodeInput, setPincodeInput] = useState('');
    const [isLoadingPincode, setIsLoadingPincode] = useState(false);

    // Callback Form State
    const [isCallbackOpen, setIsCallbackOpen] = useState(false);
    const [callbackForm, setCallbackForm] = useState({ name: '', mobile: '', city: 'Gurgaon' });
    const [isSubmittingCallback, setIsSubmittingCallback] = useState(false);

    // Auth Dialog State
    const [isAuthOpen, setIsAuthOpen] = useState(false);

    const handleCallbackSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmittingCallback(true);
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/callback/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(callbackForm)
            });

            if (response.ok) {
                alert("Request submitted! Our health expert will call you shortly.");
                setCallbackForm({ name: '', mobile: '', city: 'Gurgaon' });
                setIsCallbackOpen(false);
            } else {
                alert("Failed to submit request. Please try again.");
            }
        } catch (error) {
            console.error("Callback error:", error);
            alert("Something went wrong. Please try again.");
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

    const detectUserLocation = () => {
        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser");
            return;
        }

        setIsLoadingLocation(true);
        setIsLoadingPincode(true);

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                try {
                    const { latitude, longitude } = position.coords;
                    const response = await fetch(
                        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
                    );
                    const data = await response.json();

                    const detectedCity = data.city || data.locality || data.principalSubdivision;
                    let detectedPincode = data.postcode;

                    if (!detectedPincode) {
                        try {
                            const nominatimRes = await fetch(
                                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
                            );
                            const nominatimData = await nominatimRes.json();
                            if (nominatimData.address && nominatimData.address.postcode) {
                                detectedPincode = nominatimData.address.postcode;
                            }
                        } catch (err) {
                            console.error("Nominatim fallback failed:", err);
                        }
                    }

                    if (detectedCity) updateCity(`${detectedCity} (Detected)`);
                    if (detectedPincode) {
                        setPincodeInput(detectedPincode);
                        updatePincode(detectedPincode);
                    }
                } catch (error) {
                    console.error("Error detecting location:", error);
                } finally {
                    setIsLoadingLocation(false);
                    setIsLoadingPincode(false);
                }
            },
            () => {
                setIsLoadingLocation(false);
                setIsLoadingPincode(false);
            }
        );
    };

    const handlePincodeSubmit = () => {
        if (pincodeInput.length === 6) {
            updatePincode(pincodeInput);
            setIsPincodeDialogOpen(false);
        } else {
            alert("Please enter a valid 6-digit Pincode");
        }
    };

    const handleKeypadClick = (num: string) => {
        if (pincodeInput.length < 6) setPincodeInput(prev => prev + num);
    };

    const handleBackspace = () => setPincodeInput(prev => prev.slice(0, -1));

    return (
        <nav className="sticky top-0 z-50 border-b border-border bg-white/80 backdrop-blur-md shadow-sm">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                <Link href="/" className="text-2xl font-black tracking-tight text-primary">
                    DOC<span className="text-foreground">NOW</span>
                </Link>

                <div className="hidden md:flex items-center gap-8 px-8">
                    <Link href="/search" className="text-sm font-bold text-muted-foreground hover:text-primary transition-colors">
                        Our Packages
                    </Link>
                    <Link href="/search" className="text-sm font-bold text-muted-foreground hover:text-primary transition-colors">
                        Our Tests
                    </Link>
                    <button onClick={() => setIsCallbackOpen(true)} className="text-sm font-bold text-primary hover:text-primary/80 transition-colors animate-pulse">
                        Get a Callback
                    </button>
                </div>

                <div className="hidden md:flex items-center gap-4">
                    {/* Location Selectors */}
                    <Dialog open={isLocationDialogOpen} onOpenChange={setIsLocationDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="text-muted-foreground min-w-[140px] justify-start rounded-xl">
                                <MapPin className="mr-2 h-4 w-4 text-primary" />
                                <span className="truncate">{selectedCity}</span>
                            </Button>
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
                                <Button
                                    variant="outline"
                                    className="w-full justify-start border-border text-muted-foreground rounded-xl"
                                    onClick={detectUserLocation}
                                    disabled={isLoadingLocation}
                                >
                                    {isLoadingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> : <Navigation className="mr-2 h-4 w-4 text-primary" />}
                                    {isLoadingLocation ? "Detecting..." : "Use Current Location"}
                                </Button>

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

                    <Dialog open={isPincodeDialogOpen} onOpenChange={setIsPincodeDialogOpen}>
                        <DialogTrigger asChild>
                            <Button variant="outline" className="text-muted-foreground min-w-[140px] justify-start rounded-xl">
                                <MapPin className="mr-2 h-4 w-4 text-primary" />
                                <span className="truncate">{selectedPincode}</span>
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[400px]">
                            <DialogHeader><DialogTitle className="text-2xl font-black text-center">Enter Pincode</DialogTitle></DialogHeader>
                            <div className="space-y-6 mt-4">
                                <div className="space-y-4">
                                    <div className="flex-1 h-12 rounded-xl border-2 border-primary/20 bg-muted/30 flex items-center justify-center text-2xl font-bold tracking-widest text-primary">
                                        {pincodeInput || "______"}
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-center border-border text-muted-foreground hover:text-primary hover:border-primary/50 rounded-xl"
                                        onClick={detectUserLocation}
                                        disabled={isLoadingPincode}
                                    >
                                        {isLoadingPincode ? <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" /> : <Navigation className="mr-2 h-4 w-4 text-primary" />}
                                        {isLoadingPincode ? "Detecting..." : "Detect my location"}
                                    </Button>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                                        <button key={num} onClick={() => handleKeypadClick(num.toString())} className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-primary/10 hover:text-primary transition-all active:scale-95">{num}</button>
                                    ))}
                                    <button onClick={handleBackspace} className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-destructive/10 hover:text-destructive transition-all active:scale-95 flex items-center justify-center">bs</button>
                                    <button onClick={() => handleKeypadClick('0')} className="h-14 rounded-xl bg-secondary/50 text-xl font-bold hover:bg-primary/10 hover:text-primary transition-all active:scale-95">0</button>
                                    <button onClick={handlePincodeSubmit} className="h-14 rounded-xl bg-primary text-primary-foreground text-xl font-bold hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center">OK</button>
                                </div>
                            </div>
                        </DialogContent>
                    </Dialog>

                    <Link href="/cart" className="p-2 text-muted-foreground hover:text-primary transition-colors relative">
                        <ShoppingCart className="w-5 h-5 font-bold" />
                        {cartCount > 0 && (
                            <span className="absolute -top-1 -right-1 bg-primary text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                                {cartCount}
                            </span>
                        )}
                    </Link>

                    {isAuthenticated ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="w-10 h-10 rounded-full bg-primary text-white flex items-center justify-center text-sm font-bold hover:bg-primary/90 transition-colors">
                                    {user?.name?.[0]?.toUpperCase() || 'U'}
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 rounded-2xl border-border shadow-2xl p-2">
                                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem>
                                    <Link href="/profile" className="flex items-center gap-2 w-full">
                                        <User className="w-4 h-4" /> Profile
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                    <ShoppingCart className="w-4 h-4 mr-2" /> My Bookings
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                    className="text-destructive focus:bg-destructive/5 focus:text-destructive"
                                    onClick={() => logout()}
                                >
                                    Log Out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : (
                        <Button className="rounded-xl px-6 font-bold" onClick={() => setIsAuthOpen(true)}>
                            <User className="mr-2 h-4 w-4" />
                            Sign In
                        </Button>
                    )}
                </div>

                <AuthDialog isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />

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
                                <select
                                    className="w-full h-12 rounded-xl border border-border bg-white px-3 text-sm focus:outline-none focus:border-primary appearance-none font-medium"
                                    value={callbackForm.city}
                                    onChange={(e) => setCallbackForm({ ...callbackForm, city: e.target.value })}
                                >
                                    <option value="Gurgaon">Gurgaon</option>
                                    <option value="Delhi">Delhi</option>
                                    <option value="Noida">Noida</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <Button type="submit" className="w-full h-12 rounded-xl font-bold text-lg" disabled={isSubmittingCallback}>
                                {isSubmittingCallback ? <Loader2 className="animate-spin" /> : "Submit"}
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>

                <button className="md:hidden p-2 text-muted-foreground"><Menu className="h-6 w-6" /></button>
            </div>
        </nav>
    );
}
