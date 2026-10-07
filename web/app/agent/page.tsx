import { redirect } from 'next/navigation';

// Old route from earlier plugin builds ("sign in at <web>/agent").
export default function OldAgent() { redirect('/seller/agent'); }
