import { MEDIA_ICONS, STATUS_LABELS, type Item } from '../types';

const VISIBILITY_HINT: Record<string, string> = {
  private: '🔒',
  friends: '👥',
  public: '🌍',
};

export function ItemCard({ item, onClick }: { item: Item; onClick?: () => void }) {
  return (
    <article
      className={`card ${item.deletedAt ? 'removed' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="cover">
        {item.coverUrl ? (
          <img
            src={item.coverUrl}
            alt=""
            loading="lazy"
            onError={(event) => {
              // Cover art is a nicety; a dead link should not leave a broken image.
              (event.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <span>{MEDIA_ICONS[item.mediaType]}</span>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">{item.title}</div>
        {item.creators ? <div className="card-sub">{item.creators}</div> : null}
        <div className="card-meta">
          <span>{item.year ?? MEDIA_ICONS[item.mediaType]}</span>
          {item.rating ? <span className="rating">★ {item.rating}</span> : null}
          <span style={{ marginLeft: 'auto' }} title={`Visible to: ${item.visibility}`}>
            {VISIBILITY_HINT[item.visibility]}
          </span>
        </div>
        <div className="card-meta">
          <span className="badge">{STATUS_LABELS[item.status]}</span>
          {item.deletedAt ? <span className="badge danger">Removed</span> : null}
        </div>
      </div>
    </article>
  );
}
