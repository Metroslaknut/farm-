import type { ReactNode } from 'react';
import { Container } from './Container';

export function Footer({ children }: { children: ReactNode }) {
  return (
    <footer className="ds-footer">
      <Container>{children}</Container>
    </footer>
  );
}
