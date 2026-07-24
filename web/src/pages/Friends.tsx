import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { ItemCard } from '../components/ItemCard';
import { Empty, formatDate, useToast } from '../components/ui';
import type { FriendEntry, Item, PendingRequest, PublicUser } from '../types';

export function Friends() {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [incoming, setIncoming] = useState<PendingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<PendingRequest[]>([]);
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState<PublicUser[]>([]);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const response = await api.friends();
      setFriends(response.friends);
      setIncoming(response.requests.incoming);
      setOutgoing(response.requests.outgoing);
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (handle.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .searchPeople(handle.trim())
        .then((response) => setFound(response.users))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [handle]);

  async function act(action: Promise<unknown>, message: string) {
    try {
      await action;
      showToast(message);
      await load();
    } catch (error) {
      showToast((error as Error).message, 'error');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Friends</h1>
          <p>
            See what people you know are keeping. They see only what you have marked as shared —
            per item, on top of your library-wide setting.
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>Find someone</h2>
        <div className="hint">Search by handle or name.</div>
        <input
          type="search"
          placeholder="@handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
        {found.length > 0 ? (
          <div className="list" style={{ marginTop: 12 }}>
            {found.map((user) => (
              <div className="row" key={user.id}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{user.displayName}</div>
                  <div className="muted">@{user.handle}</div>
                </div>
                <button
                  className="btn small"
                  onClick={() => act(api.addFriend(user.handle), `Request sent to @${user.handle}`)}
                >
                  Add friend
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {incoming.length > 0 ? (
        <div className="panel">
          <h2>Requests for you</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {incoming.map((request) => (
              <div className="row" key={request.friendshipId}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{request.user.displayName}</div>
                  <div className="muted">@{request.user.handle}</div>
                </div>
                <button
                  className="btn primary small"
                  onClick={() =>
                    act(api.acceptFriend(request.friendshipId), 'You are now friends')
                  }
                >
                  Accept
                </button>
                <button
                  className="btn danger small"
                  onClick={() => act(api.removeFriend(request.friendshipId), 'Request declined')}
                >
                  Decline
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {outgoing.length > 0 ? (
        <div className="panel">
          <h2>Waiting on them</h2>
          <div className="list" style={{ marginTop: 12 }}>
            {outgoing.map((request) => (
              <div className="row" key={request.friendshipId}>
                <div className="grow">
                  <div className="muted">@{request.user.handle}</div>
                </div>
                <button
                  className="btn ghost small"
                  onClick={() => act(api.removeFriend(request.friendshipId), 'Request withdrawn')}
                >
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>Your friends</h2>
        {friends.length === 0 ? (
          <div className="hint">Nobody yet. Search above to send the first request.</div>
        ) : (
          <div className="list" style={{ marginTop: 12 }}>
            {friends.map((friend) => (
              <div className="row" key={friend.friendshipId}>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{friend.user.displayName}</div>
                  <div className="muted">@{friend.user.handle} · since {formatDate(friend.since)}</div>
                </div>
                <Link className="btn small" to={`/friends/${friend.user.handle}`}>
                  View library
                </Link>
                <button
                  className="btn danger small"
                  onClick={() => act(api.removeFriend(friend.friendshipId), 'Friend removed')}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {toast}
    </>
  );
}

export function FriendLibrary() {
  const { handle = '' } = useParams();
  const [items, setItems] = useState<Item[]>([]);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api
      .friendLibrary(handle, query ? { q: query } : {})
      .then((response) => {
        if (cancelled) return;
        setUser(response.user);
        setItems(response.items);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, query]);

  if (error) {
    return (
      <>
        <div className="page-head">
          <h1>@{handle}</h1>
        </div>
        <Empty icon="🔒" title="Not shared with you" hint={error} />
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{user?.displayName ?? handle}</h1>
          <p>
            @{handle} · showing what they have chosen to share ({items.length} item
            {items.length === 1 ? '' : 's'}).
          </p>
        </div>
        <Link className="btn" to="/friends">
          Back to friends
        </Link>
      </div>

      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search their library…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <Empty icon="📭" title="Nothing shared yet" />
      ) : (
        <div className="grid">
          {items.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
