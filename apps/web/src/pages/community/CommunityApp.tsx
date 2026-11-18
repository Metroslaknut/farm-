import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import FeedPage from './FeedPage';
import PostDetailPage from './PostDetailPage';
import ProfilePage from './ProfilePage';

/** Everything under /community: the social feed for signed-in members (design-system layout). */
export default function CommunityApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          <Route index element={<FeedPage />} />
          <Route path="posts/:id" element={<PostDetailPage />} />
          <Route path="users/:id" element={<ProfilePage />} />
        </Route>
      </Route>
    </Routes>
  );
}
