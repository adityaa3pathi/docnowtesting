'use client';

import { useState, useEffect } from 'react';
import { User, Mail, Phone, MapPin, Briefcase } from 'lucide-react';

export default function SettingsPage() {
    const [formData, setFormData] = useState({
        name: 'Manager Account',
        email: '',
        phone: '',
        location: '',
        role: 'Manager',
    });

    useEffect(() => {
        // Load from stored user data
        try {
            const raw = localStorage.getItem('docnow_user');
            if (raw) {
                const user = JSON.parse(raw);
                setFormData(prev => ({
                    ...prev,
                    name: user.name || prev.name,
                    email: user.email || '',
                    phone: user.phone || '',
                }));
            }
        } catch { /* ignore */ }
    }, []);

    const handleSave = () => {
        alert('Profile updated successfully');
    };

    const permissions = [
        { label: 'Catalog Management', status: 'Enabled', color: 'text-green-600' },
        { label: 'Category Management', status: 'Enabled', color: 'text-green-600' },
        { label: 'Payment Link Creation', status: 'Enabled', color: 'text-green-600' },
        { label: 'Order Management', status: 'Read-only', color: 'text-orange-600' },
        { label: 'User Management', status: 'Disabled', color: 'text-gray-400' },
        { label: 'Wallet & Transactions', status: 'Disabled', color: 'text-gray-400' },
    ];

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-semibold text-gray-900">Settings</h1>
                <p className="text-gray-600 mt-1">Manage your profile settings</p>
            </div>

            {/* Profile Card */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Profile Information</h2>
                    <p className="text-sm text-gray-500 mt-1">Update your personal details and contact information</p>
                </div>
                <div className="p-6 space-y-6">
                    {/* Avatar Section */}
                    <div className="flex items-center gap-6">
                        <div
                            className="h-24 w-24 rounded-full flex items-center justify-center text-2xl font-medium text-white"
                            style={{ backgroundColor: '#4b2192' }}
                        >
                            {formData.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="font-semibold text-gray-900">{formData.name}</h3>
                            <p className="text-sm text-gray-500 mt-1">{formData.role}</p>
                        </div>
                    </div>

                    {/* Form Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-sm font-medium text-gray-700 block mb-1">Full Name</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700 block mb-1">Email Address</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700 block mb-1">Phone Number</label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="text-sm font-medium text-gray-700 block mb-1">Location</label>
                            <div className="relative">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    value={formData.location}
                                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="text-sm font-medium text-gray-700 block mb-1">Role</label>
                            <div className="relative">
                                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    value={formData.role}
                                    disabled
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-500"
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Role cannot be changed. Contact admin for role modifications.</p>
                        </div>
                    </div>

                    {/* Save */}
                    <div className="flex justify-end pt-4 border-t border-gray-200">
                        <button
                            onClick={handleSave}
                            className="px-6 py-2.5 rounded-lg text-white text-sm font-medium w-full md:w-auto"
                            style={{ backgroundColor: '#4b2192' }}
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </div>

            {/* Account Security */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Account Security</h2>
                    <p className="text-sm text-gray-500 mt-1">Manage your password and security settings</p>
                </div>
                <div className="p-6 space-y-4">
                    <div className="flex items-center justify-between py-3 border-b border-gray-100">
                        <div>
                            <h4 className="font-medium text-gray-900">Password</h4>
                            <p className="text-sm text-gray-500 mt-1">Last changed 30 days ago</p>
                        </div>
                        <button className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">Change Password</button>
                    </div>
                    <div className="flex items-center justify-between py-3">
                        <div>
                            <h4 className="font-medium text-gray-900">Two-Factor Authentication</h4>
                            <p className="text-sm text-gray-500 mt-1">Add an extra layer of security</p>
                        </div>
                        <button className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50">Enable</button>
                    </div>
                </div>
            </div>

            {/* Permissions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="font-semibold text-gray-900">Manager Permissions</h2>
                    <p className="text-sm text-gray-500 mt-1">Your current access level and permissions</p>
                </div>
                <div className="p-6">
                    <div className="space-y-3">
                        {permissions.map((perm, i) => (
                            <div key={i} className="flex items-center justify-between py-2">
                                <span className="text-sm text-gray-700">{perm.label}</span>
                                <span className={`text-sm font-medium ${perm.color}`}>{perm.status}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
