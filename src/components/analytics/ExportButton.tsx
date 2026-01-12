/**
 * ExportButton - Export options for Analytics page
 * 
 * Mobile: Expandable button
 * Desktop: Inline row of options
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, ChevronDown, FileText, Mail, Link2 } from 'lucide-react';
import { haptic } from '../../utils/haptics';

interface ExportButtonProps {
  onDownloadCSV: () => void;
  onEmailSummary: () => void;
  onCopyLink: () => void;
  disabled?: boolean;
}

export function ExportButton({ 
  onDownloadCSV, 
  onEmailSummary, 
  onCopyLink,
  disabled = false 
}: ExportButtonProps) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    haptic('light');
    setExpanded(!expanded);
  };

  const handleAction = (action: () => void) => {
    haptic('medium');
    action();
    setExpanded(false);
  };

  return (
    <div className="bg-whoop-panel border border-whoop-divider rounded-2xl overflow-hidden">
      {/* Mobile: Expandable */}
      <div className="lg:hidden">
        <button
          onClick={handleToggle}
          disabled={disabled}
          className="w-full flex items-center justify-between p-4 text-left disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <Download className="w-5 h-5 text-primary" />
            <span className="font-medium text-white">Export Data</span>
          </div>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronDown className="w-5 h-5 text-warm-400" />
          </motion.div>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-whoop-divider"
            >
              <div className="p-2 space-y-1">
                <ExportOption
                  icon={FileText}
                  label="Download CSV"
                  onClick={() => handleAction(onDownloadCSV)}
                />
                <ExportOption
                  icon={Mail}
                  label="Email Summary"
                  onClick={() => handleAction(onEmailSummary)}
                />
                <ExportOption
                  icon={Link2}
                  label="Copy Link"
                  onClick={() => handleAction(onCopyLink)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop: Inline row */}
      <div className="hidden lg:flex items-center justify-center gap-4 p-4">
        <button
          onClick={() => handleAction(onDownloadCSV)}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 bg-warm-800 hover:bg-warm-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <FileText className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-white">Download CSV</span>
        </button>
        
        <button
          onClick={() => handleAction(onEmailSummary)}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 bg-warm-800 hover:bg-warm-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <Mail className="w-4 h-4 text-teal" />
          <span className="text-sm font-medium text-white">Email Summary</span>
        </button>
        
        <button
          onClick={() => handleAction(onCopyLink)}
          disabled={disabled}
          className="flex items-center gap-2 px-4 py-2 bg-warm-800 hover:bg-warm-700 rounded-lg transition-colors disabled:opacity-50"
        >
          <Link2 className="w-4 h-4 text-strain" />
          <span className="text-sm font-medium text-white">Copy Link</span>
        </button>
      </div>
    </div>
  );
}

function ExportOption({ 
  icon: Icon, 
  label, 
  onClick 
}: { 
  icon: typeof Download; 
  label: string; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-warm-800 transition-colors"
    >
      <Icon className="w-4 h-4 text-primary" />
      <span className="text-sm text-white">{label}</span>
    </button>
  );
}

export default ExportButton;
