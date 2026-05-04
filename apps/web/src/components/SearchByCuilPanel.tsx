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
    <section className="terminal-section card">
      <label className="label-md field-label" htmlFor="cuil-search">
        Consulta de identidad
      </label>
      <form
        className="search-cuil-form"
        onSubmit={handleSubmit((values) => {
          onSearch(values.cuil);
          reset();
        })}
      >
        <div className="search-cuil-form__input-wrap">
          <input
            id="cuil-search"
            autoFocus
            autoComplete="off"
            className="input cuil-mega"
            placeholder="CUIL / DNI"
            {...register("cuil")}
          />
          <div className="search-cuil-form__icon">
            <Icon name="search" style={{ fontSize: "2.5rem", color: "var(--secondary-container)" }} />
          </div>
        </div>
        <p className="search-cuil-form__hint">
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
