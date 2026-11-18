import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import BrowsePage from './BrowsePage';
import CheckoutPage from './CheckoutPage';
import ListingDetailPage from './ListingDetailPage';
import { FavoritesPage, MyOffersPage } from './ListsPages';
import MyOrdersPage from './MyOrdersPage';
import NegotiationPage from './NegotiationPage';
import OrderPage from './OrderPage';
import WalletPage from './WalletPage';
import { SellFarmsPage } from './SellPages';

/** Old `/market/sell/:farmId/...` links: a farm's selling now lives in My Farm (`/farms/:farmId/listings/...`). */
function ToFarmListings() {
  const { farmId = '', '*': rest = '' } = useParams();
  const { search } = useLocation();
  return <Navigate replace to={`/farms/${farmId}/listings${rest ? `/${rest}` : ''}${search}`} />;
}

/** Everything under /market: browse, favourites, offers, and the farm picker for selling. */
export default function MarketApp() {
  return (
    <Routes>
      {/* Browse uses the full screen width like the shop; the other market pages keep the reading width. */}
      <Route element={<PublicLayout wide />}>
        <Route element={<RequireSignIn />}>
          <Route index element={<BrowsePage />} />
        </Route>
      </Route>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          <Route path="listing/:id" element={<ListingDetailPage />} />
          <Route path="favorites" element={<FavoritesPage />} />
          <Route path="offers" element={<MyOffersPage />} />
          <Route path="offers/:id" element={<NegotiationPage />} />
          <Route path="checkout/:negotiationId" element={<CheckoutPage />} />
          <Route path="orders" element={<MyOrdersPage />} />
          <Route path="orders/:id" element={<OrderPage />} />
          <Route path="wallet" element={<WalletPage />} />
          <Route path="sell" element={<SellFarmsPage />} />
          <Route path="sell/:farmId/*" element={<ToFarmListings />} />
        </Route>
      </Route>
    </Routes>
  );
}
