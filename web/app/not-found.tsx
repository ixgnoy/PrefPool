import { Button, EmptyState } from '@/components/ui';

export default function NotFound() {
  return <EmptyState pose="sleeping" text="This page swam off. Let's get you back." action={<Button href="/">Go home</Button>} />;
}
