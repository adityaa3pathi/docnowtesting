'use client';

import { useState, useEffect, useRef } from 'react';
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
  Upload,
  CheckCircle2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface HeroSlide {
  id: string;
  desktopImageUrl?: string | null;
  desktopImageKey?: string | null;
  mobileImageUrl?: string | null;
  mobileImageKey?: string | null;
  imageAlt?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function HeroSlidesCMSPage() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Upload state
  const [desktopFile, setDesktopFile] = useState<File | null>(null);
  const [mobileFile, setMobileFile] = useState<File | null>(null);
  const [desktopPreview, setDesktopPreview] = useState<string | null>(null);
  const [mobilePreview, setMobilePreview] = useState<string | null>(null);
  const [imageAlt, setImageAlt] = useState('');
  const [uploading, setUploading] = useState(false);

  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

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

  const resetModal = () => {
    setDesktopFile(null);
    setMobileFile(null);
    setDesktopPreview(null);
    setMobilePreview(null);
    setImageAlt('');
    setUploading(false);
  };

  const openAddModal = () => {
    resetModal();
    setModalOpen(true);
  };

  const handleFileSelect = (file: File, type: 'desktop' | 'mobile') => {
    const validTypes = ['image/webp', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error('Only WebP, PNG, or JPEG files are allowed');
      return;
    }
    const maxKB = type === 'desktop' ? 500 : 500;
    if (file.size > maxKB * 1024) {
      toast.error(`File too large. Max ${maxKB} KB`);
      return;
    }

    const preview = URL.createObjectURL(file);
    if (type === 'desktop') {
      setDesktopFile(file);
      setDesktopPreview(preview);
    } else {
      setMobileFile(file);
      setMobilePreview(preview);
    }
  };

  const handleDrop = (e: React.DragEvent, type: 'desktop' | 'mobile') => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file, type);
  };

  const uploadFileToS3 = async (file: File): Promise<{ url: string; key: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder', 'hero-banners');
    const res = await api.post('/admin/upload-image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return { url: res.data.url, key: res.data.key };
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!desktopFile && !mobileFile) {
      toast.error('Please upload at least one image');
      return;
    }

    try {
      setSaving(true);
      setUploading(true);

      let desktopUrl: string | null = null;
      let desktopKey: string | null = null;
      let mobileUrl: string | null = null;
      let mobileKey: string | null = null;

      if (desktopFile) {
        const result = await uploadFileToS3(desktopFile);
        desktopUrl = result.url;
        desktopKey = result.key;
      }
      if (mobileFile) {
        const result = await uploadFileToS3(mobileFile);
        mobileUrl = result.url;
        mobileKey = result.key;
      }

      await api.post('/admin/hero-slides', {
        title: imageAlt || 'Hero Banner',
        subtitle: '',
        desktopImageUrl: desktopUrl,
        desktopImageKey: desktopKey,
        mobileImageUrl: mobileUrl,
        mobileImageKey: mobileKey,
        imageAlt: imageAlt.trim() || null,
        sortOrder: slides.length,
        isActive: true,
      });

      toast.success('Banner uploaded & added!');
      setModalOpen(false);
      resetModal();
      fetchSlides();
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setSaving(false);
      setUploading(false);
    }
  };

  const handleDelete = async (slide: HeroSlide) => {
    if (!confirm('Delete this banner?')) return;
    try {
      // Delete images from S3 using keys
      if (slide.desktopImageKey) {
        await api.post('/admin/delete-image', { key: slide.desktopImageKey }).catch(() => {});
      }
      if (slide.mobileImageKey) {
        await api.post('/admin/delete-image', { key: slide.mobileImageKey }).catch(() => {});
      }
      await api.delete(`/admin/hero-slides/${slide.id}`);
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

      {/* Image Spec Guidelines */}
      <div className="bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200 rounded-2xl p-5 space-y-3">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-purple-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-bold text-purple-800">Image Upload Guidelines</p>
            <p className="text-xs text-purple-600 mt-0.5">
              Upload separate images for desktop and mobile for best results. Files are uploaded directly to our servers.
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
                <strong>Format:</strong>&nbsp;WebP, PNG, or JPEG
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                <strong>Max Size:</strong>&nbsp;500 KB
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
                <strong>Format:</strong>&nbsp;WebP, PNG, or JPEG
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0" />
                <strong>Max Size:</strong>&nbsp;500 KB
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
                {/* Order indicator */}
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
                    {slide.desktopImageUrl ? '🖥 Desktop ✓' : '🖥 Desktop ✗'}
                    {' · '}
                    {slide.mobileImageUrl ? '📱 Mobile ✓' : '📱 Mobile ✗'}
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
                    onClick={() => handleDelete(slide)}
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
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black text-gray-900">Add Hero Banner</h2>
              <button
                onClick={() => { setModalOpen(false); resetModal(); }}
                className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAdd} className="space-y-4">
              {/* Desktop Upload Zone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Monitor size={13} className="text-blue-600" />
                  Desktop Image
                  <span className="text-gray-400 font-medium">(1440 × 560 px)</span>
                </label>
                <input
                  ref={desktopInputRef}
                  type="file"
                  accept="image/webp,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f, 'desktop');
                  }}
                />
                {desktopPreview ? (
                  <div className="relative group">
                    <img src={desktopPreview} alt="Desktop preview" className="w-full h-32 object-cover rounded-xl border border-blue-200" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                      <button type="button" onClick={() => desktopInputRef.current?.click()} className="px-3 py-1.5 bg-white text-gray-700 text-xs font-bold rounded-lg">Replace</button>
                      <button type="button" onClick={() => { setDesktopFile(null); setDesktopPreview(null); }} className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg">Remove</button>
                    </div>
                    <div className="absolute top-2 right-2"><CheckCircle2 size={20} className="text-green-500 drop-shadow" /></div>
                  </div>
                ) : (
                  <div
                    onClick={() => desktopInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, 'desktop')}
                    className="w-full h-28 border-2 border-dashed border-gray-200 hover:border-blue-400 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors bg-gray-50 hover:bg-blue-50/50"
                  >
                    <Upload size={22} className="text-gray-400" />
                    <p className="text-xs text-gray-500 font-medium">Click or drag & drop desktop image</p>
                    <p className="text-[10px] text-gray-400">WebP, PNG, JPEG · Max 500 KB</p>
                  </div>
                )}
              </div>

              {/* Mobile Upload Zone */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Smartphone size={13} className="text-green-600" />
                  Mobile Image
                  <span className="text-gray-400 font-medium">(768 × 480 px)</span>
                </label>
                <input
                  ref={mobileInputRef}
                  type="file"
                  accept="image/webp,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f, 'mobile');
                  }}
                />
                {mobilePreview ? (
                  <div className="relative group">
                    <img src={mobilePreview} alt="Mobile preview" className="w-full h-32 object-cover rounded-xl border border-green-200" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl flex items-center justify-center gap-2">
                      <button type="button" onClick={() => mobileInputRef.current?.click()} className="px-3 py-1.5 bg-white text-gray-700 text-xs font-bold rounded-lg">Replace</button>
                      <button type="button" onClick={() => { setMobileFile(null); setMobilePreview(null); }} className="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg">Remove</button>
                    </div>
                    <div className="absolute top-2 right-2"><CheckCircle2 size={20} className="text-green-500 drop-shadow" /></div>
                  </div>
                ) : (
                  <div
                    onClick={() => mobileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, 'mobile')}
                    className="w-full h-28 border-2 border-dashed border-gray-200 hover:border-green-400 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors bg-gray-50 hover:bg-green-50/50"
                  >
                    <Upload size={22} className="text-gray-400" />
                    <p className="text-xs text-gray-500 font-medium">Click or drag & drop mobile image</p>
                    <p className="text-[10px] text-gray-400">WebP, PNG, JPEG · Max 500 KB</p>
                  </div>
                )}
              </div>

              {/* Alt text */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-700">Alt Text <span className="text-gray-400 font-medium">(optional)</span></label>
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
                  onClick={() => { setModalOpen(false); resetModal(); }}
                  className="px-5 py-2.5 text-gray-600 hover:bg-gray-100 font-bold text-sm rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || (!desktopFile && !mobileFile)}
                  className="px-6 py-2.5 bg-[#4b2192] hover:bg-[#3b1975] text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {uploading ? 'Uploading...' : 'Saving...'}
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Upload & Add
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
