import { useState } from "react";
import { api } from "../lib/api";
import { ImportPreviewTable } from "./ImportPreviewTable";
import { Icon } from "./Icon";

type Props = {
  eventId: string;
  eventKind?: "gcba" | "vecinos";
};

export function ImportWizard({ eventId, eventKind = "gcba" }: Props) {
  const isVecinos = eventKind === "vecinos";
  const [result, setResult] = useState<null | {
    originalFilename: string;
    sheetName: string;
    previewRows: Array<{
      rowNumber: number;
      canonical: Record<string, unknown>;
      extraData?: Record<string, unknown>;
      errors: string[];
    }>;
    summary: Record<string, unknown>;
    mapping: Record<string, string>;
  }>(null);
  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const preview = async (): Promise<{
    originalFilename: string;
    sheetName: string;
    previewRows: Array<{
      rowNumber: number;
      canonical: Record<string, unknown>;
      extraData?: Record<string, unknown>;
      errors: string[];
    }>;
    summary: Record<string, unknown>;
    mapping: Record<string, string>;
  } | null> => {
    if (!file) return null;
    setErrorMessage(null);
    setIsPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await api.post(`/events/${eventId}/imports/preview`, formData);
      setResult(response.data);
      setStep(2);
      return response.data;
    } catch (error: unknown) {
      const apiMessage =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErrorMessage(apiMessage ?? "No se pudo previsualizar el archivo. Revisá que tenga hoja BASE y columnas válidas.");
      return null;
    } finally {
      setIsPreviewing(false);
    }
  };

  const confirm = async () => {
    if (!file) return;
    setErrorMessage(null);
    setIsConfirming(true);
    try {
      if (!result) {
        await preview();
      }
      const formData = new FormData();
      formData.append("file", file);
      const { data: batch } = await api.post<{ importedRows: number }>(
        `/events/${eventId}/imports/confirm`,
        formData
      );
      setStep(3);
      alert(`Importación confirmada: ${batch.importedRows} fila(s) importada(s) del archivo completo.`);
    } catch (error: unknown) {
      const apiMessage =
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setErrorMessage(apiMessage ?? "No se pudo confirmar la importación.");
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.75rem" }}>
          Asistente de importación XLSX
        </h2>
        <p className="lead" style={{ marginBottom: 0 }}>
          {isVecinos ? (
            <>
              Evento <strong>Vecinos</strong>. La hoja debe llamarse <strong>BASE</strong> con columnas:{" "}
              <strong>Nombre, Apellido, Dirección, DNI, Teléfono, Mesa, Presente, 0</strong>. La acreditación usa el
              directorio de vecinos como reserva.
            </>
          ) : (
            <>
              Evento <strong>GCBA</strong>. La hoja debe llamarse <strong>BASE</strong> y seguir el formato de dotación
              (CUIL, ministerio, rol, etc.). La acreditación usa el directorio GCBA como reserva.
            </>
          )}
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
            setErrorMessage(null);
          }}
        />
        <div className="row gap" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={preview} type="button" disabled={!file || isPreviewing || isConfirming}>
            <Icon name="visibility" />
            {isPreviewing ? "Previsualizando..." : "Previsualizar"}
          </button>
          <button className="btn btn-primary" onClick={confirm} type="button" disabled={!file || isConfirming || isPreviewing}>
            <Icon name="check_circle" />
            {isConfirming ? "Importando..." : "Confirmar importación"}
          </button>
        </div>
        {errorMessage ? (
          <p className="message-error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            {errorMessage}
          </p>
        ) : null}
      </section>

      {result ? (
        <>
          <div className="card card--flat" style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--primary-container)" }}>
              Válidas: {String(result.summary.validRows)} · Inválidas: {String(result.summary.invalidRows)} · Duplicados en archivo:{" "}
              {String(result.summary.duplicateRows ?? "—")} · Total filas: {String(result.summary.totalRows)}
            </p>
            <p style={{ margin: "0.75rem 0 0", color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>
              Usá los filtros debajo para ver válidas, inválidas o duplicados. Al confirmar se importan las{" "}
              {String(result.summary.validRows)} filas válidas del archivo completo.
            </p>
          </div>
          <ImportPreviewTable rows={result.previewRows} eventKind={eventKind} />
        </>
      ) : null}
    </div>
  );
}
