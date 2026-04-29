'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { Button, Card } from '@/components/ui';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Search,
  ShoppingCart,
  Clock,
  Beaker,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  X,
  Tag,
} from 'lucide-react';
import { generateProductSlug } from '@/lib/mapProductDetails';
import Link from 'next/link';

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

interface Category {
  id: string;
  name: string;
  slug: string;
}

export default function TestsPage() {
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { isAuthenticated } = useAuth();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  // Pagination & search
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const limit = 12;

  // Fetch categories once
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/catalog/categories');
        if (res.data?.categories) setCategories(res.data.categories);
      } catch (err) { console.error(err); }
    })();
  }, []);

  // Scroll to top on page change
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [page]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit, type: 'TEST' };
      if (searchTerm) params.search = searchTerm;
      if (selectedCategory) params.category = selectedCategory;

      const res = await api.get('/catalog/products', { params });
      setProducts(res.data.products || []);
      setTotalPages(res.data.totalPages || 1);
      setTotalCount(res.data.totalCount || 0);
    } catch (err: any) {
      console.warn('[Tests] Error:', err?.message);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, selectedCategory]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Debounced search — fires API call on every keystroke with 350ms debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, 350);
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
              <Beaker className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">Comprehensive Testing</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white mb-3">
              Lab Tests
            </h1>
            <p className="text-lg text-white/70 font-medium max-w-2xl mx-auto">
              Precisely targeted diagnostics for specific health concerns
            </p>
          </div>
        </div>
      </section>

      {/* Search Bar */}
      <section className="container mx-auto px-4 max-w-7xl -mt-6 relative z-10">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6">
          <div className="relative max-w-2xl mx-auto">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tests — e.g. Vitamin D, Thyroid, CBC, Iron..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-12 pr-10 py-3.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50"
              autoFocus
            />
            {searchInput && (
              <button
                onClick={() => { setSearchInput(''); setSearchTerm(''); setPage(1); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {searchTerm && !loading && (
            <p className="text-center text-sm text-gray-500 mt-3">
              {totalCount} result{totalCount !== 1 ? 's' : ''} for &ldquo;{searchTerm}&rdquo;
            </p>
          )}
        </div>
      </section>

      {/* Category Chips */}
      {categories.length > 0 && (
        <div className="bg-white border-b border-gray-100 sticky top-0 z-30 mt-4">
          <div className="container mx-auto px-4 max-w-7xl">
            <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
              <button
                onClick={() => { setSelectedCategory(''); setPage(1); }}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all ${!selectedCategory
                  ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                }`}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.slug === selectedCategory ? '' : cat.slug); setPage(1); }}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all whitespace-nowrap ${selectedCategory === cat.slug
                    ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-600/20'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400 hover:bg-blue-50'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Results */}
      <section className="container mx-auto px-4 max-w-7xl py-8 flex-1">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm text-gray-500 font-medium">
            {loading ? 'Searching...' : `${totalCount} test${totalCount !== 1 ? 's' : ''} available`}
          </p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
                <div className="flex gap-2 mb-4"><div className="h-5 w-16 bg-gray-200 rounded-full" /><div className="h-5 w-12 bg-gray-200 rounded-full" /></div>
                <div className="h-5 w-3/4 bg-gray-200 rounded mb-2" />
                <div className="h-4 w-1/2 bg-gray-200 rounded mb-6" />
                <div className="flex justify-between items-center pt-4 border-t border-gray-100">
                  <div className="h-7 w-16 bg-gray-200 rounded" />
                  <div className="h-9 w-20 bg-gray-200 rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-gray-100">
            <Beaker className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium">
              {searchTerm ? `No tests found for "${searchTerm}"` : 'No tests available right now.'}
            </p>
            {searchTerm && (
              <p className="text-gray-400 text-sm mt-2">Try a different search term</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((test) => {
              const discount = discountPercent(test.price, test.mrp);
              const inCart = isInCart(test.partnerCode);
              const slug = generateProductSlug(test.name, test.partnerCode);

              return (
                <Link href={`/tests/${slug}`} key={test.id} className="block h-full">
                  <Card
                    className="p-5 sm:p-6 bg-white border-gray-100 hover:shadow-lg hover:shadow-gray-200/50 transition-all duration-300 group h-full flex flex-col"
                  >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-wrap gap-1.5">
                      {test.categories.map((cat) => (
                        <span
                          key={cat.id}
                          className="bg-blue-50 text-blue-700 text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full border border-blue-100"
                        >
                          {cat.name}
                        </span>
                      ))}
                    </div>
                    {discount > 0 && (
                      <span className="text-[10px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-md flex-shrink-0">
                        {discount}% OFF
                      </span>
                    )}
                  </div>

                  <h3 className="font-bold text-base sm:text-lg text-gray-900 mb-1 line-clamp-2 group-hover:text-blue-700 transition-colors">
                    {test.name}
                  </h3>

                  <div className="flex flex-wrap gap-3 mt-2 mb-5 text-xs text-gray-400 font-medium">
                    {test.reportTime && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {test.reportTime}
                      </span>
                    )}
                    {test.sampleType && (
                      <span className="flex items-center gap-1">
                        <Beaker className="w-3 h-3" /> {test.sampleType}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-gray-900">₹{test.price}</span>
                      {test.mrp && test.mrp > test.price && (
                        <span className="text-sm text-gray-400 line-through">₹{test.mrp}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {inCart && (
                        <div className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-green-200">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {cart?.items.filter(i => i.testCode === test.partnerCode).length} Added
                        </div>
                      )}
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          handleAddToCart(test);
                        }}
                        disabled={addingToCart === test.partnerCode}
                        className={inCart ? 'bg-slate-900 hover:bg-slate-800 text-white' : ''}
                      >
                        {addingToCart === test.partnerCode ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <div className="flex items-center gap-1">
                            <ShoppingCart className="w-4 h-4" />
                            {inCart ? '+1' : 'Add'}
                          </div>
                        )}
                      </Button>
                    </div>
                  </div>
                </Card>
              </Link>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !loading && (
          <div className="mt-10 flex items-center justify-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) { pageNum = i + 1; }
              else if (page <= 3) { pageNum = i + 1; }
              else if (page >= totalPages - 2) { pageNum = totalPages - 4 + i; }
              else { pageNum = page - 2 + i; }
              return (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-10 h-10 rounded-xl text-sm font-semibold transition-all ${
                    page === pageNum
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}
