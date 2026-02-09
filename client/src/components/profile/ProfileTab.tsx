"use client";

import { MapPin, Edit2, Trash2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';

export interface UserProfile {
    id: string;
    name: string | null;
    email: string | null;
    mobile: string;
    isVerified: boolean;
    gender?: string | null;
    age?: number | null;
}

export interface Address {
    id: string;
    line1: string;
    city: string;
    pincode: string;
    lat?: string | null;
    long?: string | null;
}

export function ProfileTab() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [addresses, setAddresses] = useState<Address[]>([]);
    const [loading, setLoading] = useState(true);
    const [editMode, setEditMode] = useState(false);
    const [formData, setFormData] = useState({ name: '', email: '', gender: '', age: '' });
    const [addressDialogOpen, setAddressDialogOpen] = useState(false);
    const [editingAddress, setEditingAddress] = useState<Address | null>(null);
    const [addressForm, setAddressForm] = useState({ line1: '', city: '', pincode: '' });

    useEffect(() => {
        fetchProfile();
        fetchAddresses();
    }, []);

    const fetchProfile = async () => {
        try {
            const res = await api.get('/profile');
            setProfile(res.data);
            setFormData({
                name: res.data.name || '',
                email: res.data.email || '',
                gender: res.data.gender || 'Male',
                age: res.data.age ? res.data.age.toString() : ''
            });
        } catch (error) {
            console.error('Error fetching profile:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchAddresses = async () => {
        try {
            const res = await api.get('/profile/addresses');
            setAddresses(res.data);
        } catch (error) {
            console.error('Error fetching addresses:', error);
        }
    };

    const handleUpdateProfile = async () => {
        try {
            setLoading(true);
            await api.put('/profile', formData);
            await fetchProfile();
            setEditMode(false);
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    const handleAddAddress = async () => {
        try {
            await api.post('/profile/addresses', addressForm);
            await fetchAddresses();
            setAddressDialogOpen(false);
            setAddressForm({ line1: '', city: '', pincode: '' });
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to add address');
        }
    };

    const handleDeleteAddress = async (id: string) => {
        if (!confirm('Are you sure you want to delete this address?')) return;
        try {
            await api.delete(`/profile/addresses/${id}`);
            await fetchAddresses();
        } catch (error: any) {
            alert(error.response?.data?.error || 'Failed to delete address');
        }
    };

    if (loading && !profile) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Personal Information</h2>
                {!editMode && (
                    <Button variant="outline" onClick={() => setEditMode(true)} className="gap-2">
                        <Edit2 className="w-4 h-4" /> Edit Profile
                    </Button>
                )}
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <Input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        disabled={!editMode}
                        className={!editMode ? 'bg-gray-50' : ''}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mobile Number</label>
                    <Input type="text" value={profile?.mobile || ''} className="bg-gray-50" disabled />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email ID</label>
                    <Input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        disabled={!editMode}
                        className={!editMode ? 'bg-gray-50' : ''}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Age</label>
                        <Input
                            type="number"
                            value={formData.age}
                            onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                            disabled={!editMode}
                            className={!editMode ? 'bg-gray-50' : ''}
                            placeholder="Age"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                        <select
                            className={`w-full h-10 rounded-md border px-3 text-sm ${!editMode ? 'bg-gray-50 border-input' : 'bg-white border-input'}`}
                            value={formData.gender}
                            onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                            disabled={!editMode}
                        >
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                            <option value="Other">Other</option>
                        </select>
                    </div>
                </div>
            </div>

            {editMode && (
                <div className="flex gap-3 mb-8">
                    <Button onClick={handleUpdateProfile} disabled={loading}>
                        {loading ? <Loader2 className="animate-spin" /> : 'Save Changes'}
                    </Button>
                    <Button variant="outline" onClick={() => {
                        setEditMode(false);
                        setFormData({
                            name: profile?.name || '',
                            email: profile?.email || '',
                            gender: profile?.gender || 'Male',
                            age: profile?.age ? profile.age.toString() : ''
                        });
                    }}>
                        Cancel
                    </Button>
                </div>
            )}

            <h2 className="text-xl font-bold mb-6 mt-10">Saved Addresses</h2>
            <div className="space-y-4">
                {addresses.map((addr) => (
                    <div key={addr.id} className="p-4 border border-gray-200 rounded-lg flex justify-between items-start">
                        <div>
                            <div className="font-semibold flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" /> {addr.city}</div>
                            <p className="text-gray-600 text-sm mt-1">{addr.line1} - {addr.pincode}</p>
                        </div>
                        <button onClick={() => handleDeleteAddress(addr.id)} className="text-red-500 text-sm font-medium flex items-center gap-1">
                            <Trash2 className="w-4 h-4" /> Delete
                        </button>
                    </div>
                ))}
                <button
                    onClick={() => setAddressDialogOpen(true)}
                    className="w-full border-2 border-dashed border-gray-200 rounded-lg p-4 text-gray-400 font-medium hover:border-primary hover:text-primary transition-colors"
                >
                    + Add New Address
                </button>
            </div>

            <Dialog open={addressDialogOpen} onOpenChange={setAddressDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>Add New Address</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Address Line</label>
                            <Input
                                value={addressForm.line1}
                                onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })}
                                placeholder="Enter full address"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
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
                        <Button onClick={handleAddAddress} className="w-full">Add Address</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
