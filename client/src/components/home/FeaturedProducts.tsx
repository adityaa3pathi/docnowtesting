"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/contexts/CartContext';
import { useAuthGate } from '@/contexts/AuthGateContext';
import api from '@/lib/api';
import { generateProductSlug } from '@/lib/mapProductDetails';
import { ProductMarketingCard, ProductDetailsSummary } from '@/components/catalog/ProductMarketingCard';
import { Button } from '@/components/ui';
import {
  ArrowRight,
  Beaker,
  ChevronRight,
  FlaskConical,
  Loader2,
} from 'lucide-react';

// ────────────────────── Types
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
  purpose?: string | null;
  parameters: string | null;
  sampleType: string | null;
  reportTime: string | null;
  categories: { id: string; name: string; slug: string }[];
  detailsSummary?: ProductDetailsSummary | null;
}

function isNetworkError(error: unknown) {
  return typeof error === 'object' && error !== null && 'isNetworkError' in error;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// ────────────────────── Featured Packages Grid
export function FeaturedPackages() {
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { requireAuth } = useAuthGate();
  const [packages, setPackages] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  const fetchPackages = useCallback(async (retries = 2) => {
    try {
      const res = await api.get('/catalog/featured', { params: { type: 'PACKAGE', limit: 6 } });
      setPackages(res.data.products || []);
    } catch (err: unknown) {
      if (retries > 0 && isNetworkError(err)) {
        await new Promise(r => setTimeout(r, 1500));
        return fetchPackages(retries - 1);
      }
      console.warn('[Home] Could not load packages:', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPackages(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBookNow = (product: CatalogProduct) => {
    const doAdd = async () => {
      if (cart?.items?.some((i) => i.testCode === product.partnerCode)) { router.push('/cart'); return; }
      setAddingToCart(product.partnerCode);
      const success = await addToCart(product.partnerCode, product.name, product.price, product.mrp ?? undefined);
      setAddingToCart(null);
      if (success) router.push('/cart');
    };
    requireAuth(doAdd);
  };

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm animate-pulse">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-3/4 bg-gray-200 rounded" />
                  <div className="h-4 w-1/2 bg-gray-200 rounded" />
                </div>
                <div className="h-6 w-16 bg-gray-200 rounded-full" />
              </div>
              <div className="h-4 w-full bg-gray-200 rounded mb-2" />
              <div className="h-4 w-5/6 bg-gray-200 rounded mb-4" />
              <div className="flex items-center gap-6 py-3 mb-4">
                <div className="h-4 w-20 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
              <div className="flex items-baseline justify-between pt-4 border-t border-gray-100">
                <div className="space-y-1">
                  <div className="h-7 w-24 bg-gray-200 rounded" />
                  <div className="h-4 w-16 bg-gray-200 rounded" />
                </div>
                <div className="h-10 w-28 bg-gray-200 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : packages.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <FlaskConical className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">No packages available right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {packages.slice(0, 6).map((pkg) => {
            const slug = generateProductSlug(pkg.name, pkg.partnerCode);
            const pkgBasePath = pkg.type === 'PROFILE' ? 'profiles' : 'packages';
            return (
              <ProductMarketingCard
                key={pkg.id}
                product={pkg}
                detailHref={`/${pkgBasePath}/${slug}`}
                onBookNow={handleBookNow}
                isBooking={addingToCart === pkg.partnerCode}
                inCartCount={cart?.items.filter(i => i.testCode === pkg.partnerCode).length || 0}
              />
            );
          })}
        </div>
      )}

      <div className="mt-12 text-center">
        <Button
          variant="outline"
          size="lg"
          onClick={() => router.push('/search?type=PACKAGE')}
          className="border-purple-200 text-purple-700 hover:bg-purple-50"
        >
          View All Packages
          <ArrowRight className="ml-2 w-5 h-5" />
        </Button>
      </div>
    </>
  );
}

// ────────────────────── Featured Tests Grid
export function FeaturedTests() {
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { requireAuth } = useAuthGate();
  const [tests, setTests] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  const fetchTests = useCallback(async (retries = 2) => {
    try {
      const res = await api.get('/catalog/featured', { params: { type: 'TEST,PROFILE', limit: 9 } });
      setTests(res.data.products || []);
    } catch (err: unknown) {
      if (retries > 0 && isNetworkError(err)) {
        await new Promise(r => setTimeout(r, 1500));
        return fetchTests(retries - 1);
      }
      console.warn('[Home] Could not load tests:', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTests(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBookNow = (product: CatalogProduct) => {
    const doAdd = async () => {
      if (cart?.items?.some((i) => i.testCode === product.partnerCode)) { router.push('/cart'); return; }
      setAddingToCart(product.partnerCode);
      const success = await addToCart(product.partnerCode, product.name, product.price, product.mrp ?? undefined);
      setAddingToCart(null);
      if (success) router.push('/cart');
    };
    requireAuth(doAdd);
  };

  return (
    <>
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm animate-pulse">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex-1 space-y-2">
                  <div className="h-6 w-3/4 bg-gray-200 rounded" />
                  <div className="h-4 w-1/2 bg-gray-200 rounded" />
                </div>
                <div className="h-6 w-12 bg-gray-200 rounded-full" />
              </div>
              <div className="h-4 w-full bg-gray-200 rounded mb-2" />
              <div className="h-4 w-5/6 bg-gray-200 rounded mb-4" />
              <div className="flex items-center gap-6 py-3 mb-4">
                <div className="h-4 w-20 bg-gray-200 rounded" />
                <div className="h-4 w-20 bg-gray-200 rounded" />
              </div>
              <div className="flex items-baseline justify-between pt-4 border-t border-gray-100">
                <div className="space-y-1">
                  <div className="h-7 w-24 bg-gray-200 rounded" />
                  <div className="h-4 w-16 bg-gray-200 rounded" />
                </div>
                <div className="h-10 w-28 bg-gray-200 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : tests.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <Beaker className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500 font-medium">No tests available right now.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tests.map((test) => {
            const slug = generateProductSlug(test.name, test.partnerCode);
            const testBasePath = test.type === 'PROFILE' ? 'profiles' : 'tests';
            return (
              <ProductMarketingCard
                key={test.id}
                product={test}
                detailHref={`/${testBasePath}/${slug}`}
                onBookNow={handleBookNow}
                isBooking={addingToCart === test.partnerCode}
                inCartCount={cart?.items.filter(i => i.testCode === test.partnerCode).length || 0}
              />
            );
          })}
        </div>
      )}

      <div className="mt-10 text-center">
        <Button
          variant="outline"
          size="lg"
          onClick={() => router.push('/search?type=TEST')}
          className="border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          View All Tests
          <ChevronRight className="ml-1 w-5 h-5" />
        </Button>
      </div>
    </>
  );
}
