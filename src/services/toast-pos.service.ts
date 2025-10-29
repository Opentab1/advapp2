import type { ToastOrder, ToastMetrics } from '../types';

const TOAST_API_BASE = 'https://ws-api.toasttab.com';

class ToastPOSService {
  private apiKey: string | null = null;
  private restaurantGuid: string | null = null;

  setCredentials(apiKey: string, restaurantGuid: string) {
    this.apiKey = apiKey;
    this.restaurantGuid = restaurantGuid;
  }

  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'Toast-Restaurant-External-ID': this.restaurantGuid || ''
    };
  }

  async getRecentOrders(limit: number = 50): Promise<ToastOrder[]> {
    if (!this.apiKey || !this.restaurantGuid) {
      console.warn('Toast POS not configured');
      return this.getMockOrders();
    }

    try {
      const response = await fetch(`${TOAST_API_BASE}/orders/v2/orders`, {
        headers: this.getHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch orders');
      }

      const data = await response.json();
      return this.transformToastOrders(data);
    } catch (error) {
      console.error('Toast POS error:', error);
      return this.getMockOrders();
    }
  }

  async getMetrics(startDate: Date, endDate: Date): Promise<ToastMetrics> {
    if (!this.apiKey || !this.restaurantGuid) {
      return this.getMockMetrics();
    }

    try {
      const orders = await this.getRecentOrders(1000);
      return this.calculateMetrics(orders);
    } catch (error) {
      console.error('Error calculating metrics:', error);
      return this.getMockMetrics();
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

  private getMockOrders(): ToastOrder[] {
    const now = new Date();
    const orders: ToastOrder[] = [];

    for (let i = 0; i < 20; i++) {
      const timestamp = new Date(now.getTime() - i * 15 * 60 * 1000); // Every 15 minutes
      orders.push({
        orderId: `ORDER-${1000 + i}`,
        timestamp: timestamp.toISOString(),
        total: 25 + Math.random() * 75,
        items: [
          {
            name: ['Craft Beer', 'Wings', 'Burger', 'Nachos', 'Pizza'][Math.floor(Math.random() * 5)],
            quantity: 1 + Math.floor(Math.random() * 3),
            price: 8 + Math.random() * 15,
            category: 'Food & Beverage'
          }
        ],
        tableNumber: `${Math.floor(Math.random() * 20) + 1}`,
        guestCount: 1 + Math.floor(Math.random() * 6)
      });
    }

    return orders;
  }

  private getMockMetrics(): ToastMetrics {
    return {
      totalOrders: 145,
      totalRevenue: 6750.50,
      averageOrderValue: 46.55,
      topItems: [
        { name: 'Craft Beer Flight', count: 67, revenue: 871.00 },
        { name: 'Classic Wings', count: 45, revenue: 697.50 },
        { name: 'Ferg Burger', count: 38, revenue: 608.00 },
        { name: 'Loaded Nachos', count: 32, revenue: 416.00 },
        { name: 'Margherita Pizza', count: 28, revenue: 448.00 }
      ],
      revenueByHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        revenue: hour >= 11 && hour <= 23 ? 200 + Math.random() * 400 : 0
      }))
    };
  }
}

export default new ToastPOSService();
