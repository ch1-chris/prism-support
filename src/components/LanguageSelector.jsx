const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
];

const LANGUAGE_CODES = new Set(LANGUAGES.map(l => l.code));

export function getSupportedLanguage(code) {
  const base = (code || 'en').split('-')[0];
  return LANGUAGE_CODES.has(base) ? base : 'en';
}

export default function LanguageSelector({ value, onChange }) {
  const resolvedValue = LANGUAGE_CODES.has(value) ? value : 'en';

  return (
    <select
      value={resolvedValue}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Select language"
    >
      {LANGUAGES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}
