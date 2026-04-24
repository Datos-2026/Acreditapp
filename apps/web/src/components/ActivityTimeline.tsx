type Item = {
  id: string;
  action: string;
  createdAt: string;
  user?: { name?: string | null } | null;
};

type Props = {
  items: Item[];
};

export function ActivityTimeline({ items }: Props) {
  return (
    <section className="card">
      <h3 className="display-sm" style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Actividad y auditoría
      </h3>
      <ul className="timeline">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.action}</strong> — {item.user?.name ?? "Sistema"} —{" "}
            {new Date(item.createdAt).toLocaleString("es-AR")}
          </li>
        ))}
      </ul>
    </section>
  );
}
