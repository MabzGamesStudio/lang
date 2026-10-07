import { Loader2, X } from 'lucide-react';
import { useApp } from '../state/AppContext';

// Background tasks (book imports, translations, audio...) with progress.
export default function JobsPanel({ langId, types }: { langId?: string | null; types?: string[] }) {
  const { jobs, cancelJob } = useApp();
  const visible = jobs
    .filter((job) => !langId || job.langId === langId || job.langId === null)
    .filter((job) => !types || types.some((type) => job.type.startsWith(type)))
    .slice(0, 6);
  if (visible.length === 0) return null;
  return (
    <div className="jobs">
      {visible.map((job) => {
        const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : null;
        return (
          <div key={job.id} className={`job job-${job.status}`}>
            <div className="job-head">
              {job.status === 'running' && <Loader2 size={16} className="spin" />}
              <strong>{job.title}</strong>
              <span className="muted">{job.status === 'running' ? (percent !== null ? `${percent}%` : '') : job.status}</span>
              {job.status === 'running' && (
                <button className="icon-button" title="Cancel" onClick={() => cancelJob(job.id)}>
                  <X size={14} />
                </button>
              )}
            </div>
            {job.status === 'running' && percent !== null && (
              <div className="bar">
                <span style={{ width: `${percent}%` }} />
              </div>
            )}
            <div className="job-message">{job.status === 'error' ? job.error : job.message}</div>
          </div>
        );
      })}
    </div>
  );
}
