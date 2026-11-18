import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import MessagesPage from './MessagesPage';
import NotificationsPage from './NotificationsPage';

/** `/notifications` and `/messages` — both need a signed-in user; the API checks every request again. */
export default function InboxApp({ area }: { area: 'notifications' | 'messages' }) {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          {area === 'notifications' ? (
            <Route index element={<NotificationsPage />} />
          ) : (
            <>
              <Route index element={<MessagesPage />} />
              <Route path=":conversationId" element={<MessagesPage />} />
            </>
          )}
        </Route>
      </Route>
    </Routes>
  );
}
