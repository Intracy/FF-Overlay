import { createContext, useContext } from 'react';

// Wer ist angemeldet und mit welcher Rolle? (aus /api/auth/me, Rolle kommt aus dem FrankenFinals-Broadcast-Portal)

export type Role = 'operator' | 'editor' | 'admin';
export interface Me {
  authenticated: boolean;
  authRequired: boolean;
  user: { name: string; email: string | null; role: Role; roleLabel: string; via: 'password' | 'portal' | 'open' } | null;
  portalUrl: string | null;
  portalLogin: string | null;
  passwordLogin: boolean;
}

const RANK: Record<Role, number> = { operator: 1, editor: 2, admin: 3 };
export const atLeast = (role: Role | undefined, min: Role) => !!role && RANK[role] >= RANK[min];

export const SessionContext = createContext<Me | null>(null);
export const useSession = () => useContext(SessionContext);
export const useRole = (): Role => useContext(SessionContext)?.user?.role ?? 'admin';

/** FF-Wappen wie im Portal */
export function FFLogo({ size = 19 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M11.97 0.00 L4.83 1.75 L1.89 15.54 L12.00 23.99 L22.10 15.52 L19.15 1.74Z M11.96 2.67 L16.96 3.89 L19.23 14.51 L12.00 20.60 L4.75 14.55 L7.03 3.88Z M12.03 5.29 L8.47 6.16 L7.02 12.98 L12.07 17.20 L17.11 12.96 L15.65 6.16Z M12.06 7.06 L14.19 7.60 L15.19 12.28 L12.06 14.95 L8.92 12.31 L9.93 7.59Z"
      />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="logo"><FFLogo /></span>
      <span className="brand-name"><b>Frankenfinals</b><span>Overlay</span></span>
    </div>
  );
}
