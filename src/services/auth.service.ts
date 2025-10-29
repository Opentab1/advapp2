import { 
  signIn, 
  signOut, 
  getCurrentUser,
  fetchAuthSession,
  signInWithRedirect,
  SignInInput
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
      
      const { isSignedIn } = await signIn(signInInput);
      
      if (isSignedIn) {
        const user = await this.getCurrentAuthenticatedUser();
        return user;
      }
      
      throw new Error('Sign in failed');
    } catch (error: any) {
      console.error('Login error:', error);
      throw new Error(error.message || 'Failed to login');
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
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.userKey);
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
