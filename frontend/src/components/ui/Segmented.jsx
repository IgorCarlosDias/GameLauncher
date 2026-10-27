import { haptic } from "../../lib/haptics";

/** Controle segmentado. `options`: [{ id, label, icon? }]. */
export default function Segmented({ options, value, onChange, label, className = "" }) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={label}>
      {options.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={`segmented__item${value === id ? " is-active" : ""}`}
          onClick={() => {
            if (value !== id) {
              haptic.select();
              onChange(id);
            }
          }}
        >
          {Icon && <Icon size={16} aria-hidden="true" />}
          <span>{text}</span>
        </button>
      ))}
    </div>
  );
}
