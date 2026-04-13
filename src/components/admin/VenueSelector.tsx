import { useAdminVenue } from '../../contexts/AdminVenueContext';

export function VenueSelector() {
  const { venues, selectedVenueId, setSelectedVenueId, loadingVenues } = useAdminVenue();

  const activeCount = venues.filter(v => v.status === 'active').length;

  return (
    <div className="relative flex items-center gap-2">
      <span className="text-xs text-gray-500 hidden sm:block">Venue:</span>
      <div className="relative">
        <select
          value={selectedVenueId ?? ''}
          onChange={e => setSelectedVenueId(e.target.value === '' ? null : e.target.value)}
          disabled={loadingVenues}
          className="
            appearance-none
            pl-3 pr-8 py-1.5
            bg-gray-800/80
            border border-white/10
            rounded-lg
            text-sm text-white
            focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20
            disabled:opacity-50
            cursor-pointer
            min-w-[160px]
          "
        >
          <option value="">
            {loadingVenues ? 'Loading...' : `All Venues (${venues.length})`}
          </option>
          {venues.map(venue => (
            <option key={venue.venueId} value={venue.venueId}>
              {venue.status === 'active' ? '● ' : '○ '}{venue.venueName || venue.venueId}
            </option>
          ))}
        </select>
        {/* Dropdown chevron */}
        <svg
          className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {/* Status dots legend — small indicator */}
      {!loadingVenues && venues.length > 0 && (
        <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
          <span>{activeCount} active</span>
          {venues.length - activeCount > 0 && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block ml-1" />
              <span>{venues.length - activeCount} suspended</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
