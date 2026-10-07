import type { ReactNode } from 'react';

// Remounts on every navigation, so each page eases in while the header and store persist.
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-in">{children}</div>;
}
