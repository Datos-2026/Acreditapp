import { useEffect, useRef } from "react";

type Props = {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  danger?: boolean;
};

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirmar",
  danger = false
}: Props) {
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  /**
   * Atajos de teclado:
   * - Enter dentro del diálogo → confirma.
   * - Escape → cancela.
   * El listener se registra con un pequeño retraso para no atrapar el mismo
   * Enter que abrió el diálogo (cuando el usuario lo apretó en otro input).
   */
  useEffect(() => {
    if (!open) return;
    let registered = false;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    const armId = setTimeout(() => {
      registered = true;
      window.addEventListener("keydown", handler);
      confirmBtnRef.current?.focus();
    }, 60);
    return () => {
      clearTimeout(armId);
      if (registered) window.removeEventListener("keydown", handler);
    };
  }, [open, onConfirm, onCancel]);

  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal card" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        <p>{message}</p>
        <p style={{ color: "var(--on-surface-variant)", fontSize: "0.8rem", marginTop: "0.25rem" }}>
          Enter para confirmar · Esc para cancelar.
        </p>
        <div className="row gap">
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            ref={confirmBtnRef}
            className={`btn ${danger ? "btn-secondary" : "btn-primary"}`}
            type="button"
            style={danger ? { color: "var(--error)", borderColor: "var(--error)" } : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
