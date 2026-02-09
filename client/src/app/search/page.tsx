"use client";

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Search, Filter, Loader2, ShoppingCart, Info, Check } from 'lucide-react';
import api from '@/lib/api';
import { useLocation } from '@/contexts/LocationContext';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';

interface Product {
    deal_id: string;
    test_name: string;
    product_type: string; // 'package' | 'profile' | 'parameter'
    description?: string;
    mrp?: string;
    price?: string;
}

export default function SearchPage() {
    const { selectedPincode, isInitialized } = useLocation();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Only fetch if context is initialized and we have a valid-looking pincode
        if (isInitialized && selectedPincode && selectedPincode.length === 6 && !selectedPincode.includes('Select')) {
            fetchProducts(selectedPincode);
        }
    }, [selectedPincode, isInitialized]);

    const fetchProducts = async (zip: string) => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.get('/catalog/products', {
                params: { zipcode: zip }
            });

            console.log('Product Data:', response.data);

            if (response.data && response.data.data) {
                const items = Array.isArray(response.data.data) ? response.data.data : [];
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
                        <div className="flex gap-3">
                            <button className="flex items-center gap-2 px-4 py-2.5 bg-white border border-border rounded-xl text-sm font-medium hover:bg-accent transition-colors">
                                <Filter className="w-4 h-4" />
                                Filters
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
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
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {products.length > 0 ? (
                                products.map((product, idx) => (
                                    <ProductCard key={product.deal_id || idx} product={product} />
                                ))
                            ) : (
                                <div className="col-span-full text-center py-20 text-muted-foreground font-medium">
                                    {isInitialized && selectedPincode.length === 6 && !selectedPincode.includes('Select')
                                        ? "No products found for this location."
                                        : "Please select a valid location to see available packages."}
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

    // Pricing logic - handle strings from API
    const offerPrice = parseInt(product.price || '0');
    const mrp = parseInt(product.mrp || '0');
    const displayActualPrice = mrp > offerPrice ? mrp : Math.floor(offerPrice * 1.4);

    // Check if item is already in cart
    const isInCart = cart?.items.some(item => item.testCode === product.deal_id);

    const handleAddToCart = async () => {
        if (!isAuthenticated) {
            alert('Please login to add items to cart');
            return;
        }

        setAdding(true);
        const success = await addToCart(
            product.deal_id,
            product.test_name,
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
                        {product.product_type || 'Package'}
                    </span>
                    <button className="text-muted-foreground hover:text-primary transition-colors">
                        <Info className="w-4 h-4" />
                    </button>
                </div>
                <h3 className="font-bold text-foreground text-lg mb-2 line-clamp-2 min-h-[3.5rem] leading-snug">
                    {product.test_name || 'Unknown Package'}
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
                    <button
                        onClick={handleAddToCart}
                        disabled={adding || isInCart}
                        className={`p-3 rounded-xl transition-all shadow-lg ${isInCart
                            ? 'bg-green-500 text-white cursor-not-allowed'
                            : 'bg-primary hover:bg-primary/90 text-white hover:scale-105 active:scale-95 shadow-primary/20'
                            }`}
                    >
                        {adding ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : isInCart ? (
                            <Check className="w-5 h-5" />
                        ) : (
                            <ShoppingCart className="w-5 h-5" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
