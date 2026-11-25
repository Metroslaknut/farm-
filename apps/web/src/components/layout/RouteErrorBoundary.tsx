import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Card } from '../ui';
import { useT } from '../../i18n';

function PageErrorFallback({ onRetry }: { onRetry: () => void }) {
  const t = useT('layout');
  return (
    <div role="alert">
      <Card title={t('pageError.title')} headingLevel={1}>
        <p>{t('pageError.body')}</p>
        <p>
          <Button onClick={onRetry}>{t('pageError.retry')}</Button>{' '}
          <Link to="/">{t('pageError.home')}</Link>
        </p>
      </Card>
    </div>
  );
}

interface BoundaryProps {
  resetKey: string;
  children: ReactNode;
}

interface BoundaryState {
  failedAt: string | null;
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failedAt: null };

  static getDerivedStateFromError(): Partial<BoundaryState> {
    // No props here: getDerivedStateFromProps (which runs next) records the path that failed.
    return { failedAt: '' };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState) {
    // Remember where the page broke; navigating to another path clears the error.
    if (state.failedAt === '') return { failedAt: props.resetKey };
    if (state.failedAt !== null && state.failedAt !== props.resetKey) return { failedAt: null };
    return null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page crashed', error, info.componentStack);
  }

  /** Renders the page again (a passing problem, e.g. data that has loaded since); it shows this again if it fails. */
  retry = () => this.setState({ failedAt: null });

  override render() {
    return this.state.failedAt !== null ? (
      <PageErrorFallback onRetry={this.retry} />
    ) : (
      this.props.children
    );
  }
}

/**
 * Wraps a layout's <Outlet />: a page that throws while rendering shows a short message inside the
 * layout (header and menu still work) instead of blanking the whole app. Leaving the page resets it.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
