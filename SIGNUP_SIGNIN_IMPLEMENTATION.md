# Sign Up & Sign In Flow Implementation

## Summary of Changes

This implementation separates the signup and signin flows into two distinct, focused components and pages.

### Files Created

1. **`apps/web/src/components/openbooks/SignUpForm.tsx`** - NEW
   - Dedicated signup form with email, password, confirm password, and name fields
   - Password validation (min 8 characters)
   - Confirm password matching
   - Only handles `signUp` flow
   - Clear error messages for:
     - "Account already exists"
     - "Password requirements not met"
     - "Passwords don't match"

2. **`apps/web/src/app/sign-up/page.tsx`** - NEW
   - New signup page with explanatory copy
   - Uses `SignUpForm` component
   - Link to sign-in for existing users
   - Mirrors the design of the sign-in page

### Files Modified

1. **`apps/web/src/components/openbooks/SignInForm.tsx`** - MODIFIED
   - Removed auto-signup fallback (was trying signUp if signIn failed)
   - Only handles `signIn` flow
   - Removed "name" field (not needed for signin)
   - Updated error message to: "Invalid email or password. If you don't have an account yet, please sign up."
   - Updated help text to clarify this is for existing accounts

2. **`apps/web/src/app/sign-in/page.tsx`** - MODIFIED
   - Added signup link with button
   - Added explanatory card: "Don't have an account? Create one here"
   - Updated help text to mention both flows

3. **`apps/web/src/components/openbooks/InviteAcceptScreen.tsx`** - MODIFIED
   - Changed from `SignInForm` to `SignUpForm`
   - Invited users now use signup form (since they're creating accounts)
   - Email is pre-filled and locked
   - Submit label: "Create invited account"

## User Flows

### Flow 1: New User Creating an Account
1. User lands on `/sign-up`
2. Enters email, password (8+ chars), confirm password, optional name
3. Submits form
4. If account created successfully → redirects to `/dashboard`
5. If email already exists → shows "Account already exists" error
6. Link to sign-in for existing accounts

### Flow 2: Existing User Signing In
1. User lands on `/sign-in` (or returns from signup)
2. Enters email and password
3. Submits form
4. If credentials valid → redirects to `/dashboard` (or `/dashboard?demo=1` if cloning demo)
5. If user doesn't exist → shows error message
6. If password invalid → shows error message
7. Link to sign-up for new accounts

### Flow 3: Invited User
1. User receives invite link with token
2. Lands on `/invite/[token]`
3. `InviteAcceptScreen` shows workspace details
4. Email is pre-filled and locked
5. User creates password, confirm password, optional name
6. Submits form
7. If successful → redirects to `/dashboard`
8. Invite status changes from "pending" to "accepted"

### Flow 4: Developer Mode
- `/sign-in` page shows "Continue as local dev owner" button when `devAuthBypass` is enabled
- Allows quick testing without entering credentials

## Error Handling

### SignUp Form Errors
- Empty email → "Email is required"
- Password < 8 chars → "Password must be at least 8 characters"
- Passwords don't match → "Passwords don't match"
- Account exists → "Unable to create account. The email may already be in use or there was an error."

### SignIn Form Errors
- Invalid credentials → "Invalid email or password. If you don't have an account yet, please sign up."
- User not found → Caught by auth provider with same error message
- Password reset errors → "Could not reset this password. Request a fresh reset email."

## Testing Checklist

- [ ] New user can sign up at `/sign-up`
- [ ] Password validation works (8 char min, confirm matching)
- [ ] Existing user can sign in at `/sign-in`
- [ ] Invalid email/password shows proper error
- [ ] Signup link visible on sign-in page
- [ ] Sign-in link visible on sign-up page
- [ ] Invited user flow works (pre-filled email, locked)
- [ ] Invited user can create account with password
- [ ] Owner (admin env user) can use dev bypass if enabled
- [ ] Post-auth redirect to `/dashboard` works
- [ ] Demo clone flag (`?demo=1`) passes through to dashboard
- [ ] No type errors in new files

## Database Impact

No schema changes. Uses existing:
- `users` table (email, name, password handled by auth provider)
- `invites` table (status, email, role, workspaceId)
- `userProfiles` table (display name, initials, avatar color)
- `workspaceMembers` table (user-to-workspace relationships)

## Auth Provider Details

Uses `@convex-dev/auth` with `Password` provider:
- `signIn("password", { email, password, flow: "signIn" })`
- `signIn("password", { email, password, name, flow: "signUp" })`
- Email normalization via `normalizeEmail()`
- Password hashing handled by Convex auth
- Session creation via `beforeSessionCreation` callback

## Next Steps (Optional Future Work)

1. Add "Forgot Password" link on sign-in page
2. Email verification for new signups
3. Social login (GitHub, Google) via auth provider
4. Rate limiting on auth endpoints
5. Account recovery / email change flow
