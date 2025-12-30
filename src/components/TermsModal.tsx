import React, { useState, useEffect } from 'react';
import { Shield, FileText } from 'lucide-react';

const TERMS_ACCEPTED_KEY = 'pulse_terms_accepted';

interface TermsModalProps {
  onAccept: () => void;
  onSkip?: () => void;
  userEmail: string;
}

/**
 * Check if terms have been accepted on this device
 */
export function hasAcceptedTerms(): boolean {
  try {
    const accepted = localStorage.getItem(TERMS_ACCEPTED_KEY);
    return accepted === 'true';
  } catch {
    return false;
  }
}

/**
 * Save terms acceptance to localStorage
 */
function saveTermsAcceptance(): void {
  try {
    localStorage.setItem(TERMS_ACCEPTED_KEY, 'true');
  } catch (e) {
    console.error('Failed to save terms acceptance:', e);
  }
}

export const TermsModal: React.FC<TermsModalProps> = ({ onAccept, onSkip, userEmail }) => {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const canProceed = termsAccepted && privacyAccepted;

  // Check if already accepted on mount
  useEffect(() => {
    if (hasAcceptedTerms()) {
      onAccept();
    }
  }, [onAccept]);

  const handleAccept = () => {
    saveTermsAcceptance();
    onAccept();
  };

  return (
    <div className="fixed inset-0 bg-warm-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border border-warm-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-primary-50 to-primary-100 border-b border-warm-200 p-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-warm-900">Welcome to Pulse</h2>
              <p className="text-warm-500 text-sm mt-1">Please review and accept our terms to continue</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <p className="text-warm-600 mb-6">
            Welcome, <span className="text-primary font-semibold">{userEmail}</span>! 
            Before accessing your dashboard, please review and accept our policies.
          </p>

          {/* Terms of Service Section */}
          <div className="bg-warm-50 border border-warm-200 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-3 mb-3">
              <FileText className="w-5 h-5 text-primary mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-warm-900 mb-2">Terms of Service</h3>
                <div className="text-sm text-warm-600 space-y-2">
                  <p>By using Pulse, you agree to:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Use the service for lawful business purposes only</li>
                    <li>Maintain the confidentiality of your login credentials</li>
                    <li>Not share your account with unauthorized users</li>
                    <li>Comply with all applicable data protection regulations</li>
                    <li>Report any security concerns immediately</li>
                  </ul>
                  <p className="mt-3">
                    <a 
                      href="#" 
                      className="text-primary hover:text-primary-dark underline font-medium"
                      onClick={(e) => {
                        e.preventDefault();
                        alert('Full Terms of Service document coming soon. Please contact support for details.');
                      }}
                    >
                      Read full Terms of Service →
                    </a>
                  </p>
                </div>
              </div>
            </div>
            
            <label className="flex items-center gap-3 mt-4 cursor-pointer group">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="w-5 h-5 rounded border-warm-300 bg-white text-primary focus:ring-2 focus:ring-primary focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-warm-800 group-hover:text-primary transition-colors font-medium">
                I have read and agree to the Terms of Service
              </span>
            </label>
          </div>

          {/* Privacy Policy Section */}
          <div className="bg-warm-50 border border-warm-200 rounded-xl p-4">
            <div className="flex items-start gap-3 mb-3">
              <Shield className="w-5 h-5 text-success mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-warm-900 mb-2">Privacy Policy</h3>
                <div className="text-sm text-warm-600 space-y-2">
                  <p>We respect your privacy and protect your data:</p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>Your sensor data is encrypted and isolated to your venue only</li>
                    <li>We do not share your data with third parties</li>
                    <li>You can request data deletion at any time</li>
                    <li>We use AWS infrastructure with enterprise-grade security</li>
                    <li>Access logs are maintained for security auditing</li>
                  </ul>
                  <p className="mt-3">
                    <a 
                      href="#" 
                      className="text-success hover:opacity-80 underline font-medium"
                      onClick={(e) => {
                        e.preventDefault();
                        alert('Full Privacy Policy document coming soon. Please contact support for details.');
                      }}
                    >
                      Read full Privacy Policy →
                    </a>
                  </p>
                </div>
              </div>
            </div>
            
            <label className="flex items-center gap-3 mt-4 cursor-pointer group">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                className="w-5 h-5 rounded border-warm-300 bg-white text-success focus:ring-2 focus:ring-success focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-warm-800 group-hover:text-success transition-colors font-medium">
                I have read and agree to the Privacy Policy
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-warm-200 p-6 bg-warm-50">
          <button
            onClick={handleAccept}
            disabled={!canProceed}
            className={`w-full py-3 px-6 rounded-xl font-semibold transition-all ${
              canProceed
                ? 'bg-primary hover:bg-primary-dark text-white shadow-lg'
                : 'bg-warm-200 text-warm-400 cursor-not-allowed'
            }`}
          >
            {canProceed ? 'Accept and Continue to Dashboard' : 'Please accept both policies to continue'}
          </button>
          
          {onSkip && (
            <div className="mt-4 text-center">
              <button
                onClick={onSkip}
                className="text-xs text-warm-400 hover:text-warm-600 underline transition-colors"
              >
                Skip for now (will show again next time)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
