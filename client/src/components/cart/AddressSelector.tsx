import { MapPin, Plus } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
    lat?: string;
    long?: string;
}

interface AddressSelectorProps {
    addresses: Address[];
    selectedAddressId: string;
    onSelect: (id: string) => void;
    onAddressAdded: () => void;
}

export function AddressSelector({
    addresses,
    selectedAddressId,
    onSelect,
    onAddressAdded
}: AddressSelectorProps) {
    const [addressDialogOpen, setAddressDialogOpen] = useState(false);
    const [addressForm, setAddressForm] = useState({ line1: '', city: '', pincode: '' });
    const [loading, setLoading] = useState(false);

    const handleAddAddress = async () => {
        try {
            setLoading(true);
            await api.post('/profile/addresses', addressForm);
            onAddressAdded(); // Refresh parent list
            setAddressDialogOpen(false);
            setAddressForm({ line1: '', city: '', pincode: '' });
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to add address');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white p-4 md:p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-primary" />
                1. Sample Collection Address
            </h3>

            {addresses.length === 0 ? (
                <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-lg">
                    <p className="text-gray-500 text-sm mb-3">No addresses saved</p>
                    <Button onClick={() => setAddressDialogOpen(true)} className="gap-2" size="sm">
                        <Plus className="w-4 h-4" /> Add Address
                    </Button>
                </div>
            ) : (
                <div className="space-y-3">
                    <select
                        value={selectedAddressId}
                        onChange={(e) => onSelect(e.target.value)}
                        className="w-full p-3 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:bg-white transition-colors"
                    >
                        {addresses.map((addr) => (
                            <option key={addr.id} value={addr.id}>
                                {addr.line1}, {addr.city} - {addr.pincode}
                            </option>
                        ))}
                    </select>
                    <button
                        onClick={() => setAddressDialogOpen(true)}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-semibold border-2 border-dashed border-gray-200 text-slate-700 bg-gray-50 hover:bg-white hover:border-primary/40 active:scale-[0.97] transition-all duration-200"
                    >
                        <Plus className="w-4 h-4" /> Add New Address
                    </button>
                </div>
            )}

            {/* Add Address Dialog - Kept local to this component logic */}
            <Dialog open={addressDialogOpen} onOpenChange={setAddressDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>Add Collection Address</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Address Line</label>
                            <Input
                                value={addressForm.line1}
                                onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })}
                                placeholder="Enter full address"
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">City</label>
                                <Input
                                    value={addressForm.city}
                                    onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })}
                                    placeholder="e.g. Gurgaon"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Pincode</label>
                                <Input
                                    value={addressForm.pincode}
                                    onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })}
                                    placeholder="6-digit pincode"
                                    maxLength={6}
                                />
                            </div>
                        </div>
                        <Button onClick={handleAddAddress} disabled={loading} className="w-full">
                            {loading ? 'Adding...' : 'Add Address'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
