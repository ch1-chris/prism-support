export default function VersionSelector({ versions, value, onChange }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Select app version"
    >
      <option value="all">All versions</option>
      {(versions || []).map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
}
