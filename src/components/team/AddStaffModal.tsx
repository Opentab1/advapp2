/**
 * AddStaffModal - Add a new staff member
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User } from 'lucide-react';
import type { StaffMember } from '../../services/staff.service';

interface AddStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, role: StaffMember['role']) => void;
}

const ROLES: { value: StaffMember['role']; label: string }[] = [
  { value: 'manager', label: 'Manager' },
  { value: 'bartender', label: 'Bartender' },
  { value: 'server', label: 'Server' },
  { value: 'host', label: 'Host' },
  { value: 'other', label: 'Other' },
];

export function AddStaffModal({ isOpen, onClose, onAdd }: AddStaffModalProps) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffMember['role']>('manager');
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onAdd(name.trim(), role);
      setName('');
      setRole('manager');
    }
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-warm-900/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-warm-200">
              <h3 className="text-lg font-bold text-warm-800">Add Staff Member</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-warm-100 transition-colors"
              >
                <X className="w-5 h-5 text-warm-400" />
              </button>
            </div>
            
            {/* Form */}
            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1.5">
                  Name
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-warm-400" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Sarah T."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-warm-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none"
                    autoFocus
                  />
                </div>
              </div>
              
              {/* Role */}
              <div>
                <label className="block text-sm font-medium text-warm-700 mb-1.5">
                  Role
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setRole(r.value)}
                      className={`
                        py-2 px-3 rounded-lg text-sm font-medium transition-colors
                        ${role === r.value
                          ? 'bg-primary text-white'
                          : 'bg-warm-100 text-warm-600 hover:bg-warm-200'
                        }
                      `}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Submit */}
              <button
                type="submit"
                disabled={!name.trim()}
                className="w-full py-3 rounded-xl bg-primary text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary-dark transition-colors"
              >
                Add to Team
              </button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default AddStaffModal;
