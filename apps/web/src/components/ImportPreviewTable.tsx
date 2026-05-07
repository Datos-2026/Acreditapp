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
  const extraColumns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row.extraData ?? {})))
  );

  return (
    <div className="card">
      <h3>Preview de importación</h3>
      <table className="table">
        <thead>
          <tr>
            <th>Fila</th>
            <th>CUIL</th>
            <th>Nombre</th>
            <th>Apellido</th>
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
              {extraColumns.map((column) => (
                <td key={column}>{String(row.extraData?.[column] ?? "-")}</td>
              ))}
              <td>{row.errors.length > 0 ? row.errors.join(", ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
