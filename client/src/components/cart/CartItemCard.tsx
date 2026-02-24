import { Trash2 } from 'lucide-react';
import { Patient } from '@/types/cart';

interface CartItem {
    id: string;
    testName: string;
    price: number;
    mrp?: number | null;
    patientId?: string | null;
}

interface CartItemCardProps {
    item: CartItem;
    patients: Patient[];
    onRemove: (id: string) => void;
    onUpdatePatient: (itemId: string, patientId: string | null) => void;
    onAddNewMember: (itemId: string) => void;
}

export function CartItemCard({
    item,
    patients,
    onRemove,
    onUpdatePatient,
    onAddNewMember
}: CartItemCardProps) {
    return (
        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-start gap-3 sm:gap-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-primary/10 rounded-lg flex-shrink-0 flex items-center justify-center">
                    <span className="text-xl sm:text-2xl">🧪</span>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-slate-900 text-sm sm:text-base line-clamp-2 break-words">{item.testName}</h3>
                        <button
                            onClick={() => onRemove(item.id)}
                            className="p-1.5 sm:p-2 text-gray-400 hover:text-red-500 active:scale-90 transition-all flex-shrink-0 -mt-0.5"
                        >
                            <Trash2 className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                    </div>

                    {/* Patient Assignment */}
                    <div className="mt-2 mb-2">
                        <label className="text-[11px] text-gray-500 font-medium mb-1 block">Assign to:</label>
                        <select
                            value={item.patientId || 'self'}
                            onChange={(e) => {
                                if (e.target.value === '__add_new__') {
                                    onAddNewMember(item.id);
                                } else {
                                    onUpdatePatient(item.id, e.target.value === 'self' ? null : e.target.value);
                                }
                            }}
                            className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 w-full"
                        >
                            <option value="self">Self</option>
                            {patients.map((patient) => (
                                <option key={patient.id} value={patient.id}>
                                    {patient.name} ({patient.relation})
                                </option>
                            ))}
                            <option value="__add_new__">➕ Add New Member</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        {item.mrp && item.mrp > item.price && (
                            <span className="text-xs text-gray-400 line-through">₹{item.mrp}</span>
                        )}
                        <span className="font-bold text-primary text-base sm:text-lg">₹{item.price}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
