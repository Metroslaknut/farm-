import { Route, Routes } from 'react-router-dom';
import { PublicLayout } from '../../app/layouts/PublicLayout';
import RequireSignIn from '../farms/RequireSignIn';
import ShopBrowsePage from './BrowsePage';
import CartPage from './CartPage';
import ProductPage from './ProductPage';
import { ProductFormPage, SellFarmsPage, SellProductsPage } from './SellPages';

/** Everything under /shop: browse, product pages, cart and checkout, and the seller's product tools. */
export default function ShopApp() {
  return (
    <Routes>
      {/* Browse uses the full screen width; the other shop pages keep the reading width. */}
      <Route element={<PublicLayout wide />}>
        <Route element={<RequireSignIn />}>
          <Route index element={<ShopBrowsePage />} />
        </Route>
      </Route>
      <Route element={<PublicLayout />}>
        <Route element={<RequireSignIn />}>
          <Route path="product/:id" element={<ProductPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="sell" element={<SellFarmsPage />} />
          <Route path="sell/:farmId" element={<SellProductsPage />} />
          <Route path="sell/:farmId/new" element={<ProductFormPage />} />
          <Route path="sell/:farmId/:id" element={<ProductFormPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
