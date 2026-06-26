"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Search, Loader2, Tag, X,
  ChevronLeft, ChevronRight, SlidersHorizontal,
  Package, TestTubes, ArrowLeft, Activity
} from 'lucide-react';
import api from '@/lib/api';
import { useAuthGate } from '@/contexts/AuthGateContext';
import { useCart } from '@/contexts/CartContext';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { generateProductSlug } from '@/lib/mapProductDetails';
import { Footer } from '@/components/Footer';
import { ProductMarketingCard, ProductDetailsSummary } from '@/components/catalog/ProductMarketingCard';

interface Product {
  id: string;
  partnerCode: string;
  name: string;
  type: string;
  description?: string;
  displayPrice: number;
  discountedPrice?: number | null;
  price: number;
  mrp?: number | null;
  parameters?: string | null;
  sampleType?: string | null;
  reportTime?: string | null;
  categories: { id: string; name: string; slug: string }[];
  detailsSummary?: ProductDetailsSummary | null;
}

interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

type TypeFilter = 'ALL' | 'PACKAGE' | 'PROFILE' | 'TEST';

export default function SearchPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </main>
    }>
      <SearchPageContent />
    </Suspense>
  );
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { addToCart, cart } = useCart();
  const { requireAuth } = useAuthGate();

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [initialLoading, setInitialLoading] = useState(true); // Skeleton only on first load
  const [fetching, setFetching] = useState(false); // Subtle indicator for subsequent loads
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const limit = 12;

  // Refs for initialization gate and request cancellation
  const initialized = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Read URL params on mount — batch all state before marking initialized
  useEffect(() => {
    const cat = searchParams.get('category');
    const type = searchParams.get('type');
    const q = searchParams.get('q');
    if (cat) setSelectedCategory(cat);
    if (type && ['PACKAGE', 'PROFILE', 'TEST'].includes(type.toUpperCase())) {
      setTypeFilter(type.toUpperCase() as TypeFilter);
    }
    if (q) { setSearchInput(q); setSearchTerm(q); }
    // Mark initialized after URL params are parsed — this gates the first fetch
    initialized.current = true;
  }, [searchParams]);

  // Fetch categories once
  useEffect(() => {
    (async () => {
      setLoadingCategories(true);
      try {
        const res = await api.get('/catalog/categories');
        if (res.data?.categories) setCategories(res.data.categories);
      } catch (err) { console.error('Error fetching categories:', err); }
      finally { setLoadingCategories(false); }
    })();
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Fetch products — with AbortController to cancel stale requests
  const fetchProducts = useCallback(async () => {
    // Don't fetch until URL params have been parsed
    if (!initialized.current) return;

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Only show full skeleton on the very first load
    if (products.length === 0) {
      setInitialLoading(true);
    }
    setFetching(true);

    try {
      const params: Record<string, string | number> = { page, limit };
      if (typeFilter === 'ALL') {
        // Don't send type — get everything
      } else if (typeFilter === 'TEST') {
        params.type = 'TEST,PROFILE';
      } else {
        params.type = typeFilter;
      }
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (selectedCategory) params.category = selectedCategory;

      const res = await api.get('/catalog/products', { params, signal: controller.signal });

      // Only apply results if this request wasn't cancelled
      if (!controller.signal.aborted) {
        setProducts(res.data.products || []);
        setTotalPages(res.data.totalPages || 1);
        setTotalCount(res.data.totalCount || 0);
      }
    } catch (err: any) {
      // Ignore aborted requests — they're expected
      if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
        console.error('[Search] Error:', err);
      }
    } finally {
      if (!controller.signal.aborted) {
        setInitialLoading(false);
        setFetching(false);
      }
    }
  }, [page, searchTerm, selectedCategory, typeFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Helpers
  const handleBookNow = (product: Product) => {
    const doAdd = async () => {
      if (isInCart(product.partnerCode)) {
        router.push('/cart');
        return;
      }

      setAddingToCart(product.partnerCode);
      const offerPrice = product.price || product.displayPrice || 0;
      const mrpPrice = product.mrp || product.displayPrice || 0;
      const success = await addToCart(product.partnerCode, product.name, offerPrice, mrpPrice > offerPrice ? mrpPrice : undefined);
      setAddingToCart(null);
      if (success) {
        router.push('/cart');
      }
    };
    requireAuth(doAdd);
  };

  const isInCart = (code: string) => cart?.items?.some((i) => i.testCode === code) ?? false;
  const handleCategorySelect = (slug: string) => {
    setSelectedCategory(slug === selectedCategory ? '' : slug);
    setPage(1);
  };

  const handleTypeFilter = (t: TypeFilter) => {
    setTypeFilter(t);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearchInput(''); setSearchTerm('');
    setSelectedCategory(''); setTypeFilter('ALL'); setPage(1);
  };

  const hasActiveFilters = searchTerm || selectedCategory || typeFilter !== 'ALL';

  const typeOptions: { label: string; value: TypeFilter; icon: LucideIcon }[] = [
    { label: 'All', value: 'ALL', icon: SlidersHorizontal },
    { label: 'Packages', value: 'PACKAGE', icon: Package },
    { label: 'Profiles', value: 'PROFILE', icon: Activity },
    { label: 'Tests', value: 'TEST', icon: TestTubes },
  ];

  return (
    <main className="flex flex-col min-h-screen bg-gray-50">
      {/* Hero */}
      <section
        className="pt-8 pb-14 md:pt-12 md:pb-20"
        style={{ background: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' }}
      >
        <div className="container mx-auto px-4 max-w-7xl">
          <button onClick={() => router.push('/')} className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 mb-4">
              <Search className="w-4 h-4 text-white" />
              <span className="text-sm font-bold text-white">Explore Our Catalog</span>
            </div>
            <h1 className="text-3xl md:text-5xl font-black text-white mb-3">Search Health Tests & Packages</h1>
            <p className="text-lg text-white/70 font-medium max-w-2xl mx-auto">
              Browse 1000+ diagnostic tests, health packages, and profiles — all from certified labs
            </p>
          </div>
        </div>
      </section>

      {/* Sticky Filter Bar */}
      <section className="container mx-auto px-4 max-w-7xl -mt-8 relative z-10">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-4 sm:p-6">
          {/* Search Input */}
          <div className="relative mb-4">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search tests, packages — e.g. Vitamin D, Thyroid, CBC..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-12 pr-12 py-3.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-gray-50"
              autoFocus
            />
            {searchInput && (
              <button onClick={() => { setSearchInput(''); setSearchTerm(''); setPage(1); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Type Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex gap-2 flex-wrap">
              {typeOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleTypeFilter(opt.value)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
                    typeFilter === opt.value
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <opt.icon className="w-4 h-4" />
                  {opt.label}
                </button>
              ))}
            </div>
            {hasActiveFilters && (
              <button onClick={clearAllFilters} className="text-sm text-gray-400 hover:text-red-500 font-medium ml-auto transition-colors">
                Clear all filters
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Category Chips */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30 mt-4">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex gap-2 overflow-x-auto py-3 scrollbar-hide">
            <button
              onClick={() => handleCategorySelect('')}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all duration-200 ${!selectedCategory
                ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-600/20'
                : 'bg-white text-gray-600 border-gray-200 hover:border-purple-400 hover:bg-purple-50'
              }`}
            >
              All Categories
            </button>
            {loadingCategories ? (
              <div className="flex items-center px-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
            ) : (
              categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => handleCategorySelect(cat.slug)}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-semibold border-2 transition-all duration-200 whitespace-nowrap ${selectedCategory === cat.slug
                    ? 'bg-purple-600 text-white border-purple-600 shadow-md shadow-purple-600/20'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-purple-400 hover:bg-purple-50'
                  }`}
                >
                  {cat.name}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Active Filters Summary */}
      {hasActiveFilters && (
        <div className="container mx-auto px-4 max-w-7xl mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            {searchTerm && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-bold border border-purple-100">
                Search: &ldquo;{searchTerm}&rdquo;
                <button onClick={() => { setSearchInput(''); setSearchTerm(''); }}><X className="w-3 h-3" /></button>
              </span>
            )}
            {selectedCategory && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-bold border border-purple-100">
                <Tag className="w-3 h-3" />
                {categories.find(c => c.slug === selectedCategory)?.name}
                <button onClick={() => setSelectedCategory('')}><X className="w-3 h-3" /></button>
              </span>
            )}
            {typeFilter !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-lg text-xs font-bold border border-purple-100">
                Type: {typeFilter}
                <button onClick={() => setTypeFilter('ALL')}><X className="w-3 h-3" /></button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      <section className="container mx-auto px-4 max-w-7xl py-6 flex-1">
        {/* Subtle loading bar for subsequent fetches */}
        {fetching && !initialLoading && (
          <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden mb-2">
            <div className="h-full bg-purple-500 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
        )}

        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500 font-medium">
            {initialLoading ? 'Searching...' : `${totalCount} result${totalCount !== 1 ? 's' : ''} found`}
          </p>
          {!initialLoading && totalCount > 0 && (
            <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          )}
        </div>

        {initialLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
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
            <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium text-lg">No results found</p>
            <p className="text-gray-400 text-sm mt-1 max-w-md mx-auto">
              {searchTerm ? `We couldn't find anything matching "${searchTerm}".` : 'Try adjusting your filters.'}
            </p>
            {hasActiveFilters && (
              <button onClick={clearAllFilters} className="mt-4 text-sm text-purple-600 font-semibold hover:underline">
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 transition-opacity duration-200 ${fetching ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
            {products.map((product) => {
              const slug = generateProductSlug(product.name, product.partnerCode);
              const basePath = product.type === 'PROFILE' ? 'profiles' : (product.type === 'TEST' || product.type === 'PARAMETER') ? 'tests' : 'packages';

              return (
                <ProductMarketingCard
                  key={product.id}
                  product={product}
                  detailHref={`/${basePath}/${slug}`}
                  onBookNow={handleBookNow}
                  isBooking={addingToCart === product.partnerCode}
                  inCartCount={cart?.items.filter(i => i.testCode === product.partnerCode).length || 0}
                />
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !initialLoading && (
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
                      ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
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
