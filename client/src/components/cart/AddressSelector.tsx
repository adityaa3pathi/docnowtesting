import { MapPin, Plus } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import LocationPicker, { LocationResult } from '@/components/LocationPicker';
import { Address } from '@/types/cart';

interface AddressSelectorProps {
    addresses: Address[];
    selectedAddressId: string;
    onSelect: (id: string) => void;
    onAddressAdded: (newId?: string) => void;
}

export function AddressSelector({
    addresses,
    selectedAddressId,
    onSelect,
    onAddressAdded
}: AddressSelectorProps) {
    const [addressDialogOpen, setAddressDialogOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // Two-step flow: 1) Pick location on map  2) Add house/flat details
    const [step, setStep] = useState<'map' | 'details'>('map');
    const [pickedLocation, setPickedLocation] = useState<LocationResult | null>(null);
    const [line1, setLine1] = useState('');

    const handleLocationPicked = (location: LocationResult) => {
        setPickedLocation(location);
        setStep('details');
    };

    const handleAddAddress = async () => {
        if (!pickedLocation) return;
        try {
            setLoading(true);
            const res = await api.post('/profile/addresses', {
                line1: line1.trim() || pickedLocation.formattedAddress,
                city: pickedLocation.city,
                pincode: pickedLocation.pincode,
                lat: pickedLocation.lat,
                long: pickedLocation.lng,
            });
            onAddressAdded(res.data.address.id);
            handleCloseDialog();
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to add address');
        } finally {
            setLoading(false);
        }
    };

    const handleCloseDialog = () => {
        setAddressDialogOpen(false);
        setStep('map');
        setPickedLocation(null);
        setLine1('');
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

            {/* Add Address Dialog — Map Picker + Details */}
            <Dialog open={addressDialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
                <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {step === 'map' ? 'Pick Collection Location' : 'Add Address Details'}
                        </DialogTitle>
                    </DialogHeader>

                    {step === 'map' ? (
                        <div className="mt-2">
                            <LocationPicker
                                onLocationSelect={handleLocationPicked}
                                height="320px"
                                showConfirm={true}
                            />
                        </div>
                    ) : (
                        <div className="space-y-4 mt-2">
                            {/* Show picked location summary */}
                            <div className="bg-purple-50 border border-purple-100 rounded-lg p-3">
                                <div className="flex items-start gap-2">
                                    <MapPin className="w-4 h-4 text-purple-600 mt-0.5 flex-shrink-0" />
                                    <div>
                                        <p className="text-sm text-purple-900">{pickedLocation?.formattedAddress}</p>
                                        <p className="text-xs text-purple-600 mt-0.5">
                                            {pickedLocation?.city}{pickedLocation?.city && pickedLocation?.pincode ? ' — ' : ''}{pickedLocation?.pincode}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* House/Flat/Building details */}
                            <div>
                                <label className="block text-sm font-medium mb-1">
                                    House / Flat / Building Details
                                </label>
                                <Input
                                    value={line1}
                                    onChange={(e) => setLine1(e.target.value)}
                                    placeholder="e.g. EWS/2/9, Ashiana Greens, Near Suncity"
                                    autoFocus
                                />
                                <p className="text-xs text-gray-400 mt-1">Add specific details to help the phlebotomist find you</p>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" onClick={() => setStep('map')} className="flex-1">
                                    ← Change Location
                                </Button>
                                <Button onClick={handleAddAddress} disabled={loading} className="flex-1">
                                    {loading ? 'Saving...' : 'Save Address'}
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
