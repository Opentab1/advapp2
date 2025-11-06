import React, { useState } from 'react';
import { X, Shield, FileText } from 'lucide-react';

interface TermsModalProps {
  onAccept: () => void;
  onSkip?: () => void;
  userEmail: string;
}

export const TermsModal: React.FC<TermsModalProps> = ({ onAccept, onSkip, userEmail }) => {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

  const canProceed = termsAccepted && privacyAccepted;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-purple-500/30 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-600/20 to-blue-600/20 border-b border-purple-500/30 p-6">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-purple-400" />
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome to Pulse</h2>
              <p className="text-gray-400 text-sm mt-1">Please review and accept our terms to continue</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <p className="text-gray-300 mb-6">
            Welcome, <span className="text-purple-400 font-semibold">{userEmail}</span>! 
            Before accessing your dashboard, please review and accept our policies.
          </p>

          {/* Terms of Service Section */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3 mb-3">
              <FileText className="w-5 h-5 text-blue-400 mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Terms of Service</h3>
                <div className="text-sm text-gray-400 space-y-2">
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
                      className="text-purple-400 hover:text-purple-300 underline"
                      onClick={(e) => {
                        e.preventDefault();
                        // TODO: Link to full terms document when available
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
                className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-purple-600 focus:ring-2 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-white group-hover:text-purple-300 transition-colors">
                I have read and agree to the Terms of Service
              </span>
            </label>
          </div>

          {/* Privacy Policy Section */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-start gap-3 mb-3">
              <Shield className="w-5 h-5 text-green-400 mt-1 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Privacy Policy</h3>
                <div className="text-sm text-gray-400 space-y-2">
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
                      className="text-green-400 hover:text-green-300 underline"
                      onClick={(e) => {
                        e.preventDefault();
                        // TODO: Link to full privacy policy when available
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
                className="w-5 h-5 rounded border-gray-600 bg-gray-700 text-green-600 focus:ring-2 focus:ring-green-500 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-white group-hover:text-green-300 transition-colors">
                I have read and agree to the Privacy Policy
              </span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-700 p-6 bg-gray-800/30">
          <button
            onClick={onAccept}
            disabled={!canProceed}
            className={`w-full py-3 px-6 rounded-lg font-semibold transition-all ${
              canProceed
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {canProceed ? 'Accept and Continue to Dashboard' : 'Please accept both policies to continue'}
          </button>
          
          {onSkip && (
            <div className="mt-4 text-center">
              <button
                onClick={onSkip}
                className="text-xs text-gray-500 hover:text-gray-400 underline transition-colors"
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
