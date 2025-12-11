import { 
  signIn, 
  signOut, 
  getCurrentUser,
  fetchAuthSession,
  signInWithRedirect,
  confirmSignIn,
  updatePassword,
  SignInInput,
  SignInOutput
} from '@aws-amplify/auth';
import type { User, Location } from '../types';
import locationService from './location.service';

class AuthService {
  private tokenKey = 'pulse_auth_token';
  private userKey = 'pulse_user';

  async login(email: string, password: string): Promise<User> {
    try {
      const signInInput: SignInInput = {
        username: email,
        password
      };
      
      const signInOutput: SignInOutput = await signIn(signInInput);
      
      // Handle NEW_PASSWORD_REQUIRED challenge for temp passwords
      if (signInOutput.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        throw new Error('NEW_PASSWORD_REQUIRED');
      }
      
      if (signInOutput.isSignedIn) {
        const user = await this.getCurrentAuthenticatedUser();
        return user;
      }
      
      throw new Error('Sign in failed');
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.message === 'NEW_PASSWORD_REQUIRED') {
        throw error;
      }
      throw new Error(error.message || 'Failed to login');
    }
  }

  async completeNewPassword(newPassword: string): Promise<User> {
    try {
      const { isSignedIn } = await confirmSignIn({ challengeResponse: newPassword });
      
      if (isSignedIn) {
        const user = await this.getCurrentAuthenticatedUser();
        return user;
      }
      
      throw new Error('Password change failed');
    } catch (error: any) {
      console.error('Password change error:', error);
      throw new Error(error.message || 'Failed to set new password');
    }
  }

  async loginWithGoogle(): Promise<void> {
    try {
      await signInWithRedirect({ provider: 'Google' });
    } catch (error: any) {
      console.error('Google login error:', error);
      throw new Error('Failed to login with Google');
    }
  }

  async logout(): Promise<void> {
    try {
      await signOut();
      
      // Clear all Cognito-related tokens from localStorage
      // AWS Amplify stores tokens with various keys
      const keysToRemove: string[] = [
        this.tokenKey,
        this.userKey,
        'CognitoIdentityServiceProvider',
        'aws-amplify-cache',
        'aws-amplify-federatedInfo',
        'appSettings', // Also clear appSettings on logout
        'lastSongLogged',
        'pulse_locations', // Clear location caches
        'pulse_current_location',
        'pulse_locations_cache',
        'pulse_locations_cache_time'
      ];
      
      // Remove all localStorage items that start with Cognito-related prefixes
      Object.keys(localStorage).forEach(key => {
        if (
          key.startsWith('CognitoIdentityServiceProvider') ||
          key.startsWith('aws-amplify-') ||
          key.startsWith('amplify-') ||
          keysToRemove.includes(key)
        ) {
          localStorage.removeItem(key);
        }
      });
      
      console.log('✅ Logout complete - all tokens cleared');
    } catch (error) {
      console.error('Logout error:', error);
      // Still clear localStorage even if signOut fails
      localStorage.clear();
      throw new Error('Failed to logout');
    }
  }

  async getCurrentAuthenticatedUser(): Promise<User> {
    try {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      
      // Get JWT token
      const token = session.tokens?.idToken?.toString();
      if (token) {
        localStorage.setItem(this.tokenKey, token);
      }

      // Extract user data from token or attributes
      const payload = session.tokens?.idToken?.payload;
      const venueId = (payload?.['custom:venueId'] as string) || undefined;
      const venueName = (payload?.['custom:venueName'] as string) || undefined;
      const role = (payload?.['custom:role'] as string) || 'owner'; // Default to owner for backward compatibility
      
      // Fetch user's locations from DynamoDB (only for client users with venueId)
      let locations: Location[] = [];
      if (venueId) {
        // Clear any cached location data first to ensure fresh data
        locationService.clearCache();
        
        try {
          // Pass venueId directly to avoid double session fetch
          locations = await locationService.fetchLocationsFromDynamoDB(venueId);
          // Set initial location if none selected and locations exist
          if (!locationService.getCurrentLocationId() && locations.length > 0) {
            locationService.setCurrentLocationId(locations[0].id);
          }
        } catch (error: any) {
          console.error('Failed to fetch locations:', error);
          // Don't throw error - allow user to proceed without locations
          // Locations can be loaded later in the Dashboard
          console.warn('⚠️ Proceeding without locations. They will be loaded in Dashboard.');
        }
      }

      const user: User = {
        id: currentUser.userId,
        email: payload?.email as string || '',
        role: role as User['role'],
        venueId,
        venueName,
        locations
      };

      localStorage.setItem(this.userKey, JSON.stringify(user));
      return user;
    } catch (error: any) {
      console.error('Get current user error:', error);
      throw new Error(error.message || 'Not authenticated');
    }
  }

  getStoredToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  getStoredUser(): User | null {
    const userStr = localStorage.getItem(this.userKey);
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  isAuthenticated(): boolean {
    return !!this.getStoredToken();
  }

  /**
   * Change password for currently authenticated user
   * Requires old password for security verification
   * 
   * @param oldPassword - Current password
   * @param newPassword - New password (must meet Cognito requirements)
   * @throws Error if old password is incorrect or new password doesn't meet requirements
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    try {
      // Verify user is authenticated
      if (!this.isAuthenticated()) {
        throw new Error('You must be logged in to change your password');
      }

      // Validate password requirements
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters long');
      }

      if (!/[A-Z]/.test(newPassword)) {
        throw new Error('Password must contain at least one uppercase letter');
      }

      if (!/[a-z]/.test(newPassword)) {
        throw new Error('Password must contain at least one lowercase letter');
      }

      if (!/[0-9]/.test(newPassword)) {
        throw new Error('Password must contain at least one number');
      }

      // Call AWS Cognito to update password
      await updatePassword({ oldPassword, newPassword });

      console.log('✅ Password changed successfully');
    } catch (error: any) {
      console.error('Password change error:', error);

      // Provide user-friendly error messages
      if (error.name === 'NotAuthorizedException' || error.message.includes('Incorrect username or password')) {
        throw new Error('Current password is incorrect');
      }

      if (error.name === 'InvalidPasswordException') {
        throw new Error('New password does not meet requirements');
      }

      if (error.name === 'LimitExceededException') {
        throw new Error('Too many password change attempts. Please try again later.');
      }

      // Pass through our custom validation errors
      if (error.message.includes('must be at least') || 
          error.message.includes('must contain')) {
        throw error;
      }

      throw new Error(error.message || 'Failed to change password');
    }
  }
}

export default new AuthService();
