type Props = {
  label: string;
  value: string | number;
  emphasis?: "primary" | "cyan";
};

export function MetricsCard({ label, value, emphasis = "primary" }: Props) {
  return (
    <article className={`card metric metric-${emphasis}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  );
}
