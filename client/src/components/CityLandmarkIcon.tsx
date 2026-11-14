/** Line icons of each top city's best-known landmark, drawn to match Lucide (24 grid, round strokes). */
const LANDMARKS: Record<string, { title: string; d: string[] }> = {
    Jaipur: {
        title: 'Hawa Mahal',
        d: ['M4 21v-8l2-2V8l2-2V4h8v2l2 2v3l2 2v8', 'M8 15v2M12 15v2M16 15v2', 'M10 10v1.5M14 10v1.5M12 6.5v1'],
    },
    Bengaluru: {
        title: 'Vidhana Soudha',
        d: ['M3 21v-9h18v9', 'M2 12h20', 'M9 12V9h6v3', 'M9 9a3 3 0 0 1 6 0', 'M12 6V4', 'M7 14v5M10 14v5M14 14v5M17 14v5'],
    },
    Chennai: {
        title: 'Kapaleeshwarar Temple',
        d: ['M5 21 7 8h10l2 13', 'M5.6 17h12.8M6.2 13h11.6', 'M8 8V6h8v2', 'M10 6V4h4v2', 'M10.5 21v-2.5a1.5 1.5 0 0 1 3 0V21'],
    },
    Delhi: {
        title: 'India Gate',
        d: ['M4 21V8h16v13', 'M9 21v-7a3 3 0 0 1 6 0v7', 'M3 8h18', 'M5 8V5h14v3', 'M8 5V3h8v2'],
    },
    Gurgaon: {
        title: 'Cyber City towers',
        d: ['M4 21V10h5v11', 'M9 21V4l6 2v15', 'M15 21v-9h5v9', 'M11.5 9h1M11.5 12h1M11.5 15h1M17 15h1'],
    },
    Hyderabad: {
        title: 'Charminar',
        d: ['M4 21V6M20 21V6', 'M3 6h2M19 6h2', 'M4 6V4M20 6V4', 'M5 21V11h14v10', 'M9 21v-4a3 3 0 0 1 6 0v4', 'M7 11V9h10v2'],
    },
    Kolkata: {
        title: 'Howrah Bridge',
        d: ['M6 21V6M18 21V6', 'M2 14h20', 'M6 6 2 11M18 6l4 5', 'M6 6q6 6 12 0', 'M9 9v5M12 10v4M15 9v5'],
    },
    Mumbai: {
        title: 'Gateway of India',
        d: ['M7 21V9h10v12', 'M10 21v-6a2 2 0 0 1 4 0v6', 'M3 21v-9h4M21 21v-9h-4', 'M3 12a2 2 0 0 1 4 0M17 12a2 2 0 0 1 4 0', 'M7 9a5 3 0 0 1 10 0'],
    },
    Noida: {
        title: 'City skyline',
        d: ['M3 21v-9h5v9', 'M8 21V6h6v15', 'M14 21V9h3l3 3v9', 'M10.5 9h1M10.5 12h1M10.5 15h1M5 15h1M16.5 15h1'],
    },
    Pune: {
        title: 'Shaniwar Wada',
        d: ['M3 21V9h5v12M16 21V9h5v12', 'M3 9l2.5-2L8 9M16 9l2.5-2L21 9', 'M8 12h8', 'M10 21v-5a2 2 0 0 1 4 0v5'],
    },
};

export const TOP_CITIES = ['Jaipur', 'Bengaluru', 'Chennai', 'Delhi', 'Gurgaon', 'Hyderabad', 'Kolkata', 'Mumbai', 'Noida', 'Pune'] as const;

export function CityLandmarkIcon({ city, className = 'h-7 w-7' }: { city: string; className?: string }) {
    const landmark = LANDMARKS[city];
    if (!landmark) return null;
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <title>{landmark.title}</title>
            {landmark.d.map((d) => <path key={d} d={d} />)}
            <path d="M2 21h20" />
        </svg>
    );
}
