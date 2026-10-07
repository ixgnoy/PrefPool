'use client';
// "Match campaigns to my profile" (FRONTEND_PRD §5.3 step 2 + guardrails): when on, the owner's agent abstains with
// "no matching profile" if a campaign's audience excludes them. The profile stays on this device; campaigns only ever
// learn "answered" or "abstained".
import { Card, Toggle, cx } from './ui';
import { AGES, COUNTRIES, COUNTRY_CODES, OCCUPATIONS, ageLabel, ageValue, countryLabel } from '@/lib/audience';
import type { Profile } from '@/lib/store';

export function ProfileMatch({ on, onToggle, profile, onChange, compact = false }: {
  on: boolean; onToggle(v: boolean): void; profile: Profile; onChange(p: Profile): void; compact?: boolean;
}) {
  return (
    <Card id="profile" className={cx('flex scroll-mt-24 flex-col gap-4', compact ? 'p-5' : 'p-0 border-0 bg-transparent')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-xl flex-col gap-1">
          <h3 className="font-bold">Match campaigns to my profile</h3>
          <p className="text-[13px] text-muted">
            {on ? 'Your agent skips campaigns whose audience doesn\'t include you, and says why ("no matching profile").'
              : 'Off: your agent ignores who a campaign is for and only applies your category and reward rules.'}
          </p>
        </div>
        <Toggle checked={on} onChange={onToggle} label="" ariaLabel="Match campaigns to my profile" />
      </div>
      {on && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Country" value={countryLabel(profile.country)} options={COUNTRIES} onChange={(v) => onChange({ ...profile, country: COUNTRY_CODES[v] ?? null })} />
          <Select label="Age band" value={ageLabel(profile.ageBand)} options={AGES} onChange={(v) => onChange({ ...profile, ageBand: ageValue(v) })} />
          <Select label="Occupation group" value={profile.occupation ?? ''} options={OCCUPATIONS} onChange={(v) => onChange({ ...profile, occupation: v })} verified={false} />
        </div>
      )}
      {on && (!profile.country || !profile.ageBand || !profile.occupation) && (
        <p className="text-[13px] font-bold text-warn-ink">Blank fields can&apos;t match a campaign that targets them, so your agent will skip those.</p>
      )}
      <p className="text-xs text-muted">Stays on this device. Campaigns never see these values. Applies to the web agent in this browser; a Claude Code or OpenClaw agent uses its own rules.</p>
    </Card>
  );
}

function Select({ label, value, options, onChange, verified = true }: { label: string; value: string; options: string[]; onChange(v: string): void; verified?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between text-sm font-bold">{label}{verified && <span className="text-[11px] font-bold text-muted">Verified, coming soon</span>}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm">
        <option value="" disabled>Choose…</option>
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </label>
  );
}
