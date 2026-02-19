"use client";

import { useEffect, useState, Suspense } from 'react';
import { Header } from '@/components/Header';
import { Search, Filter, Loader2, ShoppingCart, Info, Check, Tag, X } from 'lucide-react';
import api from '@/lib/api';
import { useLocation } from '@/contexts/LocationContext';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, useSearchParams } from 'next/navigation';

interface Product {
    id: string;
    partnerCode: string;
    name: string;
    type: string; // 'PACKAGE' | 'PROFILE' | 'PARAMETER'
    description?: string;
    displayPrice: number;
    discountedPrice?: number | null;
    price: number;
    mrp?: number | null;
    parameters?: string | null;
    sampleType?: string | null;
    reportTime?: string | null;
}

interface Category {
    id: string;
    name: string;
    slug: string;
    description?: string | null;
}

// Wrapper with Suspense to fix Vercel static prerendering
export default function SearchPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-gray-50">
                <Header />
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            </div>
        }>
            <SearchPageContent />
        </Suspense>
    );
}

function SearchPageContent() {
    const { selectedPincode, isInitialized } = useLocation();
    const searchParams = useSearchParams();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Category state
    const [categories, setCategories] = useState<Category[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [loadingCategories, setLoadingCategories] = useState(false);

    // Search
    const [searchTerm, setSearchTerm] = useState('');

    // Read initial category from URL params
    useEffect(() => {
        const cat = searchParams.get('category');
        if (cat) setSelectedCategory(cat);
    }, [searchParams]);

    // Fetch categories on mount
    useEffect(() => {
        fetchCategories();
    }, []);

    // Fetch products when pincode or category changes
    useEffect(() => {
        if (isInitialized && selectedPincode && selectedPincode.length === 6 && !selectedPincode.includes('Select')) {
            fetchProducts(selectedPincode, selectedCategory);
        }
    }, [selectedPincode, isInitialized, selectedCategory]);

    const fetchCategories = async () => {
        setLoadingCategories(true);
        try {
            const res = await api.get('/catalog/categories');
            if (res.data?.categories) {
                setCategories(res.data.categories);
            }
        } catch (err) {
            console.error('Error fetching categories:', err);
        } finally {
            setLoadingCategories(false);
        }
    };

    const fetchProducts = async (zip: string, category?: string) => {
        setLoading(true);
        setError(null);
        try {
            const params: any = { zipcode: zip };
            if (category) params.category = category;
            if (searchTerm.trim()) params.search = searchTerm.trim();

            const response = await api.get('/catalog/products', { params });

            if (response.data && response.data.products) {
                const items = Array.isArray(response.data.products) ? response.data.products : [];
                setProducts(items);
            } else {
                setProducts([]);
            }
        } catch (err) {
            console.error(err);
            setError("Failed to fetch products for this pincode.");
        } finally {
            setLoading(false);
        }
    };

    // Search handler with debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            if (isInitialized && selectedPincode && selectedPincode.length === 6 && !selectedPincode.includes('Select')) {
                fetchProducts(selectedPincode, selectedCategory);
            }
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleCategorySelect = (slug: string) => {
        setSelectedCategory(slug === selectedCategory ? '' : slug);
    };

    // Filter by search locally too for responsiveness
    const filteredProducts = searchTerm.trim()
        ? products.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : products;

    return (
        <div className="min-h-screen bg-gray-50 pb-20">
            <Header />

            <div className="bg-gradient-to-br from-primary/5 to-secondary/5 border-b border-border">
                <div className="container mx-auto px-4 py-8">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div>
                            <h1 className="text-3xl font-bold text-foreground mb-2">Health Packages</h1>
                            <p className="text-muted-foreground font-medium">Find the perfect test for you and your family</p>
                        </div>
                    </div>

                    {/* Search Bar */}
                    <div className="mt-6 max-w-2xl">
                        <div className="relative group">
                            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Search tests, packages..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white border border-border rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                            />
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Category Chips */}
            <div className="bg-white border-b border-border sticky top-0 z-30">
                <div className="container mx-auto px-4">
                    <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
                        <button
                            onClick={() => setSelectedCategory('')}
                            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all duration-200 ${!selectedCategory
                                ? 'bg-primary text-white border-primary shadow-md shadow-primary/20'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40 hover:bg-primary/5'
                                }`}
                        >
                            All
                        </button>
                        {loadingCategories ? (
                            <div className="flex items-center px-4">
                                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                            </div>
                        ) : (
                            categories.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => handleCategorySelect(cat.slug)}
                                    className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all duration-200 whitespace-nowrap ${selectedCategory === cat.slug
                                        ? 'bg-primary text-white border-primary shadow-md shadow-primary/20'
                                        : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40 hover:bg-primary/5'
                                        }`}
                                >
                                    {cat.name}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
                {/* Active filter indicator */}
                {selectedCategory && (
                    <div className="mb-6 flex items-center gap-2">
                        <Tag className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium text-gray-600">
                            Showing: <span className="text-primary font-bold">{categories.find(c => c.slug === selectedCategory)?.name}</span>
                        </span>
                        <button
                            onClick={() => setSelectedCategory('')}
                            className="ml-1 text-gray-400 hover:text-red-500 transition-colors"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

                {loading ? (
                    <div className="flex justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    </div>
                ) : (
                    <>
                        {error && (
                            <div className="mb-6 p-4 bg-destructive/5 border border-destructive/20 text-destructive rounded-xl text-sm font-medium flex items-center gap-2">
                                <Info className="w-4 h-4" />
                                <span>{error}</span>
                            </div>
                        )}

                        {/* Results count */}
                        {filteredProducts.length > 0 && (
                            <p className="text-sm text-gray-500 font-medium mb-4">
                                {filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''} found
                            </p>
                        )}

                        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredProducts.length > 0 ? (
                                filteredProducts.map((product, idx) => (
                                    <ProductCard key={product.id || idx} product={product} />
                                ))
                            ) : (
                                <div className="col-span-full text-center py-20">
                                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Search className="w-7 h-7 text-gray-300" />
                                    </div>
                                    <p className="text-muted-foreground font-medium">
                                        {isInitialized && selectedPincode.length === 6 && !selectedPincode.includes('Select')
                                            ? selectedCategory
                                                ? "No products found in this category."
                                                : "No products found for this location."
                                            : "Please select a valid location to see available packages."}
                                    </p>
                                    {selectedCategory && (
                                        <button
                                            onClick={() => setSelectedCategory('')}
                                            className="mt-3 text-sm text-primary font-semibold hover:underline"
                                        >
                                            Clear filter and show all
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function ProductCard({ product }: { product: Product }) {
    const { addToCart, cart } = useCart();
    const { isAuthenticated } = useAuth();
    const router = useRouter();
    const [adding, setAdding] = useState(false);

    // Pricing logic
    const offerPrice = product.price || product.displayPrice || 0;
    const mrpPrice = product.mrp || product.displayPrice || 0;
    const displayActualPrice = mrpPrice > offerPrice ? mrpPrice : Math.floor(offerPrice * 1.4);

    // Check if item is already in cart
    const isInCart = cart?.items.some(item => item.testCode === product.partnerCode);

    const handleAddToCart = async () => {
        if (!isAuthenticated) {
            alert('Please login to add items to cart');
            return;
        }

        setAdding(true);
        const success = await addToCart(
            product.partnerCode,
            product.name,
            offerPrice,
            displayActualPrice
        );
        setAdding(false);

        if (success) {
            // Optionally show a toast or success message
        }
    };

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-border overflow-hidden hover:shadow-xl hover:shadow-primary/5 transition-all group duration-300">
            <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <span className="text-[10px] font-black tracking-widest text-primary uppercase bg-primary/10 px-2.5 py-1 rounded-full">
                        {product.type || 'Package'}
                    </span>
                    <button className="text-muted-foreground hover:text-primary transition-colors">
                        <Info className="w-4 h-4" />
                    </button>
                </div>
                <h3 className="font-bold text-foreground text-lg mb-2 line-clamp-2 min-h-[3.5rem] leading-snug">
                    {product.name || 'Unknown Package'}
                </h3>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-6 font-medium">
                    {product.description || 'Comprehensive health checkup including blood parameters.'}
                </p>

                <div className="flex items-center justify-between mt-auto">
                    <div className="flex flex-col">
                        {displayActualPrice > offerPrice && (
                            <div className="text-xs text-muted-foreground line-through font-medium">₹{displayActualPrice}</div>
                        )}
                        <div className="text-2xl font-black text-foreground">₹{offerPrice}</div>
                    </div>
                    <div className="flex items-center gap-3">
                        {isInCart && (
                            <div className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-green-50 text-green-700 rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider border border-green-200">
                                <Check className="w-3.5 h-3.5" />
                                {cart?.items.filter(i => i.testCode === product.partnerCode).length} Added
                            </div>
                        )}
                        <button
                            onClick={handleAddToCart}
                            disabled={adding}
                            className={`p-3 rounded-xl transition-all shadow-lg text-white hover:scale-105 active:scale-95 shadow-primary/20 ${isInCart
                                ? 'bg-slate-900 hover:bg-slate-800'
                                : 'bg-primary hover:bg-primary/90'
                                }`}
                        >
                            {adding ? (
                                <Loader2 className="w-5 h-5 animate-spin" />
                            ) : (
                                <div className="flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5" />
                                    {isInCart && <span className="text-sm font-bold">+1</span>}
                                </div>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
