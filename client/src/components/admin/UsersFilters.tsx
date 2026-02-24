import { Search } from 'lucide-react';
import { StatusFilter, RoleFilter } from '@/types/admin';

interface UsersFiltersProps {
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    filterStatus: StatusFilter;
    setStatusFilter: (status: StatusFilter) => void;
    filterRole: RoleFilter;
    setRoleFilter: (role: RoleFilter) => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
    { value: 'All', label: 'All' },
    { value: 'ACTIVE', label: 'Active' },
    { value: 'BLOCKED', label: 'Blocked' },
];

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
    { value: 'All', label: 'All Roles' },
    { value: 'USER', label: '👤 Users' },
    { value: 'MANAGER', label: '🛡️ Managers' },
];

export function UsersFilters({
    searchTerm,
    setSearchTerm,
    filterStatus,
    setStatusFilter,
    filterRole,
    setRoleFilter
}: UsersFiltersProps) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                    <input
                        type="text"
                        placeholder="Search by name, email, or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#4b2192] focus:border-transparent"
                    />
                </div>
                <div className="flex gap-2">
                    {STATUS_OPTIONS.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => setStatusFilter(value)}
                            className={`px-4 py-2 rounded-lg transition-colors ${filterStatus === value
                                    ? 'bg-[#4b2192] text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    {ROLE_OPTIONS.map(({ value, label }) => (
                        <button
                            key={value}
                            onClick={() => setRoleFilter(value)}
                            className={`px-4 py-2 rounded-lg transition-colors ${filterRole === value
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
