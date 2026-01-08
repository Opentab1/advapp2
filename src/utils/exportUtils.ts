import type { SensorData } from '../types';
import apiService from '../services/api.service';

/**
 * Handle CSV Export
 */
export function exportReportToCSV(data: SensorData[], venueName: string) {
  if (!data || data.length === 0) {
    console.warn('No data to export');
    return;
  }
  
  // Use existing service method which handles comfort/formatting
  apiService.exportToCSV(data, true, venueName);
}

/**
 * Handle PDF Export (Simulated)
 * 
 * In a real app, this would use `jspdf` or `html2canvas`.
 * For now, we'll trigger a print dialog which allows "Save as PDF".
 */
export function exportReportToPDF(reportTitle: string) {
  const originalTitle = document.title;
  document.title = reportTitle;
  window.print();
  document.title = originalTitle;
}

/**
 * Handle Email Share (mailto)
 */
export function emailReport(venueName: string, stats: { score: number; revenue: number }) {
  const subject = encodeURIComponent(`${venueName} Performance Report`);
  const body = encodeURIComponent(`
Here is the performance summary for ${venueName}:

- Avg Pulse Score: ${stats.score}/100
- Est. Revenue/Hr: $${stats.revenue}

View full details in the dashboard.
  `);
  
  window.open(`mailto:?subject=${subject}&body=${body}`);
}
