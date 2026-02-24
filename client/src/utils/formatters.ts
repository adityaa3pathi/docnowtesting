export const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    });
};

export const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

export const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes('report') || s.includes('completed') || s.includes('confirmed')) return 'bg-green-100 text-green-700';
    if (s.includes('cancel')) return 'bg-red-100 text-red-700';
    if (s.includes('fail') || s.includes('error')) return 'bg-red-100 text-red-700';
    return 'bg-yellow-100 text-yellow-700';
};

export const getPaymentStatusColor = (status: string) => {
    if (status === 'PAID') return 'bg-green-100 text-green-700';
    if (status === 'FAILED' || status === 'REFUNDED') return 'bg-red-100 text-red-700';
    return 'bg-orange-100 text-orange-700';
};
