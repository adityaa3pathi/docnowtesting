import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AdminPagination } from '@/types/admin';

interface UserPaginationProps {
    pagination: AdminPagination;
    onPageChange: (page: number) => void;
}

export function UserPagination({ pagination, onPageChange }: UserPaginationProps) {
    return (
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
            <p className="text-sm text-gray-500">
                Showing {(pagination.page - 1) * pagination.limit + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total} users
            </p>
            <div className="flex items-center gap-2">
                <button
                    onClick={() => onPageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronLeft size={18} />
                </button>
                <span className="px-3 py-1 text-sm">
                    Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                    onClick={() => onPageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.totalPages}
                    className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <ChevronRight size={18} />
                </button>
            </div>
        </div>
    );
}
