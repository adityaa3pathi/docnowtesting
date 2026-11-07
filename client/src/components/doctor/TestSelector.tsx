'use client';
import { useState, useEffect, useRef } from 'react';
import { X, Search, Check } from 'lucide-react';
import api from '@/lib/api';

interface Test {
    partnerCode: string;
    name: string;
    type: string;
}

interface TestSelectorProps {
    selectedCodes: string[];
    onChange: (codes: string[]) => void;
}

export function TestSelector({ selectedCodes, onChange }: TestSelectorProps) {
    const [search, setSearch] = useState('');
    const [tests, setTests] = useState<Test[]>([]);
    const [loading, setLoading] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Fetch tests from catalog API
    useEffect(() => {
        if (!search || search.length < 2) {
            setTests([]);
            setDropdownOpen(false);
            return;
        }

        const timer = setTimeout(async () => {
            setLoading(true);
            try {
                const res = await api.get('/catalog/search', {
                    params: { q: search, type: 'TEST', limit: 15 }
                });
                setTests(res.data.products || []);
                setDropdownOpen(true);
            } catch (err) {
                console.error('Test search failed:', err);
                setTests([]);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [search]);

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setDropdownOpen(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleTest = (code: string) => {
        if (selectedCodes.includes(code)) {
            onChange(selectedCodes.filter(c => c !== code));
        } else {
            onChange([...selectedCodes, code]);
        }
    };

    return (
        <div className="space-y-2" ref={dropdownRef}>
            {/* Selected tests as chips */}
            {selectedCodes.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {selectedCodes.map(code => (
                        <span key={code} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
                            {code}
                            <button
                                type="button"
                                onClick={() => toggleTest(code)}
                                className="rounded-full hover:bg-primary/20 p-0.5 transition-colors"
                                aria-label={`Remove ${code}`}
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Search input */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => search.length >= 2 && tests.length > 0 && setDropdownOpen(true)}
                    placeholder="Search tests (e.g., CBC, TSH, Lipid Profile)"
                    className="w-full rounded-xl border border-border bg-input pl-10 pr-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />

                {/* Dropdown */}
                {dropdownOpen && tests.length > 0 && (
                    <div className="absolute top-full mt-1 w-full rounded-xl border border-border bg-white shadow-lg max-h-64 overflow-y-auto z-10">
                        {tests.map(test => {
                            const isSelected = selectedCodes.includes(test.partnerCode);
                            return (
                                <button
                                    key={test.partnerCode}
                                    type="button"
                                    onClick={() => {
                                        toggleTest(test.partnerCode);
                                        setSearch('');
                                        setDropdownOpen(false);
                                    }}
                                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="font-semibold text-sm text-foreground truncate">{test.name}</p>
                                        <p className="text-xs text-muted-foreground">{test.partnerCode}</p>
                                    </div>
                                    {isSelected && <Check className="h-4 w-4 text-primary shrink-0 ml-2" />}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Loading state */}
                {loading && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="h-4 w-4 border-2 border-gray-300 border-t-primary rounded-full animate-spin" />
                    </div>
                )}

                {/* No results */}
                {dropdownOpen && !loading && search.length >= 2 && tests.length === 0 && (
                    <div className="absolute top-full mt-1 w-full rounded-xl border border-border bg-white shadow-lg p-4 text-center z-10">
                        <p className="text-sm text-muted-foreground">No tests found for "{search}"</p>
                        <p className="text-xs text-muted-foreground mt-1">Try searching by test name or code</p>
                    </div>
                )}
            </div>

            <p className="text-xs text-muted-foreground">
                Search and select tests from our catalog. Selected tests will appear as chips above.
            </p>
        </div>
    );
}
