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
  Heart,
  Zap,
  TestTubes,
  Info,
  Users,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { parseSlug, mapHealthiansResponseToViewModel } from '@/lib/mapProductDetails';
import { ProductDetailsViewModel } from '@/types/productDetails';

export default function PackageDetailsPage(props: { params: Promise<{ slug: string }> }) {
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
        const { dealTypeId } = parseSlug(params.slug, 'packages');
        if (!dealTypeId) throw new Error('Invalid package URL');

        const partnerCode = `package_${dealTypeId}`;

        // 1. Fetch Local DB Data (for pricing, mrp, cart info)
        const localRes = await api.get(`/catalog/products/${partnerCode}`);
        setLocalData(localRes.data);

        // 2. Fetch Healthians Rich Data
        try {
          const richRes = await api.get(`/catalog/product-details/package/${dealTypeId}`);
          if (richRes.data && richRes.data.status === true) {
            setRichData(mapHealthiansResponseToViewModel(richRes.data.data, 'PACKAGE'));
          }
        } catch (richErr) {
          console.warn('[Package Details] Failed to fetch rich data:', richErr);
          // We don't throw here; we can still render the page with local data if rich data fails
        }

      } catch (err: any) {
        console.error('[Package Details] Error:', err);
        setError('We encountered an unexpected issue while loading the package details. Please try again later.');
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
          <Loader2 className="w-10 h-10 animate-spin text-purple-600" />
        </div>
        <Footer />
      </main>
    );
  }

  if (error || !localData) {
    return (
      <main className="min-h-screen flex flex-col bg-gray-50">
        <div className="flex-1 flex flex-col items-center justify-center p-4">
          <Activity className="w-16 h-16 text-gray-300 mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Package Not Found</h1>
          <p className="text-gray-500 mb-6 text-center max-w-md">
            {error || 'The package you are looking for does not exist or is currently unavailable.'}
          </p>
          <Button onClick={() => router.push('/packages')}>View All Packages</Button>
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
            "@type": "MedicalTestPanel",
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
            onClick={() => router.push('/packages')}
            className="flex items-center gap-1.5 text-white/70 hover:text-white text-sm font-medium mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Packages
          </button>

          <div className="flex flex-col md:flex-row gap-6 md:items-start">
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20">
               <Activity className="h-10 w-10 text-white" />
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
                    <Clock className="w-5 h-5 text-purple-300" />
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-white/50 font-bold">Reports in</div>
                      <div className="font-medium">{richData?.reportingTime || localData.reportTime}</div>
                    </div>
                  </div>
                )}
                
                {(richData?.fasting || richData?.fastingTime) && (
                  <div className="flex items-center gap-2 text-white/80 bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                    <Beaker className="w-5 h-5 text-pink-300" />
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
                    <Users className="w-5 h-5 text-blue-300" />
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
            <Card className="p-6 md:p-8 border-gray-100 shadow-xl shadow-purple-900/5">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Info className="w-5 h-5 text-purple-600" />
                About this Package
              </h2>
              <p className="text-gray-600 leading-relaxed">
                {richData?.description || localData.description}
              </p>
            </Card>
          )}

          {/* Constituents Card */}
          {richData && richData.constituents && richData.constituents.length > 0 && (
            <Card className="p-6 md:p-8 border-gray-100 shadow-xl shadow-purple-900/5">
              <div 
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setShowConstituents(!showConstituents)}
              >
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <TestTubes className="w-5 h-5 text-purple-600" />
                  Tests Included ({richData.constituents.length})
                </h2>
                <div className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  {showConstituents ? <ChevronUp className="w-5 h-5 text-gray-500" /> : <ChevronDown className="w-5 h-5 text-gray-500" />}
                </div>
              </div>
              
              {showConstituents && (
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-6 border-t border-gray-100">
                  {richData.constituents.map((c, idx) => (
                    <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-purple-50 transition-colors border border-transparent hover:border-purple-100 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-medium text-gray-700 group-hover:text-purple-900">
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
              className={`px-8 md:px-12 transition-all ${inCart ? 'bg-slate-900 hover:bg-slate-800 text-white' : 'bg-purple-600 hover:bg-purple-700'}`}
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
