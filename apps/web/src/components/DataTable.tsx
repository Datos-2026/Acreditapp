import type { ReactNode } from "react";

type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  rows: T[];
};

export function DataTable<T>({ columns, rows }: Props<T>) {
  return (
    <div className="card">
      <div className="table-wrapper data-table-desktop">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="table__empty">
                  No hay resultados para mostrar.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.render(row)}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="data-table-mobile">
        {rows.length === 0 ? (
          <p className="table__empty">No hay resultados para mostrar.</p>
        ) : (
          rows.map((row, rowIndex) => (
            <article key={rowIndex} className="data-table-mobile__card">
              {columns.map((column) => (
                <div key={column.key} className="data-table-mobile__item">
                  <span className="data-table-mobile__label">{column.header}</span>
                  <div className="data-table-mobile__value">{column.render(row)}</div>
                </div>
              ))}
            </article>
          ))
        )}
      </div>
    </div>
  );
}
