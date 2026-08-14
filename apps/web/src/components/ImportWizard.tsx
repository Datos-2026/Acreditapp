import { useState } from "react";
import { api } from "../lib/api";
import { ImportPreviewTable } from "./ImportPreviewTable";
import { Icon } from "./Icon";

type PreviewResult = {
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
};

type Props = {
  eventId: string;
  eventKind?: "gcba" | "vecinos";
  enableReferentes?: boolean;
};

function apiErrorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { data?: { message?: string } } }).response?.data?.message === "string"
  ) {
    return (error as { response: { data: { message: string } } }).response.data.message;
  }
  return fallback;
}

export function ImportWizard({ eventId, eventKind = "gcba", enableReferentes = false }: Props) {
  const isVecinos = eventKind === "vecinos";
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmSummary, setConfirmSummary] = useState<string | null>(null);

  const preview = async (): Promise<PreviewResult | null> => {
    const first = files[0];
    if (!first) return null;
    setErrorMessage(null);
    setIsPreviewing(true);
    try {
      const formData = new FormData();
      formData.append("file", first);
      const response = await api.post(`/events/${eventId}/imports/preview`, formData);
      setResult(response.data);
      setStep(2);
      return response.data;
    } catch (error: unknown) {
      setErrorMessage(
        apiErrorMessage(error, "No se pudo previsualizar el archivo. Revisá que tenga columnas válidas.")
      );
      return null;
    } finally {
      setIsPreviewing(false);
    }
  };

  const confirm = async () => {
    if (files.length === 0) return;
    setErrorMessage(null);
    setIsConfirming(true);
    try {
      if (!result) {
        await preview();
      }
      let importedTotal = 0;
      const names: string[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const { data: batch } = await api.post<{ importedRows: number }>(
          `/events/${eventId}/imports/confirm`,
          formData
        );
        importedTotal += batch.importedRows ?? 0;
        names.push(file.name);
      }
      setStep(3);
      setConfirmSummary(
        `Importación confirmada: ${importedTotal} fila(s) de ${files.length} archivo(s) (${names.join(", ")}). Se sumaron a la lista del evento.`
      );
    } catch (error: unknown) {
      setErrorMessage(apiErrorMessage(error, "No se pudo confirmar la importación."));
    } finally {
      setIsConfirming(false);
    }
  };

  const referentes = Array.isArray(result?.summary.referentes)
    ? (result.summary.referentes as Array<{
        name: string;
        email: string | null;
        peopleCount: number;
        missingEmail: boolean;
      }>)
    : [];

  return (
    <div>
      <header style={{ marginBottom: "2rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.75rem" }}>
          Asistente de importación XLSX
        </h2>
        <p className="lead" style={{ marginBottom: "0.75rem" }}>
          {enableReferentes ? (
            <>
              Evento con <strong>referentes</strong>. Columnas esperadas:{" "}
              <strong>Nombre, Apellido, DNI, Escuela, Sección, Oferta, Referente</strong> (Nombre | mail |
              teléfono). Podés subir <strong>varios Excel</strong>: cada archivo se suma a la lista.
            </>
          ) : isVecinos ? (
            <>
              Evento <strong>Vecinos</strong>. La hoja debe llamarse <strong>BASE</strong> con columnas:{" "}
              <strong>Nombre, Apellido, Dirección, DNI, Teléfono, Presente, 0</strong>. La mesa se asigna al
              acreditar.
            </>
          ) : (
            <>
              Evento <strong>GCBA</strong>. La hoja debe llamarse <strong>BASE</strong> y seguir el formato de
              dotación (CUIL, ministerio, rol, etc.).
            </>
          )}
        </p>
        <p style={{ margin: 0, color: "var(--on-surface-variant)", fontSize: "0.95rem", fontWeight: 600 }}>
          Este archivo se suma a la lista. Las personas nuevas se agregan; las que ya están (mismo DNI/CUIL) se
          actualizan. No se vacía la nómina.
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
          <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 800, color: "var(--primary)" }}>
            Archivo(s) (.xlsx)
          </h3>
        </div>
        <input
          type="file"
          accept=".xlsx"
          multiple
          className="input input--boxed"
          style={{ padding: "0.75rem 1rem", cursor: "pointer" }}
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
            setStep(1);
            setResult(null);
            setErrorMessage(null);
            setConfirmSummary(null);
          }}
        />
        {files.length > 0 ? (
          <p style={{ margin: "0.75rem 0 0", fontWeight: 700 }}>
            {files.length} archivo(s): {files.map((f) => f.name).join(", ")}
          </p>
        ) : null}
        <div className="row gap" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary"
            onClick={() => void preview()}
            type="button"
            disabled={files.length === 0 || isPreviewing || isConfirming}
          >
            <Icon name="visibility" />
            {isPreviewing ? "Previsualizando..." : "Previsualizar"}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void confirm()}
            type="button"
            disabled={files.length === 0 || isConfirming || isPreviewing}
          >
            <Icon name="check_circle" />
            {isConfirming
              ? "Importando..."
              : files.length > 1
                ? `Confirmar ${files.length} archivos`
                : "Confirmar importación"}
          </button>
        </div>
        {errorMessage ? (
          <p className="message-error" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            {errorMessage}
          </p>
        ) : null}
        {confirmSummary ? (
          <p className="message-success" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            {confirmSummary}
          </p>
        ) : null}
      </section>

      {result ? (
        <>
          <div className="card card--flat" style={{ marginTop: "1rem" }}>
            <p style={{ margin: 0, fontWeight: 700, color: "var(--primary-container)" }}>
              Vista previa de {result.originalFilename}
              {files.length > 1 ? ` (1 de ${files.length})` : ""} — Válidas:{" "}
              {String(result.summary.validRows)} · Inválidas: {String(result.summary.invalidRows)} · Duplicados
              en archivo: {String(result.summary.duplicateRows ?? "—")} · Ya en el evento:{" "}
              {String(result.summary.existingInEvent ?? "—")}
            </p>
            <p style={{ margin: "0.75rem 0 0", color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>
              Al confirmar se importan las filas válidas de todos los archivos seleccionados y se suman a la lista.
            </p>
          </div>
          {referentes.length > 0 ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h3 style={{ marginTop: 0 }}>Referentes detectados ({referentes.length})</h3>
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {referentes.map((ref) => (
                  <li key={`${ref.email ?? ref.name}-${ref.peopleCount}`}>
                    <strong>{ref.name}</strong>
                    {ref.email ? ` · ${ref.email}` : " · sin mail"} — {ref.peopleCount} a cargo
                    {ref.missingEmail ? " (agrupado por nombre)" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <ImportPreviewTable rows={result.previewRows} eventKind={eventKind} />
        </>
      ) : null}
    </div>
  );
}
