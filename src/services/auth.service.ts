import { 
  signIn, 
  signOut, 
  getCurrentUser,
  fetchAuthSession,
  signInWithRedirect,
  confirmSignIn,
  SignInInput,
  SignInOutput
} from '@aws-amplify/auth';
import type { User } from '../types';
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
      // Clear all localStorage items to ensure clean logout
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.userKey);
      localStorage.removeItem('appSettings');
      localStorage.removeItem('lastSongLogged');
      localStorage.removeItem('pulse_location_current');
      localStorage.removeItem('pulse_locations');
      localStorage.removeItem('songLog');
      localStorage.removeItem('weeklyReports');
      // Clear any other Amplify/Cognito tokens that might be stored
      localStorage.clear();
    } catch (error) {
      console.error('Logout error:', error);
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
      const venueId = (payload?.['custom:venueId'] as string) || 'demo-venue';
      const venueName = (payload?.['custom:venueName'] as string) || 'Pulse Dashboard';
      
      // Get user's locations
      const locations = locationService.getLocations();
      
      // Set initial location if none selected
      if (!locationService.getCurrentLocationId() && locations.length > 0) {
        locationService.setCurrentLocationId(locations[0].id);
      }

      const user: User = {
        id: currentUser.userId,
        email: payload?.email as string || '',
        venueId,
        venueName,
        locations
      };

      localStorage.setItem(this.userKey, JSON.stringify(user));
      return user;
    } catch (error) {
      console.error('Get current user error:', error);
      throw new Error('Not authenticated');
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
}

export default new AuthService();
