"use client";

import { Plus, Edit2, Trash2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';

export interface Patient {
    id: string;
    name: string;
    relation: string;
    age: number;
    gender: string;
}

export function FamilyTab() {
    const [patients, setPatients] = useState<Patient[]>([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
    const [formData, setFormData] = useState({ name: '', relation: '', age: 0, gender: 'Male' });

    useEffect(() => {
        fetchPatients();
    }, []);

    const fetchPatients = async () => {
        try {
            const res = await api.get('/profile/patients');
            setPatients(res.data);
        } catch (error) {
            console.error('Error fetching patients:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (formData.age < 5) {
            toast.error('Family member must be at least 5 years old');
            return;
        }
        try {
            if (editingPatient) {
                await api.put(`/profile/patients/${editingPatient.id}`, formData);
            } else {
                await api.post('/profile/patients', formData);
            }
            await fetchPatients();
            setDialogOpen(false);
            setEditingPatient(null);
            setFormData({ name: '', relation: '', age: 0, gender: 'Male' });
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to save family member');
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to remove this family member?')) return;
        try {
            await api.delete(`/profile/patients/${id}`);
            await fetchPatients();
        } catch (error: any) {
            toast.error(error.response?.data?.error || 'Failed to delete family member');
        }
    };

    const openEdit = (patient: Patient) => {
        setEditingPatient(patient);
        setFormData({ name: patient.name, relation: patient.relation, age: patient.age, gender: patient.gender });
        setDialogOpen(true);
    };

    if (loading) return <div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Family Members</h2>
                <Button onClick={() => { setEditingPatient(null); setFormData({ name: '', relation: '', age: 0, gender: 'Male' }); setDialogOpen(true); }} className="gap-2">
                    <Plus className="w-4 h-4" /> Add Member
                </Button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                {patients.map((patient) => (
                    <div key={patient.id} className="p-4 border border-gray-200 rounded-lg">
                        <div className="font-semibold text-lg">{patient.name}</div>
                        <p className="text-gray-500 text-sm">{patient.relation} • {patient.gender} • {patient.age} Years</p>
                        <div className="mt-3 flex gap-3 text-sm">
                            <button onClick={() => openEdit(patient)} className="text-primary font-medium flex items-center gap-1">
                                <Edit2 className="w-3 h-3" /> Edit
                            </button>
                            <button onClick={() => handleDelete(patient.id)} className="text-red-500 flex items-center gap-1">
                                <Trash2 className="w-3 h-3" /> Remove
                            </button>
                        </div>
                    </div>
                ))}
                {patients.length === 0 && (
                    <div className="col-span-2 text-center py-12 text-gray-400">
                        No family members added yet. Click "Add Member" to get started.
                    </div>
                )}
            </div>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader><DialogTitle>{editingPatient ? 'Edit' : 'Add'} Family Member</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Name</label>
                            <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter name" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Relation</label>
                            <select
                                className="w-full h-12 rounded-xl border border-border px-3 bg-white"
                                value={formData.relation}
                                onChange={(e) => setFormData({ ...formData, relation: e.target.value })}
                            >
                                <option value="" disabled>Select Relation</option>
                                <option value="Spouse">Spouse</option>
                                <option value="Child">Child</option>
                                <option value="Parent">Parent</option>
                                <option value="Grand parent">Grand parent</option>
                                <option value="Sibling">Sibling</option>
                                <option value="Friend">Friend</option>
                                <option value="Native">Native</option>
                                <option value="Neighbour">Neighbour</option>
                                <option value="Colleague">Colleague</option>
                                <option value="Others">Others</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Age</label>
                                <Input type="number" min={5} value={formData.age} onChange={(e) => setFormData({ ...formData, age: parseInt(e.target.value) || 0 })} />
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
                        <Button onClick={handleSubmit} className="w-full">{editingPatient ? 'Update' : 'Add'} Member</Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
