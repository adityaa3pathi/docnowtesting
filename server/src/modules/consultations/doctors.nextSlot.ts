/** Adds `nextSlotAt` (ISO or null) to each doctor from the grouped earliest-slot rows. */
export function withNextSlot<T extends { id: string }>(doctors: T[], rows: { doctorId: string; _min: { startsAt: Date | null } }[]) {
    const byDoctor = new Map(rows.map((r) => [r.doctorId, r._min.startsAt]));
    return doctors.map((d) => ({ ...d, nextSlotAt: byDoctor.get(d.id)?.toISOString() ?? null }));
}
