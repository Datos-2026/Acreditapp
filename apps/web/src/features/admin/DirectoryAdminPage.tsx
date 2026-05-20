import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DirectoryStatsDto } from "@gcba/shared";
import { api } from "../../lib/api";
import { Icon } from "../../components/Icon";
import { ConfirmDialog } from "../../components/ConfirmDialog";

function errMessage(err: unknown, fallback: string): string {
  const ax = err as { response?: { data?: { message?: string } } };
  return ax.response?.data?.message ?? fallback;
}

export function DirectoryAdminPage() {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statsQuery = useQuery({
    queryKey: ["directory", "stats"],
    queryFn: async () => (await api.get<DirectoryStatsDto>("/directory/stats")).data
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post<{ total: number; originalFilename: string }>("/directory/upload", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      return data;
    },
    onSuccess: (data) => {
      setNotice(`Base reemplazada: ${data.total} funcionarios cargados desde «${data.originalFilename}».`);
      setError(null);
      setPendingFile(null);
      setShowConfirm(false);
      if (fileRef.current) fileRef.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["directory", "stats"] });
    },
    onError: (err) => {
      setNotice(null);
      setError(errMessage(err, "No se pudo cargar el archivo."));
      setShowConfirm(false);
    }
  });

  const stats = statsQuery.data;
  const last = stats?.lastUpload;

  return (
    <section>
      <div className="page-header">
        <div className="page-header__copy">
          <h1 className="display-sm">Directorio GCBA</h1>
          <p className="lead page-header__lead">
            Base global de dotación. Se usa como reserva cuando una persona no está en la base del evento: en terminal
            figura como fuera de base de anotados.
          </p>
        </div>
      </div>

      {notice ? <p className="message-success">{notice}</p> : null}
      {error ? <p className="message-error">{error}</p> : null}

      <article className="card" style={{ marginTop: "1rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.25rem", marginTop: 0 }}>
          Estado actual
        </h2>
        {statsQuery.isLoading ? (
          <p className="page-state">Cargando…</p>
        ) : statsQuery.isError ? (
          <p className="message-error">No se pudo cargar el estado del directorio.</p>
        ) : (
          <>
            <p style={{ margin: "0.5rem 0", fontWeight: 700, fontSize: "1.1rem" }}>
              Total en directorio: {stats?.total ?? 0}
            </p>
            {last ? (
              <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>
                Última carga: {last.filename} · {new Date(last.createdAt).toLocaleString("es-AR")} · {last.uploadedBy}
              </p>
            ) : (
              <p style={{ margin: 0, color: "var(--on-surface-variant)" }}>Aún no se cargó ningún archivo.</p>
            )}
          </>
        )}
      </article>

      <article className="card" style={{ marginTop: "1.25rem" }}>
        <h2 className="display-sm" style={{ fontSize: "1.25rem", marginTop: 0 }}>
          Reemplazar base
        </h2>
        <p style={{ color: "var(--on-surface-variant)", marginTop: 0 }}>
          Subí un XLSX con columnas: MINISTERIO, AYN, NUM_DOC, LIT_PUESTO, DESC_REP, MAIL_LABORAL, MAIL_PERSONAL,
          MAIL_MIA, CUIL_SIN_GUIONES. La carga <strong>reemplaza por completo</strong> el directorio anterior.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            setNotice(null);
            setError(null);
            const file = e.target.files?.[0] ?? null;
            setPendingFile(file);
          }}
        />
        <div style={{ marginTop: "1rem" }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!pendingFile || uploadMutation.isPending}
            onClick={() => setShowConfirm(true)}
          >
            <Icon name="upload_file" />
            {uploadMutation.isPending ? "Subiendo…" : "Reemplazar base"}
          </button>
        </div>
      </article>

      <ConfirmDialog
        open={showConfirm}
        title="Reemplazar directorio GCBA"
        message="Esta acción borra todos los registros actuales del directorio y los reemplaza por el archivo seleccionado. ¿Continuar?"
        onCancel={() => setShowConfirm(false)}
        onConfirm={() => {
          if (pendingFile) uploadMutation.mutate(pendingFile);
        }}
      />
    </section>
  );
}
