import type { ReactNode } from 'react';
import { GLOSSARY, type GlossaryTerm } from '@/lib/glossary';

/** A jargon word with a dotted underline; its plain meaning shows on hover and on keyboard focus. */
export function Term({ k, children }: { k: GlossaryTerm; children?: ReactNode }) {
  return (
    <span className="group relative inline-block">
      <span tabIndex={0} aria-describedby={`term-${k}`} className="cursor-help underline decoration-dotted decoration-muted underline-offset-[3px] outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-blue">
        {children ?? k}
      </span>
      <span id={`term-${k}`} role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-64 -translate-x-1/2 rounded-lg border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-ink shadow-lg group-hover:block group-focus-within:block">
        {GLOSSARY[k]}
      </span>
    </span>
  );
}
