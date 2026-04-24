import { useForm } from "react-hook-form";
import { Icon } from "./Icon";

type Props = {
  onSearch: (cuil: string) => void;
};

type FormValues = {
  cuil: string;
};

export function SearchByCuilPanel({ onSearch }: Props) {
  const { register, handleSubmit, reset } = useForm<FormValues>();
  return (
    <section className="terminal-section">
      <label className="label-md" htmlFor="cuil-search" style={{ display: "block", marginBottom: "0.75rem" }}>
        Consulta de identidad
      </label>
      <form
        onSubmit={handleSubmit((values) => {
          onSearch(values.cuil);
          reset();
        })}
      >
        <div style={{ position: "relative" }}>
          <input
            id="cuil-search"
            autoFocus
            autoComplete="off"
            className="input cuil-mega"
            placeholder="CUIL / DNI"
            {...register("cuil")}
          />
          <div style={{ position: "absolute", right: 0, bottom: "1.5rem", pointerEvents: "none" }}>
            <Icon name="search" style={{ fontSize: "2.5rem", color: "var(--secondary-container)" }} />
          </div>
        </div>
        <p style={{ color: "var(--on-surface-variant)", fontSize: "0.9375rem", fontStyle: "italic", margin: "0.75rem 0 1.25rem" }}>
          Ingresá el documento para iniciar el proceso de acreditación en tiempo real. Enter para buscar.
        </p>
        <button className="btn btn-secondary" type="submit">
          <Icon name="manage_search" />
          Buscar
        </button>
      </form>
    </section>
  );
}
