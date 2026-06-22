type Props = {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function ToggleField({ id, label, description, checked, onChange, disabled }: Props) {
  return (
    <div className="toggle-field">
      <label className="toggle-field__label" htmlFor={id}>
        <span className="toggle-field__text">
          <span className="toggle-field__title">{label}</span>
          {description ? <span className="toggle-field__desc">{description}</span> : null}
        </span>
        <span className="toggle-field__switch-wrap">
          <input
            id={id}
            type="checkbox"
            className="toggle-field__input"
            role="switch"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="toggle-field__track" aria-hidden />
        </span>
      </label>
    </div>
  );
}
