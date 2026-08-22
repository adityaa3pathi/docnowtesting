'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  ImageIcon,
  Monitor,
  Smartphone,
  Info,
  GripVertical,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface HeroSlide {
  id: string;
  desktopImageUrl?: string | null;
  mobileImageUrl?: string | null;
  imageAlt?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function HeroSlidesCMSPage() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Simple form — just image URLs + alt
  const [desktopImageUrl, setDesktopImageUrl] = useState('');
  const [mobileImageUrl, setMobileImageUrl] = useState('');
  const [imageAlt, setImageAlt] = useState('');

  const fetchSlides = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/hero-slides');
      setSlides(res.data.slides || []);
    } catch {
      toast.error('Failed to load hero slides');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlides();
  }, []);

  const openAddModal = () => {
    setDesktopImageUrl('');
    setMobileImageUrl('');
    setImageAlt('');
    setModalOpen(true);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desktopImageUrl.trim() && !mobileImageUrl.trim()) {
      toast.error('Please provide at least one image URL');
      return;
    }

    try {
      setSaving(true);
      await api.post('/admin/hero-slides', {
        title: imageAlt || 'Hero Banner',
        subtitle: '',
        desktopImageUrl: desktopImageUrl.trim() || null,
        mobileImageUrl: mobileImageUrl.trim() || null,
        imageAlt: imageAlt.trim() || null,
        sortOrder: slides.length,
        isActive: true,
      });
      toast.success('Banner added');
      setModalOpen(false);
      fetchSlides();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to add banner');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this banner?')) return;
    try {
      await api.delete(`/admin/hero-slides/${id}`);
      toast.success('Banner deleted');
      fetchSlides();
    } catch {
      toast.error('Failed to delete');
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    const newSlides = [...slides];
    [newSlides[index], newSlides[targetIndex]] = [newSlides[targetIndex], newSlides[index]];

    const reordered = newSlides.map((s, i) => ({ id: s.id, sortOrder: i }));
    setSlides(newSlides);

    try {
      await api.put('/admin/hero-slides/reorder', { items: reordered });
    } catch {
      toast.error('Reorder failed');
      fetchSlides();
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-purple-100">
        <div>
          <div className="flex items-center gap-2 text-purple-700 font-bold text-sm mb-1">
            <ImageIcon size={18} />
            <span>Homepage CMS</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900">Hero Banners</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">
            Upload, delete, and reorder hero banner images for the landing page.
          </p>
        </div>

        <button
          onClick={openAddModal}
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#4b2192] hover:bg-[#3b1975] text-white font-bold rounded-xl shadow-md transition-all hover:scale-105 active:scale-95 text-sm"
        >
          <Plus size={18} />
          <span>Add Banner</span>
        </button>
      </div>

      {/* Image Spec Guidelines — always visible */}
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-purple-800">Image Upload Guidelines</p>
            <p className="text-xs text-purple-600 mt-0.5">
              Upload separate images for desktop and mobile for best results. Host images on Cloudinary / S3 and paste the URL.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 border border-purple-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2.5">
              <Monitor size={16} className="text-blue-600" />
              <span className="text-sm font-extrabold text-gray-800">Desktop Banner</span>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-600 font-medium">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                <strong>Size:</strong>&nbsp;1440 × 560 px
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                <strong>Aspect Ratio:</strong>&nbsp;18 : 7
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                <strong>Format:</strong>&nbsp;WebP or PNG
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                <strong>Max Size:</strong>&nbsp;200 KB
              </li>
            </ul>
          </div>

          <div className="bg-white rounded-xl p-4 border border-purple-100 shadow-sm">
            <div className="flex items-center gap-2 mb-2.5">
              <Smartphone size={16} className="text-green-600" />
              <span className="text-sm font-extrabold text-gray-800">Mobile Banner</span>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-600 font-medium">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                <strong>Size:</strong>&nbsp;768 × 480 px
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                <strong>Aspect Ratio:</strong>&nbsp;8 : 5
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                <strong>Format:</strong>&nbsp;WebP or PNG
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                <strong>Max Size:</strong>&nbsp;120 KB
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Slide List */}
      {loading ? (
        <div className="flex items-center justify-center p-16 bg-white rounded-2xl border border-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-[#4b2192]" />
        </div>
      ) : slides.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
          <ImageIcon className="w-12 h-12 text-purple-200 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800">No Banners Yet</h3>
          <p className="text-sm text-gray-500 mt-1 mb-6">Add your first hero banner image.</p>
          <button
            onClick={openAddModal}
            className="px-5 py-2.5 bg-[#4b2192] text-white font-bold text-sm rounded-xl"
          >
            Add Banner
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {slides.map((slide, idx) => (
            <div
              key={slide.id}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden"
            >
              <div className="flex items-center gap-4 p-4">
                {/* Drag handle + order */}
                <div className="flex flex-col items-center gap-1 text-gray-300">
                  <GripVertical size={20} />
                  <span className="text-[10px] font-bold text-gray-400">#{idx + 1}</span>
                </div>

                {/* Desktop thumbnail */}
                <div className="flex-shrink-0">
                  {slide.desktopImageUrl ? (
                    <img
                      src={slide.desktopImageUrl}
                      alt={slide.imageAlt || `Banner ${idx + 1}`}
                      className="w-48 h-20 object-cover rounded-lg border border-gray-100"
                    />
                  ) : (
                    <div className="w-48 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                      <span className="text-[10px] text-gray-400 font-medium">No desktop image</span>
                    </div>
                  )}
                </div>

                {/* Mobile thumbnail */}
                <div className="flex-shrink-0 hidden sm:block">
                  {slide.mobileImageUrl ? (
                    <img
                      src={slide.mobileImageUrl}
                      alt={slide.imageAlt || `Banner ${idx + 1}`}
                      className="w-14 h-20 object-cover rounded-lg border border-gray-100"
                    />
                  ) : (
                    <div className="w-14 h-20 bg-gray-100 rounded-lg flex items-center justify-center">
                      <span className="text-[8px] text-gray-400 font-medium text-center leading-tight">No<br/>mobile</span>
                    </div>
                  )}
                </div>

                {/* Alt text label */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-700 truncate">
                    {slide.imageAlt || `Banner ${idx + 1}`}
                  </p>
                  <p className="text-[11px] text-gray-400 font-medium mt-0.5 truncate">
                    {slide.desktopImageUrl ? 'Desktop ✓' : 'Desktop ✗'}
                    {' · '}
                    {slide.mobileImageUrl ? 'Mobile ✓' : 'Mobile ✗'}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                  <div className="flex flex-col bg-gray-100 rounded-lg p-0.5">
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1.5 hover:bg-white text-gray-600 disabled:opacity-30 rounded-md transition-colors"
                      title="Move up"
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      disabled={idx === slides.length - 1}
                      className="p-1.5 hover:bg-white text-gray-600 disabled:opacity-30 rounded-md transition-colors"
                      title="Move down"
                    >
                      <ArrowDown size={15} />
                    </button>
                  </div>

                  <button
                    onClick={() => handleDelete(slide.id)}
                    className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Banner Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">Add Hero Banner</h2>
              <button
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              {/* Desktop URL */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Monitor size={13} className="text-blue-600" />
                  Desktop Image URL
                </label>
                <input
                  type="url"
                  value={desktopImageUrl}
                  onChange={(e) => setDesktopImageUrl(e.target.value)}
                  placeholder="https://res.cloudinary.com/.../hero-desktop.webp"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                />
                <p className="text-[10px] text-gray-400 font-medium">1440 × 560 px · WebP/PNG · &lt; 200 KB</p>
              </div>

              {/* Mobile URL */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Smartphone size={13} className="text-green-600" />
                  Mobile Image URL
                </label>
                <input
                  type="url"
                  value={mobileImageUrl}
                  onChange={(e) => setMobileImageUrl(e.target.value)}
                  placeholder="https://res.cloudinary.com/.../hero-mobile.webp"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                />
                <p className="text-[10px] text-gray-400 font-medium">768 × 480 px · WebP/PNG · &lt; 120 KB</p>
              </div>

              {/* Alt text */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Alt Text (optional)</label>
                <input
                  type="text"
                  value={imageAlt}
                  onChange={(e) => setImageAlt(e.target.value)}
                  placeholder="e.g. Summer health checkup offer"
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 font-bold text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2.5 bg-[#4b2192] hover:bg-[#3b1975] text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Add Banner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
