export function Spinner({ label }: { label?: string }) {
  return (
    <>
      <span className="ds-spinner" aria-hidden="true" />
      {label && <span className="ds-sr-only">{label}</span>}
    </>
  );
}
