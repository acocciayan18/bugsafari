    # Sliding Login/Signup Form Implementation Plan

## 1. Task Overview
Create an interactive, single-page login and signup form with a sliding panel transition effect.

## 2. Color Palette (from Landing Page)
- **Primary Background:** `bg-slate-50` to `bg-white`
- **Secondary Background:** `bg-slate-100` for cards
- **Primary Text:** `text-slate-900`, `text-slate-800` (headings), `text-slate-600`, `text-slate-500` (body)
- **Primary Button:** `bg-slate-900`, `bg-slate-800` (hover: `bg-slate-700`)
- **Overlay Background:** `bg-slate-800` to `bg-slate-900` (gradient)
- **Overlay Text:** `text-white`
- **Accent Colors:** `emerald-500`, `blue-500`, `purple-500` (for highlights)

## 3. Layout Structure

### Main Container
- Full viewport height and width
- Two-panel layout side-by-side (50% each)
- Overflow hidden for sliding effect

### Panel 1 (Left - Login Form)
- Fields: Username/Email input, Password input
- Action: 'Sign In' button
- Use existing LoginForm structure but adapt to fit this layout

### Panel 2 (Right - Signup Form)
- Fields: Username input (Full Name), Email input, Password input, Confirm Password input
- Action: 'Sign Up' button
- Use existing SignupForm structure but adapt to fit this layout

### Sliding Overlay
- Width: 50% of container
- Position: Absolute, covering forms
- Initial State: Covers Signup Form (right), revealing Login Form (left)
- Content when covering Signup: "Hello, Friend!" + "Sign Up" button
- Content when covering Login: "Welcome Back!" + "Sign In" button

## 4. Interaction Behavior

### "Sign Up" Button Click (inside overlay)
1. Animate overlay sliding to LEFT (covering Login Form)
2. Switch overlay content to "Welcome Back" message
3. Reveal Signup Form on right

### "Sign In" Button Click (inside overlay)
1. Animate overlay sliding to RIGHT (covering Signup Form)
2. Switch overlay content to "Hello, Friend" message
3. Reveal Login Form on left

### Animation Details
- Duration: 500-600ms
- Easing: ease-in-out (cubic-bezier)
- Forms behind overlay STAY stationary (only overlay moves)
- Overlay content fades in/out smoothly

## 5. Implementation Steps

### Step 1: Create AuthLayout Component
- Create file: `src/components/AuthLayout.tsx`
- Build main container with two-panel structure
- Add CSS transitions for overlay sliding

### Step 2: Create Inline Form Components
- Create simplified LoginFormInner and SignupFormInner
- Adapt input fields to fit the sliding panel design
- Integrate with existing icons from designs/icons

### Step 3: Add Animations
- Use CSS transitions or Framer Motion
- Ensure smooth easing transitions
- Add content switching animations

### Step 4: Integrate with Routing
- Update App.tsx to add route for `/auth`
- Replace existing `/login` and `/signup` routes with new auth page

## 6. File Changes

### Files to Create:
- `src/components/AuthLayout.tsx` - Main sliding auth component

### Files to Modify:
- `src/App.tsx` - Add route for auth page

### Files to Reference:
- `src/components/LoginForm.tsx` - Field structures and icons
- `src/components/SignupForm.tsx` - Field structures and icons
- `src/designs/globals.css` - Global styles

## 7. Expected Outcome
A smooth, interactive sliding login/signup form with:
- Left panel: Login form
- Right panel: Signup form  
- Center overlay that slides left/right to switch between forms
- Smooth animations with the BugSafari slate color palette
- Professional appearance matching the Landing Page design
