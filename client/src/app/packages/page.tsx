'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { Button, Card } from '@/components/ui';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Search,
  ShoppingCart,
  Activity,
  Heart,
  Zap,
  Clock,
  Beaker,
  TestTubes,
  FlaskConical,
  BadgePercent,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
} from 'lucide-react';

interface CatalogProduct {
  id: string;
  partnerCode: string;
  name: string;
  type: string;
  price: number;
  mrp: number | null;
  displayPrice: number;
  discountedPrice: number | null;
  description: string | null;
  parameters: number | null;
  sampleType: string | null;
  reportTime: string | null;
  categories: { id: string; name: string; slug: string }[];
}

export default function PackagesPage() {
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { isAuthenticated } = useAuth();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  // Pagination & filters
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'PACKAGE' | 'PROFILE'>('all');
  const limit = 12;

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit };
      if (typeFilter === 'all') {
        params.type = 'PACKAGE,PROFILE';
      } else {
        params.type = typeFilter;
      }
      if (searchTerm) params.search = searchTerm;

      const res = await api.get('/catalog/products', { params });
      setProducts(res.data.products || []);
      setTotalPages(res.data.totalPages || 1);
      setTotalCount(res.data.totalCount || 0);
    } catch (err: any) {
      console.warn('[Packages] Error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, typeFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleAddToCart = async (product: CatalogProduct) => {
    if (!isAuthenticated) {
      toast.error('Please log in to add items to your cart');
      return;
    }
    setAddingToCart(product.partnerCode);
    const success = await addToCart(
      product.partnerCode,
      product.name,
      product.price,
      product.mrp ?? undefined
    );
    if (success) toast.success(`${product.name} added to cart`);
    setAddingToCart(null);
  };

  const isInCart = (code: string) =>
    cart?.items?.some((i) => i.testCode === code) ?? false;

  const discountPercent = (price: number, mrp: number | null) => {
    if (!mrp || mrp <= price) return 0;
    return Math.round(((mrp - price) / mrp) * 100);
  };

  return (
    <main className="flex flex-col min-h-screen bg-gray-50">
      {/* Hero Header */}
      <section
        className="pt-8 pb-12 md:pt-12 md:pb-16"
        style={{
          background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)',
        }}
      >
        <div className="container mx-auto px-4 max-w-7xl">
          <button
            onClick={() => router.push('/')}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium mb-6 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </button>
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 mb-4">
              <FlaskConical className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">Curated by Experts</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white mb-3">
              Health Packages
            </h1>
            <p className="text-lg text-white/70 font-medium max-w-2xl mx-auto">
              Comprehensive checkup packages designed by medical experts for complete health screening
            </p>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="container mx-auto px-4 max-w-7xl -mt-6 relative z-10">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search packages..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
              />
            </div>
            {/* Type filter */}
            <div className="flex gap-2">
              {[
                { label: 'All', value: 'all' as const },
                { label: 'Packages', value: 'PACKAGE' as const },
                { label: 'Profiles', value: 'PROFILE' as const },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setTypeFilter(opt.value); setPage(1); }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
                    typeFilter === opt.value
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="container mx-auto px-4 max-w-7xl py-8 flex-1">
        {/* Count */}
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500 font-medium">
            {loading ? 'Loading...' : `${totalCount} package${totalCount !== 1 ? 's' : ''} found`}
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
            <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">
              {searchTerm ? `No packages found for "${searchTerm}"` : 'No packages available right now.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((pkg, idx) => {
              const discount = discountPercent(pkg.price, pkg.mrp);
              const inCart = isInCart(pkg.partnerCode);

              return (
                <Card
                  key={pkg.id}
                  className="relative p-0 overflow-hidden hover:shadow-xl hover:shadow-purple-500/5 transition-all duration-300 group border-gray-100"
                >
                  {discount > 0 && (
                    <div className="absolute top-4 right-4 z-10">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-500 text-white text-xs font-bold shadow-lg shadow-green-500/30">
                        <BadgePercent className="w-3 h-3" />
                        {discount}% OFF
                      </span>
                    </div>
                  )}

                  <div className="h-1.5 bg-gradient-to-r from-purple-600 via-fuchsia-500 to-pink-500" />

                  <div className="p-6 sm:p-8">
                    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-50 group-hover:bg-purple-100 transition-colors">
                      {idx % 3 === 0 ? (
                        <Activity className="h-7 w-7 text-purple-600" />
                      ) : idx % 3 === 1 ? (
                        <Heart className="h-7 w-7 text-purple-600" />
                      ) : (
                        <Zap className="h-7 w-7 text-purple-600" />
                      )}
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-bold text-gray-900 line-clamp-2 group-hover:text-purple-700 transition-colors">
                        {pkg.name}
                      </h3>
                    </div>
                    <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-purple-50 text-purple-600 border border-purple-100 mb-3">
                      {pkg.type}
                    </span>
                    {pkg.description && (
                      <p className="text-sm text-gray-500 mb-4 line-clamp-2">{pkg.description}</p>
                    )}

                    <div className="flex flex-wrap gap-2 mb-6">
                      {pkg.parameters && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg">
                          <TestTubes className="w-3 h-3" />
                          {pkg.parameters} Parameters
                        </span>
                      )}
                      {pkg.reportTime && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg">
                          <Clock className="w-3 h-3" />
                          {pkg.reportTime}
                        </span>
                      )}
                      {pkg.sampleType && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-lg">
                          <Beaker className="w-3 h-3" />
                          {pkg.sampleType}
                        </span>
                      )}
                    </div>

                    <div className="flex items-end justify-between mt-auto pt-4 border-t border-gray-100">
                      <div>
                        <div className="text-3xl font-black text-gray-900">₹{pkg.price}</div>
                        {pkg.mrp && pkg.mrp > pkg.price && (
                          <div className="text-sm text-gray-400 line-through">₹{pkg.mrp}</div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => inCart ? router.push('/cart') : handleAddToCart(pkg)}
                        disabled={addingToCart === pkg.partnerCode}
                        className={inCart ? 'bg-green-600 hover:bg-green-700 shadow-green-600/20' : ''}
                      >
                        {addingToCart === pkg.partnerCode ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : inCart ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 mr-1" />
                            In Cart
                          </>
                        ) : (
                          <>
                            <ShoppingCart className="w-4 h-4 mr-1" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-4">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            <span className="text-sm text-gray-500 font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
