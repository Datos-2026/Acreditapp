import type { CSSProperties } from "react";

type Props = {
  name: string;
  className?: string;
  filled?: boolean;
  style?: CSSProperties;
};

/** Material Symbols Outlined (misma familia que Stitch / Google Fonts) */
export function Icon({ name, className = "", filled = false, style }: Props) {
  const variation = filled
    ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" as const }
    : undefined;
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      style={{ ...variation, ...style }}
      aria-hidden
    >
      {name}
    </span>
  );
}
