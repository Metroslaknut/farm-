---
name: frontend-optimization
description: Optimize Farm+ React 19 and Vite frontend performance, including rendering, API fetching, state management, route loading, bundle size, caching and memory leaks without changing existing UI or UX.
---

# Farm+ Frontend Optimization

## Role

Act as a Senior React and Frontend Performance Engineer.

Follow CLAUDE.md and existing application architecture.

## Architecture

- React 19.
- TypeScript.
- Vite.
- React Router.
- Shared API client: @farmplus/api-client.
- Shared validation: @farmplus/validation.
- Shared translations: @farmplus/i18n.
- Web app: apps/web.
- Mobile app: apps/mobile.

## Core Principle

Improve performance without changing the existing UI/UX.

Never modify:

- Layout.
- CSS.
- Colors.
- Spacing.
- Typography.
- Component appearance.
- Navigation behavior.
- Responsive design.

Unless explicitly requested.

## 1. API Fetching Optimization

Identify:

- Duplicate API requests.
- Unnecessary component-level fetching.
- Sequential requests without dependencies.
- Repeated fetching during route transitions.
- Unnecessary refetching after returning to a page.

Prefer existing shared data-fetching mechanisms.

Evaluate TanStack Query only if the existing architecture lacks an appropriate solution and the change is approved.

Do not introduce another state-management library unnecessarily.

## 2. Shared Data Management

Inspect shared data:

- Current user.
- Farm information.
- Animal types.
- Product categories.
- Cart.
- Notifications.
- Chat unread count.

Avoid loading the same data independently in multiple components.

Define appropriate cache lifetimes and invalidation behavior.

Ensure sensitive or user-specific data is not shared across accounts.

## 3. Farm Dashboard Optimization

Prioritize:

- /farms/me
- /farms/:id
- /farms/:id/summary

Inspect the entire data-loading sequence.

Reduce unnecessary dependency chains.

Load independent requests concurrently.

Avoid duplicate component mount requests.

Use partial rendering only when it preserves existing visual behavior.

Verify dashboard values remain accurate.

## 4. React Rendering

Inspect:

- Unnecessary re-renders.
- Expensive calculations.
- Large lists.
- Unstable callback references.
- Repeated derived data calculations.
- Component mount/unmount behavior.

Use:

- React.memo.
- useMemo.
- useCallback.

Only where profiling indicates meaningful benefits.

Avoid excessive memoization.

## 5. Bundle Optimization

Inspect Vite build output.

Evaluate:

- Route-based code splitting.
- React.lazy.
- Dynamic imports.
- Translation loading.
- Admin-only code.
- Validation library imports.
- Duplicate dependencies.
- Font loading.

Load only required language resources.

Preserve identical Thai and English translation keys.

Follow existing i18n architecture.

Do not break admin translations.

## 6. Socket.IO and Polling

Inspect connection lifecycle.

Ensure:

- Connections are not unnecessarily recreated.
- Event listeners are cleaned up.
- Duplicate listeners are prevented.
- Polling pauses when the page is hidden where appropriate.
- Reconnection does not trigger unnecessary full-page refetches.

Preserve realtime functionality.

## 7. Media Optimization

Inspect:

- Image lazy loading.
- Video metadata loading.
- HLS loading.
- Large media lists.
- Feed rendering.

Avoid loading expensive video resources before necessary.

Preserve playback behavior.

## 8. Memory and Lifecycle

Check:

- Memory leaks.
- Uncleaned subscriptions.
- Timers.
- Event listeners.
- Socket listeners.
- Aborted requests.
- Stale async responses.

Clean up effects correctly.

## 9. Frontend Testing

Run relevant tests.

Examples:

```bash
cd apps/web
npx vitest run test/home.test.tsx

cd apps/web
npx tsc -p tsconfig.json --noEmit
```

Check:

- Page rendering.
- Navigation.
- API request count.
- Loading states.
- Empty states.
- Error states.
- Responsive behavior.
- UI regression.

## 10. Final Report

Report:

- Components modified.
- API requests removed or consolidated.
- Bundle size before/after.
- Rendering improvements.
- Tests executed.
- UI regression status.
- Remaining bottlenecks.

Never claim performance improvements without evidence.
