'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/Footer';
import { Button, Card } from '@/components/ui';
import { useCart } from '@/contexts/CartContext';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import {
  ShoppingCart,
  Clock,
  Beaker,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  Activity,
  TestTubes,
  Info,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { parseSlug, mapHealthiansResponseToViewModel } from '@/lib/mapProductDetails';
import { ProductDetailsViewModel } from '@/types/productDetails';

export default function TestDetailsPage(props: { params: Promise<{ slug: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const { addToCart, cart } = useCart();
  const { isAuthenticated } = useAuth();

  const [localData, setLocalData] = useState<any>(null);
  const [richData, setRichData] = useState<ProductDetailsViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingToCart, setAddingToCart] = useState(false);
  const [showConstituents, setShowConstituents] = useState(false);

  useEffect(() => {
    const fetchDetails = async () => {
      try {
        const { dealTypeId } = parseSlug(params.slug, 'tests');
        if (!dealTypeId) throw new Error('Invalid test URL');

        // We don't know if it's a profile or parameter, but our local DB 
        // /api/catalog/products/:code needs the full code.
        // Wait, since we don't know the exact dealType string for partnerCode, 
        // we might have a problem looking it up strictly by ID if we don't have the prefix.
        // Let's assume the UI routing passes something like "vitamin-d-parameter_123" 
        // Actually our slug gen uses `dealTypeId`. We might need to change `parseSlug` 
        // to handle the full partner code or we just look it up by ID.
        // Wait, the `/packages` page links to `/packages/[slug]`. 
        // We will generate the slug like: `generateProductSlug(test.name, test.partnerCode)`
        // If we use the full partnerCode (e.g. "parameter_123") in the URL instead of just the ID,
        // it makes lookup easy!
        // Let's adapt parseSlug here: the last part of slug is partnerCode? 
        // Ah, if partnerCode has an underscore (e.g. `parameter_123`), the slug might be `name-parameter_123`.
        
        // Let's extract partnerCode from slug. It ends with `-type_id`.
        // e.g. `vitamin-d-parameter_123` -> `parameter_123`.
        // We'll split by `-` and take the last part if it contains `_`.
        // If the user's local partnerCode is `parameter_123`, we use that!
        
        const slugParts = params.slug.split('-');
        // Check if the last part is like package_123 or parameter_123 or profile_123
        let partnerCode = slugParts[slugParts.length - 1]; 
        
        // If partnerCode doesn't have an underscore, maybe the slug generator was only passing ID.
        // But let's assume we will pass the full partnerCode in the slug: `name-${partnerCode}`
        if (!partnerCode.includes('_')) {
            // fallback (maybe the slug format was just name-id and we assume profile or parameter)
            // But we can't reliably guess. Let's just use what we have and hope the backend route 
            // `products/:code` can handle it, or we fix the slug generator to include the full code.
            // For now, if there is no underscore, let's assume it's just the ID and we need to search.
            // Actually, we'll fix `generateProductSlug` to use `partnerCode` instead of just `dealTypeId` 
            // in the next step. So `partnerCode` will be e.g. `parameter_123`
            // Wait, in `mapProductDetails.ts`, I wrote `dealTypeId`. I will update the slug generator 
            // to append the full partnerCode. So the last part might be `package_94`!
            // Wait, `-` is the separator. So `name-package_94`. 
            // `slugParts[slugParts.length - 1]` will be `package_94`.
        }

        const localRes = await api.get(`/catalog/products/${partnerCode}`);
        setLocalData(localRes.data);

        // Extract dealType and dealTypeId from the partnerCode for the Healthians API
        // partnerCode is like "package_94"
        const [dealType, id] = partnerCode.split('_');

        // 2. Fetch Healthians Rich Data
        try {
          const richRes = await api.get(`/catalog/product-details/${dealType}/${id}`);
          if (richRes.data && richRes.data.status === true) {
            setRichData(mapHealthiansResponseToViewModel(richRes.data.data, dealType.toUpperCase() as any));
          }
        } catch (richErr) {
          console.warn('[Test Details] Failed to fetch rich data:', richErr);
        }

      } catch (err: any) {
        console.error('[Test Details] Error:', err);
        setError('We encountered an unexpected issue while loading the test details. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [params.slug]);

  // Dynamic SEO Title
  useEffect(() => {
    if (localData?.name) {
      document.title = `${localData.name} | DOCNOW`;
    }
  }, [localData]);

  if (loading) {
    return (
      <main className="min-h-screen flex flex-col bg-gray-50">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
        </div>
        <Footer />
      </main>
    );
  }

  if (error || !localData) {
    return (
      <main className="min-h-screen flex flex-col bg-gray-50">
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <Beaker className="w-16 h-16 text-gray-300 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Test Not Found</h1>
          <p className="text-gray-500 mb-6 text-center max-w-md">
            {error || 'The test you are looking for does not exist or is currently unavailable.'}
          </p>
          <Button onClick={() => router.push('/tests')}>View All Tests</Button>
        </div>
        <Footer />
      </main>
    );
  }

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      toast.error('Please log in to add items to your cart');
      return;
    }
    setAddingToCart(true);
    const success = await addToCart(
      localData.partnerCode,
      localData.name,
      localData.price,
      localData.mrp ?? undefined
    );
    if (success) toast.success(`${localData.name} added to cart`);
    setAddingToCart(false);
  };

  const inCart = cart?.items?.some((i) => i.testCode === localData.partnerCode) ?? false;
  const discount = localData.mrp && localData.mrp > localData.price 
    ? Math.round(((localData.mrp - localData.price) / localData.mrp) * 100) 
    : 0;

  return (
    <main className="flex flex-col min-h-screen bg-gray-50 pb-24">
      {/* JSON-LD Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "MedicalTest",
            "name": localData.name,
            "description": richData?.description || localData.description,
            "offers": {
              "@type": "Offer",
              "priceCurrency": "INR",
              "price": localData.price,
              "url": typeof window !== 'undefined' ? window.location.href : ''
            }
          })
        }}
      />

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-purple-900 via-purple-800 to-indigo-900 pt-8 pb-16">
        <div className="container mx-auto px-4 max-w-4xl">
          <button
            onClick={() => router.push('/tests')}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tests
          </button>

          <div className="flex flex-col md:flex-row gap-6 md:items-start">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
               <Beaker className="h-10 w-10 text-white" />
            </div>
            
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <span className="px-2.5 py-1 rounded-full text-xs font-bold tracking-wider uppercase bg-white/20 text-white border border-white/30">
                  {localData.type}
                </span>
                {discount > 0 && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold tracking-wider uppercase bg-green-500 text-white shadow-lg shadow-green-500/30">
                    {discount}% OFF
                  </span>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-4 leading-tight">
                {localData.name}
              </h1>
              
              {/* Highlights */}
              <div className="flex flex-wrap gap-4 mt-6">
                {(richData?.reportingTime || localData.reportTime) && (
                  <div className="flex items-center gap-2 text-white/80 bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                    <Clock className="w-5 h-5 text-blue-300" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Reports in</div>
                      <div className="font-medium">{richData?.reportingTime || localData.reportTime}</div>
                    </div>
                  </div>
                )}
                
                {(richData?.fasting || richData?.fastingTime) && (
                  <div className="flex items-center gap-2 text-white/80 bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                    <Activity className="w-5 h-5 text-teal-300" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Fasting</div>
                      <div className="font-medium">
                        {richData.fasting} {richData.fastingTime && `(${richData.fastingTime})`}
                      </div>
                    </div>
                  </div>
                )}

                {richData?.gender && richData.gender.length > 0 && (
                  <div className="flex items-center gap-2 text-white/80 bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                    <Users className="w-5 h-5 text-indigo-300" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Ideal For</div>
                      <div className="font-medium">{richData.gender.join(', ')}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Content Section */}
      <section className="container mx-auto px-4 max-w-4xl -mt-6 relative z-10">
        <div className="grid gap-6">
          
          {/* Description Card */}
          {(richData?.description || localData.description) && (
            <Card className="p-6 md:p-8 border-gray-100 shadow-xl shadow-blue-900/5">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-blue-600" />
                About this Test
              </h2>
              <p className="text-gray-600 leading-relaxed">
                {richData?.description || localData.description}
              </p>
            </Card>
          )}

          {/* Constituents Card */}
          {richData && richData.constituents && richData.constituents.length > 0 && (
            <Card className="p-6 md:p-8 border-gray-100 shadow-xl shadow-blue-900/5">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowConstituents(!showConstituents)}
              >
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <TestTubes className="w-5 h-5 text-blue-600" />
                  Parameters Included ({richData.constituents.length})
                </h2>
                <div className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  {showConstituents ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                </div>
              </div>
              
              {showConstituents && (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-6 border-t border-gray-100">
                  {richData.constituents.map((c, idx) => (
                    <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-100 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-blue-900">
                        {c.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

        </div>
      </section>

      {/* Sticky Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-[0_-10px_40px_rgba(0,0,0,0.05)] z-50">
        <div className="container mx-auto max-w-4xl flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-500 font-medium mb-1">Total Price</div>
            <div className="flex items-end gap-2">
              <span className="text-2xl md:text-3xl font-black text-gray-900">₹{localData.price}</span>
              {localData.mrp && localData.mrp > localData.price && (
                <span className="text-base text-gray-400 line-through mb-1">₹{localData.mrp}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {inCart && (
              <div className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-bold uppercase tracking-wider border border-green-200">
                <CheckCircle2 className="w-4 h-4" />
                {cart?.items.filter(i => i.testCode === localData.partnerCode).length} Added
              </div>
            )}
            <Button
              size="lg"
              className={`px-8 md:px-12 transition-all ${inCart ? 'bg-slate-900 hover:bg-slate-800 text-white' : 'bg-blue-600 hover:bg-blue-700'}`}
              onClick={handleAddToCart}
              disabled={addingToCart}
            >
              {addingToCart ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <ShoppingCart className="w-5 h-5 mr-2" />
                  {inCart ? '+1 Add More' : 'Add to Cart'}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}
