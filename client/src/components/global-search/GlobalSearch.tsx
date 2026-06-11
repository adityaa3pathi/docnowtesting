"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, Package, TestTubes, Activity } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useDebounce } from '@/hooks/useDebounce';
import { useGlobalSearch, SearchResultItem } from '@/hooks/useGlobalSearch';
import { generateProductSlug } from '@/lib/mapProductDetails';

function SkeletonRow() {
    return (
        <li className="px-4 py-3 flex items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gray-200 flex-shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                    <div className="h-3.5 bg-gray-200 rounded-full w-3/4" />
                    <div className="h-2.5 bg-gray-100 rounded-full w-1/3" />
                </div>
            </div>
            <div className="w-12 h-4 bg-gray-200 rounded-full flex-shrink-0" />
        </li>
    );
}

export function GlobalSearch() {
    const [query, setQuery] = useState('');
    const debouncedQuery = useDebounce(query, 300);
    const { results, isLoading, isError } = useGlobalSearch(debouncedQuery);
    
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    
    const wrapperRef = useRef<HTMLDivElement>(null);
    const router = useRouter();

    // Reset selection when results change
    useEffect(() => {
        setSelectedIndex(-1);
    }, [results]);

    // Handle click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleSelect = (item: SearchResultItem) => {
        setIsOpen(false);
        setQuery('');
        const slug = generateProductSlug(item.name, item.partnerCode);
        const basePath = item.type === 'PROFILE' ? 'profiles' : item.type === 'PACKAGE' ? 'packages' : 'tests';
        router.push(`/${basePath}/${slug}`);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!isOpen) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                setIsOpen(true);
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev > 0 ? prev - 1 : 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < results.length) {
                handleSelect(results[selectedIndex]);
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    const handleClear = () => {
        setQuery('');
        setIsOpen(false);
    };

    // Only show dropdown when we have meaningful content:
    // 1. Loading state (show skeletons) — but only after debounce has kicked in
    // 2. Results are available
    // 3. No results found (after search completed)
    // 4. Error state
    const hasQuery = query.trim().length > 0;
    const hasDebouncedQuery = debouncedQuery.trim().length > 0;
    const hasResults = results.length > 0;
    const isNoResults = !isLoading && !isError && hasDebouncedQuery && results.length === 0 && debouncedQuery === query;
    const showDropdown = isOpen && hasQuery && (isLoading || hasResults || isNoResults || isError);

    return (
        <div ref={wrapperRef} className="relative w-full">
            {/* Search Input */}
            <div className="relative flex items-center w-full">
                <Search className="absolute left-4 w-5 h-5 text-gray-400" />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                    }}
                    onKeyDown={handleKeyDown}
                    onFocus={() => { if (hasQuery) setIsOpen(true); }}
                    placeholder="Search"
                    className="w-full h-11 pl-12 pr-10 text-gray-900 bg-white border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-transparent transition-shadow shadow-sm placeholder:text-gray-400"
                    role="combobox"
                    aria-expanded={showDropdown}
                    aria-controls="search-dropdown"
                    aria-autocomplete="list"
                />
                
                {/* Right side icons */}
                <div className="absolute right-3 flex items-center">
                    {isLoading ? (
                        <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                    ) : query ? (
                        <button 
                            onClick={handleClear}
                            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
                            aria-label="Clear search"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Dropdown Results */}
            {showDropdown && (
                <div 
                    id="search-dropdown"
                    className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] border border-gray-100 overflow-hidden z-50 max-h-[400px] overflow-y-auto"
                    role="listbox"
                >
                    {isError ? (
                        <div className="p-4 text-center text-red-500 text-sm font-medium">
                            Failed to fetch search results. Please try again.
                        </div>
                    ) : isLoading && results.length === 0 ? (
                        /* Skeleton loading — only when we have zero results yet */
                        <ul className="py-1">
                            <SkeletonRow />
                            <SkeletonRow />
                            <SkeletonRow />
                        </ul>
                    ) : isNoResults ? (
                        <div className="p-8 text-center text-gray-500">
                            <Search className="w-8 h-8 mx-auto text-gray-300 mb-3" />
                            <p className="text-sm font-semibold text-gray-700">No results found for &ldquo;{query}&rdquo;</p>
                            <p className="text-xs mt-1 text-gray-400">Try checking for typos or using different keywords</p>
                        </div>
                    ) : (
                        <ul className="py-1">
                            {results.map((item, index) => {
                                const isSelected = index === selectedIndex;
                                const isPackage = item.type === 'PACKAGE';
                                const isProfile = item.type === 'PROFILE';
                                
                                return (
                                    <li 
                                        key={item.partnerCode}
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => handleSelect(item)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                        className={`px-4 py-3 cursor-pointer flex items-center justify-between gap-4 transition-colors ${
                                            isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`p-2.5 rounded-xl flex-shrink-0 ${isPackage ? 'bg-blue-100/50 text-blue-600' : isProfile ? 'bg-teal-100/50 text-teal-600' : 'bg-emerald-100/50 text-emerald-600'}`}>
                                                {isPackage ? <Package className="w-5 h-5" /> : isProfile ? <Activity className="w-5 h-5" /> : <TestTubes className="w-5 h-5" />}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-gray-900 truncate">
                                                    {item.name}
                                                </p>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                                        isPackage ? 'bg-blue-50 text-blue-700 border border-blue-200/50' : isProfile ? 'bg-teal-50 text-teal-700 border border-teal-200/50' : 'bg-emerald-50 text-emerald-700 border border-emerald-200/50'
                                                    }`}>
                                                        {isPackage ? 'PACKAGE' : isProfile ? 'PROFILE' : 'TEST'}
                                                    </span>
                                                    {item.categories?.[0] && (
                                                        <span className="text-[11px] font-medium text-gray-500 truncate">
                                                            • {item.categories[0].name}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-sm font-bold text-gray-900">₹{item.price}</p>
                                            {item.mrp && item.mrp > item.price && (
                                                <p className="text-sm font-semibold text-gray-500 line-through">₹{item.mrp}</p>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}
