import type { ToastOrder, ToastMetrics } from '../types';
import userSettingsService from './user-settings.service';
import authService from './auth.service';

const TOAST_API_BASE = 'https://ws-api.toasttab.com';

interface ToastCredentials {
  apiKey: string;
  restaurantGuid: string;
}

class ToastPOSService {
  // In-memory cache for current session
  private apiKey: string | null = null;
  private restaurantGuid: string | null = null;
  private credentialsLoaded: boolean = false;

  /**
   * Load credentials from DynamoDB (async)
   */
  async loadCredentials(): Promise<void> {
    if (this.credentialsLoaded) return;

    try {
      const user = authService.getStoredUser();
      if (!user?.venueId) return;

      const credentials = await userSettingsService.getToastCredentials(user.venueId);
      if (credentials) {
        this.apiKey = credentials.apiKey;
        this.restaurantGuid = credentials.restaurantGuid;
        console.log('✅ Toast POS credentials loaded from DynamoDB');
      }
      this.credentialsLoaded = true;
    } catch (error) {
      console.error('Failed to load Toast credentials:', error);
    }
  }

  async setCredentials(apiKey: string, restaurantGuid: string): Promise<void> {
    this.apiKey = apiKey;
    this.restaurantGuid = restaurantGuid;
    
    try {
      const user = authService.getStoredUser();
      if (user?.venueId) {
        const success = await userSettingsService.saveToastCredentials(user.venueId, apiKey, restaurantGuid);
        if (success) {
          console.log('✅ Toast POS credentials saved to DynamoDB');
        } else {
          console.log('⚠️ Toast POS credentials cached locally (DynamoDB save pending backend update)');
        }
      }
    } catch (error) {
      console.error('Failed to save Toast credentials:', error);
    }
  }

  getCredentials(): ToastCredentials | null {
    if (this.apiKey && this.restaurantGuid) {
      return {
        apiKey: this.apiKey,
        restaurantGuid: this.restaurantGuid
      };
    }
    return null;
  }

  async clearCredentials(): Promise<void> {
    this.apiKey = null;
    this.restaurantGuid = null;

    try {
      const user = authService.getStoredUser();
      if (user?.venueId) {
        await userSettingsService.clearToastCredentials(user.venueId);
        console.log('✅ Toast POS credentials cleared');
      }
    } catch (error) {
      console.error('Failed to clear Toast credentials:', error);
    }
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.restaurantGuid);
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'Toast-Restaurant-External-ID': this.restaurantGuid || ''
    };
  }

  async getRecentOrders(_limit: number = 50): Promise<ToastOrder[]> {
    // Ensure credentials are loaded
    await this.loadCredentials();

    if (!this.isConfigured()) {
      throw new Error('Toast POS credentials not configured. Please add your API key and Restaurant GUID in Settings.');
    }

    console.log('🔍 Fetching Toast POS orders...');

    try {
      const response = await fetch(`${TOAST_API_BASE}/orders/v2/orders`, {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        const errorMsg = `Toast API returned ${response.status}: ${response.statusText}`;
        console.error(`❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log('✅ Toast POS orders received');
      return this.transformToastOrders(data);
    } catch (error: any) {
      console.error('❌ Toast POS error:', error);
      throw new Error(`Failed to fetch Toast POS orders: ${error.message}`);
    }
  }

  async getMetrics(_startDate: Date, _endDate: Date): Promise<ToastMetrics> {
    // Ensure credentials are loaded
    await this.loadCredentials();

    if (!this.isConfigured()) {
      throw new Error('Toast POS credentials not configured. Please add your API key and Restaurant GUID in Settings.');
    }

    try {
      const orders = await this.getRecentOrders(1000);
      return this.calculateMetrics(orders);
    } catch (error: any) {
      console.error('❌ Error calculating Toast metrics:', error);
      throw new Error(`Failed to calculate Toast metrics: ${error.message}`);
    }
  }

  private transformToastOrders(data: any): ToastOrder[] {
    if (!Array.isArray(data)) return [];

    return data.map((order: any) => ({
      orderId: order.guid || order.id,
      timestamp: order.openedDate || order.createdDate,
      total: order.totalAmount || 0,
      items: (order.selections || []).map((item: any) => ({
        name: item.itemName || item.name,
        quantity: item.quantity || 1,
        price: item.price || 0,
        category: item.itemGroup || 'Other'
      })),
      tableNumber: order.table?.name,
      guestCount: order.guestCount
    }));
  }

  private calculateMetrics(orders: ToastOrder[]): ToastMetrics {
    const totalOrders = orders.length;
    const totalRevenue = orders.reduce((sum, order) => sum + order.total, 0);
    const averageOrderValue = totalRevenue / totalOrders || 0;

    // Calculate top items
    const itemCounts = new Map<string, { count: number; revenue: number }>();
    orders.forEach(order => {
      order.items.forEach(item => {
        const current = itemCounts.get(item.name) || { count: 0, revenue: 0 };
        itemCounts.set(item.name, {
          count: current.count + item.quantity,
          revenue: current.revenue + (item.price * item.quantity)
        });
      });
    });

    const topItems = Array.from(itemCounts.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    // Calculate revenue by hour
    const revenueByHour = Array.from({ length: 24 }, (_, hour) => {
      const hourRevenue = orders
        .filter(order => new Date(order.timestamp).getHours() === hour)
        .reduce((sum, order) => sum + order.total, 0);
      return { hour, revenue: hourRevenue };
    });

    return {
      totalOrders,
      totalRevenue,
      averageOrderValue,
      topItems,
      revenueByHour
    };
  }
}

export default new ToastPOSService();
