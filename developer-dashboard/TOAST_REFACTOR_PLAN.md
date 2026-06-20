# Implementation Plan

[Overview]
Refactor the developer-dashboard toast/notification architecture from locally-mounted per-view components to a single globally-mounted provider at the React composition root (main.tsx). This ensures notifications persist across route redirects and survive component unmounting during auth flow transitions (e.g., Signup → Login).

The solution leverages the existing `sonner` v2.0.7 library with custom toast components to meet the required visualspecification (white background, black text, colored icons) and behavioral requirements (queue limiting to 3, manual dismissal on all variants).

[Types]

### ToastVariant Enum
```typescript
type ToastVariant = 'success' | 'telemetry' | 'error';
```

### ToastOptions Interface
```typescript
interface ToastOptions {
  variant: ToastVariant;
  message: string;
  duration?: number; // ms, default: 3000
  dismissible?: boolean; // default: true
  id?: string; // optional custom ID for manual dismissal
}
```

### ToastContext Value
```typescript
interface ToastContextValue {
  showToast: (options: ToastOptions) => string | undefined;
  dismissToast: (id: string) => void;
  dismissAll: () => void;
  success: (message: string, options?: Partial<ToastOptions>) => string | undefined;
  error: (message: string, options?: Partial<ToastOptions>) => string | undefined;
  telemetry: (message: string, options?: Partial<ToastOptions>) => string | undefined;
}
```

### Custom Toast Component Props (via sonner custom component)
```typescript
interface CustomToastProps {
  message: string;
  variant?: ToastVariant;
  iconColor?: string; // colored icon per variant
  onDismiss?: () => void;
}
```

[Files]

### New Files to Create

1. **`developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`**
   - React context provider wrapping sonner's Toaster
   - Implements max 3 toast queue limiting
   - Exports toast API (success, error, telemetry methods)
   - Registers global custom toast component with white bg/black text/styled icons

2. **`developer-dashboard/src/infrastructure/notifications/customToast.css`**
   - CSS for custom toast card styling
   - White background, black text, colored icon classes
   - Close button (X) styles for manual dismissal

### Existing Files to Modify

1. **`developer-dashboard/src/main.tsx`**
   - Import and mount `<ToastProvider>` as highest-level provider inside `<BrowserRouter>`
   - Remove Toaster from App.tsx (it will be rendered by ToastProvider)

2. **`developer-dashboard/src/App.tsx`**
   - Remove all `<Toaster position="top-center" theme="dark" />` occurrences from every route block
   - Import and use toast API from ToastProvider for programmatic notifications
   - No functional changes to routing/logic - only removal of local Toaster components

3. **`developer-dashboard/src/infrastructure/notifications/toastUtils.ts`**
   - Update imports to use new ToastProvider context
   - Keep utility function signatures for backward compatibility
   - Optionally delegate to new context under the hood

4. **`developer-dashboard/src/components/SignupForm.tsx`** (if applicable)
   - Replace any toast imports/usage with ToastProvider context
   - Ensure success toast persists after route redirect

### Files to Delete
None.

[Functions]

### New Functions

1. **`ToastProvider.tsx: showToast(options: ToastOptions): string`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Purpose: Main toast display function with queue management
   - Implements max 3 concurrent toast limit using sonner's `limit` option
   - Returns toast ID for manual dismissal

2. **`ToastProvider.tsx:dismissToast(id: string): void`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Purpose: Manually dismiss specific toast by ID

3. **`ToastProvider.tsx:dismissAll(): void`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Purpose: Dismiss all active toasts

4. **`ToastProvider.tsx:success(message, options?): string`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Convenience wrapper: shows success toast with green icon

5. **`ToastProvider.tsx:error(message, options?): string`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Convenience wrapper: shows error toast with red icon

6. **`ToastProvider.tsx:telemetry(message, options?): string`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Convenience wrapper: shows telemetry toast with black/monochrome icon

7. **`CustomToast Component (inline in ToastProvider)`**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Custom sonner component: white bg, black text, colored icon, X dismiss button

### Modified Functions

1. **`toastUtils.ts:showAsyncToastPromise<T>(...)`**
   - Location: `developer-dashboard/src/infrastructure/notifications/toastUtils.ts`
   - Changes: Update to use new ToastProvider context instead of direct sonner import

2. **`toastUtils.ts:showSuccessToast(message, duration?)`**
   - Location: `developer-dashboard/src/infrastructure/notifications/toastUtils.ts`
   - Changes: Delegate to ToastProvider.success()

3. **`toastUtils.ts:showErrorToast(message, duration?)`**
   - Location: `developer-dashboard/src/infrastructure/notifications/toastUtils.ts`
   - Changes: Delegate to ToastProvider.error()

4. **`toastUtils.ts:showInfoToast(message, duration?)`**
   - Location: `developer-dashboard/src/infrastructure/notifications/toastUtils.ts`
   - Changes: Delegate to ToastProvider.telemetry()

### Removed Functions
None.

[Classes]

### New Classes

1. **`ToastProvider (React Context Provider Component)**
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Key methods: Renders `<Toaster>` with custom config, exposes context value
   - Uses React Context API (createContext, useContext)
   - Wraps children via React.Provider

2. **`CustomToast (React Component - passed to sonner)** 
   - Location: `developer-dashboard/src/infrastructure/notifications/ToastProvider.tsx`
   - Renders: White card, black text, icon via variant, X close button
   - Uses inline SVGs for icons

### Modified Classes
None.

[Dependencies]

### No New Dependencies Required
- `sonner` v2.0.7 already installed
- `react` v19.2.5 already installed
- All required functionality (limit, custom components) available via existing sonner API

### Integration Requirements
- Ensure sonner custom component API is compatible with v2.0.7
- Confirm all icon SVGs render correctly with Tailwind classes

[Testing]

### Test File Requirements
1. Create `developer-dashboard/src/__tests__/toast.test.tsx` if testing infrastructure exists
2. Verify toast displays across route transitions
3. Verify queue limiting (max 3) works
4. Verify manual dismissal works for all variants

### Existing Test Modifications
None required - current tests should pass as-is after refactor.

### Validation Strategies
1. Manual testing: Signup → redirect → verify toast persists
2. Console: Check for React key warnings during rapid toast firing
3. Visual: Verify white bg/black text on all toast variants

[Implementation Order]

1. **Step 1:** Create `ToastProvider.tsx` with custom toast rendering and queue limiting
2. **Step 2:** Create `customToast.css` for white bg/black text styling
3. **Step 3:** Modify `main.tsx` to mount `<ToastProvider>` at root
4. **Step 4:** Modify `App.tsx` to remove all `<Toaster>` instances
5. **Step 5:** Update `toastUtils.ts` to use new ToastProvider
6. **Step 6:** Test auth flow (Signup → Login) toast persistence
