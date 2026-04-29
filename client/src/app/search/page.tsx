"use client";

import { useEffect, useState, useCallback, Suspense } from 'react';
import {
  Search, Filter, Loader2, ShoppingCart, Info, Check, Tag, X,
  ChevronLeft, ChevronRight, Clock, Beaker, SlidersHorizontal,
  CheckCircle2, Package, TestTubes, FlaskConical, ArrowLeft
} from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { generateProductSlug } from '@/lib/mapProductDetails';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { Button, Card } from '@/components/ui';

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
  const { isAuthenticated } = useAuth();

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
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

  // Read URL params on mount
  useEffect(() => {
    const cat = searchParams.get('category');
    const type = searchParams.get('type');
    const q = searchParams.get('q');
    if (cat) setSelectedCategory(cat);
    if (type && ['PACKAGE', 'PROFILE', 'TEST'].includes(type.toUpperCase())) {
      setTypeFilter(type.toUpperCase() as TypeFilter);
    }
    if (q) { setSearchInput(q); setSearchTerm(q); }
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

  // Fetch products
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit };
      if (typeFilter === 'ALL') {
        // Don't send type — get everything
      } else if (typeFilter === 'PACKAGE') {
        params.type = 'PACKAGE,PROFILE';
      } else {
        params.type = typeFilter;
      }
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (selectedCategory) params.category = selectedCategory;

      const res = await api.get('/catalog/products', { params });
      setProducts(res.data.products || []);
      setTotalPages(res.data.totalPages || 1);
      setTotalCount(res.data.totalCount || 0);
    } catch (err) {
      console.error('[Search] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, selectedCategory, typeFilter]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // Helpers
  const handleAddToCart = async (product: Product) => {
    if (!isAuthenticated) { toast.error('Please log in to add items to your cart'); return; }
    setAddingToCart(product.partnerCode);
    const offerPrice = product.price || product.displayPrice || 0;
    const mrpPrice = product.mrp || product.displayPrice || 0;
    const success = await addToCart(product.partnerCode, product.name, offerPrice, mrpPrice > offerPrice ? mrpPrice : undefined);
    if (success) toast.success(`${product.name} added to cart`);
    setAddingToCart(null);
  };

  const isInCart = (code: string) => cart?.items?.some((i) => i.testCode === code) ?? false;
  const discountPercent = (price: number, mrp?: number | null) => {
    if (!mrp || mrp <= price) return 0;
    return Math.round(((mrp - price) / mrp) * 100);
  };

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

  const typeOptions: { label: string; value: TypeFilter; icon: any }[] = [
    { label: 'All', value: 'ALL', icon: SlidersHorizontal },
    { label: 'Packages', value: 'PACKAGE', icon: Package },
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
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-gray-500 font-medium">
            {loading ? 'Searching...' : `${totalCount} result${totalCount !== 1 ? 's' : ''} found`}
          </p>
          {!loading && totalCount > 0 && (
            <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {products.map((product) => {
              const discount = discountPercent(product.price, product.mrp);
              const inCart = isInCart(product.partnerCode);
              const slug = generateProductSlug(product.name, product.partnerCode);
              const basePath = (product.type === 'TEST' || product.type === 'PARAMETER') ? 'tests' : 'packages';

              return (
                <Link href={`/${basePath}/${slug}`} key={product.id} className="block h-full">
                  <Card className="relative p-0 overflow-hidden hover:shadow-xl hover:shadow-purple-500/5 transition-all duration-300 group border-gray-100 h-full flex flex-col">
                    {discount > 0 && (
                      <div className="absolute top-3 right-3 z-10">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-500 text-white text-[10px] font-bold shadow-lg shadow-green-500/30">
                          {discount}% OFF
                        </span>
                      </div>
                    )}
                    <div className={`h-1 ${product.type === 'TEST' || product.type === 'PARAMETER' ? 'bg-gradient-to-r from-blue-600 to-teal-500' : 'bg-gradient-to-r from-purple-600 via-fuchsia-500 to-pink-500'}`} />
                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex items-center gap-2 mb-3">
                        <span className={`text-[10px] font-black tracking-widest uppercase px-2 py-0.5 rounded-full ${
                          product.type === 'PACKAGE' ? 'bg-purple-50 text-purple-600 border border-purple-100' :
                          product.type === 'PROFILE' ? 'bg-fuchsia-50 text-fuchsia-600 border border-fuchsia-100' :
                          'bg-blue-50 text-blue-600 border border-blue-100'
                        }`}>
                          {product.type}
                        </span>
                        {product.categories?.slice(0, 1).map(cat => (
                          <span key={cat.id} className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{cat.name}</span>
                        ))}
                      </div>
                      <h3 className="font-bold text-gray-900 text-base mb-2 line-clamp-2 min-h-[2.5rem] group-hover:text-purple-700 transition-colors leading-snug">
                        {product.name}
                      </h3>
                      <div className="flex flex-wrap gap-2 mb-4 text-xs text-gray-400 font-medium">
                        {product.reportTime && (
                          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {product.reportTime}</span>
                        )}
                        {product.sampleType && (
                          <span className="flex items-center gap-1"><Beaker className="w-3 h-3" /> {product.sampleType}</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                        <div className="flex items-center gap-2">
                          <span className="text-xl font-black text-gray-900">₹{product.price}</span>
                          {product.mrp && product.mrp > product.price && (
                            <span className="text-sm text-gray-400 line-through">₹{product.mrp}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {inCart && (
                            <div className="flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-[10px] font-bold uppercase tracking-wider border border-green-200">
                              <CheckCircle2 className="w-3 h-3" />
                              {cart?.items.filter(i => i.testCode === product.partnerCode).length}
                            </div>
                          )}
                          <Button
                            size="sm"
                            onClick={(e) => { e.preventDefault(); handleAddToCart(product); }}
                            disabled={addingToCart === product.partnerCode}
                            className={inCart ? 'bg-slate-900 hover:bg-slate-800 text-white' : ''}
                          >
                            {addingToCart === product.partnerCode ? (
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
