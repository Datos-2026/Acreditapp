type PreviewRow = {
  rowNumber: number;
  canonical: Record<string, unknown>;
  errors: string[];
};

type Props = {
  rows: PreviewRow[];
};

export function ImportPreviewTable({ rows }: Props) {
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
              <td>{row.errors.length > 0 ? row.errors.join(", ") : "OK"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
