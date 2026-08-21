import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSession } from '../session';
import { THEME_PREFERENCES, useTheme, type ThemePreference } from '../theme';
import { formatDateTime, useToast } from '../components/ui';
import { VISIBILITIES, type ItemEvent, type Visibility } from '../types';

const VISIBILITY_COPY: Record<Visibility, string> = {
  private: 'Only me — friends included',
  friends: 'Friends can see items shared with friends',
  public: 'Anyone signed in can see items marked public',
};

const THEME_COPY: Record<ThemePreference, { icon: string; label: string; hint: string }> = {
  system: {
    icon: '🖥',
    label: 'System',
    hint: 'Following your device — it changes when your device does.',
  },
  light: { icon: '☀', label: 'Light', hint: 'Always light, whatever your device is set to.' },
  dark: { icon: '☾', label: 'Dark', hint: 'Always dark, whatever your device is set to.' },
};

export function Settings() {
  const { me, setMe } = useSession();
  const { preference, setPreference } = useTheme();
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [visibility, setVisibility] = useState<Visibility>(me?.libraryVisibility ?? 'friends');
  const [events, setEvents] = useState<ItemEvent[]>([]);
  const [toast, showToast] = useToast();

  useEffect(() => {
    void api
      .activity(40)
      .then((response) => setEvents(response.events))
      .catch(() => setEvents([]));
  }, []);

  async function save() {
    try {
      const { user } = await api.updateProfile({ displayName, libraryVisibility: visibility });
      setMe(user);
      showToast('Settings saved');
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Who you are here, and how much of your library other people can reach.</p>
        </div>
      </div>

      <div className="panel">
        <h2>Profile</h2>
        <div className="hint">Your handle (@{me?.handle}) is how friends find you.</div>
        <div className="field">
          <label htmlFor="settings-name">Display name</label>
          <input
            id="settings-name"
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="settings-visibility">Library visibility</label>
          <select
            id="settings-visibility"
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as Visibility)}
          >
            {VISIBILITIES.map((option) => (
              <option key={option} value={option}>
                {VISIBILITY_COPY[option]}
              </option>
            ))}
          </select>
          <span className="muted-note">
            This is the outer gate. Each item still has its own setting, and the stricter of the two
            wins.
          </span>
        </div>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="hint">{THEME_COPY[preference].hint}</div>
        <div className="segmented" role="group" aria-label="Colour theme">
          {THEME_PREFERENCES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preference === option}
              onClick={() => setPreference(option)}
            >
              <span aria-hidden="true">{THEME_COPY[option].icon}</span>
              {THEME_COPY[option].label}
            </button>
          ))}
        </div>
        <div className="muted-note" style={{ marginTop: 10 }}>
          Kept in this browser rather than on your account, so each device can differ.
        </div>
      </div>

      <div className="panel">
        <h2>Everything that has happened</h2>
        <div className="hint">
          Every change to your library is recorded and kept. If something ever goes missing, this is
          where you find out when and how.
        </div>
        <div className="list">
          {events.length === 0 ? (
            <span className="muted-note">Nothing yet.</span>
          ) : (
            events.map((event) => (
              <div className="row" key={event.id}>
                <span className="badge">{event.kind}</span>
                <span className="grow">
                  {typeof event.payload.title === 'string' ? event.payload.title : event.itemId}
                </span>
                <span className="muted">{formatDateTime(event.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {toast}
    </>
  );
}
