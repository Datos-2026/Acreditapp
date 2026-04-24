type Props = {
  status: "pending" | "accredited";
  source: "imported" | "manual";
};

export function AccreditationStatusBadge({ status, source }: Props) {
  return (
    <div className="badge-row">
      <span className={`badge ${status === "accredited" ? "badge-success" : "badge-warning"}`}>
        {status === "accredited" ? "Acreditado" : "Pendiente"}
      </span>
      <span className={`badge ${source === "manual" ? "badge-cyan" : "badge-info"}`}>
        {source === "manual" ? "Fuera de base" : "Base importada"}
      </span>
    </div>
  );
}
