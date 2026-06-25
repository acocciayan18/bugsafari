# TODO - Runtime Server Launch Fix

## Task
Fix the runtime issue where the backend container compilation succeeds but the application server process never runs by restoring the execution lifecycle hook in the `dev` script.

## Implementation Steps

- [x] Step 1: Understand current dev script configuration in testing-core/package.json
- [x] Step 2: Analyze tsc-watch and its --onSuccess parameter
- [x] Step 3: Create implementation_plan.md with detailed fix plan
- [x] Step 4: Execute the fix - append --onSuccess parameter to dev script
- [x] Step 5: Verify the changes are correctly applied
- [ ] Step 6: Test the dev script execution (run `npm run dev`)

## Changes Required

1. Modify testing-core/package.json:
   - Change `"dev": "tsc-watch"` to `"dev": "tsc-watch --onSuccess \"node dist/testing-core/src/index.js\""`

---

# TODO - Login Redirect Fix

## Task
Fix login network path in AuthContext.tsx to use Vite proxy instead of direct port 3000 connection.

## Implementation Steps

- [x] Step 1: Understand current login implementation in AuthContext.tsx
- [x] Step 2: Examine vite.config.ts to verify proxy configuration
- [x] Step 3: Create implementation_plan.md with detailed fix plan
- [x] Step 4: Execute the fix - change hardcoded URL to relative path
- [x] Step 5: Verify the changes are correct

## Changes Required

1. Modify AuthContext.tsx:
   - Change API_BASE_URL to use relative path when in dev mode
   - Update login fetch to use `/api/auth/login` relative path
   - Update signup fetch to use `/api/auth/register` relative path
