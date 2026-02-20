import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button, Input } from '@/components/ui';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

interface ProfileCompletionDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    missingFields?: {
        name?: boolean;
        gender?: boolean;
        age?: boolean;
    };
}

export function ProfileCompletionDialog({ isOpen, onClose, onSuccess, missingFields }: ProfileCompletionDialogProps) {
    const [formData, setFormData] = useState({
        name: '',
        gender: '',
        age: ''
    });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await api.put('/profile', {
                ...formData,
                age: parseInt(formData.age)
            });
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Profile Update Error:', error);
            toast.error('Failed to update profile. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Complete Your Profile</DialogTitle>
                </DialogHeader>
                <div className="py-4">
                    <p className="text-sm text-gray-500 mb-4">
                        Please update your profile to proceed with the booking. These details are required for billing and reporting.
                    </p>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid gap-2">
                            <label className="text-sm font-medium">Full Name</label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Enter your full name"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium">Age</label>
                            <Input
                                type="number"
                                value={formData.age}
                                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                                placeholder="Enter your age"
                                required
                            />
                        </div>
                        <div className="grid gap-2">
                            <label className="text-sm font-medium">Gender</label>
                            <select
                                value={formData.gender}
                                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                                className="w-full p-2 border rounded-md text-sm"
                                required
                            >
                                <option value="">Select Gender</option>
                                <option value="M">Male</option>
                                <option value="F">Female</option>
                            </select>
                        </div>

                        <Button type="submit" className="w-full bg-primary" disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Save & Continue
                        </Button>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
