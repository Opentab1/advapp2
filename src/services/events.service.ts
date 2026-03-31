/**
 * Events Service
 *
 * Calendar-driven event ideas based on national holidays, sports seasons,
 * and seasonal opportunities — projected 3 months out.
 */

// ============ TYPES ============

export interface CalendarEventIdea {
  id: string;
  name: string;
  emoji: string;
  description: string;        // 1-line what it is
  howTo: string;              // actionable: what to actually do
  expectedImpact: string;     // "Typically drives 30-50% more traffic"
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: 'holiday' | 'sports' | 'seasonal' | 'community';
  date: Date;                 // the actual date this event is tied to
  dateLabel: string;          // "March 17" or "First Sunday of Feb"
  leadTimeDays: number;       // days in advance owner should promote
  isThisWeek: boolean;        // computed: within next 7 days
  daysUntil: number;          // computed: days from today
}

// Keep EventSuggestion for backward compatibility (no longer used internally)
export interface EventSuggestion {
  id: string;
  name: string;
  emoji: string;
  description: string;
  whyItFits: string;
  bestNight: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  category: 'theme_night' | 'special_event' | 'recurring' | 'promotion';
  attendanceBoostPct: number;
  signalReasons: string[];
}

// VenueHistoryContext — kept for backward compatibility
export interface VenueHistoryContext {
  avgGuestsByDow: Record<number, number>;
  slowestDays: number[];
  busiestDays: number[];
  avgDrinksPerShift: number;
  totalShiftsAnalyzed: number;
}

export function buildHistoryContext(jobs: import('../services/venuescope.service').VenueScopeJob[]): VenueHistoryContext {
  const nonLive = jobs.filter(j => !j.isLive && j.totalEntries != null && j.totalEntries > 0);
  const dowTotals: Record<number, { sum: number; count: number }> = {};
  for (let i = 0; i < 7; i++) dowTotals[i] = { sum: 0, count: 0 };

  nonLive.forEach(j => {
    const dow = new Date((j.createdAt ?? 0) * 1000).getDay();
    dowTotals[dow].sum += j.totalEntries ?? 0;
    dowTotals[dow].count += 1;
  });

  const avgGuestsByDow: Record<number, number> = {};
  for (let i = 0; i < 7; i++) {
    avgGuestsByDow[i] = dowTotals[i].count > 0 ? Math.round(dowTotals[i].sum / dowTotals[i].count) : 0;
  }

  const dowsSorted = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => avgGuestsByDow[a] - avgGuestsByDow[b]);

  const drinkJobs = jobs.filter(j => !j.isLive && j.totalDrinks != null);
  const avgDrinksPerShift = drinkJobs.length
    ? Math.round(drinkJobs.reduce((s, j) => s + (j.totalDrinks ?? 0), 0) / drinkJobs.length)
    : 0;

  return {
    avgGuestsByDow,
    slowestDays: dowsSorted.slice(0, 3),
    busiestDays: [...dowsSorted].reverse().slice(0, 3),
    avgDrinksPerShift,
    totalShiftsAnalyzed: nonLive.length,
  };
}

// ============ DATE HELPERS ============

/** Get the Nth occurrence of a day-of-week in a given month/year. n=1 means first. */
function nthDayOfMonth(year: number, month: number, dow: number, n: number): Date {
  // month is 0-indexed
  const d = new Date(year, month, 1);
  const firstDow = d.getDay();
  let day = 1 + ((dow - firstDow + 7) % 7) + (n - 1) * 7;
  return new Date(year, month, day);
}

/** Get the last occurrence of a day-of-week in a given month/year. */
function lastDayOfMonth(year: number, month: number, dow: number): Date {
  // Start from the last day and walk backward
  const lastDay = new Date(year, month + 1, 0);
  const lastDow = lastDay.getDay();
  const diff = (lastDow - dow + 7) % 7;
  return new Date(year, month, lastDay.getDate() - diff);
}

function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

function daysBetween(a: Date, b: Date): number {
  const msPerDay = 86400000;
  const aDay = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bDay = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((bDay - aDay) / msPerDay);
}

// ============ EVENT GENERATOR ============

/**
 * Generate all bar-relevant calendar event opportunities from referenceDate
 * through referenceDate + monthsOut months.
 */
export function generateCalendarEvents(referenceDate: Date, monthsOut: number): CalendarEventIdea[] {
  const events: CalendarEventIdea[] = [];
  const maxDays = monthsOut * 30;

  // We generate events for the reference year and year+1 to cover the full window
  const refYear = referenceDate.getFullYear();
  const years = [refYear, refYear + 1];

  function addEvent(
    idBase: string,
    name: string,
    emoji: string,
    description: string,
    howTo: string,
    expectedImpact: string,
    difficulty: 'Easy' | 'Medium' | 'Hard',
    category: 'holiday' | 'sports' | 'seasonal' | 'community',
    date: Date,
    dateLabel: string,
    leadTimeDays: number,
  ) {
    const daysUntil = daysBetween(referenceDate, date);
    if (daysUntil < 0 || daysUntil > maxDays) return;

    events.push({
      id: `${idBase}-${date.getFullYear()}`,
      name,
      emoji,
      description,
      howTo,
      expectedImpact,
      difficulty,
      category,
      date,
      dateLabel,
      leadTimeDays,
      isThisWeek: daysUntil >= 0 && daysUntil <= 7,
      daysUntil,
    });
  }

  for (const year of years) {
    // ---- HOLIDAYS ----

    // St. Patrick's Day: March 17
    addEvent(
      'stpats',
      "St. Patrick's Day Party",
      '🍀',
      "One of the top 3 bar nights of the year.",
      "Green beer, Irish whiskey specials, shamrock decor. Start promotions at open. Partner with an Irish whiskey brand if possible.",
      "Up to 3x normal traffic",
      'Easy',
      'holiday',
      new Date(year, 2, 17),
      `March 17`,
      7,
    );

    // Cinco de Mayo: May 5
    addEvent(
      'cincodemayo',
      'Cinco de Mayo Fiesta',
      '🌮',
      "Margarita specials, tequila promotions, festive decor.",
      "Margarita specials, tequila promotions, festive decor. Partner with a tequila brand for sponsorship.",
      "40-60% traffic increase",
      'Easy',
      'holiday',
      new Date(year, 4, 5),
      `May 5`,
      7,
    );

    // Fourth of July: July 4
    addEvent(
      'july4',
      'Independence Day Party',
      '🎆',
      "Patriotic cocktails, extended hours, outdoor setup if possible.",
      "Patriotic cocktails (red/white/blue), extended hours, outdoor setup if possible. Start outdoor promotions in the afternoon.",
      "Major bar night, strong all day",
      'Medium',
      'holiday',
      new Date(year, 6, 4),
      `July 4`,
      14,
    );

    // Halloween: October 31
    addEvent(
      'halloween',
      'Halloween Costume Party',
      '🎃',
      "Costume contest with prize, themed cocktails, decorations.",
      "Costume contest with cash or bar-tab prize, themed cocktails (witch's brew, bloody mary), decorations throughout. Promote 2 weeks out.",
      "Top 5 bar night nationally",
      'Medium',
      'holiday',
      new Date(year, 9, 31),
      `October 31`,
      14,
    );

    // Thanksgiving Eve (Wednesday before Thanksgiving = 4th Thursday of November - 1 day)
    const thanksgiving = nthDayOfMonth(year, 10, 4, 4); // 4th Thursday of November
    const thanksgivingEve = new Date(thanksgiving);
    thanksgivingEve.setDate(thanksgivingEve.getDate() - 1);
    addEvent(
      'blackoutwednesday',
      'Blackout Wednesday',
      '🦃',
      "Biggest bar night of the year in most markets.",
      "Minimal setup needed — the crowd comes to you. Stock up on inventory, add extra staff, and consider a cover or drink minimum to manage capacity.",
      "Often the #1 bar night of the year",
      'Easy',
      'holiday',
      thanksgivingEve,
      formatDateLabel(thanksgivingEve),
      7,
    );

    // New Year's Eve: December 31
    addEvent(
      'nye',
      "New Year's Eve Party",
      '🥂',
      "Ticket presale, champagne toast, party favors, countdown.",
      "Sell tickets in advance, plan champagne toast at midnight, order party favors and noise makers, book DJ or entertainment. Requires 6-8 weeks of planning.",
      "Highest revenue night of the year",
      'Hard',
      'holiday',
      new Date(year, 11, 31),
      `December 31`,
      60,
    );

    // New Year's Day: January 1
    addEvent(
      'nyd',
      "New Year's Day Hangover Brunch",
      '🎊',
      "Bloody Marys, hair-of-the-dog specials.",
      "Open for brunch/midday service, Bloody Mary bar, hair-of-the-dog cocktail specials, comfort food if you serve food. Promote on NYE itself.",
      "Strong midday/afternoon crowd",
      'Easy',
      'holiday',
      new Date(year, 0, 1),
      `January 1`,
      3,
    );

    // Valentine's Day: February 14
    addEvent(
      'valentines',
      "Valentine's Night",
      '💝',
      "Couples specials, rose/champagne packages, romantic lighting.",
      "Couples drink specials (2-for-1 cocktails, champagne by the glass), rose-themed cocktails, soft lighting. Consider a prix-fixe drink package.",
      "Strong couples crowd, 20-30% lift",
      'Medium',
      'holiday',
      new Date(year, 1, 14),
      `February 14`,
      10,
    );

    // Christmas Eve: December 24
    addEvent(
      'xmaseve',
      'Christmas Eve Bar Night',
      '🎄',
      "Warm holiday cocktails, festive atmosphere.",
      "Warm holiday cocktails (hot toddies, mulled wine, eggnog), festive decor already up. Surprisingly strong neighborhood bar night — promote locally.",
      "Solid neighborhood bar night",
      'Easy',
      'holiday',
      new Date(year, 11, 24),
      `December 24`,
      7,
    );

    // Memorial Day Weekend: Saturday before last Monday of May
    const memorialDay = lastDayOfMonth(year, 4, 1); // last Monday of May
    const memorialSat = new Date(memorialDay);
    memorialSat.setDate(memorialSat.getDate() - 2);
    addEvent(
      'memorialday',
      'Memorial Day Weekend Kickoff',
      '🌟',
      "Summer launch party, outdoor specials, start of summer promotions.",
      "Summer launch party theme, outdoor setup if possible, introduce summer cocktail menu, daytime-to-night flow. Promote as summer's official start.",
      "Strong weekend, kick off summer",
      'Medium',
      'seasonal',
      memorialSat,
      formatDateLabel(memorialSat),
      10,
    );

    // Labor Day Weekend: Saturday before first Monday of September
    const laborDay = nthDayOfMonth(year, 8, 1, 1); // first Monday of September
    const laborSat = new Date(laborDay);
    laborSat.setDate(laborSat.getDate() - 2);
    addEvent(
      'laborday',
      'Labor Day Weekend Party',
      '🍺',
      "End-of-summer send-off, outdoor BBQ theme if possible.",
      "End-of-summer send-off theme, outdoor BBQ setup if possible, summer cocktail closeout specials. Last big outdoor weekend — make it count.",
      "Strong holiday weekend",
      'Medium',
      'seasonal',
      laborSat,
      formatDateLabel(laborSat),
      10,
    );

    // ---- SPORTS ----

    // Super Bowl: 2nd Sunday of February
    const superBowl = nthDayOfMonth(year, 1, 0, 2); // 2nd Sunday of February
    addEvent(
      'superbowl',
      'Super Bowl Watch Party',
      '🏈',
      "Wings/food specials, betting squares, multiple TVs.",
      "Wings and food specials, Super Bowl squares game (each square $5-20), all TVs on the game, staff up heavily. Order extra inventory. This is the #1 bar day in America.",
      "Largest single-day bar event in the US",
      'Easy',
      'sports',
      superBowl,
      formatDateLabel(superBowl),
      7,
    );

    // March Madness Opening Weekend: 3rd Thursday of March
    const marchMadness = nthDayOfMonth(year, 2, 4, 3); // 3rd Thursday of March
    addEvent(
      'marchmadness',
      'March Madness Watch Party',
      '🏀',
      "Bracket contest, game-day food/drink specials, all TVs on.",
      "Run a bracket contest (entry fee, winner-take-all), game-day drink specials, all TVs on during games. This event runs for 3 weeks — great for sustained traffic.",
      "20-40% traffic lift for 3 weeks",
      'Easy',
      'sports',
      marchMadness,
      formatDateLabel(marchMadness),
      7,
    );

    // March Madness Final Four: first Saturday of April
    const finalFour = nthDayOfMonth(year, 3, 6, 1); // first Saturday of April
    addEvent(
      'finalfour',
      'Final Four Watch Party',
      '🏆',
      "Bracket finals, bonus prizes for bracket winners.",
      "Final Four game day — announce bracket contest winners for near-misses, bonus prizes for correct Final Four picks. Peak of March Madness excitement.",
      "Peak of March Madness",
      'Easy',
      'sports',
      finalFour,
      formatDateLabel(finalFour),
      3,
    );

    // Masters Golf: 2nd Thursday of April
    const masters = nthDayOfMonth(year, 3, 4, 2); // 2nd Thursday of April
    addEvent(
      'masters',
      'Masters Watch Party',
      '⛳',
      "Golf-themed cocktails (Arnold Palmer, Green Jacket), daytime crowd.",
      "Arnold Palmer specials, 'Green Jacket' cocktail, golf trivia. Strong daytime/afternoon crowd — great if you do lunch or early opens.",
      "Strong daytime/afternoon crowd",
      'Easy',
      'sports',
      masters,
      formatDateLabel(masters),
      5,
    );

    // NBA Finals: first Thursday of June
    const nbaFinals = nthDayOfMonth(year, 5, 4, 1); // first Thursday of June
    addEvent(
      'nbafinals',
      'NBA Finals Watch Party',
      '🏀',
      "Team allegiance specials, food deals during games.",
      "Team allegiance drink specials (pick a team color), food deals timed to game breaks. Good for running through the full series.",
      "Strong sports bar crowd",
      'Easy',
      'sports',
      nbaFinals,
      formatDateLabel(nbaFinals),
      5,
    );

    // NFL Season Kickoff: first Thursday of September
    const nflKickoff = nthDayOfMonth(year, 8, 4, 1); // first Thursday of September
    addEvent(
      'nflkickoff',
      'NFL Kickoff Party',
      '🏈',
      "Season launch, fantasy football tie-in, jersey specials.",
      "NFL season launch party, fantasy football draft night tie-in if timed right, jersey night (wear your team's jersey for a discount), wings specials.",
      "Launches a 5-month weekly revenue bump",
      'Easy',
      'sports',
      nflKickoff,
      formatDateLabel(nflKickoff),
      7,
    );

    // NFL Playoffs Wild Card: 2nd Saturday of January
    const wildCard = nthDayOfMonth(year, 0, 6, 2); // 2nd Saturday of January
    addEvent(
      'nflwildcard',
      'NFL Playoff Watch Party',
      '🏈',
      "Biggest football stakes of the year begin.",
      "NFL playoffs starting — bracket-style watch party setup, playoff squares game, staff up for Sunday crowds. Multiple games over the weekend.",
      "30-40% above normal Sundays",
      'Easy',
      'sports',
      wildCard,
      formatDateLabel(wildCard),
      5,
    );

    // World Series: approximately October 25
    addEvent(
      'worldseries',
      'World Series Watch Party',
      '⚾',
      "Baseball's biggest stage, themed cocktails.",
      "World Series viewing party, baseball-themed cocktails, peanuts/nachos specials if you serve food. Great for baseball markets.",
      "Strong sports crowd",
      'Easy',
      'sports',
      new Date(year, 9, 25),
      `~October 25`,
      5,
    );

    // Stanley Cup Finals: approximately June 5
    addEvent(
      'stanleycup',
      'Stanley Cup Finals Watch Party',
      '🏒',
      "Hockey's championship, great for hockey markets.",
      "Hockey-themed watch party, team-color drink specials, promote to hockey fans locally. Especially strong in hockey markets (Boston, NY, Chicago, Detroit, etc.).",
      "Strong in hockey markets",
      'Easy',
      'sports',
      new Date(year, 5, 5),
      `~June 5`,
      5,
    );

    // Kentucky Derby: first Saturday of May
    const kentuckyDerby = nthDayOfMonth(year, 4, 6, 1); // first Saturday of May
    addEvent(
      'kentuckyderby',
      'Kentucky Derby Party',
      '🐎',
      "Mint juleps, hat contest, 2-minute race broadcast.",
      "Mint julep specials, fascinator/hat contest with prize, broadcast the 2-minute race, sell $2 win/place/show betting slips (for fun). Easy and fun to execute.",
      "Fun daytime event, 20% traffic lift",
      'Medium',
      'sports',
      kentuckyDerby,
      formatDateLabel(kentuckyDerby),
      7,
    );

    // Daytona 500: approximately February 16
    addEvent(
      'daytona500',
      'Daytona 500 Watch Party',
      '🏎️',
      "NASCAR's biggest race, beer + wings specials.",
      "Beer and wings specials, broadcast the race on all TVs, racing trivia during commercial breaks. Strong in NASCAR markets (Southeast, Midwest).",
      "Strong in racing markets",
      'Easy',
      'sports',
      new Date(year, 1, 16),
      `~February 16`,
      5,
    );

    // ---- SEASONAL / COMMUNITY ----

    // Oktoberfest: September 20
    addEvent(
      'oktoberfest',
      'Oktoberfest Party',
      '🍺',
      "German beer taps, pretzels, lederhosen/dirndl contest.",
      "German beer on tap or in steins, pretzel specials, lederhosen/dirndl costume contest, oompah playlist. One of the most fun and easy bar themes to pull off.",
      "Strong themed event, 25-35% lift",
      'Medium',
      'seasonal',
      new Date(year, 8, 20),
      `~September 20`,
      14,
    );

    // Summer Solstice: June 21
    addEvent(
      'solstice',
      'Summer Solstice Party',
      '☀️',
      "Longest day of the year, outdoor specials, daytime-to-night.",
      "Celebrate the longest day — outdoor setup if possible, summer cocktail specials starting at happy hour and running through close. Good for a slow Thursday.",
      "Moderate — good for a slow Thursday",
      'Easy',
      'seasonal',
      new Date(year, 5, 21),
      `June 21`,
      7,
    );
  }

  // Sort by date ascending
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  return events;
}

export { generateCalendarEvents as default };
export type { CalendarEventIdea };
