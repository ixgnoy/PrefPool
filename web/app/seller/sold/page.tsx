import { redirect } from 'next/navigation';

// "Sold" moved into Activity → My answers; old links keep working.
export default function SoldRedirect() {
  redirect('/seller/activity?tab=answers');
}
