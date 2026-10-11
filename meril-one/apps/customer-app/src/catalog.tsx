import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, useAuth } from '@meril-one/shared';
import type { Category, Service } from '@meril-one/shared';

// The services offered to this customer's background, loaded once and
// reloaded when the background changes.
interface CatalogState {
  categories: Category[];
  slots: string[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  findService: (id: number) => { service: Service; category: Category } | null;
}
const Ctx = createContext<CatalogState | null>(null);
export const useCatalog = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCatalog outside CatalogProvider');
  return c;
};

export function CatalogProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [categories, setCategories] = useState<Category[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await api.get<{ data: Category[]; slots: string[] }>('/catalog');
      setCategories(r.data); setSlots(r.slots);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload, user?.segment]);

  const findService = (id: number) => {
    for (const category of categories) {
      const service = category.services.find((s) => s.id === id);
      if (service) return { service, category };
    }
    return null;
  };

  return <Ctx.Provider value={{ categories, slots, loading, error, reload, findService }}>{children}</Ctx.Provider>;
}
