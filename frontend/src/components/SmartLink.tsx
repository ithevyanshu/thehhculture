import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Router link for site paths ("/shows/legacy"), new-tab anchor for outside URLs. */
export function SmartLink({ href, className, children, tabIndex }: { href: string; className?: string; children: ReactNode; tabIndex?: number }) {
  return href.startsWith('/') ? (
    <Link to={href} className={className} tabIndex={tabIndex}>
      {children}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noreferrer" className={className} tabIndex={tabIndex}>
      {children}
    </a>
  );
}
