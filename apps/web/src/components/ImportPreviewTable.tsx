import { useMemo, useState } from "react";

type PreviewRow = {
  rowNumber: number;
  canonical: Record<string, unknown>;
  extraData?: Record<string, unknown>;
  errors: string[];
};

type PreviewFilter = "all" | "valid" | "invalid" | "duplicate";

type Props = {
  rows: PreviewRow[];
};

function isDuplicateRow(row: PreviewRow): boolean {
  return row.errors.some((error) => error.toLowerCase().includes("duplicado"));
}

function isValidRow(row: PreviewRow): boolean {
  return row.errors.length === 0;
}

function isInvalidOnlyRow(row: PreviewRow): boolean {
  return row.errors.length > 0 && !isDuplicateRow(row);
}

export function ImportPreviewTable({ rows }: Props) {
  const [filter, setFilter] = useState<PreviewFilter>("all");

  const counts = useMemo(
    () => ({
      all: rows.length,
      valid: rows.filter(isValidRow).length,
      invalid: rows.filter(isInvalidOnlyRow).length,
      duplicate: rows.filter(isDuplicateRow).length
    }),
    [rows]
  );

  const filteredRows = useMemo(() => {
    switch (filter) {
      case "valid":
        return rows.filter(isValidRow);
      case "invalid":
        return rows.filter(isInvalidOnlyRow);
      case "duplicate":
        return rows.filter(isDuplicateRow);
      default:
        return rows;
    }
  }, [rows, filter]);

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
    new Set(filteredRows.flatMap((row) => Object.keys(row.extraData ?? {})))
  ).filter((column) => !isNoiseColumn(column));

  const filters: Array<{ id: PreviewFilter; label: string; count: number }> = [
    { id: "all", label: "Todas", count: counts.all },
    { id: "valid", label: "Válidas", count: counts.valid },
    { id: "invalid", label: "Inválidas", count: counts.invalid },
    { id: "duplicate", label: "Duplicados", count: counts.duplicate }
  ];

  return (
    <div className="card">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>Preview de importación</h3>
        <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--on-surface-variant)" }}>
          Mostrando {filteredRows.length} de {rows.length} filas
        </p>
      </div>

      <div className="filters-bar" style={{ marginBottom: "1rem" }}>
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab-btn ${filter === item.id ? "active" : ""}`}
            onClick={() => setFilter(item.id)}
          >
            {item.label} ({item.count})
          </button>
        ))}
      </div>

      {filteredRows.length === 0 ? (
        <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>No hay filas en este filtro.</p>
      ) : (
        <>
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
                  <th>Ministerio</th>
                  <th>Rol</th>
                  <th>Pregunta / nota</th>
                  {extraColumns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                  <th>Errores</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td>{String(row.canonical.cuil ?? "-")}</td>
                    <td>{String(row.canonical.nombre ?? "-")}</td>
                    <td>{String(row.canonical.apellido ?? "-")}</td>
                    <td>{String(row.canonical.email ?? "-")}</td>
                    <td>{String(row.canonical.telefono ?? "-")}</td>
                    <td>{String(row.canonical.empresa ?? "-")}</td>
                    <td>{String(row.canonical.cargo ?? "-")}</td>
                    <td className="import-preview-table__cell-wrap">{String(row.canonical.notes ?? "-")}</td>
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
            {filteredRows.map((row) => (
              <article key={row.rowNumber} className="import-preview-card">
                <div className="import-preview-card__head">
                  <strong>Fila {row.rowNumber}</strong>
                  <span className={`status-pill ${row.errors.length > 0 ? "status-pill--draft" : "status-pill--active"}`}>
                    {isDuplicateRow(row) ? "Duplicado" : row.errors.length > 0 ? "Inválida" : "OK"}
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
                  <p>
                    <strong>Ministerio</strong>
                    <span>{String(row.canonical.empresa ?? "-")}</span>
                  </p>
                  <p>
                    <strong>Rol</strong>
                    <span>{String(row.canonical.cargo ?? "-")}</span>
                  </p>
                  <p>
                    <strong>Pregunta / nota</strong>
                    <span>{String(row.canonical.notes ?? "-")}</span>
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
        </>
      )}
    </div>
  );
}
