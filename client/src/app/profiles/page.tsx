import { redirect } from 'next/navigation';

export default function ProfilesPage() {
    redirect('/search?type=PROFILE');
}
