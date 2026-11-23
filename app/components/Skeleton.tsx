interface Props {
  lines?: number;
  label?: string;
}

export default function Skeleton({ lines = 3, label = "Loading" }: Props) {
  return (
    <div className="pp-skeleton" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="pp-skeleton-line" />
      ))}
    </div>
  );
}
