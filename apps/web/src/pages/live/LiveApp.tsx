import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import LiveHostPage from './LiveHostPage';
import LiveListPage from './LiveListPage';
import LiveViewerPage from './LiveViewerPage';

/** Everything under /live: what is on air, host controls, the viewer page. */
export default function LiveApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          <Route index element={<LiveListPage />} />
          <Route path="host" element={<LiveHostPage />} />
          <Route path=":id" element={<LiveViewerPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
