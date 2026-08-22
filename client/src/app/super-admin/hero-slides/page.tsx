'use client';

import { useState, useEffect } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
  Sparkles,
  Sliders,
  Check,
  X,
  Loader2,
  ExternalLink,
  Paintbrush,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  badgeText?: string | null;
  ctaText: string;
  ctaLink: string;
  secondaryCtaText?: string | null;
  secondaryCtaLink?: string | null;
  imageUrl?: string | null;
  bgGradient: string;
  sortOrder: number;
  isActive: boolean;
}

const GRADIENT_PRESETS = [
  { name: 'Royal Purple', value: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #4B0082 25.49%, #2A004A 74.17%)' },
  { name: 'Midnight Blue', value: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #1E3A8A 25.49%, #0F172A 74.17%)' },
  { name: 'Emerald Forest', value: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #065F46 25.49%, #022C22 74.17%)' },
  { name: 'Crimson Night', value: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #881337 25.49%, #4C0519 74.17%)' },
  { name: 'Deep Amethyst', value: 'radial-gradient(594.6% 81.5% at 50% 63.68%, #581C87 25.49%, #3B0764 74.17%)' },
];

export default function HeroSlidesCMSPage() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSlide, setEditingSlide] = useState<HeroSlide | null>(null);
  const [saving, setSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    badgeText: '',
    ctaText: 'Book a Test',
    ctaLink: '/search',
    secondaryCtaText: '',
    secondaryCtaLink: '',
    bgGradient: GRADIENT_PRESETS[0].value,
    isActive: true,
  });

  const fetchSlides = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/hero-slides');
      setSlides(res.data.slides || []);
    } catch (err: any) {
      toast.error('Failed to load hero slides');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlides();
  }, []);

  const openCreateModal = () => {
    setEditingSlide(null);
    setFormData({
      title: '',
      subtitle: '',
      badgeText: '',
      ctaText: 'Book a Test',
      ctaLink: '/search',
      secondaryCtaText: 'View Packages',
      secondaryCtaLink: '/packages',
      bgGradient: GRADIENT_PRESETS[0].value,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (slide: HeroSlide) => {
    setEditingSlide(slide);
    setFormData({
      title: slide.title,
      subtitle: slide.subtitle,
      badgeText: slide.badgeText || '',
      ctaText: slide.ctaText,
      ctaLink: slide.ctaLink,
      secondaryCtaText: slide.secondaryCtaText || '',
      secondaryCtaLink: slide.secondaryCtaLink || '',
      bgGradient: slide.bgGradient,
      isActive: slide.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim() || !formData.subtitle.trim()) {
      toast.error('Title and subtitle are required');
      return;
    }

    try {
      setSaving(true);
      if (editingSlide) {
        await api.put(`/admin/hero-slides/${editingSlide.id}`, formData);
        toast.success('Hero slide updated');
      } else {
        await api.post('/admin/hero-slides', {
          ...formData,
          sortOrder: slides.length,
        });
        toast.success('Hero slide created');
      }
      setModalOpen(false);
      fetchSlides();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to save slide');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (slide: HeroSlide) => {
    try {
      await api.put(`/admin/hero-slides/${slide.id}/toggle`);
      toast.success(slide.isActive ? 'Slide hidden' : 'Slide activated');
      fetchSlides();
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this hero slide?')) return;
    try {
      await api.delete(`/admin/hero-slides/${id}`);
      toast.success('Hero slide deleted');
      fetchSlides();
    } catch (err) {
      toast.error('Failed to delete slide');
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= slides.length) return;

    const newSlides = [...slides];
    const temp = newSlides[index];
    newSlides[index] = newSlides[targetIndex];
    newSlides[targetIndex] = temp;

    // Re-assign sortOrder
    const reorderedItems = newSlides.map((item, idx) => ({
      id: item.id,
      sortOrder: idx,
    }));

    setSlides(newSlides); // optimistic update

    try {
      await api.put('/admin/hero-slides/reorder', { items: reorderedItems });
      toast.success('Slide order updated');
    } catch (err) {
      toast.error('Failed to reorder slides');
      fetchSlides();
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-purple-100">
        <div>
          <div className="flex items-center gap-2 text-purple-700 font-bold text-sm mb-1">
            <Sliders size={18} />
            <span>Homepage CMS</span>
          </div>
          <h1 className="text-2xl font-black text-gray-900">Hero Slides CMS</h1>
          <p className="text-sm text-gray-500 font-medium mt-1">
            Manage, customize, and reorder hero banners displayed on the DOCNOW landing page.
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#4b2192] hover:bg-[#3b1975] text-white font-bold rounded-xl shadow-md transition-all hover:scale-105 active:scale-95 text-sm"
        >
          <Plus size={18} />
          <span>Add New Slide</span>
        </button>
      </div>

      {/* Slide List */}
      {loading ? (
        <div className="flex items-center justify-center p-16 bg-white rounded-2xl border border-gray-100">
          <Loader2 className="w-8 h-8 animate-spin text-[#4b2192]" />
        </div>
      ) : slides.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 p-8">
          <Sparkles className="w-12 h-12 text-purple-300 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-gray-800">No Hero Slides Found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-6">
            Get started by creating your first hero carousel slide.
          </p>
          <button
            onClick={openCreateModal}
            className="px-5 py-2.5 bg-[#4b2192] text-white font-bold text-sm rounded-xl"
          >
            Create Hero Slide
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {slides.map((slide, idx) => (
            <div
              key={slide.id}
              className={`bg-white rounded-2xl border transition-all overflow-hidden shadow-sm hover:shadow-md ${
                slide.isActive ? 'border-gray-200' : 'border-gray-200 opacity-60 bg-gray-50/50'
              }`}
            >
              <div className="p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                {/* Visual Preview Badge */}
                <div
                  className="w-full lg:w-72 h-36 rounded-xl p-4 flex flex-col justify-between text-white relative shadow-inner flex-shrink-0"
                  style={{ background: slide.bgGradient }}
                >
                  {slide.badgeText && (
                    <span className="self-start text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm border border-white/20 tracking-wider uppercase">
                      {slide.badgeText}
                    </span>
                  )}
                  <div>
                    <h4 className="font-extrabold text-sm line-clamp-1">{slide.title}</h4>
                    <p className="text-[11px] text-white/80 line-clamp-2 mt-0.5">{slide.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-300">
                    <span>{slide.ctaText} →</span>
                  </div>
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-2.5 py-0.5 rounded-md bg-purple-50 text-purple-700 font-bold text-xs">
                      Slide #{idx + 1}
                    </span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md font-bold text-xs flex items-center gap-1 ${
                        slide.isActive
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {slide.isActive ? <Eye size={12} /> : <EyeOff size={12} />}
                      {slide.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 line-clamp-1">{slide.title}</h3>
                  <p className="text-xs text-gray-500 font-medium line-clamp-2 mt-1">
                    {slide.subtitle}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 mt-3 text-xs font-semibold text-gray-600">
                    <span className="flex items-center gap-1 text-purple-700">
                      <ExternalLink size={12} />
                      CTA: {slide.ctaText} ({slide.ctaLink})
                    </span>
                    {slide.secondaryCtaText && (
                      <span className="text-gray-500">
                        Secondary: {slide.secondaryCtaText} ({slide.secondaryCtaLink})
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end lg:self-center border-t lg:border-t-0 pt-4 lg:pt-0 w-full lg:w-auto justify-end">
                  {/* Reorder Buttons */}
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5 mr-2">
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1.5 hover:bg-white text-gray-600 disabled:opacity-30 rounded-md transition-colors"
                      title="Move up"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      disabled={idx === slides.length - 1}
                      className="p-1.5 hover:bg-white text-gray-600 disabled:opacity-30 rounded-md transition-colors"
                      title="Move down"
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>

                  {/* Toggle Active */}
                  <button
                    onClick={() => handleToggle(slide)}
                    className={`p-2 rounded-xl transition-all ${
                      slide.isActive
                        ? 'bg-amber-50 text-amber-600 hover:bg-amber-100'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                    title={slide.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {slide.isActive ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>

                  {/* Edit */}
                  <button
                    onClick={() => openEditModal(slide)}
                    className="p-2 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                    title="Edit slide"
                  >
                    <Edit2 size={18} />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(slide.id)}
                    className="p-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                    title="Delete slide"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Create/Edit */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full p-6 sm:p-8 shadow-2xl space-y-6 my-8 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h2 className="text-xl font-black text-gray-900">
                  {editingSlide ? 'Edit Hero Slide' : 'Create New Hero Slide'}
                </h2>
                <p className="text-xs text-gray-500 font-medium">
                  Configure headline, badges, call-to-action buttons, and gradient style.
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Live Preview Card */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-purple-600" />
                Live Banner Preview
              </label>
              <div
                className="rounded-2xl p-6 text-white min-h-[180px] flex flex-col justify-between shadow-lg transition-all duration-300"
                style={{ background: formData.bgGradient }}
              >
                {formData.badgeText && (
                  <span className="self-start text-xs font-bold px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/20 tracking-wider uppercase">
                    {formData.badgeText}
                  </span>
                )}
                <div>
                  <h3 className="font-black text-xl sm:text-2xl leading-tight">
                    {formData.title || 'Slide Title Headline'}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/80 font-medium mt-1">
                    {formData.subtitle || 'Slide subtitle description goes here...'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 mt-4">
                  <span className="px-4 py-2 bg-amber-400 text-gray-900 font-extrabold rounded-lg text-xs shadow-md">
                    {formData.ctaText || 'CTA Button'} →
                  </span>
                  {formData.secondaryCtaText && (
                    <span className="px-4 py-2 bg-white/15 text-white font-bold rounded-lg text-xs border border-white/20">
                      {formData.secondaryCtaText}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              {/* Title & Badge */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-bold text-gray-700">Headline Title *</label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g. Precision Diagnostics, Delivered to Your Door."
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Badge Pill (Optional)</label>
                  <input
                    type="text"
                    value={formData.badgeText}
                    onChange={(e) => setFormData({ ...formData, badgeText: e.target.value })}
                    placeholder="e.g. 100% ACCREDITED"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
              </div>

              {/* Subtitle */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Subtitle Description *</label>
                <textarea
                  rows={2}
                  required
                  value={formData.subtitle}
                  onChange={(e) => setFormData({ ...formData, subtitle: e.target.value })}
                  placeholder="e.g. Get NABL & CAP certified lab tests and health checkups at home."
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                />
              </div>

              {/* Primary CTA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Primary CTA Text</label>
                  <input
                    type="text"
                    required
                    value={formData.ctaText}
                    onChange={(e) => setFormData({ ...formData, ctaText: e.target.value })}
                    placeholder="e.g. Book a Test"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Primary CTA Link</label>
                  <input
                    type="text"
                    required
                    value={formData.ctaLink}
                    onChange={(e) => setFormData({ ...formData, ctaLink: e.target.value })}
                    placeholder="e.g. /search"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
              </div>

              {/* Secondary CTA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Secondary CTA Text (Optional)</label>
                  <input
                    type="text"
                    value={formData.secondaryCtaText}
                    onChange={(e) => setFormData({ ...formData, secondaryCtaText: e.target.value })}
                    placeholder="e.g. Explore Packages"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-700">Secondary CTA Link (Optional)</label>
                  <input
                    type="text"
                    value={formData.secondaryCtaLink}
                    onChange={(e) => setFormData({ ...formData, secondaryCtaLink: e.target.value })}
                    placeholder="e.g. /packages"
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium focus:ring-2 focus:ring-[#4b2192] outline-none"
                  />
                </div>
              </div>

              {/* Gradient Theme Picker */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Paintbrush size={14} className="text-purple-600" />
                  Background Gradient Theme
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => setFormData({ ...formData, bgGradient: preset.value })}
                      className={`h-12 rounded-xl p-2 text-white font-bold text-[10px] flex items-center justify-center text-center transition-all ${
                        formData.bgGradient === preset.value
                          ? 'ring-2 ring-purple-600 scale-105 shadow-md'
                          : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{ background: preset.value }}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Active Checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 text-[#4b2192] rounded border-gray-300 focus:ring-[#4b2192]"
                />
                <label htmlFor="isActive" className="text-xs font-bold text-gray-700">
                  Slide is Active and visible on home page
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
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
                  <span>{editingSlide ? 'Update Slide' : 'Create Slide'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
