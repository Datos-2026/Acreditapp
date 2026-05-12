type PreviewRow = {
  rowNumber: number;
  canonical: Record<string, unknown>;
  extraData?: Record<string, unknown>;
  errors: string[];
};

type Props = {
  rows: PreviewRow[];
};

export function ImportPreviewTable({ rows }: Props) {
  const normalizeHeader = (header: string) =>
    header
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const isNoiseColumn = (header: string) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return true;
    if (normalized === "marca temporal") return true;
    if (/^column\s*\d+$/i.test(normalized)) return true;
    if (/^rol\s*\d+$/i.test(normalized)) return true;
    return false;
  };

  const extraColumns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row.extraData ?? {})))
  ).filter((column) => !isNoiseColumn(column));

  return (
    <div className="card">
      <h3>Preview de importación</h3>
      <div className="table-wrapper import-preview-table">
        <table className="table">
          <thead>
            <tr>
              <th>Fila</th>
              <th>CUIL</th>
              <th>Nombre</th>
              <th>Apellido</th>
              <th>Correo</th>
              <th>Teléfono</th>
              {extraColumns.map((column) => (
                <th key={column}>{column}</th>
              ))}
              <th>Errores</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber}>
                <td>{row.rowNumber}</td>
                <td>{String(row.canonical.cuil ?? "-")}</td>
                <td>{String(row.canonical.nombre ?? "-")}</td>
                <td>{String(row.canonical.apellido ?? "-")}</td>
                <td>{String(row.canonical.email ?? "-")}</td>
                <td>{String(row.canonical.telefono ?? "-")}</td>
                {extraColumns.map((column) => (
                  <td key={column}>{String(row.extraData?.[column] ?? "-")}</td>
                ))}
                <td>{row.errors.length > 0 ? row.errors.join(", ") : "OK"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="import-preview-mobile">
        {rows.map((row) => (
          <article key={row.rowNumber} className="import-preview-card">
            <div className="import-preview-card__head">
              <strong>Fila {row.rowNumber}</strong>
              <span className={`status-pill ${row.errors.length > 0 ? "status-pill--draft" : "status-pill--active"}`}>
                {row.errors.length > 0 ? "Con errores" : "OK"}
              </span>
            </div>
            <div className="import-preview-card__grid">
              <p>
                <strong>CUIL</strong>
                <span>{String(row.canonical.cuil ?? "-")}</span>
              </p>
              <p>
                <strong>Nombre</strong>
                <span>{String(row.canonical.nombre ?? "-")}</span>
              </p>
              <p>
                <strong>Apellido</strong>
                <span>{String(row.canonical.apellido ?? "-")}</span>
              </p>
              <p>
                <strong>Correo</strong>
                <span>{String(row.canonical.email ?? "-")}</span>
              </p>
              <p>
                <strong>Teléfono</strong>
                <span>{String(row.canonical.telefono ?? "-")}</span>
              </p>
            </div>
            {extraColumns.length > 0 ? (
              <div className="import-preview-card__extra">
                {extraColumns.map((column) => (
                  <p key={column}>
                    <strong>{column}</strong>
                    <span>{String(row.extraData?.[column] ?? "-")}</span>
                  </p>
                ))}
              </div>
            ) : null}
            {row.errors.length > 0 ? (
              <p className="message-error" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
                {row.errors.join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </div>
  );
}
