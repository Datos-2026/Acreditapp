import { useState } from "react";
import { api } from "../lib/api";
import { ImportPreviewTable } from "./ImportPreviewTable";
import { Icon } from "./Icon";

type ReferentePreview = {
  name: string;
  email: string | null;
  peopleCount: number;
  missingEmail: boolean;
};

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

function asReferentes(summary: Record<string, unknown> | undefined): ReferentePreview[] {
  return Array.isArray(summary?.referentes) ? (summary.referentes as ReferentePreview[]) : [];
}

function mergeReferentes(lists: ReferentePreview[][]): ReferentePreview[] {
  const map = new Map<string, ReferentePreview>();
  for (const list of lists) {
    for (const ref of list) {
      const key = (ref.email ?? "").trim().toLowerCase() || `nombre:${ref.name.trim().toLowerCase()}`;
      const prev = map.get(key);
      if (prev) {
        prev.peopleCount += ref.peopleCount;
      } else {
        map.set(key, { ...ref });
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function sumNumber(previews: PreviewResult[], key: string): number {
  return previews.reduce((acc, p) => acc + (Number(p.summary[key]) || 0), 0);
}

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
  const [filePreviews, setFilePreviews] = useState<PreviewResult[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmSummary, setConfirmSummary] = useState<string | null>(null);

  const preview = async (): Promise<PreviewResult | null> => {
    if (files.length === 0) return null;
    setErrorMessage(null);
    setIsPreviewing(true);
    try {
      const previews: PreviewResult[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const response = await api.post<PreviewResult>(`/events/${eventId}/imports/preview`, formData);
          previews.push(response.data);
        } catch (error: unknown) {
          failed.push(`${file.name}: ${apiErrorMessage(error, "no se pudo leer")}`);
        }
      }
      if (previews.length === 0) {
        setErrorMessage(
          failed.length > 0
            ? failed.join(" · ")
            : "No se pudo previsualizar el archivo. Revisá que tenga columnas válidas."
        );
        return null;
      }
      const mergedReferentes = mergeReferentes(previews.map((p) => asReferentes(p.summary)));
      const merged: PreviewResult = {
        ...previews[0],
        originalFilename: previews.map((p) => p.originalFilename).join(", "),
        previewRows: previews.flatMap((p) => p.previewRows),
        summary: {
          ...previews[0].summary,
          validRows: sumNumber(previews, "validRows"),
          invalidRows: sumNumber(previews, "invalidRows"),
          duplicateRows: sumNumber(previews, "duplicateRows"),
          existingInEvent: sumNumber(previews, "existingInEvent"),
          referentesCount: mergedReferentes.length,
          referentes: mergedReferentes
        }
      };
      setFilePreviews(previews);
      setResult(merged);
      setStep(2);
      if (failed.length > 0) {
        setErrorMessage(`Algunos archivos no se pudieron leer: ${failed.join(" · ")}`);
      }
      return merged;
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
      const failed: string[] = [];
      for (const file of files) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const { data: batch } = await api.post<{ importedRows: number }>(
            `/events/${eventId}/imports/confirm`,
            formData
          );
          importedTotal += batch.importedRows ?? 0;
          names.push(file.name);
        } catch (error: unknown) {
          failed.push(`${file.name}: ${apiErrorMessage(error, "no se pudo importar")}`);
        }
      }
      if (names.length > 0) {
        setStep(3);
        setConfirmSummary(
          `Importación confirmada: ${importedTotal} fila(s) de ${names.length} archivo(s) (${names.join(", ")}). Se sumaron a la lista del evento.`
        );
      }
      if (failed.length > 0) {
        setErrorMessage(
          names.length === 0
            ? `No se pudo confirmar la importación. ${failed.join(" · ")}`
            : `Se importaron ${names.length} archivo(s), pero fallaron: ${failed.join(" · ")}`
        );
      }
    } catch (error: unknown) {
      setErrorMessage(apiErrorMessage(error, "No se pudo confirmar la importación."));
    } finally {
      setIsConfirming(false);
    }
  };

  const referentes = asReferentes(result?.summary);

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
            setFilePreviews([]);
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
              Vista previa de {filePreviews.length > 1 ? `${filePreviews.length} archivos` : result.originalFilename}{" "}
              — Válidas: {String(result.summary.validRows)} · Inválidas: {String(result.summary.invalidRows)} ·
              Duplicados en archivo: {String(result.summary.duplicateRows ?? "—")} · Ya en el evento:{" "}
              {String(result.summary.existingInEvent ?? "—")}
            </p>
            {filePreviews.length > 1 ? (
              <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.25rem", color: "var(--on-surface-variant)" }}>
                {filePreviews.map((p) => (
                  <li key={p.originalFilename}>
                    <strong>{p.originalFilename}</strong> — {String(p.summary.validRows)} válidas ·{" "}
                    {asReferentes(p.summary).length} referente(s)
                  </li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "0.75rem 0 0", color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>
                Al confirmar se importan las filas válidas y se suman a la lista.
              </p>
            )}
          </div>
          {referentes.length > 0 ? (
            <div className="card" style={{ marginTop: "1rem" }}>
              <h3 style={{ marginTop: 0 }}>
                Referentes detectados ({referentes.length}
                {filePreviews.length > 1 ? ` en ${filePreviews.length} archivos` : ""})
              </h3>
              <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                {referentes.map((ref) => (
                  <li key={`${ref.email ?? ref.name}`}>
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
