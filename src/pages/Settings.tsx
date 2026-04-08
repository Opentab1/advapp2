import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Key, MapPin, Check, Building2,
  User, Info, CloudSun, Sliders, Users, Save, CreditCard, Bell, DollarSign,
  Camera, Download, Wifi, WifiOff, RefreshCw, Circle, Clock, Pencil, X,
  Eye, EyeOff, AlertCircle, Search, Globe, Radio,
  ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Loader2, Plus, Trash2,
} from 'lucide-react';
import connectService, { ConnectStatus, VenueOS, detectOS } from '../services/connect.service';
import alertsService, { AlertPreferences } from '../services/alerts.service';
import authService from '../services/auth.service';
import venueSettingsService, { VenueAddress } from '../services/venue-settings.service';
import weatherService from '../services/weather.service';
import { getUserRoleDisplay } from '../utils/userRoles';
import { ChangePasswordModal } from '../components/ChangePasswordModal';
import { AddressSettings } from '../components/AddressSettings';
import { CalibrationSettings } from '../components/CalibrationSettings';
import { POSIntegration } from '../components/settings/POSIntegration';
import { haptic } from '../utils/haptics';
import { useDisplayName } from '../hooks/useDisplayName';
import squarePosService, { SquareCredentials } from '../services/square-pos.service';

export function Settings() {
  const [activeTab, setActiveTab] = useState<'account' | 'venue' | 'integrations' | 'calibration' | 'alerts' | 'cameras' | 'about'>('account');
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [selectedOS, setSelectedOS] = useState<VenueOS>(detectOS());
  const [alertPrefs, setAlertPrefs] = useState<AlertPreferences>(() => alertsService.getPreferences());
  const [alertsSaved, setAlertsSaved] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [savedAddress, setSavedAddress] = useState<VenueAddress | null>(null);
  const [capacity, setCapacity] = useState<number | ''>('');
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [capacitySaved, setCapacitySaved] = useState(false);
  const [avgDrinkPrice, setAvgDrinkPrice] = useState<number | ''>('');
  const [drinkPriceSaving, setDrinkPriceSaving] = useState(false);
  const [drinkPriceSaved, setDrinkPriceSaved] = useState(false);
  // Business hours
  const [bizOpen, setBizOpen] = useState('17:00');
  const [bizClose, setBizClose] = useState('02:00');
  const [bizHoursSaved, setBizHoursSaved] = useState(false);
  // Camera proxy
  const [camProxy, setCamProxy] = useState('');
  const [camProxySaving, setCamProxySaving] = useState(false);
  const [camProxySaved, setCamProxySaved] = useState(false);

  // Square POS
  const [squareCreds, setSquareCreds]             = useState<SquareCredentials>(() => squarePosService.getCredentials() ?? { accessToken: '', locationId: '', environment: 'sandbox' });
  const [showSquareToken, setShowSquareToken]     = useState(false);
  const [squareTesting, setSquareTesting]         = useState(false);
  const [squareTestResult, setSquareTestResult]   = useState<{ ok: boolean; message: string } | null>(null);
  const [squareSaved, setSquareSaved]             = useState(false);
  const squareIsConfigured                        = squarePosService.isConfigured();

  const user = authService.getStoredUser();

  // Use display name (custom name if set by admin, otherwise venueId/venueName)
  const { displayName } = useDisplayName();

  // Registered cameras (RTSP)
  const [regCameras, setRegCameras]     = useState<any[]>([]);
  const [regVenues, setRegVenues]       = useState<string[]>([]);
  const [showAddCam, setShowAddCam]     = useState(false);
  const [camSaving, setCamSaving]       = useState(false);
  const [newCam, setNewCam]             = useState({
    venue: '', name: '', rtsp_url: '', mode: 'drink_count', model_profile: 'balanced', notes: ''
  });

  // ONVIF network scan
  const [scanning, setScanning]           = useState(false);
  const [discovered, setDiscovered]       = useState<any[]>([]);
  const [scanDone, setScanDone]           = useState(false);
  const [fetchingRtsp, setFetchingRtsp]   = useState<string | null>(null); // ip being fetched
  const [camCreds, setCamCreds]           = useState<Record<string, { u: string; p: string }>>({});
  // Stream connectivity results (auto-polled)
  const [streamScanResults, setStreamScanResults] = useState<any[]>([]);
  // Network diagnostics
  const [networkInfo, setNetworkInfo] = useState<{
    hostname: string; platform: string;
    interfaces: Array<{ name: string; ip: string; subnet: string | null; prefix: number | null }>;
  } | null>(null);
  const [netInfoLoading, setNetInfoLoading]     = useState(false);
  const [subnetInput, setSubnetInput]           = useState('192.168.1.0/24');
  const [subnetScanning, setSubnetScanning]     = useState(false);
  const [subnetHosts, setSubnetHosts]           = useState<Array<{ ip: string; ports: Record<string, number>; is_camera: boolean }>>([]);
  const [subnetScanned, setSubnetScanned]       = useState(0);
  const [streamLastScanned, setStreamLastScanned] = useState<Date | null>(null);

  // Camera discovery wizard
  const [arpEntries, setArpEntries]               = useState<Array<{ip:string;mac:string|null;hostname:string|null;interface:string}>>([]);
  const [arpLoading, setArpLoading]               = useState(false);
  const [identifyingIp, setIdentifyingIp]         = useState<string | null>(null);
  const [identifyResults, setIdentifyResults]     = useState<Record<string, any>>({});
  const [selectedChannels, setSelectedChannels]   = useState<Record<string, Record<number, boolean>>>({});
  const [channelNames, setChannelNames]           = useState<Record<string, Record<number, string>>>({});
  const [batchVenue, setBatchVenue]               = useState('');
  const [batchMode, setBatchMode]                 = useState('drink_count');
  const [registering, setRegistering]             = useState<string | null>(null);
  const [expandedIp, setExpandedIp]               = useState<string | null>(null);
  const [discoveryRunning, setDiscoveryRunning]   = useState(false);
  const [allDiscovered, setAllDiscovered]         = useState<Array<{ip:string;ports:Record<string,number>;is_camera:boolean;onvif:boolean;arp_hostname:string|null;vendor:string|null;mac:string|null}>>([]);
  const [discoveryDone, setDiscoveryDone]         = useState(false);

  const serverUrl = (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');

  const loadRegCameras = async () => {
    try {
      const r = await fetch(`${serverUrl}/api/cameras`);
      if (r.ok) { const d = await r.json(); setRegCameras(d.cameras || []); setRegVenues(d.venues || []); }
    } catch { /* backend not reachable */ }
  };

  const saveRegCamera = async () => {
    if (!newCam.venue.trim() || !newCam.name.trim() || !newCam.rtsp_url.trim()) return;
    setCamSaving(true);
    try {
      await fetch(`${serverUrl}/api/cameras`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCam),
      });
      setNewCam({ venue: '', name: '', rtsp_url: '', mode: 'drink_count', model_profile: 'balanced', notes: '' });
      setShowAddCam(false);
      await loadRegCameras();
    } finally { setCamSaving(false); }
  };

  const deleteRegCamera = async (id: string) => {
    await fetch(`${serverUrl}/api/cameras/${id}`, { method: 'DELETE' });
    await loadRegCameras();
  };

  const scanNetwork = async () => {
    // ONVIF discovery for finding new cameras (manual trigger)
    setScanning(true); setScanDone(false); setDiscovered([]);
    try {
      const r = await fetch(`${serverUrl}/api/cameras/discover`);
      if (r.ok) { const d = await r.json(); setDiscovered(d.cameras || []); }
    } catch { /* not reachable */ }
    setScanning(false); setScanDone(true);
  };

  const loadArpTable = async () => {
    if (!serverUrl) return;
    setArpLoading(true);
    try {
      const r = await fetch(`${serverUrl}/api/cameras/arp-table`);
      if (r.ok) { const d = await r.json(); setArpEntries(d.entries || []); }
    } catch { }
    setArpLoading(false);
  };

  const runFullDiscovery = async () => {
    if (!serverUrl || discoveryRunning) return;
    setDiscoveryRunning(true);
    setDiscoveryDone(false);
    setAllDiscovered([]);
    await loadNetworkInfo();

    // Run ARP + subnet scan + ONVIF in parallel
    const [arpRes, scanRes, onvifRes] = await Promise.allSettled([
      fetch(`${serverUrl}/api/cameras/arp-table`).then(r => r.ok ? r.json() : {entries:[]}),
      fetch(`${serverUrl}/api/cameras/subnet-scan?subnet=${encodeURIComponent(subnetInput)}&ports=554,80,8554,443`).then(r => r.ok ? r.json() : {found:[]}),
      fetch(`${serverUrl}/api/cameras/discover`).then(r => r.ok ? r.json() : {cameras:[]}),
    ]);

    const arpMap: Record<string, { hostname: string | null; vendor: string | null; mac: string | null }> = {};
    if (arpRes.status === 'fulfilled') {
      const entries = arpRes.value.entries || [];
      setArpEntries(entries);
      for (const e of entries) arpMap[e.ip] = { hostname: e.hostname, vendor: e.vendor || null, mac: e.mac || null };
    }

    const onvifIps = new Set<string>();
    if (onvifRes.status === 'fulfilled') {
      for (const c of (onvifRes.value.cameras || [])) {
        onvifIps.add(c.ip);
        setDiscovered(prev => {
          if (prev.find((x: any) => x.ip === c.ip)) return prev;
          return [...prev, c];
        });
      }
    }

    const merged: Array<{ip:string;ports:Record<string,number>;is_camera:boolean;onvif:boolean;arp_hostname:string|null;vendor:string|null;mac:string|null}> = [];
    if (scanRes.status === 'fulfilled') {
      for (const h of (scanRes.value.found || [])) {
        const arp = arpMap[h.ip] || { hostname: null, vendor: null, mac: null };
        merged.push({ ...h, onvif: onvifIps.has(h.ip), arp_hostname: arp.hostname, vendor: arp.vendor, mac: arp.mac });
      }
      setSubnetHosts(scanRes.value.found || []);
      setSubnetScanned(scanRes.value.scanned || 0);
    }

    // Also add ONVIF-only (not in scan)
    for (const ip of onvifIps) {
      if (!merged.find(m => m.ip === ip)) {
        const arp = arpMap[ip] || { hostname: null, vendor: null, mac: null };
        merged.push({ ip, ports: {'554': 0, '80': 0}, is_camera: true, onvif: true, arp_hostname: arp.hostname, vendor: arp.vendor, mac: arp.mac });
      }
    }

    merged.sort((a, b) => {
      if (a.is_camera !== b.is_camera) return a.is_camera ? -1 : 1;
      return a.ip.localeCompare(b.ip, undefined, {numeric: true});
    });

    setAllDiscovered(merged);
    setDiscoveryDone(true);
    setDiscoveryRunning(false);
  };

  const identifyCamera = async (ip: string) => {
    if (!serverUrl) return;
    setIdentifyingIp(ip);
    setExpandedIp(ip);
    const creds = camCreds[ip] || { u: 'admin', p: '' };
    try {
      const r = await fetch(`${serverUrl}/api/cameras/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip, username: creds.u, password: creds.p }),
      });
      if (r.ok) {
        const d = await r.json();
        setIdentifyResults(prev => ({ ...prev, [ip]: d }));
        // Auto-select all reachable channels
        if (d.channels?.length > 0) {
          const sel: Record<number, boolean> = {};
          const names: Record<number, string> = {};
          for (const ch of d.channels) {
            sel[ch.num] = true;
            names[ch.num] = ch.label || `Channel ${ch.num}`;
          }
          setSelectedChannels(prev => ({ ...prev, [ip]: sel }));
          setChannelNames(prev => ({ ...prev, [ip]: names }));
        } else if (d.single_stream) {
          setNewCam(p => ({ ...p, rtsp_url: d.single_stream, name: p.name || `Camera ${ip}` }));
          setShowAddCam(true);
        }
        if (d.creds_used) {
          setCamCreds(prev => ({ ...prev, [ip]: { u: d.creds_used.username, p: d.creds_used.password } }));
        }
      }
    } catch { }
    setIdentifyingIp(null);
  };

  const batchRegister = async (ip: string) => {
    if (!serverUrl) return;
    const result = identifyResults[ip];
    if (!result) return;
    const sel = selectedChannels[ip] || {};
    const names = channelNames[ip] || {};
    const venue = batchVenue || newCam.venue || 'Default Venue';
    const channels = (result.channels || [])
      .filter((ch: any) => sel[ch.num])
      .map((ch: any) => ({
        ...ch,
        name: names[ch.num] || ch.label || `CH${ch.num} — ${ip}`,
        mode: batchMode,
      }));
    if (channels.length === 0) return;
    setRegistering(ip);
    try {
      const r = await fetch(`${serverUrl}/api/cameras/batch-register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels, venue, mode: batchMode }),
      });
      if (r.ok) {
        await loadRegCameras();
        setIdentifyResults(prev => { const n = {...prev}; delete n[ip]; return n; });
        setSelectedChannels(prev => { const n = {...prev}; delete n[ip]; return n; });
        setExpandedIp(null);
      }
    } finally { setRegistering(null); }
  };

  const loadNetworkInfo = async () => {
    if (!serverUrl) return;
    setNetInfoLoading(true);
    try {
      const r = await fetch(`${serverUrl}/api/cameras/network-info`);
      if (r.ok) {
        const d = await r.json();
        setNetworkInfo(d);
        // Auto-fill subnet from first interface that has one
        const first = (d.interfaces || []).find((i: any) => i.subnet);
        if (first) setSubnetInput(first.subnet);
      }
    } catch { /* not reachable */ }
    setNetInfoLoading(false);
  };

  const scanSubnet = async () => {
    if (!serverUrl || subnetScanning) return;
    setSubnetScanning(true);
    setSubnetHosts([]);
    setSubnetScanned(0);
    try {
      const r = await fetch(
        `${serverUrl}/api/cameras/subnet-scan?subnet=${encodeURIComponent(subnetInput)}&ports=554,80,8554,443`
      );
      if (r.ok) {
        const d = await r.json();
        setSubnetHosts(d.found || []);
        setSubnetScanned(d.scanned || 0);
      }
    } catch { /* not reachable */ }
    setSubnetScanning(false);
  };

  const fetchRtsp = async (cam: any) => {
    const creds = camCreds[cam.ip] || { u: 'admin', p: '' };
    setFetchingRtsp(cam.ip);
    try {
      const r = await fetch(`${serverUrl}/api/cameras/fetch-rtsp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: cam.ip, username: creds.u, password: creds.p, xaddrs: cam.xaddrs }),
      });
      const d = await r.json();
      if (d.ok && d.rtsp_url) {
        setNewCam(p => ({ ...p, rtsp_url: d.rtsp_url, name: p.name || `Camera ${cam.ip}` }));
        setShowAddCam(true);
      } else {
        setDiscovered(prev => prev.map(c => c.ip === cam.ip ? { ...c, error: d.error || 'Failed' } : c));
      }
    } finally { setFetchingRtsp(null); }
  };

  // Auto-refresh stream status when on cameras tab
  useEffect(() => {
    if (activeTab !== 'cameras') return;
    const stop = connectService.watchStatus(setConnectStatus);
    loadRegCameras();

    const pollStreams = async () => {
      if (!serverUrl) return;
      try {
        const r = await fetch(`${serverUrl}/api/cameras/scan-streams`);
        if (r.ok) { const d = await r.json(); setStreamScanResults(d.cameras || []); setStreamLastScanned(new Date()); }
      } catch { /* backend not reachable */ }
    };

    pollStreams(); // immediate on tab open
    loadNetworkInfo(); // load worker network info on tab open
    loadArpTable(); // load ARP table on tab open
    const interval = setInterval(pollStreams, 15000); // every 15s
    return () => { stop(); clearInterval(interval); };
  }, [activeTab, serverUrl]);

  useEffect(() => {
    // Load saved address, capacity, and drink price
    if (user?.venueId) {
      const address = venueSettingsService.getAddress(user.venueId);
      setSavedAddress(address);

      const savedCapacity = venueSettingsService.getCapacity(user.venueId);
      if (savedCapacity) {
        setCapacity(savedCapacity);
      }

      venueSettingsService.loadSettingsFromCloud(user.venueId).then(s => {
        if (s?.avgDrinkPrice) setAvgDrinkPrice(s.avgDrinkPrice);
        else setAvgDrinkPrice(12);
        if (s?.camProxyUrl) setCamProxy(s.camProxyUrl);
        const hours = s?.businessHours ?? venueSettingsService.getBusinessHours(user.venueId);
        if (hours?.open) setBizOpen(hours.open);
        if (hours?.close) setBizClose(hours.close);
      }).catch(() => {
        const hours = venueSettingsService.getBusinessHours(user.venueId);
        if (hours?.open) setBizOpen(hours.open);
        if (hours?.close) setBizClose(hours.close);
      });
    }
  }, [user?.venueId]);

  const startRename = (cam: { cameraId: string; name: string }) => {
    setRenamingId(cam.cameraId);
    setRenameValue(cam.name);
    setTimeout(() => renameInputRef.current?.select(), 50);
  };

  const saveRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    setRenameSaving(true);
    try {
      const serverUrl = (import.meta.env.VITE_VENUESCOPE_URL || '').replace(':8501', ':8502').replace(/\/$/, '');
      await fetch(`${serverUrl}/api/cameras/${renamingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      connectService.clearCache();
      const updated = await connectService.getStatus();
      if (updated) setConnectStatus(updated);
    } finally {
      setRenameSaving(false);
      setRenamingId(null);
    }
  };

  const handleSaveCapacity = async () => {
    if (!user?.venueId || !capacity) return;

    setCapacitySaving(true);
    try {
      await venueSettingsService.saveCapacity(user.venueId, Number(capacity));
      haptic('success');
      setCapacitySaved(true);
      setTimeout(() => setCapacitySaved(false), 3000);
    } catch (error) {
      console.error('Failed to save capacity:', error);
    } finally {
      setCapacitySaving(false);
    }
  };

  const handleSaveDrinkPrice = async () => {
    if (!user?.venueId || avgDrinkPrice === '') return;

    setDrinkPriceSaving(true);
    try {
      await venueSettingsService.saveAvgDrinkPrice(user.venueId, Number(avgDrinkPrice));
      haptic('success');
      setDrinkPriceSaved(true);
      setTimeout(() => setDrinkPriceSaved(false), 3000);
    } catch (error) {
      console.error('Failed to save drink price:', error);
    } finally {
      setDrinkPriceSaving(false);
    }
  };

  const handleSquareSave = () => {
    if (!squareCreds.accessToken.trim() || !squareCreds.locationId.trim()) return;
    squarePosService.saveCredentials(squareCreds);
    haptic('success');
    setSquareSaved(true);
    setSquareTestResult(null);
    setTimeout(() => setSquareSaved(false), 3000);
  };

  const handleSquareTest = async () => {
    if (!squareCreds.accessToken.trim() || !squareCreds.locationId.trim()) return;
    // Save first so the service can read the creds
    squarePosService.saveCredentials(squareCreds);
    setSquareTesting(true);
    setSquareTestResult(null);
    try {
      const result = await squarePosService.testConnection();
      setSquareTestResult(result);
    } finally {
      setSquareTesting(false);
    }
  };

  const handleSquareClear = () => {
    squarePosService.clearCredentials();
    setSquareCreds({ accessToken: '', locationId: '', environment: 'sandbox' });
    setSquareTestResult(null);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="text-3xl font-bold text-white mb-2">⚙️ Settings</h2>
        <p className="text-warm-400 mb-8">Manage your account and venue</p>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {[
            { id: 'account' as const, label: 'Account', icon: User },
            { id: 'venue' as const, label: 'Venue', icon: MapPin },
            { id: 'integrations' as const, label: 'Integrations', icon: CreditCard },
            { id: 'calibration' as const, label: 'Calibration', icon: Sliders },
            { id: 'alerts' as const, label: 'Alerts', icon: Bell },
            { id: 'cameras' as const, label: 'Cameras', icon: Camera },
            { id: 'about' as const, label: 'About', icon: Info },
          ].map((tab) => (
            <motion.button
              key={tab.id}
              onClick={() => { haptic('selection'); setActiveTab(tab.id); }}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-primary/20 border border-primary/50 text-white'
                  : 'bg-warm-800 border border-warm-700 text-warm-400 hover:text-white'
              }`}
              whileTap={{ scale: 0.95 }}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </motion.button>
          ))}
        </div>

        <div className="space-y-6">
          {/* Account Tab */}
          {activeTab === 'account' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">Account Information</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Email</label>
                  <input
                    type="text"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Venue</label>
                  <input
                    type="text"
                    value={displayName || 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Role</label>
                  <input
                    type="text"
                    value={user?.role ? getUserRoleDisplay(user.role) : 'Not configured'}
                    disabled
                    className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-warm-300 mb-2">Account Status</label>
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <Check className="w-4 h-4 text-green-400" />
                    <span className="text-green-400 font-medium">Active</span>
                  </div>
                </div>
                <button 
                  onClick={() => setShowPasswordModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors"
                >
                  <Key className="w-4 h-4" />
                  Change Password
                </button>
              </div>
            </motion.div>
          )}

          {/* Change Password Modal */}
          <ChangePasswordModal
            isOpen={showPasswordModal}
            onClose={() => setShowPasswordModal(false)}
          />

          {/* Venue Tab */}
          {activeTab === 'venue' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Address Settings */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CloudSun className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Address</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set your venue's address to enable outdoor weather display on your dashboard. 
                  This address is used to fetch current weather conditions from our weather service.
                </p>
                
                {user?.venueId ? (
                  <AddressSettings 
                    venueId={user.venueId}
                    inline={true}
                    onAddressSaved={(address) => {
                      setSavedAddress(address);
                      // Clear weather cache to trigger refresh
                      weatherService.clearCache();
                    }}
                  />
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">
                      Venue ID not configured. Please contact your administrator.
                    </p>
                  </div>
                )}
                
                {savedAddress && (
                  <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-4 h-4 text-green-400" />
                      <span className="text-sm font-medium text-green-400">Current Address</span>
                    </div>
                    <p className="text-sm text-green-300">
                      {savedAddress.street}, {savedAddress.city}, {savedAddress.state} {savedAddress.zipCode}
                    </p>
                  </div>
                )}
              </div>

              {/* Venue Capacity */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Users className="w-5 h-5 text-green-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Capacity</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set your venue's maximum capacity. This is used to calculate accurate occupancy percentages 
                  and compare to your best historical performance.
                </p>
                
                {user?.venueId ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-warm-300 mb-2">Maximum Capacity (people)</label>
                      <input
                        type="number"
                        min="1"
                        max="10000"
                        value={capacity}
                        onChange={(e) => setCapacity(e.target.value ? Number(e.target.value) : '')}
                        placeholder="e.g., 200"
                        className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      />
                      <p className="text-xs text-warm-500 mt-2">
                        This is the maximum number of people your venue can legally or comfortably hold.
                      </p>
                    </div>
                    
                    <button
                      onClick={handleSaveCapacity}
                      disabled={!capacity || capacitySaving}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                        capacitySaved 
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                          : 'bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {capacitySaved ? (
                        <>
                          <Check className="w-4 h-4" />
                          Saved!
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {capacitySaving ? 'Saving...' : 'Save Capacity'}
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">
                      Venue ID not configured. Please contact your administrator.
                    </p>
                  </div>
                )}
              </div>

              {/* Average Drink Price */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <DollarSign className="w-5 h-5 text-red-400" />
                  <h3 className="text-xl font-semibold text-white">Average Drink Price</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Used to calculate estimated revenue loss from unrung drinks detected by VenueScope.
                  Appears in the Theft Investigation modal and summary totals.
                </p>

                {user?.venueId ? (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-warm-300 mb-2">Price per drink ($)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="0.50"
                        value={avgDrinkPrice}
                        onChange={e => setAvgDrinkPrice(e.target.value ? Number(e.target.value) : '')}
                        placeholder="e.g., 12"
                        className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                      />
                      <p className="text-xs text-warm-500 mt-2">
                        Industry average is $10–$14. Use your venue's average check per drink.
                      </p>
                    </div>

                    <button
                      onClick={handleSaveDrinkPrice}
                      disabled={avgDrinkPrice === '' || drinkPriceSaving}
                      className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                        drinkPriceSaved
                          ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                          : 'bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {drinkPriceSaved ? (
                        <><Check className="w-4 h-4" />Saved!</>
                      ) : (
                        <><Save className="w-4 h-4" />{drinkPriceSaving ? 'Saving...' : 'Save Price'}</>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-sm text-yellow-300">Venue ID not configured.</p>
                  </div>
                )}
              </div>

              {/* Business Hours */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="w-5 h-5 text-teal" />
                  <h3 className="text-xl font-semibold text-white">Business Hours</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set your opening and closing times. Pulse uses this to determine when your bar is open and filter drink counts to your active shift only.
                </p>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Opens at</label>
                    <input
                      type="time"
                      value={bizOpen}
                      onChange={e => setBizOpen(e.target.value)}
                      className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-teal focus:ring-1 focus:ring-teal transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Closes at</label>
                    <input
                      type="time"
                      value={bizClose}
                      onChange={e => setBizClose(e.target.value)}
                      className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white focus:border-teal focus:ring-1 focus:ring-teal transition-colors"
                    />
                    <p className="text-xs text-warm-500 mt-1.5">Can be after midnight (e.g. 2:00 AM)</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (user?.venueId) {
                      venueSettingsService.saveBusinessHours(user.venueId, { open: bizOpen, close: bizClose });
                    } else {
                      localStorage.setItem('pulse_biz_hours', JSON.stringify({ open: bizOpen, close: bizClose }));
                    }
                    haptic('success');
                    setBizHoursSaved(true);
                    setTimeout(() => setBizHoursSaved(false), 3000);
                  }}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                    bizHoursSaved
                      ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                      : 'bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30'
                  }`}
                >
                  {bizHoursSaved ? <><Check className="w-4 h-4" />Saved!</> : <><Save className="w-4 h-4" />Save Hours</>}
                </button>
              </div>

              {/* Camera Proxy URL */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Camera className="w-5 h-5 text-teal" />
                  <h3 className="text-xl font-semibold text-white">Camera Live Feed</h3>
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Set the HTTPS proxy URL for your camera NVR so live feeds appear on the VenueScope tab.
                  This is the URL of your server with <code className="text-teal/80 text-xs bg-black/30 px-1 rounded">/cam</code> appended
                  (e.g. <code className="text-teal/80 text-xs bg-black/30 px-1 rounded">https://your-server.sslip.io/cam</code>).
                  Each venue has its own URL. Leave blank to hide live feeds.
                </p>
                <div className="space-y-3">
                  <input
                    type="url"
                    value={camProxy}
                    onChange={e => setCamProxy(e.target.value)}
                    placeholder="https://137-184-61-178.sslip.io/cam"
                    className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white text-sm focus:border-teal focus:ring-1 focus:ring-teal transition-colors font-mono"
                  />
                  <button
                    onClick={async () => {
                      if (!user?.venueId) return;
                      setCamProxySaving(true);
                      await venueSettingsService.saveCamProxyUrl(user.venueId, camProxy.trim());
                      haptic('success');
                      setCamProxySaved(true);
                      setTimeout(() => setCamProxySaved(false), 3000);
                      setCamProxySaving(false);
                    }}
                    disabled={camProxySaving}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-all ${
                      camProxySaved
                        ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                        : 'bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30'
                    }`}
                  >
                    {camProxySaving ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     camProxySaved ? <><Check className="w-4 h-4" />Saved!</> :
                     <><Save className="w-4 h-4" />Save Camera URL</>}
                  </button>
                </div>
              </div>

              {/* Venue Info (read-only) */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Building2 className="w-5 h-5 text-cyan-400" />
                  <h3 className="text-xl font-semibold text-white">Venue Information</h3>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Venue Name</label>
                    <input
                      type="text"
                      value={displayName || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Venue ID</label>
                    <input
                      type="text"
                      value={user?.venueId || 'Not configured'}
                      disabled
                      className="w-full px-4 py-2 bg-warm-900 border border-warm-700 rounded-lg text-warm-400 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-warm-500">
                    Venue information is managed by your system administrator. Contact support to make changes.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <motion.div
              className="space-y-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <POSIntegration />
              </div>

              {/* Square POS — direct credentials for VenueScope POS reconciliation */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-1">
                  <CreditCard className="w-5 h-5 text-warm-300" />
                  <h3 className="text-xl font-semibold text-white">Square POS — VenueScope Reconciliation</h3>
                  {squareIsConfigured && (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full px-2.5 py-0.5">
                      <Check className="w-3 h-3" /> Configured
                    </span>
                  )}
                </div>
                <p className="text-sm text-warm-400 mb-6">
                  Store Square credentials locally to enable POS reconciliation in VenueScope.
                  Camera drink counts are compared against Square order data to detect variance.
                </p>

                <div className="space-y-4">
                  {/* Access Token */}
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Access Token</label>
                    <div className="relative">
                      <input
                        type={showSquareToken ? 'text' : 'password'}
                        value={squareCreds.accessToken}
                        onChange={e => setSquareCreds(c => ({ ...c, accessToken: e.target.value }))}
                        placeholder="EAAAl..."
                        className="w-full px-4 py-3 pr-12 bg-warm-900 border border-warm-700 rounded-lg text-white font-mono text-sm focus:border-teal focus:ring-1 focus:ring-teal transition-colors placeholder-warm-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSquareToken(s => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-warm-500 hover:text-white transition-colors"
                      >
                        {showSquareToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-warm-500 mt-1.5">
                      Find at developer.squareup.com → your app → Credentials → Production Access Token.
                    </p>
                  </div>

                  {/* Location ID */}
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Location ID</label>
                    <input
                      type="text"
                      value={squareCreds.locationId}
                      onChange={e => setSquareCreds(c => ({ ...c, locationId: e.target.value }))}
                      placeholder="L1234567890ABCD"
                      className="w-full px-4 py-3 bg-warm-900 border border-warm-700 rounded-lg text-white font-mono text-sm focus:border-teal focus:ring-1 focus:ring-teal transition-colors placeholder-warm-600"
                    />
                    <p className="text-xs text-warm-500 mt-1.5">
                      Found in your Square Dashboard → Account &amp; Settings → Business locations.
                    </p>
                  </div>

                  {/* Environment toggle */}
                  <div>
                    <label className="block text-sm font-medium text-warm-300 mb-2">Environment</label>
                    <div className="flex gap-2">
                      {(['production', 'sandbox'] as const).map(env => (
                        <button
                          key={env}
                          onClick={() => setSquareCreds(c => ({ ...c, environment: env }))}
                          className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                            squareCreds.environment === env
                              ? 'bg-teal/20 border-teal/50 text-teal'
                              : 'bg-warm-900 border-warm-700 text-warm-400 hover:text-white hover:border-warm-600'
                          }`}
                        >
                          {env.charAt(0).toUpperCase() + env.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Test result */}
                  {squareTestResult && (
                    <div className={`flex items-center gap-2 px-4 py-3 rounded-lg border text-sm ${
                      squareTestResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                        : 'bg-red-500/10 border-red-500/30 text-red-400'
                    }`}>
                      {squareTestResult.ok
                        ? <Check className="w-4 h-4 flex-shrink-0" />
                        : <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      }
                      {squareTestResult.message}
                    </div>
                  )}

                  {/* Buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSquareTest}
                      disabled={!squareCreds.accessToken.trim() || !squareCreds.locationId.trim() || squareTesting}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm bg-warm-700 hover:bg-warm-600 text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {squareTesting
                        ? <><RefreshCw className="w-4 h-4 animate-spin" />Testing…</>
                        : <><Wifi className="w-4 h-4" />Test Connection</>
                      }
                    </button>
                    <button
                      onClick={handleSquareSave}
                      disabled={!squareCreds.accessToken.trim() || !squareCreds.locationId.trim()}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                        squareSaved
                          ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400'
                          : 'bg-teal/20 border border-teal/50 text-teal hover:bg-teal/30'
                      }`}
                    >
                      {squareSaved ? <><Check className="w-4 h-4" />Saved!</> : <><Save className="w-4 h-4" />Save Credentials</>}
                    </button>
                    {squareIsConfigured && (
                      <button
                        onClick={handleSquareClear}
                        className="px-4 py-3 rounded-lg font-medium text-sm bg-warm-800 border border-warm-700 text-warm-400 hover:text-red-400 hover:border-red-500/40 transition-all"
                        title="Remove credentials"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-warm-500 text-center">
                    Credentials stored locally in your browser. Never sent to our servers.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* Calibration Tab */}
          {activeTab === 'calibration' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex items-center gap-3 mb-4">
                <Sliders className="w-5 h-5 text-primary" />
                <h3 className="text-xl font-semibold text-white">Venue Calibration</h3>
              </div>
              <p className="text-sm text-warm-400 mb-6">
                Customize optimal sound and light ranges for your specific venue type.
                These settings affect how Pulse Score and recommendations are calculated.
              </p>
              
              {user?.venueId ? (
                <CalibrationSettings venueId={user.venueId} />
              ) : (
                <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-sm text-yellow-300">
                    Venue ID not configured. Please contact your administrator.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {/* Alerts Tab */}
          {activeTab === 'alerts' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6 space-y-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div>
                <h3 className="text-xl font-semibold text-white mb-1">Alert Thresholds</h3>
                <p className="text-sm text-warm-400">Get notified in-app when your venue needs attention.</p>
              </div>

              {/* Helper to render a toggle row */}
              {([
                {
                  key: 'capacityEnabled',
                  label: 'Crowd capacity',
                  desc: 'Alert when occupancy exceeds a % of your venue limit',
                  threshold: { key: 'capacityThresholdPct', label: 'Alert at', suffix: '% of capacity', min: 50, max: 100 },
                },
                {
                  key: 'dwellEnabled',
                  label: 'Dwell time drop',
                  desc: 'Alert when average stay drops vs last week',
                  threshold: { key: 'dwellDropPct', label: 'Alert when drops by', suffix: '%', min: 5, max: 50 },
                },
                {
                  key: 'pulseEnabled',
                  label: 'Low Pulse Score',
                  desc: 'Alert when score falls below threshold',
                  threshold: { key: 'pulseThreshold', label: 'Alert below score', suffix: '', min: 10, max: 60 },
                },
                {
                  key: 'connectionEnabled',
                  label: 'Sensor connection lost',
                  desc: 'Alert when sensor data goes stale',
                  threshold: { key: 'connectionStaleMinutes', label: 'Alert after', suffix: ' min without data', min: 5, max: 60 },
                },
                {
                  key: 'posEnabled',
                  label: 'POS vs Camera variance',
                  desc: 'Alert when drink count differs from POS',
                  threshold: { key: 'posVariancePct', label: 'Alert above', suffix: '% variance', min: 5, max: 50 },
                },
              ] as const).map(({ key, label, desc, threshold }) => (
                <div key={key} className="border border-warm-700 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-warm-400 mt-0.5">{desc}</p>
                    </div>
                    <button
                      onClick={() => setAlertPrefs(p => ({ ...p, [key]: !p[key as keyof AlertPreferences] }))}
                      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${alertPrefs[key as keyof AlertPreferences] ? 'bg-primary' : 'bg-warm-700'}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${alertPrefs[key as keyof AlertPreferences] ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  </div>
                  {alertPrefs[key as keyof AlertPreferences] && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-warm-400 flex-shrink-0">{threshold.label}</span>
                      <input
                        type="range"
                        min={threshold.min}
                        max={threshold.max}
                        value={alertPrefs[threshold.key as keyof AlertPreferences] as number}
                        onChange={e => setAlertPrefs(p => ({ ...p, [threshold.key]: Number(e.target.value) }))}
                        className="flex-1 accent-primary"
                      />
                      <span className="text-sm font-semibold text-white w-24 text-right flex-shrink-0">
                        {alertPrefs[threshold.key as keyof AlertPreferences] as number}{threshold.suffix}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              <motion.button
                onClick={() => {
                  alertsService.savePreferences(alertPrefs);
                  haptic('success');
                  setAlertsSaved(true);
                  setTimeout(() => setAlertsSaved(false), 3000);
                }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary/20 border border-primary/40 text-white font-medium text-sm hover:bg-primary/30 transition-colors"
                whileTap={{ scale: 0.97 }}
              >
                {alertsSaved ? <><Check className="w-4 h-4 text-primary" /> Saved</> : <><Save className="w-4 h-4" /> Save Alert Settings</>}
              </motion.button>
            </motion.div>
          )}

          {/* Cameras Tab */}
          {activeTab === 'cameras' && (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Connection Status */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {connectStatus?.connected
                      ? <Wifi className="w-5 h-5 text-green-400" />
                      : <WifiOff className="w-5 h-5 text-warm-500" />
                    }
                    <h3 className="text-xl font-semibold text-white">VenueScope Connect</h3>
                  </div>
                  <button
                    onClick={async () => {
                      setConnectLoading(true);
                      connectService.clearCache();
                      const s = await connectService.getStatus();
                      setConnectStatus(s);
                      setConnectLoading(false);
                    }}
                    className="p-2 text-warm-400 hover:text-white transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${connectLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {connectStatus?.connected ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-500/10 border border-green-500/30 rounded-lg mb-4">
                    <Circle className="w-2 h-2 fill-green-400 text-green-400" />
                    <span className="text-green-400 text-sm font-medium">
                      Connected — {connectStatus.cameraCount} camera{connectStatus.cameraCount !== 1 ? 's' : ''} active
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-warm-700/50 border border-warm-600 rounded-lg mb-4">
                    <Circle className="w-2 h-2 fill-warm-500 text-warm-500" />
                    <span className="text-warm-400 text-sm">
                      No venue PC connected yet
                    </span>
                  </div>
                )}

                <p className="text-sm text-warm-400 mb-5">
                  Download the setup file for the venue's computer. Double-clicking it
                  automatically installs Tailscale, connects to VenueScope, and notifies
                  your dashboard — no configuration needed.
                </p>

                {/* OS Selector */}
                <div className="mb-5">
                  <p className="text-xs text-warm-500 mb-2 uppercase tracking-wide font-medium">Venue computer's operating system</p>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { id: 'mac'     as VenueOS, label: '🍎  Mac',     file: '.sh' },
                      { id: 'windows' as VenueOS, label: '🪟  Windows', file: '.bat'     },
                      { id: 'linux'   as VenueOS, label: '🐧  Linux',   file: '.sh'      },
                    ]).map(({ id, label, file }) => (
                      <button
                        key={id}
                        onClick={() => setSelectedOS(id)}
                        className={`flex flex-col items-center gap-1 px-3 py-3 rounded-xl border text-sm font-medium transition-all ${
                          selectedOS === id
                            ? 'bg-primary/20 border-primary/60 text-white'
                            : 'bg-warm-800 border-warm-700 text-warm-400 hover:text-white hover:border-warm-600'
                        }`}
                      >
                        <span>{label}</span>
                        <span className="text-[10px] text-warm-500">{file}</span>
                      </button>
                    ))}
                  </div>
                  {selectedOS === detectOS() && (
                    <p className="text-[11px] text-teal mt-2">✓ Auto-detected from your browser</p>
                  )}
                </div>

                <button
                  onClick={() => connectService.downloadInstaller(selectedOS)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 rounded-lg font-medium transition-all"
                >
                  <Download className="w-4 h-4" />
                  Download Setup File
                </button>

                <div className="mt-4 space-y-3">
                  {(selectedOS === 'mac' ? [
                    { step: '1', text: 'Download the file, then open Terminal and paste this:', code: 'bash ~/Downloads/connect-venuescope.sh' },
                    { step: '2', text: 'Script installs Tailscale and joins the VenueScope network — no login needed' },
                    { step: '3', text: 'Cameras appear in your dashboard within 2 minutes' },
                  ] : selectedOS === 'windows' ? [
                    { step: '1', text: 'Download the file and double-click it — Command Prompt opens automatically' },
                    { step: '2', text: 'If Tailscale is not installed, the script opens the installer — run it, then double-click the file again' },
                    { step: '3', text: 'Cameras appear in your dashboard within 2 minutes' },
                  ] : [
                    { step: '1', text: 'Download the file, then open Terminal and paste this:', code: 'bash ~/Downloads/connect-venuescope.sh' },
                    { step: '2', text: 'Script installs Tailscale and joins the VenueScope network' },
                    { step: '3', text: 'Cameras appear in your dashboard within 2 minutes' },
                  ]).map(({ step, text, code }: { step: string; text: string; code?: string }) => (
                    <div key={step} className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 border border-primary/40 text-primary text-xs flex items-center justify-center font-bold">
                        {step}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm text-warm-300 pt-0.5">{text}</p>
                        {code && (
                          <code className="mt-1.5 block text-xs bg-warm-900 border border-warm-700 rounded-lg px-3 py-2 text-teal font-mono select-all">
                            {code}
                          </code>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Connected Cameras */}
              {connectStatus?.cameras && connectStatus.cameras.length > 0 && (
                <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Camera className="w-5 h-5 text-cyan-400" />
                    <h3 className="text-xl font-semibold text-white">Connected Cameras</h3>
                  </div>
                  <div className="space-y-3">
                    {connectStatus.cameras.map((cam) => (
                      <div
                        key={cam.cameraId}
                        className="flex items-center justify-between p-4 bg-warm-900/50 border border-warm-700 rounded-xl gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <Circle className={`w-2 h-2 flex-shrink-0 ${
                            cam.isOnline ? 'fill-green-400 text-green-400' : 'fill-red-400 text-red-400'
                          }`} />
                          <div className="min-w-0 flex-1">
                            {renamingId === cam.cameraId ? (
                              <div className="flex items-center gap-2">
                                <input
                                  ref={renameInputRef}
                                  value={renameValue}
                                  onChange={e => setRenameValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveRename(); if (e.key === 'Escape') setRenamingId(null); }}
                                  className="text-sm font-medium bg-warm-800 border border-teal/50 rounded px-2 py-0.5 text-white w-full focus:outline-none focus:border-teal"
                                  autoFocus
                                />
                                <button onClick={saveRename} disabled={renameSaving} className="text-teal hover:text-teal/80 flex-shrink-0">
                                  {renameSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => setRenamingId(null)} className="text-warm-500 hover:text-warm-300 flex-shrink-0">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 group">
                                <p className="text-sm font-medium text-white truncate">{cam.name}</p>
                                <button
                                  onClick={() => startRename(cam)}
                                  className="opacity-0 group-hover:opacity-100 text-warm-500 hover:text-warm-300 flex-shrink-0 transition-opacity"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                            <p className="text-xs text-warm-500">{cam.cameraId} · {cam.mode}</p>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full flex-shrink-0 ${
                          cam.enabled
                            ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                            : 'bg-warm-700 text-warm-400 border border-warm-600'
                        }`}>
                          {cam.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Camera Registry ──────────────────────────────────────── */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Camera className="w-5 h-5 text-primary" />
                    <h3 className="text-xl font-semibold text-white">Camera Registry</h3>
                    <span className="text-xs text-warm-500 bg-warm-700 px-2 py-0.5 rounded-full">{regCameras.length} camera{regCameras.length !== 1 ? 's' : ''}</span>
                  </div>
                  <button onClick={() => setShowAddCam(v => !v)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 border border-primary/50 text-primary hover:bg-primary/30 rounded-lg text-sm font-medium transition-all">
                    <span>{showAddCam ? '✕ Cancel' : '+ Add Camera'}</span>
                  </button>
                </div>
                <p className="text-sm text-warm-400 mb-4">Register RTSP cameras per venue. The worker daemon connects and runs analysis automatically.</p>

                {/* ── Camera Setup Wizard ── */}
                <div className="mb-5 border border-warm-700 rounded-xl overflow-hidden">

                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 bg-warm-900/60 border-b border-warm-700">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-teal" />
                      <p className="text-sm font-semibold text-white">Camera Setup &amp; Discovery</p>
                      {discoveryDone && allDiscovered.length > 0 && (
                        <span className="text-xs px-2 py-0.5 bg-teal/20 border border-teal/30 text-teal rounded-full">
                          {allDiscovered.filter(d => d.is_camera).length} camera{allDiscovered.filter(d => d.is_camera).length !== 1 ? 's' : ''} found
                        </span>
                      )}
                    </div>
                    <button
                      onClick={runFullDiscovery}
                      disabled={discoveryRunning || !serverUrl}
                      className="flex items-center gap-2 px-4 py-2 bg-teal/20 border border-teal/40 text-teal hover:bg-teal/30 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                    >
                      {discoveryRunning
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Discovering…</>
                        : <><Search className="w-3.5 h-3.5" /> Run Discovery</>
                      }
                    </button>
                  </div>

                  <div className="p-4 space-y-5">

                    {/* 1 — Worker Network */}
                    <div>
                      <p className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-2">
                        Worker Network
                        {networkInfo && <span className="ml-2 normal-case text-warm-600 font-normal">{networkInfo.hostname} · {networkInfo.platform}</span>}
                      </p>
                      {!serverUrl && (
                        <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          <p className="text-xs text-amber-300">No VenueScope server URL configured. The worker must be running on a machine with access to the camera network.</p>
                        </div>
                      )}
                      {networkInfo && networkInfo.interfaces.length > 0 && (
                        <div className="space-y-1.5">
                          {networkInfo.interfaces.map((iface: any, i: number) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 bg-warm-800/60 border border-warm-700 rounded-lg">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                                <span className="text-xs font-mono text-white">{iface.ip}</span>
                                {iface.prefix != null && <span className="text-xs text-warm-500 font-mono">/{iface.prefix}</span>}
                                <span className="text-xs text-warm-600">{iface.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {iface.subnet && (
                                  <button onClick={() => setSubnetInput(iface.subnet)} className="text-xs text-teal hover:text-teal/80 transition-colors">
                                    scan →
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Subnet input */}
                      <div className="flex gap-2 mt-2">
                        <input
                          value={subnetInput}
                          onChange={e => setSubnetInput(e.target.value)}
                          placeholder="192.168.1.0/24"
                          className="flex-1 bg-warm-800 border border-warm-600 rounded-lg px-3 py-1.5 text-sm text-white font-mono placeholder-warm-600 focus:outline-none focus:border-teal"
                        />
                        <button
                          onClick={runFullDiscovery}
                          disabled={discoveryRunning || !serverUrl}
                          className="flex-shrink-0 px-3 py-1.5 bg-warm-800 border border-warm-600 text-warm-300 hover:text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                        >
                          {discoveryRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Scan'}
                        </button>
                      </div>
                    </div>

                    {/* 2 — Discovery Results */}
                    {(discoveryRunning || allDiscovered.length > 0) && (
                      <div>
                        <p className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-2">
                          Discovered Devices
                          {subnetScanned > 0 && <span className="ml-2 normal-case font-normal text-warm-600">{subnetScanned} hosts scanned</span>}
                        </p>

                        {discoveryRunning && allDiscovered.length === 0 && (
                          <div className="flex items-center gap-2 text-xs text-warm-400 py-2">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Running ARP, subnet scan, and ONVIF discovery simultaneously…
                          </div>
                        )}

                        <div className="space-y-2">
                          {allDiscovered.map(host => {
                            const result = identifyResults[host.ip];
                            const isExpanded = expandedIp === host.ip;
                            const isIdentifying = identifyingIp === host.ip;
                            const selChannels = selectedChannels[host.ip] || {};
                            const chNames = channelNames[host.ip] || {};
                            const numSelected = Object.values(selChannels).filter(Boolean).length;

                            return (
                              <div key={host.ip} className={`rounded-xl border overflow-hidden ${
                                host.is_camera ? 'border-green-500/30' : 'border-warm-700'
                              }`}>
                                {/* Device row */}
                                <div
                                  className={`flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer ${
                                    host.is_camera ? 'bg-green-500/5' : 'bg-warm-800/40'
                                  }`}
                                  onClick={() => setExpandedIp(isExpanded ? null : host.ip)}
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${host.is_camera ? 'bg-green-400' : 'bg-warm-500'}`} />
                                    <span className="text-sm font-mono text-white">{host.ip}</span>
                                    {host.vendor && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded font-medium flex-shrink-0">{host.vendor}</span>
                                    )}
                                    {host.arp_hostname && (
                                      <span className="text-xs text-warm-500 truncate">{host.arp_hostname}</span>
                                    )}
                                    {host.is_camera && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-green-500/20 text-green-400 border border-green-500/20 rounded font-medium flex-shrink-0">CAMERA</span>
                                    )}
                                    {host.onvif && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded font-medium flex-shrink-0">ONVIF</span>
                                    )}
                                    {result && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-warm-700 text-warm-300 border border-warm-600 rounded font-medium flex-shrink-0">
                                        {result.brand}{result.model ? ` · ${result.model}` : ''}
                                      </span>
                                    )}
                                    <div className="flex gap-1 flex-shrink-0">
                                      {Object.keys(host.ports || {}).map(p => (
                                        <span key={p} className={`text-[10px] px-1 py-0.5 rounded font-mono border ${
                                          p === '554' || p === '8554'
                                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                                            : 'bg-warm-700/60 text-warm-500 border-warm-600'
                                        }`}>:{p}</span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {result?.channels?.length > 0 && (
                                      <span className="text-xs text-green-400 font-medium">{result.channels.length} stream{result.channels.length !== 1 ? 's' : ''}</span>
                                    )}
                                    {isExpanded ? <ChevronDown className="w-4 h-4 text-warm-500" /> : <ChevronRight className="w-4 h-4 text-warm-500" />}
                                  </div>
                                </div>

                                {/* Expanded panel */}
                                {isExpanded && (
                                  <div className="border-t border-warm-700 p-3 space-y-3 bg-warm-900/30">

                                    {/* ARP info */}
                                    {(host.mac || host.vendor) && (
                                      <div className="flex items-center gap-3 text-xs text-warm-500 font-mono">
                                        {host.mac && <span>MAC: {host.mac}</span>}
                                        {host.vendor && <span className="text-warm-400">({host.vendor})</span>}
                                      </div>
                                    )}

                                    {/* Credentials */}
                                    <div className="flex gap-2 items-end">
                                      <div className="flex-1">
                                        <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Username</label>
                                        <input
                                          value={camCreds[host.ip]?.u ?? 'admin'}
                                          onChange={e => setCamCreds(p => ({ ...p, [host.ip]: { ...p[host.ip], u: e.target.value } }))}
                                          className="w-full bg-warm-800 border border-warm-600 rounded px-2 py-1.5 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal"
                                        />
                                      </div>
                                      <div className="flex-1">
                                        <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Password</label>
                                        <input
                                          type="password"
                                          value={camCreds[host.ip]?.p ?? ''}
                                          onChange={e => setCamCreds(p => ({ ...p, [host.ip]: { ...p[host.ip], p: e.target.value } }))}
                                          className="w-full bg-warm-800 border border-warm-600 rounded px-2 py-1.5 text-xs text-white placeholder-warm-600 focus:outline-none focus:border-teal"
                                        />
                                      </div>
                                      <button
                                        onClick={() => identifyCamera(host.ip)}
                                        disabled={isIdentifying}
                                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                                      >
                                        {isIdentifying
                                          ? <><Loader2 className="w-3 h-3 animate-spin" /> Identifying…</>
                                          : <><Search className="w-3 h-3" /> Identify</>
                                        }
                                      </button>
                                    </div>

                                    {/* Identity result */}
                                    {result && (
                                      <div className="space-y-2">
                                        <div className="flex items-center gap-2">
                                          {result.auth_ok
                                            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                                            : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                                          }
                                          <span className="text-xs text-warm-300">
                                            {result.brand}{result.model ? ` ${result.model}` : ''}
                                            {result.auth_ok && result.creds_used && (
                                              <span className="text-warm-500 ml-1">
                                                · auth: {result.creds_used.username}/{result.creds_used.password || '(blank)'}
                                              </span>
                                            )}
                                            {!result.auth_ok && <span className="text-amber-400 ml-1">· auth failed — check credentials</span>}
                                          </span>
                                        </div>

                                        {result.channels?.length > 0 && (
                                          <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                              <p className="text-[10px] text-warm-500 uppercase tracking-wide font-medium">
                                                {result.channels.length} stream{result.channels.length !== 1 ? 's' : ''} found — select to register:
                                              </p>
                                              <button
                                                onClick={() => {
                                                  const all: Record<number,boolean> = {};
                                                  result.channels.forEach((c: any) => { all[c.num] = true; });
                                                  setSelectedChannels(p => ({...p, [host.ip]: all}));
                                                }}
                                                className="text-[10px] text-teal hover:text-teal/80 transition-colors"
                                              >
                                                select all
                                              </button>
                                            </div>
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                              {result.channels.map((ch: any) => (
                                                <div key={ch.num} className="flex items-center gap-2 px-2 py-1.5 bg-warm-800/60 border border-warm-700 rounded-lg">
                                                  <input
                                                    type="checkbox"
                                                    checked={selChannels[ch.num] ?? false}
                                                    onChange={e => setSelectedChannels(p => ({
                                                      ...p, [host.ip]: { ...(p[host.ip]||{}), [ch.num]: e.target.checked }
                                                    }))}
                                                    className="w-3.5 h-3.5 accent-teal flex-shrink-0"
                                                  />
                                                  <span className="text-[10px] text-warm-500 font-mono flex-shrink-0">CH{ch.num}</span>
                                                  <input
                                                    value={chNames[ch.num] ?? ch.label ?? `Channel ${ch.num}`}
                                                    onChange={e => setChannelNames(p => ({
                                                      ...p, [host.ip]: { ...(p[host.ip]||{}), [ch.num]: e.target.value }
                                                    }))}
                                                    className="flex-1 bg-warm-900 border border-warm-700 rounded px-2 py-0.5 text-xs text-white focus:outline-none focus:border-teal"
                                                  />
                                                  <span className="text-[10px] text-warm-600 font-mono truncate max-w-[160px]">{ch.rtsp_url.replace(/:[^@]*@/, ':●●●@')}</span>
                                                </div>
                                              ))}
                                            </div>

                                            {/* Venue + mode + register */}
                                            <div className="mt-3 space-y-2">
                                              <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                  <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Venue</label>
                                                  <input
                                                    value={batchVenue || newCam.venue}
                                                    onChange={e => setBatchVenue(e.target.value)}
                                                    placeholder="Ferg's Bar"
                                                    className="w-full bg-warm-800 border border-warm-600 rounded px-2 py-1.5 text-xs text-white placeholder-warm-500 focus:outline-none focus:border-teal"
                                                  />
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-warm-500 mb-1 block uppercase tracking-wide">Mode</label>
                                                  <select
                                                    value={batchMode}
                                                    onChange={e => setBatchMode(e.target.value)}
                                                    className="w-full bg-warm-800 border border-warm-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-teal"
                                                  >
                                                    <option value="drink_count">🍺 Drink Count</option>
                                                    <option value="people_count">🚶 People Count</option>
                                                    <option value="staff_activity">👷 Staff Activity</option>
                                                    <option value="table_turns">🪑 Table Turns</option>
                                                    <option value="after_hours">🔒 After Hours</option>
                                                  </select>
                                                </div>
                                              </div>
                                              <button
                                                onClick={() => batchRegister(host.ip)}
                                                disabled={registering === host.ip || numSelected === 0}
                                                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500/20 border border-green-500/40 text-green-400 hover:bg-green-500/30 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                                              >
                                                {registering === host.ip
                                                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Registering…</>
                                                  : <><Plus className="w-3.5 h-3.5" /> Register {numSelected} Camera{numSelected !== 1 ? 's' : ''}</>
                                                }
                                              </button>
                                            </div>
                                          </div>
                                        )}

                                        {result.channels?.length === 0 && !result.single_stream && (
                                          <p className="text-xs text-warm-500">No streams found. Try different credentials or add the RTSP URL manually below.</p>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {discoveryDone && allDiscovered.length === 0 && (
                          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-300">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                            No devices found on {subnetInput}. Check that the worker machine is on the same network as the cameras.
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3 — Registered Stream Status */}
                    <div>
                      <p className="text-xs text-warm-500 uppercase tracking-wide font-medium mb-2">
                        Registered Stream Status
                        <span className="ml-2 text-warm-600 normal-case font-normal">· auto-refreshes every 15s</span>
                        {streamLastScanned && (
                          <span className="ml-1 text-warm-600 normal-case font-normal">· {streamLastScanned.toLocaleTimeString()}</span>
                        )}
                      </p>
                      {streamScanResults.length === 0 && (
                        <p className="text-xs text-warm-500 italic">No cameras registered yet — discover and add cameras above.</p>
                      )}
                      <div className="space-y-1.5">
                        {streamScanResults.map((cam: any) => {
                          const isLive = cam.status === 'live' || cam.status === 'reachable';
                          const isOff  = cam.status === 'offline' || cam.status === 'error';
                          return (
                            <div key={cam.camera_id} className="flex items-center justify-between gap-3 px-3 py-2 bg-warm-800/60 border border-warm-700 rounded-lg">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isLive ? 'bg-green-400 animate-pulse' : isOff ? 'bg-red-400' : 'bg-warm-500'}`} />
                                <span className="text-xs font-medium text-white truncate">{cam.name}</span>
                                {cam.mode && <span className="text-xs text-warm-500 flex-shrink-0">{cam.mode.split(',')[0]}</span>}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {cam.latency_ms != null && <span className="text-xs text-warm-500">{cam.latency_ms}ms</span>}
                                {isOff && cam.error && <span className="text-xs text-red-400 truncate max-w-[100px]">{cam.error}</span>}
                                <span className={`text-xs font-semibold ${isLive ? 'text-green-400' : isOff ? 'text-red-400' : 'text-warm-400'}`}>
                                  {isLive ? 'LIVE' : isOff ? 'OFFLINE' : cam.status.toUpperCase()}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>
                </div>

                {/* Add camera form */}
                {showAddCam && (
                  <div className="mb-5 p-4 bg-warm-900/60 border border-warm-600 rounded-xl space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-warm-400 mb-1 block">Venue *</label>
                        {regVenues.length > 0 ? (
                          <select value={newCam.venue} onChange={e => setNewCam(p => ({ ...p, venue: e.target.value }))}
                            className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                            <option value="">➕ New venue…</option>
                            {regVenues.map(v => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : null}
                        {(regVenues.length === 0 || newCam.venue === '') && (
                          <input placeholder="Ferg's Bar" value={newCam.venue}
                            onChange={e => setNewCam(p => ({ ...p, venue: e.target.value }))}
                            className="w-full mt-1 bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm placeholder-warm-500 focus:outline-none focus:border-primary" />
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-warm-400 mb-1 block">Camera Name *</label>
                        <input placeholder="Bar — CH9" value={newCam.name}
                          onChange={e => setNewCam(p => ({ ...p, name: e.target.value }))}
                          className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm placeholder-warm-500 focus:outline-none focus:border-primary" />
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-warm-400 mb-1 block">RTSP URL *</label>
                      <input placeholder="rtsp://admin:pass@192.168.1.x:554/stream1" value={newCam.rtsp_url}
                        onChange={e => setNewCam(p => ({ ...p, rtsp_url: e.target.value }))}
                        className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm placeholder-warm-500 font-mono focus:outline-none focus:border-primary" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-warm-400 mb-1 block">Analysis Mode</label>
                        <select value={newCam.mode} onChange={e => setNewCam(p => ({ ...p, mode: e.target.value }))}
                          className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                          <option value="drink_count">🍺 Drink Count</option>
                          <option value="bottle_count">🍾 Bottle Count</option>
                          <option value="people_count">🚶 People Count</option>
                          <option value="staff_activity">👷 Staff Activity</option>
                          <option value="after_hours">🔒 After Hours</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-warm-400 mb-1 block">Model Profile</label>
                        <select value={newCam.model_profile} onChange={e => setNewCam(p => ({ ...p, model_profile: e.target.value }))}
                          className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary">
                          <option value="fast">Fast</option>
                          <option value="balanced">Balanced</option>
                          <option value="accurate">Accurate</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-warm-400 mb-1 block">Notes (optional)</label>
                      <input placeholder="Overhead fisheye, covers full bar. CH9." value={newCam.notes}
                        onChange={e => setNewCam(p => ({ ...p, notes: e.target.value }))}
                        className="w-full bg-warm-800 border border-warm-600 rounded-lg px-3 py-2 text-white text-sm placeholder-warm-500 focus:outline-none focus:border-primary" />
                    </div>
                    <div className="pt-1 text-xs text-warm-500">
                      <strong className="text-warm-400">RTSP formats:</strong> Hikvision: <code className="text-teal">rtsp://admin:PASS@IP:554/Streaming/Channels/101</code> &nbsp;·&nbsp;
                      Dahua: <code className="text-teal">rtsp://admin:PASS@IP:554/cam/realmonitor?channel=1&subtype=0</code> &nbsp;·&nbsp;
                      Reolink: <code className="text-teal">rtsp://admin:PASS@IP:554/h264Preview_01_main</code>
                    </div>
                    <button onClick={saveRegCamera} disabled={camSaving || !newCam.venue.trim() || !newCam.name.trim() || !newCam.rtsp_url.trim()}
                      className="w-full py-2 bg-primary text-white rounded-lg font-medium hover:bg-primary/80 disabled:opacity-40 transition-all text-sm">
                      {camSaving ? 'Saving…' : '💾 Save Camera'}
                    </button>
                  </div>
                )}

                {/* Camera list grouped by venue */}
                {regCameras.length === 0 ? (
                  <p className="text-sm text-warm-500 text-center py-4">No cameras registered yet.</p>
                ) : (
                  <div className="space-y-4">
                    {regVenues.map(venue => {
                      const cams = regCameras.filter(c => c.venue === venue);
                      if (!cams.length) return null;
                      return (
                        <div key={venue}>
                          <p className="text-xs font-semibold text-warm-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                            <span>🏠</span>{venue}
                          </p>
                          <div className="space-y-2">
                            {cams.map(cam => (
                              <div key={cam.camera_id} className="flex items-center justify-between p-3 bg-warm-900/50 border border-warm-700 rounded-xl gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-white truncate">{cam.name}</p>
                                  <p className="text-xs text-warm-500 font-mono truncate">{cam.rtsp_url}</p>
                                  <p className="text-xs text-warm-600">{cam.mode} · {cam.model_profile}</p>
                                </div>
                                <button onClick={() => deleteRegCamera(cam.camera_id)}
                                  className="p-1.5 text-warm-500 hover:text-red-400 transition-colors flex-shrink-0">
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Requirements */}
              <div className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6">
                <h3 className="text-lg font-semibold text-white mb-3">Requirements</h3>
                <ul className="space-y-2 text-sm text-warm-400">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    Any always-on Windows, Mac, or Linux PC at the venue
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    PC must be on the same network as the cameras
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    Internet connection (outbound only — no ports to open)
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                    PC plugged into power
                  </li>
                </ul>
              </div>
            </motion.div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <motion.div
              className="bg-warm-800/50 border border-warm-700 rounded-2xl p-6"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <h3 className="text-xl font-semibold text-white mb-6">About Pulse</h3>
              <div className="space-y-6">
                <div className="text-center py-6">
                  <div className="text-4xl font-bold bg-gradient-to-r from-primary to-cyan-400 bg-clip-text text-transparent mb-2">Pulse</div>
                  <div className="text-warm-400 mb-1">by Advizia</div>
                  <div className="text-sm text-warm-500">Version 2.0.0</div>
                  <div className="text-xs text-warm-600 mt-2">Last Updated: March 2026</div>
                </div>

                <div className="space-y-3">
                  <div className="p-4 bg-warm-900 rounded-lg">
                    <div className="text-sm text-warm-400 mb-1">Support</div>
                    <a href="mailto:support@advizia.com" className="text-cyan-400 hover:text-cyan-300">
                      support@advizia.com
                    </a>
                  </div>

                  <div className="p-4 bg-warm-900 rounded-lg">
                    <div className="text-sm text-warm-400 mb-1">Documentation</div>
                    <a href="#" className="text-cyan-400 hover:text-cyan-300">
                      docs.advizia.com
                    </a>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button className="flex-1 px-4 py-2 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors text-sm">
                    Terms of Service
                  </button>
                  <button className="flex-1 px-4 py-2 bg-warm-700 hover:bg-warm-600 text-white rounded-lg transition-colors text-sm">
                    Privacy Policy
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
