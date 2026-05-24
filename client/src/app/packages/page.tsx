import { redirect } from 'next/navigation';

export default function PackagesPage() {
    redirect('/search?type=PACKAGE');
}
