import { HardDrive, Cloud } from "lucide-react";

const META = {
  steam: { label: "Steam", Icon: Cloud },
  local: { label: "Local", Icon: HardDrive },
};

export default function PlatformBadge({ platform, compact = false }) {
  const { label, Icon } = META[platform] || META.local;
  return (
    <span className={`platform-badge platform-badge--${platform}${compact ? " is-compact" : ""}`}>
      <Icon size={compact ? 11 : 12} aria-hidden="true" />
      {label}
    </span>
  );
}
