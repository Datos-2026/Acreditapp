import { useState } from "react";
import { api } from "../lib/api";
import { ImportPreviewTable } from "./ImportPreviewTable";
import { Icon } from "./Icon";

type Props = {
  eventId: string;
};

export function ImportWizard({ eventId }: Props) {
  const [result, setResult] = useState<null | {
    originalFilename: string;
    sheetName: string;
    previewRows: Array<{ rowNumber: number; canonical: Record<string, unknown>; errors: string[] }>;
    summary: Record<string, unknown>;
    mapping: Record<string, string>;
  }>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const preview = async () => {
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    const response = await api.post(`/events/${eventId}/imports/preview`, formData);
    setResult(response.data);
    setStep(2);
  };

  const confirm = async () => {
    if (!result || !file) return;
    await api.post(`/events/${eventId}/imports/confirm`, {
      eventId,
      originalFilename: result.originalFilename,
      sheetName: result.sheetName,
      rows: result.previewRows.map((row) => row.canonical),
      mapping: undefined
    });
    setStep(3);
    alert("Importación confirmada");
  };

  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.75rem" }}>
          Asistente de importación XLSX
        </h2>
        <p className="lead" style={{ marginBottom: 0 }}>
          Cargá masivamente registros al sistema. La hoja debe llamarse <strong>BASE</strong> y seguir el formato acordado.
        </p>
      </header>

      <div className="wizard-steps">
        <div className={`wizard-step ${step === 1 ? "wizard-step--current" : ""}`}>
          <div className="wizard-step__num">1</div>
          <div>
            <p className="wizard-step__sub">{step === 1 ? "Paso actual" : "Listo"}</p>
            <p className="wizard-step__title">Carga de archivo</p>
          </div>
        </div>
        <div className={`wizard-step ${step === 2 ? "wizard-step--current" : ""}`}>
          <div className="wizard-step__num">2</div>
          <div>
            <p className="wizard-step__sub">Validación</p>
            <p className="wizard-step__title">Previsualización</p>
          </div>
        </div>
        <div className={`wizard-step ${step === 3 ? "wizard-step--current" : ""}`}>
          <div className="wizard-step__num">3</div>
          <div>
            <p className="wizard-step__sub">Cierre</p>
            <p className="wizard-step__title">Confirmación</p>
          </div>
        </div>
      </div>

      <section className="card">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
          <Icon name="upload_file" style={{ fontSize: 28, color: "var(--primary-container)" }} />
          <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800, color: "var(--primary)" }}>Archivo (.xlsx)</h3>
        </div>
        <input
          type="file"
          accept=".xlsx"
          className="input input--boxed"
          style={{ padding: "0.75rem 1rem", cursor: "pointer" }}
          onChange={(event) => {
            setFile(event.target.files?.[0] ?? null);
            setStep(1);
            setResult(null);
          }}
        />
        <div className="row gap" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={preview} type="button" disabled={!file}>
            <Icon name="visibility" />
            Previsualizar
          </button>
          <button className="btn btn-primary" onClick={confirm} type="button" disabled={!result || step < 2}>
            <Icon name="check_circle" />
            Confirmar importación
          </button>
        </div>
      </section>

      {result ? (
        <>
          <div className="card card--flat" style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--primary-container)" }}>
              Válidas: {String(result.summary.validRows)} · Inválidas: {String(result.summary.invalidRows)} · Duplicados en archivo:{" "}
              {String(result.summary.duplicateRows ?? "—")}
            </p>
          </div>
          <ImportPreviewTable rows={result.previewRows} />
        </>
      ) : null}
    </div>
  );
}
