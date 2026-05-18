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
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div className="modal card">
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="row gap">
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
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
