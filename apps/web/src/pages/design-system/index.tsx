import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import DesignSystemPreview from './DesignSystemPreview';

/** Everything under /design-system, in one lazy chunk (layout + tokens + components). */
export default function DesignSystemRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<DesignSystemPreview />} />
      </Route>
    </Routes>
  );
}
