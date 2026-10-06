const rupeeFormat = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** Consultation amounts from the server are whole paise. */
export function formatPaise(paise: number): string {
    return `₹${rupeeFormat.format(paise / 100)}`;
}

/** The doctor's fee is stored in rupees. */
export function formatRupees(rupees: number): string {
    return `₹${rupeeFormat.format(rupees)}`;
}
