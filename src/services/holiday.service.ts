/**
 * Holiday Service
 * 
 * Provides upcoming holidays and special events relevant to bars/restaurants
 * No API needed - uses static calendar with dynamic date calculations
 */

export interface Holiday {
  name: string;
  date: Date;
  type: 'major' | 'drinking' | 'sports' | 'busy' | 'slow';
  icon: string;
  impact: 'very-high' | 'high' | 'medium' | 'low';
  description: string;
  tips?: string;
}

class HolidayService {
  /**
   * Get all holidays for a given year
   */
  private getHolidaysForYear(year: number): Holiday[] {
    return [
      // Major Holidays
      {
        name: "New Year's Day",
        date: new Date(year, 0, 1),
        type: 'major',
        icon: '🎉',
        impact: 'high',
        description: 'Many people recovering from NYE celebrations',
        tips: 'Brunch specials, Bloody Mary bar'
      },
      {
        name: "New Year's Eve",
        date: new Date(year, 11, 31),
        type: 'major',
        icon: '🥂',
        impact: 'very-high',
        description: 'Biggest party night of the year',
        tips: 'Reservations required, champagne specials, live entertainment'
      },
      {
        name: "Super Bowl Sunday",
        date: this.getSuperBowlDate(year),
        type: 'sports',
        icon: '🏈',
        impact: 'very-high',
        description: 'Second biggest eating day in America',
        tips: 'Wing specials, beer buckets, big screens, early reservations'
      },
      {
        name: "Valentine's Day",
        date: new Date(year, 1, 14),
        type: 'busy',
        icon: '💕',
        impact: 'very-high',
        description: 'Busiest date night of the year',
        tips: 'Prix fixe menus, romantic ambiance, couples specials'
      },
      {
        name: "Presidents Day",
        date: this.getNthWeekdayOfMonth(year, 1, 1, 3), // 3rd Monday of Feb
        type: 'busy',
        icon: '🇺🇸',
        impact: 'medium',
        description: 'Federal holiday, many people off work',
        tips: 'Brunch crowd, day drinkers'
      },
      {
        name: "Mardi Gras",
        date: this.getMardiGrasDate(year),
        type: 'drinking',
        icon: '🎭',
        impact: 'high',
        description: 'Fat Tuesday celebrations',
        tips: 'Cajun specials, hurricanes, beads, live music'
      },
      {
        name: "St. Patrick's Day",
        date: new Date(year, 2, 17),
        type: 'drinking',
        icon: '☘️',
        impact: 'very-high',
        description: 'One of the biggest bar days of the year',
        tips: 'Green beer, Irish food, live music, start early'
      },
      {
        name: "March Madness Starts",
        date: this.getMarchMadnessStart(year),
        type: 'sports',
        icon: '🏀',
        impact: 'high',
        description: 'College basketball tournament begins',
        tips: 'Multiple TVs needed, bracket contests, lunch crowds'
      },
      {
        name: "Easter",
        date: this.getEasterDate(year),
        type: 'slow',
        icon: '🐣',
        impact: 'low',
        description: 'Family holiday, typically slow for bars',
        tips: 'Brunch service, early close option'
      },
      {
        name: "Cinco de Mayo",
        date: new Date(year, 4, 5),
        type: 'drinking',
        icon: '🇲🇽',
        impact: 'very-high',
        description: 'Major drinking holiday',
        tips: 'Margarita specials, Mexican food, mariachi, tequila flights'
      },
      {
        name: "Kentucky Derby",
        date: this.getKentuckyDerbyDate(year),
        type: 'drinking',
        icon: '🏇',
        impact: 'high',
        description: 'Mint julep day, afternoon event',
        tips: 'Mint juleps, fancy hats contest, Derby party'
      },
      {
        name: "Mother's Day",
        date: this.getNthWeekdayOfMonth(year, 4, 0, 2), // 2nd Sunday of May
        type: 'busy',
        icon: '👩',
        impact: 'very-high',
        description: 'Busiest brunch day of the year',
        tips: 'Brunch reservations essential, flower arrangements, specials'
      },
      {
        name: "Memorial Day",
        date: this.getLastWeekdayOfMonth(year, 4, 1), // Last Monday of May
        type: 'major',
        icon: '🇺🇸',
        impact: 'high',
        description: 'Summer kickoff, long weekend',
        tips: 'Patio season begins, BBQ specials, day drinking crowd'
      },
      {
        name: "Father's Day",
        date: this.getNthWeekdayOfMonth(year, 5, 0, 3), // 3rd Sunday of June
        type: 'busy',
        icon: '👨',
        impact: 'high',
        description: 'Big brunch and dinner day',
        tips: 'Steak specials, whiskey flights, sports on TV'
      },
      {
        name: "Independence Day",
        date: new Date(year, 6, 4),
        type: 'major',
        icon: '🎆',
        impact: 'very-high',
        description: 'Major holiday, fireworks crowds',
        tips: 'Patio essential, red/white/blue specials, late night after fireworks'
      },
      {
        name: "Labor Day",
        date: this.getNthWeekdayOfMonth(year, 8, 1, 1), // 1st Monday of Sept
        type: 'major',
        icon: '🇺🇸',
        impact: 'high',
        description: 'End of summer, long weekend',
        tips: 'Last patio push, BBQ specials, day drinking'
      },
      {
        name: "NFL Season Opener",
        date: this.getNFLOpenerDate(year),
        type: 'sports',
        icon: '🏈',
        impact: 'high',
        description: 'Football season begins',
        tips: 'Fantasy draft parties, game day specials start'
      },
      {
        name: "Halloween",
        date: new Date(year, 9, 31),
        type: 'drinking',
        icon: '🎃',
        impact: 'very-high',
        description: 'Major party night, costume crowds',
        tips: 'Costume contest, themed drinks, decorations essential'
      },
      {
        name: "Thanksgiving Eve",
        date: new Date(year, 10, this.getThanksgivingDate(year).getDate() - 1),
        type: 'drinking',
        icon: '🦃',
        impact: 'very-high',
        description: 'Biggest bar night of the year ("Blackout Wednesday")',
        tips: 'All hands on deck, hometown crowds, no food needed'
      },
      {
        name: "Thanksgiving",
        date: this.getThanksgivingDate(year),
        type: 'slow',
        icon: '🦃',
        impact: 'low',
        description: 'Family holiday, most bars closed or slow',
        tips: 'Close early or host Friendsgiving event'
      },
      {
        name: "Black Friday",
        date: new Date(year, 10, this.getThanksgivingDate(year).getDate() + 1),
        type: 'busy',
        icon: '🛍️',
        impact: 'medium',
        description: 'Shopping crowds need breaks',
        tips: 'Lunch specials, shopper recovery drinks'
      },
      {
        name: "Christmas Eve",
        date: new Date(year, 11, 24),
        type: 'slow',
        icon: '🎄',
        impact: 'low',
        description: 'Family night, typically slow',
        tips: 'Early close, minimal staff'
      },
      {
        name: "Christmas Day",
        date: new Date(year, 11, 25),
        type: 'slow',
        icon: '🎄',
        impact: 'low',
        description: 'Most venues closed',
        tips: 'If open, cater to those without family plans'
      },
    ];
  }

  /**
   * Get upcoming holidays (next 60 days)
   */
  getUpcomingHolidays(daysAhead: number = 60): Holiday[] {
    const now = new Date();
    const currentYear = now.getFullYear();
    const nextYear = currentYear + 1;
    
    // Get holidays for this year and next
    const allHolidays = [
      ...this.getHolidaysForYear(currentYear),
      ...this.getHolidaysForYear(nextYear)
    ];
    
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    return allHolidays
      .filter(h => h.date >= now && h.date <= futureDate)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Get holidays happening today
   */
  getTodaysHolidays(): Holiday[] {
    const today = new Date();
    const currentYear = today.getFullYear();
    const holidays = this.getHolidaysForYear(currentYear);
    
    return holidays.filter(h => 
      h.date.getDate() === today.getDate() &&
      h.date.getMonth() === today.getMonth()
    );
  }

  /**
   * Get days until a holiday
   */
  getDaysUntil(holiday: Holiday): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const holidayDate = new Date(holiday.date);
    holidayDate.setHours(0, 0, 0, 0);
    
    const diff = holidayDate.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  /**
   * Get the next "big" holiday (very-high or high impact)
   */
  getNextBigHoliday(): Holiday | null {
    const upcoming = this.getUpcomingHolidays(90);
    return upcoming.find(h => h.impact === 'very-high' || h.impact === 'high') || null;
  }

  // Date calculation helpers
  
  private getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    let day = 1 + ((weekday - firstWeekday + 7) % 7) + (n - 1) * 7;
    return new Date(year, month, day);
  }

  private getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
    const lastDay = new Date(year, month + 1, 0);
    const lastWeekday = lastDay.getDay();
    const diff = (lastWeekday - weekday + 7) % 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }

  private getThanksgivingDate(year: number): Date {
    return this.getNthWeekdayOfMonth(year, 10, 4, 4); // 4th Thursday of Nov
  }

  private getSuperBowlDate(year: number): Date {
    // Super Bowl is typically 2nd Sunday of February
    return this.getNthWeekdayOfMonth(year, 1, 0, 2);
  }

  private getEasterDate(year: number): Date {
    // Anonymous Gregorian algorithm
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }

  private getMardiGrasDate(year: number): Date {
    // Mardi Gras is 47 days before Easter
    const easter = this.getEasterDate(year);
    return new Date(easter.getTime() - 47 * 24 * 60 * 60 * 1000);
  }

  private getMarchMadnessStart(year: number): Date {
    // Usually starts around March 14-17
    return new Date(year, 2, 15);
  }

  private getKentuckyDerbyDate(year: number): Date {
    // First Saturday of May
    return this.getNthWeekdayOfMonth(year, 4, 6, 1);
  }

  private getNFLOpenerDate(year: number): Date {
    // Usually first Thursday after Labor Day
    const laborDay = this.getNthWeekdayOfMonth(year, 8, 1, 1);
    return new Date(laborDay.getTime() + 3 * 24 * 60 * 60 * 1000);
  }
}

export default new HolidayService();
