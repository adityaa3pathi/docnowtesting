'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';

const ALLOWED_RELATIONS = [
    'Spouse', 'Child', 'Parent', 'Grand parent',
    'Sibling', 'Friend', 'Native', 'Neighbour',
    'Colleague', 'Others'
] as const;

interface AddFamilyMemberDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Called after a new member is successfully created. Receives the new patient. */
    onMemberAdded: (patient: { id: string; name: string; relation: string; age: number; gender: string }) => void;
}

export function AddFamilyMemberDialog({ open, onOpenChange, onMemberAdded }: AddFamilyMemberDialogProps) {
    const [formData, setFormData] = useState({ name: '', relation: '', age: 0, gender: 'Male' });
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const resetForm = () => {
        setFormData({ name: '', relation: '', age: 0, gender: 'Male' });
        setError('');
    };

    const handleSubmit = async () => {
        // Client-side validation
        if (!formData.name.trim()) {
            setError('Please enter a name');
            return;
        }
        if (!formData.relation) {
            setError('Please select a relation');
            return;
        }
        if (formData.age < 5) {
            setError('Family member must be at least 5 years old');
            return;
        }

        setSaving(true);
        setError('');

        try {
            const res = await api.post('/profile/patients', formData);
            const newPatient = res.data.patient;
            resetForm();
            onMemberAdded(newPatient);
            onOpenChange(false);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to add family member');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(val) => { if (!saving) { onOpenChange(val); if (!val) resetForm(); } }}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Add Family Member</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Name</label>
                        <Input
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Enter name"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Relation</label>
                        <select
                            className="w-full h-12 rounded-xl border border-border px-3 bg-white"
                            value={formData.relation}
                            onChange={(e) => setFormData({ ...formData, relation: e.target.value })}
                        >
                            <option value="" disabled>Select Relation</option>
                            {ALLOWED_RELATIONS.map((rel) => (
                                <option key={rel} value={rel}>{rel}</option>
                            ))}
                        </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Age</label>
                            <Input
                                type="number"
                                min={5}
                                value={formData.age}
                                onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Sex</label>
                            <select
                                className="w-full h-12 rounded-xl border border-border px-3 bg-white"
                                value={formData.gender}
                                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                            >
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                    )}

                    <Button onClick={handleSubmit} disabled={saving} className="w-full">
                        {saving ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> Saving...
                            </span>
                        ) : (
                            'Add Member'
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
