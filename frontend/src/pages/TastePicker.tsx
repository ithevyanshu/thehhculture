import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../lib/api';
import { useArtists, useGenres, useRegions } from '../lib/queries';
import { Artwork } from '../components/Artwork';
import { Spinner } from '../components/ui';
import type { User } from '../lib/types';

function toggle(list: string[], v: string) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/**
 * Shared taste editor used by onboarding (with artist picks) and settings.
 */
export function TastePicker({ mode }: { mode: 'onboarding' | 'settings' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const genres = useGenres();
  const regions = useRegions();
  const artists = useArtists({ sort: 'popular', limit: 18 });

  const [genreSlugs, setGenres] = useState<string[]>([]);
  const [regionSlugs, setRegions] = useState<string[]>([]);
  const [artistSlugs, setArtists] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    setGenres(user.favoriteGenres.map((g) => g.slug));
    setRegions(user.favoriteRegions.map((r) => r.slug));
  }, [user]);

  const save = async () => {
    setSaving(true);
    try {
      const { user: updated } = await api<{ user: User }>('/me/preferences', {
        method: 'PUT',
        body: { genreSlugs, regionSlugs, followArtistSlugs: mode === 'onboarding' ? artistSlugs : undefined },
      });
      setUser(updated);
      await qc.invalidateQueries();
      if (mode === 'onboarding') navigate('/', { replace: true });
      else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (genres.isLoading || regions.isLoading) return <Spinner />;

  return (
    <div className="space-y-10">
      <section>
        <h2 className="display text-3xl">What do you bump?</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Pick the sounds you like. We'll surface more of them.</p>
        <div className="flex flex-wrap gap-2">
          {genres.data?.items.map((g) => {
            const on = genreSlugs.includes(g.slug);
            return (
              <button key={g.slug} onClick={() => setGenres(toggle(genreSlugs, g.slug))} className={`chip !px-4 !py-2 !text-sm ${on ? 'chip-active' : ''}`} aria-pressed={on}>
                {on && <Check size={14} />} {g.name}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="display text-3xl">Rep your city</h2>
        <p className="mt-1 mb-4 text-sm text-muted">Which scenes do you want to hear from?</p>
        <div className="flex flex-wrap gap-2">
          {regions.data?.items.map((r) => {
            const on = regionSlugs.includes(r.slug);
            return (
              <button key={r.slug} onClick={() => setRegions(toggle(regionSlugs, r.slug))} className={`chip !px-4 !py-2 !text-sm ${on ? 'chip-active' : ''}`} aria-pressed={on}>
                {on && <Check size={14} />} {r.name}
              </button>
            );
          })}
        </div>
      </section>

      {mode === 'onboarding' && (
        <section>
          <h2 className="display text-3xl">Follow some artists</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Their new drops will land at the top of your home screen.</p>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {artists.data?.items.map((a) => {
              const on = artistSlugs.includes(a.slug) || a.isFollowing;
              return (
                <button key={a.slug} onClick={() => setArtists(toggle(artistSlugs, a.slug))} className="group text-center" aria-pressed={on}>
                  <div className={`relative rounded-full p-1 transition ${on ? 'bg-saffron' : 'bg-transparent group-hover:bg-line'}`}>
                    <Artwork src={a.imageUrl} name={a.name} seed={a.slug} round />
                    {on && (
                      <span className="absolute right-1 bottom-1 grid size-7 place-items-center rounded-full bg-saffron text-ink">
                        <Check size={16} />
                      </span>
                    )}
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{a.name}</p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex items-center gap-4">
        <button onClick={save} className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : mode === 'onboarding' ? "Let's go" : 'Save taste'}
        </button>
        {mode === 'onboarding' && (
          <button onClick={() => navigate('/')} className="text-sm text-muted hover:text-bone">
            Skip for now
          </button>
        )}
        {saved && <span className="text-sm text-saffron-soft">Saved - your home feed has been updated.</span>}
      </div>
    </div>
  );
}

export function OnboardingPage() {
  const { user } = useAuth();
  return (
    <div className="mx-auto max-w-4xl py-4">
      <span className="sticker">Step 1 of 1</span>
      <h1 className="display mt-4 text-5xl md:text-7xl">
        Welcome, <span className="text-saffron">{user?.displayName}</span>
      </h1>
      <p className="mt-3 mb-10 max-w-xl text-muted">Tell us what you're into and we'll build a home screen around it. You can change this anytime in settings.</p>
      <TastePicker mode="onboarding" />
    </div>
  );
}
