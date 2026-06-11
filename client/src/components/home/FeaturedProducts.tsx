"use client";

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { generateProductSlug } from '@/lib/mapProductDetails';
import toast from 'react-hot-toast';
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
  const { isAuthenticated } = useAuth();
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

  const handleBookNow = async (product: CatalogProduct) => {
    if (!isAuthenticated) { toast.error('Please log in to book this test'); return; }
    if (cart?.items?.some((i) => i.testCode === product.partnerCode)) { router.push('/cart'); return; }
    setAddingToCart(product.partnerCode);
    const success = await addToCart(product.partnerCode, product.name, product.price, product.mrp ?? undefined);
    setAddingToCart(null);
    if (success) router.push('/cart');
  };

  return (
    <>
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
  const { isAuthenticated } = useAuth();
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

  const handleBookNow = async (product: CatalogProduct) => {
    if (!isAuthenticated) { toast.error('Please log in to book this test'); return; }
    if (cart?.items?.some((i) => i.testCode === product.partnerCode)) { router.push('/cart'); return; }
    setAddingToCart(product.partnerCode);
    const success = await addToCart(product.partnerCode, product.name, product.price, product.mrp ?? undefined);
    setAddingToCart(null);
    if (success) router.push('/cart');
  };

  return (
    <>
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
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
