import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  /** Texto exacto que el usuario debe escribir para habilitar el botón de confirmar. */
  requiredText: string;
  /** Etiqueta amigable para mostrar al usuario qué debe escribir (por defecto, el `requiredText`). */
  requiredTextLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
  /** Si es true, ignora mayúsculas / minúsculas y espacios al comparar. */
  caseInsensitive?: boolean;
};

/** Modal de confirmación que exige escribir un texto exacto antes de habilitar el botón confirmar. */
export function ConfirmTypeDialog({
  open,
  title,
  message,
  requiredText,
  requiredTextLabel,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmar",
  danger = false,
  caseInsensitive = false
}: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!open) setValue("");
  }, [open]);

  if (!open) return null;

  const normalize = (s: string) => (caseInsensitive ? s.trim().toLowerCase() : s.trim());
  const matches = normalize(value) === normalize(requiredText) && requiredText.trim().length > 0;
  const label = requiredTextLabel ?? requiredText;

  return (
    <div className="modal-backdrop">
      <div className="modal card" style={{ width: "min(560px, 95vw)" }}>
        <h3>{title}</h3>
        <p style={{ whiteSpace: "pre-line" }}>{message}</p>
        <p style={{ marginTop: "0.75rem", color: "var(--on-surface-variant)" }}>
          Para confirmar, escribí exactamente: <strong>{label}</strong>
        </p>
        <input
          autoFocus
          type="text"
          className="input"
          value={value}
          placeholder={label}
          onChange={(e) => setValue(e.target.value)}
          style={{ width: "100%", marginTop: "0.5rem" }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches) onConfirm();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="row gap" style={{ marginTop: "1rem", justifyContent: "flex-end" }}>
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            className={`btn ${danger ? "btn-secondary" : "btn-primary"}`}
            type="button"
            style={danger ? { color: "var(--error)", borderColor: "var(--error)" } : undefined}
            disabled={!matches}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
