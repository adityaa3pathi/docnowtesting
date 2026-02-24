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
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
            <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-lg flex-shrink-0 flex items-center justify-center">
                    <span className="text-2xl">🧪</span>
                </div>
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-900 mb-2 line-clamp-2 break-words">{item.testName}</h3>

                    {/* Patient Assignment */}
                    <div className="mb-2">
                        <label className="text-xs text-gray-500 font-medium mb-1 block">Assign to:</label>
                        <select
                            value={item.patientId || 'self'}
                            onChange={(e) => {
                                if (e.target.value === '__add_new__') {
                                    onAddNewMember(item.id);
                                } else {
                                    onUpdatePatient(item.id, e.target.value === 'self' ? null : e.target.value);
                                }
                            }}
                            className="text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 w-full max-w-[220px]"
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
                        <span className="font-bold text-primary text-lg">₹{item.price}</span>
                    </div>
                </div>
                <button
                    onClick={() => onRemove(item.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                >
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}
