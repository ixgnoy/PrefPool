// web/lib/audience.ts — one audience vocabulary for the campaign builder and the seller's profile, so what a buyer
// targets and what an owner declares compare exactly (matchesAudience in @as/shared).
import type { AudienceProfile } from '@as/shared';
import type { Profile } from './store';

/** Label shown → ISO code stored. */
export const COUNTRY_CODES: Record<string, string> = { Malaysia: 'MY', Singapore: 'SG', Indonesia: 'ID', Philippines: 'PH', Thailand: 'TH', Vietnam: 'VN' };
export const COUNTRIES = Object.keys(COUNTRY_CODES);
export const countryLabel = (code: string | null) => Object.entries(COUNTRY_CODES).find(([, c]) => c === code)?.[0] ?? code ?? '';
/** Shown with an en dash, stored with a hyphen (like the demo network's profiles). */
export const AGES = ['18–24', '25–34', '35–44', '45–54', '55+'];
export const ageValue = (label: string) => label.replace('–', '-');
export const ageLabel = (value: string | null) => (value ?? '').replace('-', '–');
export const OCCUPATIONS = ['Student', 'Office / knowledge work', 'Service & retail', 'Trades', 'Healthcare', 'Retired'];

export const audienceOf = (p: Profile): AudienceProfile => ({
  country: p.country ?? undefined, ageBand: p.ageBand ?? undefined, occupationGroup: p.occupation ?? undefined,
});
