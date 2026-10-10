// A small bar chart (levels, upcoming reviews, activity).
export default function Bars({ values, labels, className }: { values: number[]; labels: string[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className={`bars ${className ?? ''}`}>
      {values.map((value, index) => (
        <div key={labels[index]} className="bar-col" title={`${labels[index]}: ${value}`}>
          <span className="value">{value || ''}</span>
          <span className="fill" style={{ height: `${(value / max) * 100}%` }} />
          <span className="label">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}
