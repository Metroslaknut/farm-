import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import MyVideosPage from './MyVideosPage';
import UploadPage from './UploadPage';
import VideoFeedPage from './VideoFeedPage';
import VideoWatchPage from './VideoWatchPage';

/** Everything under /videos: vertical feed, upload, my videos, single-video page. */
export default function VideosApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          <Route index element={<VideoFeedPage />} />
          <Route path="upload" element={<UploadPage />} />
          <Route path="mine" element={<MyVideosPage />} />
          <Route path="watch/:id" element={<VideoWatchPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
